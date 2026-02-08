import express from 'express';
import { createServer } from 'http';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs/promises';
import { spawn } from 'child_process';
import { AgentLoop } from './agent/agent-loop.js';
import { generateRepoMap } from './agent/repo-map.js';
import { setupWebSocket } from './websocket.js';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const PROJECT_ROOT = '/home/workspace/project';
const INSTANCE_MODE = (process.env.INSTANCE_MODE || 'vibe') as 'vibe' | 'vibe-pro';
const INSTANCE_ID = process.env.INSTANCE_ID || '';
const BASE_PATH = INSTANCE_ID ? `/i/${INSTANCE_ID}` : '';
const PORT = 8080;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface FileEntry {
  path: string;
  type: 'file' | 'directory';
}

const SKIPPED_DIRS = new Set(['node_modules', '.git', 'dist', '.next', '.cache']);

/**
 * Recursively walk a directory up to `maxDepth` levels, returning a flat list
 * of file and directory entries with paths relative to `root`.
 */
async function walkProjectFiles(
  dir: string,
  root: string,
  depth: number,
  maxDepth: number,
): Promise<FileEntry[]> {
  if (depth > maxDepth) return [];

  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  const results: FileEntry[] = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    const relativePath = path.relative(root, fullPath).replace(/\\/g, '/');

    if (entry.isDirectory()) {
      if (SKIPPED_DIRS.has(entry.name)) continue;

      results.push({ path: relativePath, type: 'directory' });
      const children = await walkProjectFiles(fullPath, root, depth + 1, maxDepth);
      results.push(...children);
    } else if (entry.isFile()) {
      results.push({ path: relativePath, type: 'file' });
    }
  }

  return results;
}

/**
 * Validate that a resolved file path is within the project root to prevent
 * directory traversal attacks.
 */
function isWithinRoot(filePath: string, root: string): boolean {
  const resolved = path.resolve(root, filePath);
  return resolved.startsWith(path.resolve(root));
}

// ---------------------------------------------------------------------------
// Express app
// ---------------------------------------------------------------------------

const app = express();
app.use(express.json());

// Strip the ALB base path prefix (/i/{instanceId}) so routes work at /
// The ALB routes /i/{instanceId}/* to this container on port 8080
if (BASE_PATH) {
  app.use((req, _res, next) => {
    if (req.url.startsWith(BASE_PATH)) {
      req.url = req.url.slice(BASE_PATH.length) || '/';
    }
    next();
  });
}

// Serve the built client UI
const clientDistPath = path.join(__dirname, '..', 'client', 'dist');
app.use(express.static(clientDistPath));

// ---- Config endpoint (client reads base path from here) ------------------

app.get('/api/config', (_req, res) => {
  res.json({ basePath: BASE_PATH, mode: INSTANCE_MODE, instanceId: INSTANCE_ID });
});

// ---- Health check --------------------------------------------------------

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', mode: INSTANCE_MODE });
});

// ---- Project file listing ------------------------------------------------

app.get('/api/project-files', async (_req, res) => {
  try {
    const files = await walkProjectFiles(PROJECT_ROOT, PROJECT_ROOT, 0, 3);
    res.json({ files });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

// ---- Read a single project file ------------------------------------------

app.get('/api/file/:filePath(*)', async (req, res) => {
  const filePath = req.params.filePath;

  if (!isWithinRoot(filePath, PROJECT_ROOT)) {
    res.status(403).json({ error: 'Access denied: path is outside the project root' });
    return;
  }

  const absolutePath = path.resolve(PROJECT_ROOT, filePath);

  try {
    const content = await fs.readFile(absolutePath, 'utf-8');
    res.json({ content });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(404).json({ error: message });
  }
});

// ---- SPA fallback --------------------------------------------------------

app.get('*', (_req, res) => {
  res.sendFile(path.join(clientDistPath, 'index.html'));
});

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  // In vibe-pro mode, generate a repo map for richer context
  let repoMap: string | undefined;
  if (INSTANCE_MODE === 'vibe-pro') {
    try {
      repoMap = await generateRepoMap(PROJECT_ROOT);
      console.log('Repo map generated for vibe-pro mode');
    } catch (err) {
      console.warn('Failed to generate repo map:', err);
    }
  }

  // Create the agent loop
  const agentLoop = new AgentLoop(INSTANCE_MODE, repoMap);

  // Create the HTTP server and attach WebSocket
  const server = createServer(app);
  setupWebSocket(server, agentLoop);

  // Start the Vite dev server for the user's project
  const viteProcess = spawn('npx', ['vite', '--host', '0.0.0.0', '--port', '3000'], {
    cwd: PROJECT_ROOT,
    stdio: 'inherit',
  });

  viteProcess.on('error', (err) => {
    console.error('Failed to start Vite dev server:', err.message);
  });

  // Graceful shutdown
  process.on('SIGTERM', () => {
    console.log('Received SIGTERM, shutting down...');
    viteProcess.kill();
    server.close();
    process.exit(0);
  });

  // Start listening
  server.listen(PORT, () => {
    console.log(`Vibe instance running (mode: ${INSTANCE_MODE}) on port ${PORT}`);
  });
}

main().catch((err) => {
  console.error('Fatal error during startup:', err);
  process.exit(1);
});
