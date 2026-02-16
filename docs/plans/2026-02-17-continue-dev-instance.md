# Continue-Dev Instance Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Create a new `continue-dev` instance type that uses the Continue CLI (`@continuedev/cli`) as a headless AI backend with the platform's shared/instance-client React UI.

**Architecture:** Express server bridges WebSocket UI to Continue CLI headless mode (`cn -p "message" --format json`). No streaming — full response returned at once. Follows the same Node.js instance pattern as loclaude-instance.

**Tech Stack:** Node.js 20, Express, WebSocket (ws), @continuedev/cli, shared/instance-client (React + Vite)

---

### Task 1: Scaffold continue-dev-instance directory

**Files:**
- Create: `continue-dev-instance/package.json`
- Create: `continue-dev-instance/tsconfig.json`

**Step 1: Create package.json**

```json
{
  "name": "continue-dev-instance",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "dev": "tsx watch server/index.ts",
    "build:client": "cd client && npm run build",
    "start": "node dist/server/index.js",
    "test": "vitest run"
  },
  "dependencies": {
    "chokidar": "^4.0.0",
    "express": "^4.21.0",
    "ws": "^8.18.0"
  },
  "devDependencies": {
    "@types/express": "^5.0.0",
    "@types/node": "^22.10.0",
    "@types/ws": "^8.5.0",
    "tsx": "^4.19.0",
    "typescript": "^5.6.0",
    "vitest": "^4.0.18"
  }
}
```

Note: No `@aws-sdk/client-bedrock-runtime` needed — Continue CLI handles Bedrock directly.

**Step 2: Create tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "esModuleInterop": true,
    "strict": true,
    "outDir": "dist",
    "rootDir": ".",
    "resolveJsonModule": true,
    "declaration": true,
    "skipLibCheck": true
  },
  "include": ["server/**/*.ts"],
  "exclude": ["node_modules", "dist", "client"]
}
```

**Step 3: Commit**

```bash
git add continue-dev-instance/package.json continue-dev-instance/tsconfig.json
git commit -m "feat(continue-dev): scaffold directory with package.json and tsconfig"
```

---

### Task 2: Create the Continue bridge (agent layer)

**Files:**
- Create: `continue-dev-instance/server/agent/continue-bridge.ts`

This is the core module that spawns the Continue CLI headless and parses responses.

**Step 1: Create continue-bridge.ts**

```typescript
import { EventEmitter } from 'events';
import { spawn } from 'child_process';
import fs from 'fs/promises';
import path from 'path';

const PROJECT_ROOT = '/home/workspace/project';
const CONFIG_PATH = '/app/continue-config.yaml';

/**
 * Bridge between the WebSocket server and the Continue CLI.
 * Spawns `cn -p "message" --format json` for each user message.
 */
export class ContinueBridge extends EventEmitter {
  private sessionId: string | null = null;

