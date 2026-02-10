import { Router } from 'express';
import { nanoid } from 'nanoid';
import {
  createInstance,
  getAllInstances,
  getInstanceById,
  updateInstance,
  deleteInstance,
  Instance,
  getUnassignedParticipants,
  assignParticipantToInstance,
  getConfig,
} from '../db/database.js';
import { runTask, stopTask, getTaskStatus, getAllRunningTasks } from '../services/ecs-manager.js';
import {
  disableDistribution,
} from '../services/cloudfront-manager.js';
import {
  getCodingLabALBConfig,
  registerCodingInstance,
  deregisterCodingInstance,
  getCodingLabCloudFrontDomain,
} from '../services/coding-lab-alb.js';

const router = Router();

// Helper to register instance with shared ALB
async function registerInstanceWithALB(instance: Instance, publicIp: string, privateIp?: string): Promise<void> {
  console.log(`[ALB] Checking instance ${instance.id}: publicIp=${publicIp}, privateIp=${privateIp}, existing_tg=${instance.alb_target_group_arn}`);

  // Skip if no public IP
  if (!publicIp) {
    return;
  }

  // Already registered with ALB
  if (instance.alb_target_group_arn && instance.alb_rule_arn) {
    const updates: Partial<Instance> = {};

    // Update public IP if changed
    if (instance.public_ip !== publicIp) {
      updates.public_ip = publicIp;
      instance.public_ip = publicIp;
    }

    // Reconstruct URL if missing, or upgrade to HTTPS if CloudFront is now available
    const cloudfrontDomain = getCodingLabCloudFrontDomain();
    const accessPath = instance.alb_access_path || `/i/${instance.id}`;
    if (!instance.vscode_url) {
      // URL is null despite being registered - reconstruct it
      const albConfig = getCodingLabALBConfig();
      const url = cloudfrontDomain
        ? `https://${cloudfrontDomain}${accessPath}/`
        : albConfig
          ? `http://${albConfig.albDnsName}${accessPath}/`
          : `http://${publicIp}:8080`;
      updates.vscode_url = url;
      instance.vscode_url = url;
    } else if (cloudfrontDomain && !instance.vscode_url.startsWith('https://')) {
      const httpsUrl = `https://${cloudfrontDomain}${accessPath}/`;
      updates.vscode_url = httpsUrl;
      instance.vscode_url = httpsUrl;
    }

    if (Object.keys(updates).length > 0) {
      updateInstance(instance.id, updates);
    }
    return;
  }

  const albConfig = getCodingLabALBConfig();
  if (!albConfig) {
    console.log(`[ALB] ALB not configured - run setup first`);
    // Fall back to direct IP access
    updateInstance(instance.id, {
      public_ip: publicIp,
      vscode_url: `http://${publicIp}:8080`,
      app_url: `http://${publicIp}:3000`,
    });
    return;
  }

  const vpcId = getConfig('vpc_id');
  if (!vpcId) {
    console.log(`[ALB] VPC ID not configured - falling back to direct IP access`);
    updateInstance(instance.id, {
      public_ip: publicIp,
      vscode_url: `http://${publicIp}:8080`,
      app_url: `http://${publicIp}:3000`,
    });
    return;
  }

  try {
    console.log(`[ALB] Registering instance ${instance.id} with ALB`);
    const result = await registerCodingInstance(
      instance.id,
      privateIp || publicIp,
      vpcId,
      albConfig.listenerArn
    );

    // Build the VS Code URL using the shared CloudFront domain
    const cloudfrontDomain = getCodingLabCloudFrontDomain();
    const vscodeUrl = cloudfrontDomain
      ? `https://${cloudfrontDomain}${result.accessPath}/`
      : `http://${albConfig.albDnsName}${result.accessPath}/`;

    updateInstance(instance.id, {
      alb_target_group_arn: result.targetGroupArn,
      alb_rule_arn: result.ruleArn,
      alb_access_path: result.accessPath,
      public_ip: publicIp,
      vscode_url: vscodeUrl,
      app_url: `http://${publicIp}:3000`,
    });

    instance.alb_target_group_arn = result.targetGroupArn;
    instance.alb_rule_arn = result.ruleArn;
    instance.alb_access_path = result.accessPath;
    instance.public_ip = publicIp;
    instance.vscode_url = vscodeUrl;
    instance.app_url = `http://${publicIp}:3000`;

    console.log(`[ALB] Instance registered: ${vscodeUrl}`);
  } catch (err: any) {
    console.error(`[ALB] Error registering instance ${instance.id}:`, err.message);
    // Fall back to direct IP access
    updateInstance(instance.id, {
      public_ip: publicIp,
      vscode_url: `http://${publicIp}:8080`,
      app_url: `http://${publicIp}:3000`,
    });
  }
}

