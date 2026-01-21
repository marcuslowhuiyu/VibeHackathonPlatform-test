import { Router } from 'express';
import { nanoid } from 'nanoid';
import {
  createInstance,
  getAllInstances,
  getInstanceById,
  updateInstance,
  deleteInstance,
  Instance,
} from '../db/database.js';
import { runTask, stopTask, getTaskStatus } from '../services/ecs-manager.js';

const router = Router();

// Get all instances
router.get('/', async (req, res) => {
  try {
    const instances = getAllInstances();

    // Update status from AWS for running instances
    const updatedInstances = await Promise.all(
      instances.map(async (instance) => {
        if (instance.task_arn && ['provisioning', 'running', 'pending'].includes(instance.status)) {
          const taskInfo = await getTaskStatus(instance.task_arn);
          if (taskInfo) {
            const newStatus = taskInfo.status.toLowerCase();
            const vscodeUrl = taskInfo.publicIp ? `http://${taskInfo.publicIp}:8080` : null;
            const appUrl = taskInfo.publicIp ? `http://${taskInfo.publicIp}:3000` : null;

            if (instance.status !== newStatus || instance.vscode_url !== vscodeUrl) {
              updateInstance(instance.id, {
                status: newStatus,
                vscode_url: vscodeUrl,
                app_url: appUrl,
              });
              instance.status = newStatus;
              instance.vscode_url = vscodeUrl;
              instance.app_url = appUrl;
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
    const { count = 1 } = req.body;

    if (count < 1 || count > 100) {
      return res.status(400).json({ error: 'Count must be between 1 and 100' });
    }

    const results: Instance[] = [];
    const errors: string[] = [];

    // Spin up instances in parallel for faster provisioning
    const promises = Array.from({ length: count }, async (_, i) => {
      const instanceId = `vibe-${nanoid(8)}`;

      try {
        // Create local record
        const instance = createInstance(instanceId);

        // Start ECS task
        const taskInfo = await runTask(instanceId);

        // Update with task ARN
        updateInstance(instanceId, {
          task_arn: taskInfo.taskArn,
          status: taskInfo.status.toLowerCase(),
        });

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

    // Start new ECS task
    const taskInfo = await runTask(instance.id);

    updateInstance(instance.id, {
      task_arn: taskInfo.taskArn,
      status: taskInfo.status.toLowerCase(),
      vscode_url: null,
      app_url: null,
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

export default router;