  /**
   * Send a user message to the Continue CLI and emit events as the response
   * is received.
   */
  async processMessage(userMessage: string): Promise<void> {
    this.emit('agent:thinking', { text: 'Processing with Continue...' });

    // Snapshot workspace files before CLI runs (for change detection)
    const beforeSnapshot = await this.snapshotFiles();

    try {
      const response = await this.runCli(userMessage);

      // Emit the response text
      if (response) {
        this.emit('agent:text', { text: response });
      }

      // Detect file changes
      const afterSnapshot = await this.snapshotFiles();
      const changes = this.detectChanges(beforeSnapshot, afterSnapshot);

      for (const change of changes) {
        this.emit('agent:file_changed', {
          path: change.path,
          content: change.content,
        });
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.emit('agent:error', { error: message });
    }
  }

  /**
   * Run the Continue CLI in headless mode and return the response text.
   */
  private runCli(prompt: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const args = ['-p', prompt, '--config', CONFIG_PATH];

      // Resume session if we have one
      if (this.sessionId) {
        args.push('--resume', this.sessionId);
      }

      const proc = spawn('cn', args, {
        cwd: PROJECT_ROOT,
        env: {
          ...process.env,
          // Ensure non-interactive mode
          CI: 'true',
          NO_COLOR: '1',
        },
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      let stdout = '';
      let stderr = '';

      proc.stdout.on('data', (chunk: Buffer) => {
        stdout += chunk.toString();
      });

      proc.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString();
      });

      proc.on('close', (code) => {
        if (code !== 0 && !stdout) {
          reject(new Error(`Continue CLI exited with code ${code}: ${stderr}`));
          return;
        }

        // Try to parse JSON response
        try {
          const parsed = JSON.parse(stdout);
          // Extract session ID for resume
          if (parsed.sessionId) {
            this.sessionId = parsed.sessionId;
          }
          resolve(parsed.content || parsed.message || parsed.text || stdout);
        } catch {
          // If not JSON, return raw text (CLI may output plain text)
          resolve(stdout.trim());
        }
      });

      proc.on('error', (err) => {
        reject(new Error(`Failed to spawn Continue CLI: ${err.message}`));
      });

      // Close stdin immediately — headless mode doesn't read from it
      proc.stdin.end();
    });
  }

  /**
   * Take a snapshot of all files in the workspace for change detection.
   * Returns a map of relative path → content hash (mtime as proxy).
   */
  private async snapshotFiles(): Promise<Map<string, number>> {
    const snapshot = new Map<string, number>();
    await this.walkForSnapshot(PROJECT_ROOT, PROJECT_ROOT, snapshot, 0, 4);
    return snapshot;
  }

  private async walkForSnapshot(
    dir: string,
    root: string,
    snapshot: Map<string, number>,
    depth: number,
    maxDepth: number,
  ): Promise<void> {
    if (depth > maxDepth) return;

    const SKIP = new Set(['node_modules', '.git', 'dist', '.next', '.cache']);

    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const relativePath = path.relative(root, fullPath).replace(/\\/g, '/');

      if (entry.isDirectory()) {
        if (SKIP.has(entry.name)) continue;
        await this.walkForSnapshot(fullPath, root, snapshot, depth + 1, maxDepth);
      } else if (entry.isFile()) {
        try {
          const stat = await fs.stat(fullPath);
          snapshot.set(relativePath, stat.mtimeMs);
        } catch {
          // Skip files we can't stat
        }
      }
    }
  }

  /**
   * Compare before/after snapshots to find changed or new files.
   */
  private detectChanges(
    before: Map<string, number>,
    after: Map<string, number>,
  ): Array<{ path: string; content: string }> {
    const changes: Array<{ path: string; content: string }> = [];

    for (const [filePath, mtime] of after) {
      const prevMtime = before.get(filePath);
      if (prevMtime === undefined || mtime > prevMtime) {
        // File is new or modified — read its content
        try {
          const fullPath = path.join(PROJECT_ROOT, filePath);
          // Use sync read since we're in a synchronous comparison loop
          // (will be called after async CLI completes)
          const content = require('fs').readFileSync(fullPath, 'utf-8');
          changes.push({ path: filePath, content });
        } catch {
          changes.push({ path: filePath, content: '' });
        }
      }
    }

    return changes;
  }
}
```

Wait — this uses `require()` which won't work in ESM. Fix: use `fs.readFileSync` from the sync API.

**Step 1 (corrected): Create continue-bridge.ts**

Replace the `detectChanges` method's file read with:

```typescript
import { readFileSync } from 'fs';
```

And in the method body:
```typescript
const content = readFileSync(fullPath, 'utf-8');
```

**Step 2: Commit**

```bash
git add continue-dev-instance/server/agent/continue-bridge.ts
git commit -m "feat(continue-dev): add Continue CLI bridge with file change detection"
```

---

### Task 3: Create WebSocket handler

**Files:**
- Create: `continue-dev-instance/server/websocket.ts`

Copy the pattern from `loclaude-instance/server/websocket.ts` but use `ContinueBridge` instead of `AgentLoop`.

**Step 1: Create websocket.ts**

```typescript
import { WebSocketServer, WebSocket } from 'ws';
import type { Server } from 'http';
import { ContinueBridge } from './agent/continue-bridge.js';

function send(ws: WebSocket, data: Record<string, unknown>): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

