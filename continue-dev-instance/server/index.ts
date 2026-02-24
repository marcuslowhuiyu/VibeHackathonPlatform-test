import express from 'express';
import { createServer, request as httpRequest } from 'http';
import net from 'net';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs/promises';
import { spawn } from 'child_process';
import { ContinueBridge } from './agent/continue-bridge.js';
import { setupWebSocket } from './websocket.js';

const PROJECT_ROOT = '/home/workspace/project';
const INSTANCE_ID = process.env.INSTANCE_ID || '';
const BASE_PATH = INSTANCE_ID ? `/i/${INSTANCE_ID}` : '';
const PORT = 8080;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface FileEntry {
  path: string;
  type: 'file' | 'directory';
}

const SKIPPED_DIRS = new Set(['node_modules', '.git', 'dist', '.next', '.cache']);

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

function isWithinRoot(filePath: string, root: string): boolean {
  const resolved = path.resolve(root, filePath);
  return resolved.startsWith(path.resolve(root));
}

const app = express();
app.use(express.json());

if (BASE_PATH) {
  app.use((req, _res, next) => {
    if (req.url.startsWith(BASE_PATH)) {
      req.url = req.url.slice(BASE_PATH.length) || '/';
    }
    next();
  });
}

const clientDistPath = path.join(__dirname, '..', 'client', 'dist');
app.use(express.static(clientDistPath));

app.get('/api/config', (_req, res) => {
  res.json({ basePath: BASE_PATH, instanceId: INSTANCE_ID });
});

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.get('/api/project-files', async (_req, res) => {
  try {
    const files = await walkProjectFiles(PROJECT_ROOT, PROJECT_ROOT, 0, 3);
    res.json({ files });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    res.status(500).json({ error: message });
  }
});

app.get('/api/file/:filePath(*)', async (req, res) => {
  const filePath = (req.params as Record<string, string>)['filePath(*)'] || (req.params as Record<string, string>).filePath;

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

app.use('/preview', (req, res) => {
  const proxyPath = BASE_PATH
    ? `${BASE_PATH}/preview${req.url || '/'}`
    : (req.url || '/');
  const proxyReq = httpRequest(
    {
      hostname: '127.0.0.1',
      port: 3000,
      path: proxyPath,
      method: req.method,
      headers: { ...req.headers, host: '127.0.0.1:3000' },
    },
    (proxyRes) => {
      res.writeHead(proxyRes.statusCode || 502, proxyRes.headers);
      proxyRes.pipe(res, { end: true });
    },
  );

  proxyReq.on('error', () => {
    res.status(503).send(`<!DOCTYPE html>
<html><head><meta charset="utf-8"><title>Loading Preview...</title>
<meta http-equiv="refresh" content="3">
<style>body{display:flex;align-items:center;justify-content:center;height:100vh;margin:0;font-family:system-ui;background:#1a1a2e;color:#e0e0e0}
.loader{text-align:center}.spinner{width:40px;height:40px;border:4px solid #333;border-top:4px solid #6c63ff;border-radius:50%;animation:spin 1s linear infinite;margin:0 auto 16px}
@keyframes spin{to{transform:rotate(360deg)}}</style></head>
<body><div class="loader"><div class="spinner"></div><p>Starting preview server...</p><p style="font-size:0.85em;color:#888">This page will refresh automatically</p></div></body></html>`);
  });

  req.pipe(proxyReq, { end: true });
});

app.get('*', (_req, res) => {
  res.sendFile(path.join(clientDistPath, 'index.html'));
});

async function main(): Promise<void> {
  const bridge = new ContinueBridge();
  console.log('Continue bridge initialized');

  const server = createServer(app);
  setupWebSocket(server, bridge);

  server.on('upgrade', (req, socket, head) => {
    let url = req.url || '';
    if (BASE_PATH && url.startsWith(BASE_PATH)) {
      url = url.slice(BASE_PATH.length) || '/';
    }
    if (!url.includes('/preview')) return;

    const remainder = url.replace(/^\/preview/, '') || '/';
    const vitePath = BASE_PATH
      ? `${BASE_PATH}/preview${remainder}`
      : remainder;

    const proxySocket = net.connect(3000, '127.0.0.1', () => {
      const reqHeaders = Object.entries(req.headers)
        .map(([k, v]) => `${k}: ${v}`)
        .join('\r\n');
      proxySocket.write(
        `GET ${vitePath} HTTP/1.1\r\nHost: 127.0.0.1:3000\r\n${reqHeaders}\r\n\r\n`
      );
      if (head && head.length) proxySocket.write(head);
      proxySocket.pipe(socket);
      socket.pipe(proxySocket);
    });

    proxySocket.on('error', () => socket.destroy());
    socket.on('error', () => proxySocket.destroy());
  });

  // Vite dev server with health check and auto-restart
  function startVite() {
    const args = ['vite', '--host', '0.0.0.0', '--port', '3000'];
    if (BASE_PATH) {
      args.push('--base', `${BASE_PATH}/preview/`);
    }
    const proc = spawn('npx', args, {
      cwd: PROJECT_ROOT,
      stdio: 'inherit',
    });
    proc.on('error', (err) => {
      console.error('Failed to start Vite dev server:', err.message);
    });
    return proc;
  }

  let viteFailCount = 0;
  let viteRestartCount = 0;
  const VITE_MAX_FAILURES = 3;
  const VITE_MAX_RESTARTS = 3;
  let viteProcess = startVite();

  setInterval(async () => {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3000);
      const res = await fetch('http://localhost:3000/', { signal: controller.signal });
      clearTimeout(timeout);
      if (res.ok || res.status === 404) {
        viteFailCount = 0;
      } else {
        viteFailCount++;
      }
    } catch {
      viteFailCount++;
    }

    if (viteFailCount >= VITE_MAX_FAILURES && viteRestartCount < VITE_MAX_RESTARTS) {
      console.warn(`Vite health check failed ${viteFailCount} times, restarting (attempt ${viteRestartCount + 1}/${VITE_MAX_RESTARTS})...`);
      try { viteProcess.kill(); } catch {}
      viteProcess = startVite();
      viteFailCount = 0;
      viteRestartCount++;
    }
  }, 30_000);

  process.on('SIGTERM', () => {
    console.log('Received SIGTERM, shutting down...');
    viteProcess.kill();
    server.close();
    process.exit(0);
  });

  server.listen(PORT, () => {
    console.log(`Continue-dev instance running on port ${PORT}`);
  });
}

main().catch((err) => {
  console.error('Fatal error during startup:', err);
  process.exit(1);
});
