import { Router } from 'express';
import { getAllConfig, setConfig } from '../db/database.js';

const router = Router();

// Get all config
router.get('/', (req, res) => {
  const config = getAllConfig();
  res.json(config);
});

// Update config
router.put('/', (req, res) => {
  const allowedKeys = [
    'cluster_name',
    'task_definition',
    'vpc_id',
    'subnet_ids',
    'security_group_id',
    'alb_arn',
    'listener_arn',
  ];

  const updates: Record<string, string> = {};

  for (const key of allowedKeys) {
    if (req.body[key] !== undefined) {
      setConfig(key, req.body[key]);
      updates[key] = req.body[key];
    }
  }

  res.json({ success: true, updated: updates });
});

// Update single config key
router.put('/:key', (req, res) => {
  const { key } = req.params;
  const { value } = req.body;

  if (value === undefined) {
    return res.status(400).json({ error: 'value is required' });
  }

  setConfig(key, value);
  res.json({ success: true });
});

export default router;