export function setupWebSocket(server: Server, bridge: ContinueBridge): void {
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req, socket, head) => {
    const url = req.url || '';
    if (url.includes('/preview')) return;
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req);
    });
  });

  wss.on('connection', (ws: WebSocket) => {
    let autoFixAttempts = 0;
    let lastErrorTime = 0;

    const onThinking = (data?: { text?: string }) => {
      send(ws, { type: 'agent:thinking', text: data?.text });
    };

    const onText = (data: { text: string }) => {
      send(ws, { type: 'agent:text', content: data.text });
    };

    const onFileChanged = (data: { path: string; content?: string }) => {
      send(ws, { type: 'agent:file_changed', path: data.path, content: data.content });
    };

    const onError = (data: { error: string }) => {
      send(ws, { type: 'error', message: data.error });
    };

    bridge.on('agent:thinking', onThinking);
    bridge.on('agent:text', onText);
    bridge.on('agent:file_changed', onFileChanged);
    bridge.on('agent:error', onError);

    ws.on('message', async (raw: Buffer | string) => {
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(typeof raw === 'string' ? raw : raw.toString());
      } catch {
        send(ws, { type: 'error', message: 'Invalid JSON' });
        return;
      }

      if (parsed.type === 'chat' && typeof parsed.message === 'string') {
        autoFixAttempts = 0;
        try {
          await bridge.processMessage(parsed.message);
          send(ws, { type: 'agent:done' });
        } catch (err: unknown) {
          const errorMessage = err instanceof Error ? err.message : String(err);
          send(ws, { type: 'error', message: errorMessage });
        }
        return;
      }

      if (
        parsed.type === 'element_click' &&
        typeof parsed.tagName === 'string' &&
        typeof parsed.textContent === 'string'
      ) {
        const formattedMessage = `Change the ${parsed.tagName} element that says '${parsed.textContent}'...`;
        send(ws, { type: 'prefill', message: formattedMessage });
        return;
      }

      if (parsed.type === 'preview_error' && typeof parsed.error === 'string') {
        const now = Date.now();
        if (now - lastErrorTime < 5000) return;
        if (autoFixAttempts >= 3) return;
        lastErrorTime = now;
        autoFixAttempts++;

        send(ws, { type: 'agent:text', content: `[Auto-detected error] ${parsed.error}\n\nAttempting to fix...` });
        try {
          await bridge.processMessage(
            `The live preview has an error:\n\`\`\`\n${parsed.error}\n\`\`\`\nPlease investigate and fix this error.`
          );
          send(ws, { type: 'agent:done' });
        } catch (err: unknown) {
          send(ws, { type: 'error', message: err instanceof Error ? err.message : String(err) });
        }
      }
    });

    ws.on('close', () => {
      bridge.off('agent:thinking', onThinking);
      bridge.off('agent:text', onText);
      bridge.off('agent:file_changed', onFileChanged);
      bridge.off('agent:error', onError);
    });
  });
}
```

**Step 2: Commit**

```bash
git add continue-dev-instance/server/websocket.ts
git commit -m "feat(continue-dev): add WebSocket handler bridging UI to Continue CLI"
```

---

### Task 4: Create Express server

**Files:**
- Create: `continue-dev-instance/server/index.ts`

Follow the loclaude-instance pattern exactly: REST API for files, preview proxy, WebSocket, Vite dev server.

**Step 1: Create server/index.ts**

```typescript
import express from 'express';
import { createServer, request as httpRequest } from 'http';
import net from 'net';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs/promises';
import { spawn } from 'child_process';
import chokidar from 'chokidar';
import { ContinueBridge } from './agent/continue-bridge.js';
import { setupWebSocket } from './websocket.js';

const PROJECT_ROOT = '/home/workspace/project';
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

// ---------------------------------------------------------------------------
// Express app
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Startup
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const bridge = new ContinueBridge();
  console.log('Continue bridge initialized');

  const server = createServer(app);
  setupWebSocket(server, bridge);

  // Proxy WebSocket upgrades for /preview to Vite HMR on port 3000
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

  // Start Vite dev server for user's project
  const viteArgs = ['vite', '--host', '0.0.0.0', '--port', '3000'];
  if (BASE_PATH) {
    viteArgs.push('--base', `${BASE_PATH}/preview/`);
  }
  const viteProcess = spawn('npx', viteArgs, {
    cwd: PROJECT_ROOT,
    stdio: 'inherit',
  });

  viteProcess.on('error', (err) => {
    console.error('Failed to start Vite dev server:', err.message);
  });

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
```

**Step 2: Commit**

```bash
git add continue-dev-instance/server/index.ts
git commit -m "feat(continue-dev): add Express server with REST API, preview proxy, and WebSocket"
```

---

### Task 5: Create Dockerfile and entrypoint

**Files:**
- Create: `continue-dev-instance/Dockerfile`
- Create: `continue-dev-instance/entrypoint.sh`

**Step 1: Create Dockerfile**

```dockerfile
FROM node:20-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    ripgrep \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Install Continue CLI globally
RUN npm i -g @continuedev/cli

