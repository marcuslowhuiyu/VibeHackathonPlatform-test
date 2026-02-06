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
} from '../db/database.js';
import { runTask, stopTask, getTaskStatus, getAllRunningTasks } from '../services/ecs-manager.js';
import {
  createDistribution,
  getDistributionStatus,
  disableDistribution,
  deleteDistribution,
  updateDistributionOrigin,
} from '../services/cloudfront-manager.js';

const router = Router();

// Helper to create CloudFront distribution for an instance
async function ensureCloudFrontDistribution(instance: Instance, publicIp: string): Promise<void> {
  console.log(`[CloudFront] Checking instance ${instance.id}: publicIp=${publicIp}, existing_cf=${instance.cloudfront_distribution_id}`);

  // Skip if no public IP
  if (!publicIp) {
    return;
  }

  // If already has CloudFront, check status and update origin if IP changed
  if (instance.cloudfront_distribution_id) {
    try {
      const status = await getDistributionStatus(instance.cloudfront_distribution_id);
      if (status) {
        // Check if IP has changed - need to update CloudFront origin
        if (instance.public_ip && instance.public_ip !== publicIp) {
          console.log(`[CloudFront] IP changed for ${instance.id}: ${instance.public_ip} -> ${publicIp}, updating origin...`);
          await updateDistributionOrigin(instance.cloudfront_distribution_id, publicIp);
          updateInstance(instance.id, {
            public_ip: publicIp,
            cloudfront_status: 'InProgress', // Will be deploying after update
          });
          instance.public_ip = publicIp;
          instance.cloudfront_status = 'InProgress';
        } else if (status.status !== instance.cloudfront_status) {
          updateInstance(instance.id, {
            cloudfront_status: status.status,
          });
          instance.cloudfront_status = status.status;
        }
      }
    } catch (err) {
      console.error(`Error checking/updating CloudFront for ${instance.id}:`, err);
    }
    return;
  }

  // Create new CloudFront distribution
  try {
    console.log(`Creating CloudFront distribution for instance ${instance.id} with IP ${publicIp}`);
    const distribution = await createDistribution(instance.id, publicIp);

    updateInstance(instance.id, {
      cloudfront_distribution_id: distribution.distributionId,
      cloudfront_domain: distribution.domainName,
      cloudfront_status: distribution.status,
      public_ip: publicIp,
    });

    instance.cloudfront_distribution_id = distribution.distributionId;
    instance.cloudfront_domain = distribution.domainName;
    instance.cloudfront_status = distribution.status;
    instance.public_ip = publicIp;

    console.log(`CloudFront distribution created: ${distribution.domainName}`);
  } catch (err: any) {
    console.error(`ERROR creating CloudFront distribution for ${instance.id}:`, err.message);
    console.error(`Full error:`, JSON.stringify(err, null, 2));
    // Don't fail the whole request, just log the error
    // The instance will still work with direct IP access
  }
}

// Helper to clean up CloudFront distribution
async function cleanupCloudFront(instance: Instance): Promise<void> {
  if (!instance.cloudfront_distribution_id) return;

  try {
    console.log(`Disabling CloudFront distribution for instance ${instance.id}`);
    await disableDistribution(instance.cloudfront_distribution_id);
    // Note: Full deletion happens asynchronously after distribution is deployed
    // We could set up a background job to clean these up later
  } catch (err: any) {
    console.error(`Error disabling CloudFront for ${instance.id}:`, err);
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

            // Create CloudFront distribution if we have a public IP and instance is running
            if (taskInfo.publicIp && newStatus === 'running') {
              await ensureCloudFrontDistribution(instance, taskInfo.publicIp);
            }

            // Use CloudFront URLs (HTTPS) if available - works even while status is "InProgress"
            // CloudFront distributions are usable within 1-2 minutes of creation, no need to wait for "Deployed"
            let vscodeUrl: string | null = null;
            let appUrl: string | null = null;

            if (instance.cloudfront_domain) {
              // CloudFront URL available - use HTTPS for VS Code (works even during deployment)
              vscodeUrl = `https://${instance.cloudfront_domain}`;
              // CloudFront only proxies port 8080 (VS Code), so React app must use direct IP
              appUrl = taskInfo.publicIp ? `http://${taskInfo.publicIp}:3000` : null;
            } else if (taskInfo.publicIp) {
              // Fall back to direct IP if CloudFront not yet created
              vscodeUrl = `http://${taskInfo.publicIp}:8080`;
              appUrl = `http://${taskInfo.publicIp}:3000`;
            }

            // Update if any field has changed
            if (instance.status !== newStatus || instance.vscode_url !== vscodeUrl || instance.app_url !== appUrl) {
              updateInstance(instance.id, {
                status: newStatus,
                vscode_url: vscodeUrl,
                app_url: appUrl,
                public_ip: taskInfo.publicIp || instance.public_ip,
              });
              instance.status = newStatus;
              instance.vscode_url = vscodeUrl;
              instance.app_url = appUrl;
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
    const validExtensions = ['continue', 'cline'];
    // const validExtensions = ['continue', 'cline', 'roo-code']; // Enable roo-code when ready

    const extPrefixes: Record<string, string> = {
      continue: 'ct',
      cline: 'cl',
      // 'roo-code': 'rc', // Enable when ready
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
          await cleanupCloudFront(instance);
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
        await cleanupCloudFront(instance);
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
        const vscodeUrl = taskInfo.publicIp ? `http://${taskInfo.publicIp}:8080` : null;
        const appUrl = taskInfo.publicIp ? `http://${taskInfo.publicIp}:3000` : null;

        updateInstance(instance.id, {
          status: taskInfo.status.toLowerCase(),
          vscode_url: vscodeUrl,
          app_url: appUrl,
        });

        instance.status = taskInfo.status.toLowerCase();
        instance.vscode_url = vscodeUrl;
        instance.app_url = appUrl;
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
    await cleanupCloudFront(instance);
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
    await cleanupCloudFront(instance);

    // Start new ECS task
    const taskInfo = await runTask(instance.id);

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
    await cleanupCloudFront(instance);

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
      vscode_url: taskInfo.publicIp ? `http://${taskInfo.publicIp}:8080` : null,
      app_url: taskInfo.publicIp ? `http://${taskInfo.publicIp}:3000` : null,
      public_ip: taskInfo.publicIp,
    });

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
