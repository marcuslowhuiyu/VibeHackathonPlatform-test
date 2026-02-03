import { Router } from 'express';
import {
  getCredentials,
  saveCredentials,
  deleteCredentials,
} from '../db/database.js';
import { validateCredentials } from '../services/ecs-manager.js';

const router = Router();

// Get credentials (masked)
router.get('/', (req, res) => {
  const creds = getCredentials();

  if (!creds) {
    return res.json({ configured: false });
  }

  res.json({
    configured: true,
    accessKeyId: creds.access_key_id.slice(0, 4) + '****' + creds.access_key_id.slice(-4),
    region: creds.region,
  });
});

// Save credentials
router.post('/', (req, res) => {
  const { accessKeyId, secretAccessKey, region = 'ap-southeast-1' } = req.body;

  if (!accessKeyId || !secretAccessKey) {
    return res.status(400).json({ error: 'accessKeyId and secretAccessKey are required' });
  }

  saveCredentials({
    access_key_id: accessKeyId,
    secret_access_key: secretAccessKey,
    region,
  });

  res.json({ success: true });
});

// Validate credentials
router.get('/validate', async (req, res) => {
  const creds = getCredentials();

  if (!creds) {
    return res.json({ valid: false, message: 'No credentials configured' });
  }

  const result = await validateCredentials();
  res.json(result);
});

// Delete credentials
router.delete('/', (req, res) => {
  deleteCredentials();
  res.json({ success: true });
});

export default router;