# Copy and install server dependencies
COPY continue-dev-instance/package.json continue-dev-instance/tsconfig.json ./
RUN npm install

# Copy and build shared client
COPY shared/instance-client/ ./client/
RUN cd client && npm install && npm run build

# Copy server source
COPY continue-dev-instance/server/ ./server/

# Create workspace
RUN mkdir -p /home/workspace/project

# Copy entrypoint
COPY continue-dev-instance/entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

EXPOSE 8080 3000

ENTRYPOINT ["/app/entrypoint.sh"]
```

**Step 2: Create entrypoint.sh**

```bash
#!/bin/bash
set -e

# ---------------------------------------------------------------------------
# Write AWS credentials for Continue CLI
# ---------------------------------------------------------------------------
if [ -n "$AWS_ACCESS_KEY_ID" ]; then
  mkdir -p ~/.aws
  cat > ~/.aws/credentials << AWSEOF
[default]
aws_access_key_id = $AWS_ACCESS_KEY_ID
aws_secret_access_key = $AWS_SECRET_ACCESS_KEY
AWSEOF
  cat > ~/.aws/config << AWSEOF
[default]
region = ${AWS_REGION:-ap-southeast-1}
AWSEOF
fi

# ---------------------------------------------------------------------------
# Write Continue config.yaml for Bedrock
# ---------------------------------------------------------------------------
REGION="${AWS_REGION:-ap-southeast-1}"
MODEL="${BEDROCK_MODEL_ID:-us.anthropic.claude-sonnet-4-20250514}"

cat > /app/continue-config.yaml << CFGEOF
name: Hackathon Assistant
version: 0.0.1
schema: v1
models:
  - name: Claude Sonnet
    provider: bedrock
    model: $MODEL
    env:
      region: $REGION
    roles:
      - chat
      - edit
CFGEOF

echo "Continue config written (model: $MODEL, region: $REGION)"

# ---------------------------------------------------------------------------
# Scaffold starter project if empty
# ---------------------------------------------------------------------------
if [ ! -f /home/workspace/project/package.json ]; then
  cd /home/workspace/project
  npm create vite@latest . -- --template react-ts <<< "y"
  npm install
  npm install -D tailwindcss @tailwindcss/vite

  cat > vite.config.ts << 'VITEEOF'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
})
VITEEOF

  { echo '@import "tailwindcss";'; cat src/index.css; } > /tmp/index.css && mv /tmp/index.css src/index.css

  echo "Project scaffolded successfully"
fi

# ---------------------------------------------------------------------------
# Start the server
# ---------------------------------------------------------------------------
cd /app
exec npx tsx server/index.ts
```

**Step 3: Commit**

```bash
git add continue-dev-instance/Dockerfile continue-dev-instance/entrypoint.sh
git commit -m "feat(continue-dev): add Dockerfile and entrypoint with Continue CLI + Bedrock config"
```

---

### Task 6: Register in dashboard backend

**Files:**
- Modify: `dashboard/server/services/aws-setup.ts:642-651`
- Modify: `dashboard/server/services/ecs-manager.ts:111-117`
- Modify: `dashboard/server/routes/instances.ts:249-257`

**Step 1: Add to AI_EXTENSIONS in aws-setup.ts (line 642)**

Change:
```typescript
export const AI_EXTENSIONS = ['continue', 'cline', 'vibe', 'loclaude-lite', 'loclaude'] as const;
```
To:
```typescript
export const AI_EXTENSIONS = ['continue', 'cline', 'vibe', 'loclaude-lite', 'loclaude', 'continue-dev'] as const;
```

**Step 2: Add to EXTENSION_DIRECTORIES in aws-setup.ts (lines 645-651)**

Change:
```typescript
export const EXTENSION_DIRECTORIES: Record<AIExtension, string> = {
  continue: 'continue-instance',
  cline: 'cline-instance',
  vibe: 'vibe-instance',
  'loclaude-lite': 'loclaude-lite-instance',
  loclaude: 'loclaude-instance',
};
```
To:
```typescript
export const EXTENSION_DIRECTORIES: Record<AIExtension, string> = {
  continue: 'continue-instance',
  cline: 'cline-instance',
  vibe: 'vibe-instance',
  'loclaude-lite': 'loclaude-lite-instance',
  loclaude: 'loclaude-instance',
  'continue-dev': 'continue-dev-instance',
};
```

**Step 3: Add to imageTagMap in ecs-manager.ts (lines 111-117)**

Change:
```typescript
const imageTagMap: Record<string, string> = {
  continue: 'continue',
  cline: 'cline',
  vibe: 'vibe',
  'loclaude-lite': 'loclaude-lite',
  loclaude: 'loclaude',
};
```
To:
```typescript
const imageTagMap: Record<string, string> = {
  continue: 'continue',
  cline: 'cline',
  vibe: 'vibe',
  'loclaude-lite': 'loclaude-lite',
  loclaude: 'loclaude',
  'continue-dev': 'continue-dev',
};
```

**Step 4: Add to validExtensions and extPrefixes in instances.ts (lines 249-257)**

Change:
```typescript
const validExtensions = ['continue', 'cline', 'vibe', 'loclaude-lite', 'loclaude'];

