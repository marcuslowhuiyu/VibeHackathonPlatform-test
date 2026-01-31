import { Router } from 'express';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { runFullSetup, checkSetupStatus, getDockerPushCommands, checkDockerAvailable, buildAndPushImage } from '../services/aws-setup.js';
import * as codebuild from '../services/codebuild-manager.js';

const router = Router();

// Get the project root directory (two levels up from server/routes)
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PROJECT_ROOT = join(__dirname, '..', '..', '..');

// Use EFS for editable files if DATA_DIR is set (production), otherwise use local
const EFS_CLINE_DIR = process.env.DATA_DIR ? join(process.env.DATA_DIR, '..', 'cline-setup') : null;
const LOCAL_CLINE_DIR = join(PROJECT_ROOT, 'cline-setup');

// Initialize EFS cline-setup directory with default files if needed
function initEfsClineSetup() {
  if (!EFS_CLINE_DIR) return;

  try {
    if (!existsSync(EFS_CLINE_DIR)) {
      const { mkdirSync, copyFileSync } = require('fs');
      mkdirSync(EFS_CLINE_DIR, { recursive: true });

      // Copy default files from container to EFS
      const files = ['Dockerfile', 'entrypoint.sh', 'cline-config.json'];
      for (const file of files) {
        const src = join(LOCAL_CLINE_DIR, file);
        const dest = join(EFS_CLINE_DIR, file);
        if (existsSync(src) && !existsSync(dest)) {
          copyFileSync(src, dest);
          console.log(`Copied ${file} to EFS`);
        }
      }
    }
  } catch (err) {
    console.error('Failed to init EFS cline-setup:', err);
  }
}

// Initialize on module load
initEfsClineSetup();

// Get the appropriate path for editable files
function getEditableFilePath(filename: string): string {
  // In production with EFS, use EFS path; otherwise use local
  if (EFS_CLINE_DIR && existsSync(EFS_CLINE_DIR)) {
    return join(EFS_CLINE_DIR, filename);
  }
  return join(LOCAL_CLINE_DIR, filename);
}

// Editable files configuration
const EDITABLE_FILES: Record<string, { description: string; language: string }> = {
  'Dockerfile': {
    description: 'Docker image configuration - defines the container environment',
    language: 'dockerfile',
  },
  'entrypoint.sh': {
    description: 'Container startup script - runs when the container starts',
    language: 'bash',
  },
  'cline-config.json': {
    description: 'Continue AI assistant settings - model, instructions, auto-approval',
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
// Only builds Continue extension
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
    // Only build Continue extension
    const extensions: ('continue')[] = ['continue'];

    const result = await buildAndPushImage((progress) => {
      sendEvent({ type: 'progress', ...progress });
    }, extensions);

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
    exists: existsSync(getEditableFilePath(name)),
    location: EFS_CLINE_DIR ? 'EFS (persistent)' : 'Local (container)',
  }));
  res.json({ files, usingEfs: !!EFS_CLINE_DIR });
});

// Get file content
router.get('/files/:filename', (req, res) => {
  const { filename } = req.params;
  const fileConfig = EDITABLE_FILES[filename];

  if (!fileConfig) {
    return res.status(404).json({ error: 'File not found' });
  }

  try {
    const filePath = getEditableFilePath(filename);
    if (!existsSync(filePath)) {
      return res.status(404).json({ error: 'File does not exist on disk' });
    }

    const content = readFileSync(filePath, 'utf-8');
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
    const filePath = getEditableFilePath(filename);
    writeFileSync(filePath, content, 'utf-8');
    res.json({ success: true, message: `${filename} saved successfully${EFS_CLINE_DIR ? ' to EFS' : ''}` });
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

// ==========================================
// CodeBuild Routes - for building without Docker
// ==========================================

// Check if CodeBuild project exists
router.get('/codebuild/status', async (req, res) => {
  try {
    const exists = await codebuild.checkProjectExists();
    res.json({ exists, projectName: 'vibe-coding-lab-builder' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Start a CodeBuild build
router.post('/codebuild/start', async (req, res) => {
  try {
    const buildId = await codebuild.startBuild();
    res.json({ success: true, buildId });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Get build status
router.get('/codebuild/build/:buildId', async (req, res) => {
  try {
    const status = await codebuild.getBuildStatus(req.params.buildId);
    res.json(status);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
