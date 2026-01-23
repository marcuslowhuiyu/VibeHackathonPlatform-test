import { Router } from 'express';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { runFullSetup, checkSetupStatus, getDockerPushCommands, checkDockerAvailable, buildAndPushImage } from '../services/aws-setup.js';

const router = Router();

// Get the project root directory (two levels up from server/routes)
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = join(__dirname, '..', '..', '..');

// Editable files configuration
const EDITABLE_FILES: Record<string, { path: string; description: string; language: string }> = {
  'Dockerfile': {
    path: join(PROJECT_ROOT, 'cline-setup', 'Dockerfile'),
    description: 'Docker image configuration - defines the container environment',
    language: 'dockerfile',
  },
  'entrypoint.sh': {
    path: join(PROJECT_ROOT, 'cline-setup', 'entrypoint.sh'),
    description: 'Container startup script - runs when the container starts',
    language: 'bash',
  },
  'cline-config.json': {
    path: join(PROJECT_ROOT, 'cline-setup', 'cline-config.json'),
    description: 'Cline AI assistant settings - model, instructions, auto-approval',
    language: 'json',
  },
};

// Check current setup status
router.get('/status', async (req, res) => {
  try {
    const status = await checkSetupStatus();
    res.json(status);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Run full AWS setup
router.post('/run', async (req, res) => {
  try {
    const result = await runFullSetup();
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Get Docker push commands
router.get('/docker-commands', async (req, res) => {
  try {
    const commands = await getDockerPushCommands();
    res.json({ commands });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Check if Docker is available
router.get('/docker-status', async (req, res) => {
  try {
    const status = await checkDockerAvailable();
    res.json(status);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Build and push Docker image (original - for backwards compatibility)
router.post('/build-and-push', async (req, res) => {
  try {
    const result = await buildAndPushImage();
    res.json(result);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Build and push Docker image with SSE streaming progress
router.get('/build-and-push-stream', async (req, res) => {
  // Set up SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const sendEvent = (data: object) => {
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  try {
    const result = await buildAndPushImage((progress) => {
      sendEvent({ type: 'progress', ...progress });
    });

    sendEvent({ type: 'complete', success: result.success, steps: result.steps, error: result.error });
  } catch (err: any) {
    sendEvent({ type: 'error', error: err.message });
  } finally {
    res.end();
  }
});

// List editable files
router.get('/files', (req, res) => {
  const files = Object.entries(EDITABLE_FILES).map(([name, config]) => ({
    name,
    description: config.description,
    language: config.language,
    exists: existsSync(config.path),
  }));
  res.json({ files });
});

// Get file content
router.get('/files/:filename', (req, res) => {
  const { filename } = req.params;
  const fileConfig = EDITABLE_FILES[filename];

  if (!fileConfig) {
    return res.status(404).json({ error: 'File not found' });
  }

  try {
    if (!existsSync(fileConfig.path)) {
      return res.status(404).json({ error: 'File does not exist on disk' });
    }

    const content = readFileSync(fileConfig.path, 'utf-8');
    res.json({
      name: filename,
      content,
      description: fileConfig.description,
      language: fileConfig.language,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Save file content
router.put('/files/:filename', (req, res) => {
  const { filename } = req.params;
  const { content } = req.body;
  const fileConfig = EDITABLE_FILES[filename];

  if (!fileConfig) {
    return res.status(404).json({ error: 'File not found' });
  }

  if (typeof content !== 'string') {
    return res.status(400).json({ error: 'Content must be a string' });
  }

  try {
    writeFileSync(fileConfig.path, content, 'utf-8');
    res.json({ success: true, message: `${filename} saved successfully` });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Test CloudFront creation (for debugging)
router.post('/test-cloudfront', async (req, res) => {
  try {
    const { CloudFrontClient, ListDistributionsCommand } = await import('@aws-sdk/client-cloudfront');
    const { getCredentials } = await import('../db/database.js');

    const creds = getCredentials();
    if (!creds) {
      return res.status(400).json({ error: 'No credentials configured' });
    }

    const client = new CloudFrontClient({
      region: 'us-east-1',
      credentials: {
        accessKeyId: creds.access_key_id,
        secretAccessKey: creds.secret_access_key,
      },
    });

    // Test basic CloudFront access
    const result = await client.send(new ListDistributionsCommand({ MaxItems: 1 }));

    res.json({
      success: true,
      message: 'CloudFront access OK',
      distributionCount: result.DistributionList?.Items?.length || 0
    });
  } catch (err: any) {
    res.status(500).json({
      error: err.message,
      code: err.name,
      details: err.$metadata || null
    });
  }
});

export default router;