const extPrefixes: Record<string, string> = {
  continue: 'ct',
  cline: 'cl',
  vibe: 'vb',
  'loclaude-lite': 'll',
  loclaude: 'lc',
};
```
To:
```typescript
const validExtensions = ['continue', 'cline', 'vibe', 'loclaude-lite', 'loclaude', 'continue-dev'];

const extPrefixes: Record<string, string> = {
  continue: 'ct',
  cline: 'cl',
  vibe: 'vb',
  'loclaude-lite': 'll',
  loclaude: 'lc',
  'continue-dev': 'cd',
};
```

**Step 5: Commit**

```bash
git add dashboard/server/services/aws-setup.ts dashboard/server/services/ecs-manager.ts dashboard/server/routes/instances.ts
git commit -m "feat(dashboard): register continue-dev instance type in backend"
```

---

### Task 7: Add to dashboard frontend

**Files:**
- Modify: `dashboard/client/src/components/ExtensionSelector.tsx:16-71`

**Step 1: Add continue-dev extension to EXTENSIONS array**

After the existing `loclaude` entry (line 70), before the closing `]`, add:

```typescript
  {
    id: 'continue-dev',
    name: 'Continue Dev',
    description: 'Open-source Continue AI with custom chat UI, codebase indexing, and slash commands',
    features: [
      'Continue CLI-powered AI backend',
      'Codebase indexing and context providers',
      'Custom slash commands',
      'Live preview UI',
      'AWS Bedrock integration'
    ],
    credentialSupport: 'AWS credentials auto-configured via task role',
    docsUrl: 'https://docs.continue.dev/cli/install'
  },
```

**Step 2: Commit**

```bash
git add dashboard/client/src/components/ExtensionSelector.tsx
git commit -m "feat(dashboard): add Continue Dev to extension selector UI"
```

---

### Task 8: Test build locally and push

**Step 1: Verify TypeScript compiles**

Run from project root:
```bash
cd continue-dev-instance && npm install && npx tsc --noEmit
```

Expected: No errors.

**Step 2: Verify dashboard compiles**

```bash
cd dashboard && npx tsc --noEmit
```

Expected: No errors.

**Step 3: Push feature branch**

```bash
git push origin feature/64-continue-dev-instance
```

**Step 4: Verify CI builds the new instance**

Watch the GitHub Actions run. The detect job should pick up `continue-dev-instance/` and build it.

---

### Task 9: Create PR and merge to dev

**Step 1: Create PR**

```bash
gh pr create --head feature/64-continue-dev-instance --base dev \
  --title "feat: add continue-dev instance type with Continue CLI backend" \
  --body "## Summary
- New instance type: continue-dev
- Uses @continuedev/cli as headless AI backend
- Custom chat UI via shared/instance-client
- Bedrock integration via Continue's config.yaml
- File change detection for real-time UI updates

## Test plan
- [ ] CI builds continue-dev-instance Docker image
- [ ] Dashboard shows Continue Dev in extension selector
- [ ] Instance can be spun up and responds to chat messages"
```

**Step 2: Merge after CI passes**

```bash
gh pr merge --merge --admin
```