// Helper to clean up ALB registration (and legacy CloudFront if present)
async function cleanupInstanceRouting(instance: Instance): Promise<void> {
  // Clean up ALB resources
  if (instance.alb_target_group_arn || instance.alb_rule_arn) {
    try {
      console.log(`[ALB] Deregistering instance ${instance.id} from ALB`);
      await deregisterCodingInstance(
        instance.alb_target_group_arn || '',
        instance.alb_rule_arn || ''
      );
    } catch (err: any) {
      console.error(`[ALB] Error deregistering instance ${instance.id}:`, err);
    }

    // Clear ALB fields so registerInstanceWithALB will re-register on next start
    updateInstance(instance.id, {
      alb_target_group_arn: undefined,
      alb_rule_arn: undefined,
      alb_access_path: undefined,
    });
    instance.alb_target_group_arn = undefined;
    instance.alb_rule_arn = undefined;
    instance.alb_access_path = undefined;
  }

  // Clean up legacy per-instance CloudFront if present (for backwards compatibility)
  if (instance.cloudfront_distribution_id) {
    try {
      console.log(`[Legacy] Disabling CloudFront distribution for instance ${instance.id}`);
      await disableDistribution(instance.cloudfront_distribution_id);
    } catch (err: any) {
      console.error(`[Legacy] Error disabling CloudFront for ${instance.id}:`, err);
    }
  }
}

// Get all instances
router.get('/', async (req, res) => {
  try {
    const instances = getAllInstances();

    // Update status from AWS for active instances (including stopping)
    const updatedInstances = await Promise.all(
      instances.map(async (instance) => {
        if (instance.task_arn && ['provisioning', 'running', 'pending', 'stopping'].includes(instance.status)) {
          const taskInfo = await getTaskStatus(instance.task_arn);
          if (taskInfo) {
            const newStatus = taskInfo.status.toLowerCase();

            // Register with ALB if we have a public IP and instance is running
            if (taskInfo.publicIp && newStatus === 'running') {
              await registerInstanceWithALB(instance, taskInfo.publicIp, taskInfo.privateIp);
            }

            // Update status if changed (URLs are set by registerInstanceWithALB)
            if (instance.status !== newStatus) {
              updateInstance(instance.id, {
                status: newStatus,
                public_ip: taskInfo.publicIp || instance.public_ip,
              });
              instance.status = newStatus;
              instance.public_ip = taskInfo.publicIp || instance.public_ip;
            }
          }
        }
        return instance;
      })
    );

    res.json(updatedInstances);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Spin up new instances
router.post('/spin-up', async (req, res) => {
  try {
    const { count = 1, extension = 'continue', autoAssignParticipants = true } = req.body;

    if (count < 1 || count > 100) {
      return res.status(400).json({ error: 'Count must be between 1 and 100' });
    }

    // ==========================================
    // AI EXTENSION VALIDATION
    // To add new extensions:
    // 1. Add to validExtensions array
    // 2. Add to extPrefixes map
    // ==========================================
    const validExtensions = ['continue', 'cline', 'vibe', 'vibe-pro'];

    const extPrefixes: Record<string, string> = {
      continue: 'ct',
      cline: 'cl',
      vibe: 'vb',
      'vibe-pro': 'vp',
    };

    if (!validExtensions.includes(extension)) {
      return res.status(400).json({ error: `Invalid extension. Valid options: ${validExtensions.join(', ')}` });
    }

    // Use extension abbreviation for instance ID
    const extPrefix = extPrefixes[extension] || 'ct';

    // Get unassigned participants if auto-assign is enabled
    const unassignedParticipants = autoAssignParticipants ? getUnassignedParticipants() : [];

    const results: Instance[] = [];
    const errors: string[] = [];
    const assignedParticipants: string[] = [];

    // Spin up instances in parallel for faster provisioning
    const promises = Array.from({ length: count }, async (_, i) => {
      const instanceId = `vibe-${extPrefix}-${nanoid(5)}`;

      try {
        // Create local record with extension info
        const instance = createInstance(instanceId, extension);

        // Start ECS task with specific extension image
        const taskInfo = await runTask(instanceId, extension);

        // Update with task ARN
        updateInstance(instanceId, {
          task_arn: taskInfo.taskArn,
          status: taskInfo.status.toLowerCase(),
        });

        // Auto-assign participant if available
        if (autoAssignParticipants && i < unassignedParticipants.length) {
          const participant = unassignedParticipants[i];
          assignParticipantToInstance(participant.id, instanceId);
          assignedParticipants.push(participant.name);

          // Update the instance object with participant info
          instance.participant_name = participant.name;
          instance.participant_email = participant.email;
          instance.notes = participant.notes;
        }

        results.push({
          ...instance,
          task_arn: taskInfo.taskArn,
          status: taskInfo.status.toLowerCase(),
        });
      } catch (err: any) {
        errors.push(`Instance ${i + 1}: ${err.message}`);
      }
    });

    await Promise.all(promises);

    res.json({
      success: results.length > 0,
      instances: results,
      participantsAssigned: assignedParticipants.length,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Stop all running instances - MUST be before /:id routes
router.post('/stop-all', async (req, res) => {
  try {
    const instances = getAllInstances();
    const runningInstances = instances.filter((i) =>
      ['running', 'provisioning', 'pending'].includes(i.status.toLowerCase())
    );

    const results: string[] = [];
    const errors: string[] = [];

    // Stop in parallel for faster execution
    const promises = runningInstances.map(async (instance) => {
      try {
        if (instance.task_arn) {
          await stopTask(instance.task_arn);
          // Clean up CloudFront distribution
          await cleanupInstanceRouting(instance);
          updateInstance(instance.id, { status: 'stopping' });
          results.push(instance.id);
        }
      } catch (err: any) {
        errors.push(`${instance.id}: ${err.message}`);
      }
    });

    await Promise.all(promises);

    res.json({
      success: true,
      stopped: results.length,
      total: runningInstances.length,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Delete all instances - MUST be before /:id routes
router.delete('/all', async (req, res) => {
  try {
    const instances = getAllInstances();
    const results: string[] = [];
    const errors: string[] = [];

    // Process in parallel
    const promises = instances.map(async (instance) => {
      try {
        // Stop task if running
        if (instance.task_arn && ['running', 'provisioning', 'pending'].includes(instance.status)) {
          try {
            await stopTask(instance.task_arn);
          } catch (err) {
            // Task might already be stopped
          }
        }
        // Clean up CloudFront distribution
        await cleanupInstanceRouting(instance);
        deleteInstance(instance.id);
        results.push(instance.id);
      } catch (err: any) {
        errors.push(`${instance.id}: ${err.message}`);
      }
    });

    await Promise.all(promises);

    res.json({
      success: true,
      deleted: results.length,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Get single instance
router.get('/:id', async (req, res) => {
  try {
    const instance = getInstanceById(req.params.id);

    if (!instance) {
      return res.status(404).json({ error: 'Instance not found' });
    }

    // Refresh status from AWS
    if (instance.task_arn) {
      const taskInfo = await getTaskStatus(instance.task_arn);
      if (taskInfo) {
        const newStatus = taskInfo.status.toLowerCase();

        // Register with ALB if we have a public IP and instance is running
        if (taskInfo.publicIp && newStatus === 'running') {
          await registerInstanceWithALB(instance, taskInfo.publicIp, taskInfo.privateIp);
        }

        // Update status if changed
        if (instance.status !== newStatus) {
          updateInstance(instance.id, {
            status: newStatus,
            public_ip: taskInfo.publicIp || instance.public_ip,
          });
          instance.status = newStatus;
          instance.public_ip = taskInfo.publicIp || instance.public_ip;
        }
      }
    }

    res.json(instance);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Stop an instance
router.post('/:id/stop', async (req, res) => {
  try {
    const instance = getInstanceById(req.params.id);

    if (!instance) {
      return res.status(404).json({ error: 'Instance not found' });
    }

    if (!instance.task_arn) {
      return res.status(400).json({ error: 'Instance has no associated task' });
    }

    await stopTask(instance.task_arn);
    // Clean up CloudFront distribution
    await cleanupInstanceRouting(instance);
    updateInstance(instance.id, { status: 'stopping' });

    res.json({ success: true, message: 'Stop signal sent' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Start a stopped instance (creates new task)
router.post('/:id/start', async (req, res) => {
  try {
    const instance = getInstanceById(req.params.id);

    if (!instance) {
      return res.status(404).json({ error: 'Instance not found' });
    }

    // Clean up old CloudFront distribution if exists (IP will change)
    await cleanupInstanceRouting(instance);

    // Start new ECS task with the correct extension
    const taskInfo = await runTask(instance.id, instance.ai_extension || 'continue');

    updateInstance(instance.id, {
      task_arn: taskInfo.taskArn,
      status: taskInfo.status.toLowerCase(),
      vscode_url: null,
      app_url: null,
      // Reset CloudFront fields since IP will change
      cloudfront_distribution_id: undefined,
      cloudfront_domain: undefined,
      cloudfront_status: undefined,
      public_ip: undefined,
    });

    res.json({ success: true, taskArn: taskInfo.taskArn });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Delete an instance
router.delete('/:id', async (req, res) => {
  try {
    const instance = getInstanceById(req.params.id);

    if (!instance) {
      return res.status(404).json({ error: 'Instance not found' });
    }

    // Stop task if running
    if (instance.task_arn && ['running', 'provisioning', 'pending'].includes(instance.status)) {
      try {
        await stopTask(instance.task_arn);
      } catch (err) {
        // Task might already be stopped
      }
    }

    // Clean up CloudFront distribution
    await cleanupInstanceRouting(instance);

    // Delete local record
    deleteInstance(instance.id);

    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Update instance metadata (participant info, notes)
router.patch('/:id', async (req, res) => {
  try {
    const instance = getInstanceById(req.params.id);

    if (!instance) {
      return res.status(404).json({ error: 'Instance not found' });
    }

    const { participant_name, participant_email, notes } = req.body;
    updateInstance(instance.id, {
      participant_name,
      participant_email,
      notes,
    });

    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Scan for orphaned instances (running on AWS but not tracked in dashboard)
router.get('/orphaned/scan', async (req, res) => {
  try {
    // Get all running tasks from AWS
    const runningTasks = await getAllRunningTasks();

    // Get all tracked instances from database
    const trackedInstances = getAllInstances();
    const trackedTaskArns = new Set(
      trackedInstances
        .filter((i) => i.task_arn)
        .map((i) => i.task_arn)
    );

    // Find orphaned tasks (running on AWS but not in our database)
    const orphanedTasks = runningTasks.filter(
      (task) => !trackedTaskArns.has(task.taskArn)
    );

    res.json({
      total_running: runningTasks.length,
      tracked: trackedInstances.filter((i) => i.task_arn).length,
      orphaned: orphanedTasks.length,
      orphaned_tasks: orphanedTasks.map((task) => ({
        task_arn: task.taskArn,
        task_id: task.taskId,
        status: task.status,
        public_ip: task.publicIp,
        private_ip: task.privateIp,
        started_at: task.startedAt,
        task_definition: task.taskDefinition,
        vscode_url: task.publicIp ? `http://${task.publicIp}:8080` : null,
        app_url: task.publicIp ? `http://${task.publicIp}:3000` : null,
      })),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Import an orphaned task into the dashboard
router.post('/orphaned/import', async (req, res) => {
  try {
    const { task_arn, task_id } = req.body;

    if (!task_arn) {
      return res.status(400).json({ error: 'task_arn is required' });
    }

    // Check if already tracked
    const existing = getAllInstances().find((i) => i.task_arn === task_arn);
    if (existing) {
      return res.status(400).json({ error: 'Task is already tracked', instance_id: existing.id });
    }

    // Get current task status
    const taskInfo = await getTaskStatus(task_arn);
    if (!taskInfo) {
      return res.status(404).json({ error: 'Task not found on AWS' });
    }

    // Create instance record
    const instanceId = `imported-${task_id || nanoid(8)}`;
    const instance = createInstance(instanceId);

    // Update with task info
    updateInstance(instanceId, {
      task_arn: task_arn,
      status: taskInfo.status.toLowerCase(),
      public_ip: taskInfo.publicIp,
    });

    // Register with ALB if running with a public IP
    if (taskInfo.publicIp && taskInfo.status.toLowerCase() === 'running') {
      const updatedInstance = getInstanceById(instanceId);
      if (updatedInstance) {
        await registerInstanceWithALB(updatedInstance, taskInfo.publicIp, taskInfo.privateIp);
      }
    }

    res.json({
      success: true,
      instance_id: instanceId,
      message: 'Task imported successfully',
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Terminate an orphaned task (without importing it)
router.post('/orphaned/terminate', async (req, res) => {
  try {
    const { task_arn } = req.body;

    if (!task_arn) {
      return res.status(400).json({ error: 'task_arn is required' });
    }

    // Check if tracked - if so, use normal delete flow
    const existing = getAllInstances().find((i) => i.task_arn === task_arn);
    if (existing) {
      return res.status(400).json({
        error: 'Task is tracked in dashboard. Use the delete instance endpoint instead.',
        instance_id: existing.id,
      });
    }

    // Stop the task directly
    await stopTask(task_arn);

    res.json({
      success: true,
      message: 'Orphaned task terminated',
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Terminate all orphaned tasks
router.post('/orphaned/terminate-all', async (req, res) => {
  try {
    // Get all running tasks from AWS
    const runningTasks = await getAllRunningTasks();

    // Get tracked task ARNs
    const trackedInstances = getAllInstances();
    const trackedTaskArns = new Set(
      trackedInstances
        .filter((i) => i.task_arn)
        .map((i) => i.task_arn)
    );

    // Find and terminate orphaned tasks
    const orphanedTasks = runningTasks.filter(
      (task) => !trackedTaskArns.has(task.taskArn)
    );

    const results = {
      total: orphanedTasks.length,
      terminated: 0,
      errors: [] as string[],
    };

    for (const task of orphanedTasks) {
      try {
        await stopTask(task.taskArn);
        results.terminated++;
      } catch (err: any) {
        results.errors.push(`${task.taskId}: ${err.message}`);
      }
    }

    res.json({
      success: true,
      ...results,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
