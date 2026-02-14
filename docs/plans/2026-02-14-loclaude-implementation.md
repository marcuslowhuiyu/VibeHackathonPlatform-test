# Loclaude Instances Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add two new Claude Code-inspired instance types (Loclaude-lite and Loclaude) and consolidate Vibe/Vibe Pro into a single Vibe type.

**Architecture:** Both Loclaude variants share the Vibe UI (Express + WebSocket + React with Chat/Preview/Code panels) but have progressively more capable agent backends. Loclaude-lite adds shell/glob/grep tools + AST repo map. Loclaude adds Claude Code-style tools, sub-agents, extended thinking, and persistent shell.

**Tech Stack:** TypeScript, Express, WebSocket (ws), React, AWS Bedrock Converse API, ts-morph (AST), chokidar (file watching), ripgrep (search)

---

## Phase 1: Consolidate Vibe

### Task 1: Remove dual-mode from vibe-instance agent-loop

**Files:**
- Modify: `vibe-instance/server/agent/agent-loop.ts:33-54` (buildSystemPrompt)
- Modify: `vibe-instance/server/agent/agent-loop.ts:94` (instanceMode type)
- Modify: `vibe-instance/server/agent/agent-loop.ts:97` (constructor)

**Step 1: Simplify buildSystemPrompt — remove mode parameter, always use vibe-pro prompt with repo map**

Replace lines 33-54 with:

```typescript
function buildSystemPrompt(repoMap?: string): string {
  const basePrompt = `You are a friendly AI coding assistant helping a hackathon participant build a React web app.

Key rules:
- You can only read and modify files within the project directory.
- Always explain what you are doing in simple, beginner-friendly terms before and after making changes.
- Keep code simple and beginner-friendly. Avoid overly clever patterns.
- After making changes to code, remind the user to check the live preview to see the results.
- When creating new files, also make sure they are properly imported where needed.
- If something goes wrong, explain the error in plain language and suggest a fix.

The user may have some coding experience. You can be slightly more technical in explanations, but still keep things clear and approachable.`;

  if (repoMap) {
    return `${basePrompt}\n\nHere is a map of the current project files for reference:\n<repo-map>\n${repoMap}\n</repo-map>`;
  }

  return basePrompt;
}
```

**Step 2: Remove instanceMode from class — keep only repoMap**

Change line 94 from:
```typescript
private instanceMode: "vibe" | "vibe-pro";
```
to remove it entirely. Change constructor (lines 97-102) from:
```typescript
constructor(instanceMode: "vibe" | "vibe-pro", repoMap?: string) {
    super();
    this.instanceMode = instanceMode;
    this.repoMap = repoMap;
```
to:
```typescript
constructor(repoMap?: string) {
    super();
    this.repoMap = repoMap;
```

Update `runLoop` (line 129-130) from:
```typescript
const systemPrompt = buildSystemPrompt(this.instanceMode, this.repoMap);
```
to:
```typescript
const systemPrompt = buildSystemPrompt(this.repoMap);
```

**Step 3: Commit**

```bash
git add vibe-instance/server/agent/agent-loop.ts
git commit -m "refactor(vibe): remove dual-mode, always use enhanced prompt with repo map"
```

---

### Task 2: Remove dual-mode from vibe-instance server/index.ts and Dockerfile

**Files:**
- Modify: `vibe-instance/server/index.ts:17` (INSTANCE_MODE)
- Modify: `vibe-instance/server/index.ts:109` (config endpoint)
- Modify: `vibe-instance/server/index.ts:115` (health check)
- Modify: `vibe-instance/server/index.ts:201-213` (main function repo map + AgentLoop constructor)
- Modify: `vibe-instance/server/index.ts:307` (startup log)
- Modify: `vibe-instance/Dockerfile:28` (ENV INSTANCE_MODE)

**Step 1: Remove INSTANCE_MODE from server/index.ts**

Line 17 — delete the INSTANCE_MODE line entirely.

Line 109 — change:
```typescript
res.json({ basePath: BASE_PATH, mode: INSTANCE_MODE, instanceId: INSTANCE_ID });
```
to:
```typescript
res.json({ basePath: BASE_PATH, instanceId: INSTANCE_ID });
```

Line 115 — change:
```typescript
res.json({ status: 'ok', mode: INSTANCE_MODE });
```
to:
```typescript
res.json({ status: 'ok' });
```

Lines 201-213 — change from conditional repo map generation to always generating:
```typescript
let repoMap: string | undefined;
try {
  repoMap = await generateRepoMap(PROJECT_ROOT);
  console.log('Repo map generated');
} catch (err) {
  console.warn('Failed to generate repo map:', err);
}

const agentLoop = new AgentLoop(repoMap);
```

Line 307 — change:
```typescript
console.log(`Vibe instance running (mode: ${INSTANCE_MODE}) on port ${PORT}`);
```
to:
```typescript
console.log(`Vibe instance running on port ${PORT}`);
```

**Step 2: Remove ENV INSTANCE_MODE from Dockerfile**

Delete line 28: `ENV INSTANCE_MODE=vibe`

**Step 3: Commit**

```bash
git add vibe-instance/server/index.ts vibe-instance/Dockerfile
git commit -m "refactor(vibe): remove INSTANCE_MODE, always generate repo map"
```

---

### Task 3: Update dashboard — rename Vibe Pro to Vibe, remove old Vibe

**Files:**
- Modify: `dashboard/server/routes/instances.ts:249-256`
- Modify: `dashboard/server/services/ecs-manager.ts:111-116,165-167`
- Modify: `dashboard/server/db/database.ts:144,156`
- Modify: `dashboard/client/src/components/SpinUpForm.tsx:8,18-47`
- Modify: `dashboard/client/src/components/ExtensionSelector.tsx:16-55`
- Modify: `dashboard/client/src/components/InstanceList.tsx:77-82,283,491,662`
- Modify: `dashboard/client/src/components/portal/ParticipantPortal.tsx:212,231,233,273-285`

**Step 1: Update instances.ts — remove vibe-pro from validExtensions, keep only vibe**

Line 249: change to `const validExtensions = ['continue', 'cline', 'vibe'];`

Lines 251-256: change to:
```typescript
const extPrefixes: Record<string, string> = {
  continue: 'ct',
  cline: 'cl',
  vibe: 'vb',
};
```

**Step 2: Update ecs-manager.ts — remove vibe-pro from imageTagMap**

Lines 111-116: change to:
```typescript
const imageTagMap: Record<string, string> = {
  continue: 'continue',
  cline: 'cline',
  vibe: 'vibe',
};
```

Lines 165-167: change to:
```typescript
...(extension === 'vibe' ? [
  { name: 'INSTANCE_MODE', value: 'vibe' },
] : []),
```

**Step 3: Update database.ts — remove vibe-pro from types**

Line 144: change to `ai_extension?: 'continue' | 'cline' | 'vibe';`

Line 156: change to `export function createInstance(id: string, aiExtension?: 'continue' | 'cline' | 'vibe'): Instance {`

**Step 4: Update SpinUpForm.tsx — remove vibe-pro, update vibe description**

Line 8: change to `type AIExtension = 'continue' | 'cline' | 'vibe'`

Lines 18-47: remove the `'vibe-pro'` entry entirely. Update vibe entry description:
```typescript
vibe: {
  name: 'Vibe',
  description: 'AI-powered coding with chat UI, live preview, and codebase-aware AI context.',
  color: 'text-pink-400',
  bgColor: 'bg-pink-600',
  enabled: true,
},
```

**Step 5: Update ExtensionSelector.tsx — remove vibe-pro entry, update vibe**

Lines 31-54: replace with single vibe entry:
```typescript
{
  id: 'vibe',
  name: 'Vibe',
  description: 'AI-powered coding with chat UI, live preview, and codebase-aware AI context',
  features: [
    'Chat-based AI interface',
    'Codebase-aware AI context',
    'Live preview UI',
    'Multi-file project support',
    'AWS Bedrock integration'
  ],
  credentialSupport: 'AWS credentials auto-configured via task role',
},
```

**Step 6: Update InstanceList.tsx — remove vibe-pro references**

Lines 77-82: add vibe and cline badges:
```typescript
const EXTENSION_BADGES: Record<string, { label: string; color: string; bgColor: string }> = {
  continue: { label: 'Continue', color: 'text-emerald-400', bgColor: 'bg-emerald-900/50 border-emerald-600' },
  cline: { label: 'Cline', color: 'text-violet-400', bgColor: 'bg-violet-900/50 border-violet-600' },
  vibe: { label: 'Vibe', color: 'text-pink-400', bgColor: 'bg-pink-900/50 border-pink-600' },
}
```

Lines 283, 491, 662: replace `i.ai_extension === 'vibe' || i.ai_extension === 'vibe-pro'` with `i.ai_extension === 'vibe'` (all 3 locations).

**Step 7: Update ParticipantPortal.tsx — remove vibe-pro references**

Line 212: change to `const isVibeInstance = instance.ai_extension === 'vibe';`

Lines 273-285: change condition to `instance.ai_extension === 'vibe'`.

**Step 8: Commit**

```bash
git add dashboard/
git commit -m "refactor(dashboard): consolidate Vibe Pro into Vibe, remove dual-mode"
```

---

## Phase 2: Loclaude-lite Instance

### Task 4: Scaffold loclaude-lite-instance directory structure

**Files:**
- Create: `loclaude-lite-instance/package.json`
- Create: `loclaude-lite-instance/tsconfig.json`
- Create: `loclaude-lite-instance/Dockerfile`
- Create: `loclaude-lite-instance/entrypoint.sh`

**Step 1: Create package.json**

```json
{
  "name": "loclaude-lite-instance",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "dev": "tsx watch server/index.ts",
    "build:client": "cd client && npm run build",
    "start": "node dist/server/index.js",
    "test": "vitest run"
  },
  "dependencies": {
    "@aws-sdk/client-bedrock-runtime": "^3.972.0",
    "chokidar": "^4.0.0",
    "express": "^4.21.0",
    "ts-morph": "^25.0.0",
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

**Step 2: Create tsconfig.json** — copy from `vibe-instance/tsconfig.json`

**Step 3: Create Dockerfile**

```dockerfile
FROM node:20-slim

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    ripgrep \
    && rm -rf /var/lib/apt/lists/*

COPY package.json tsconfig.json ./
RUN npm install

COPY client/ ./client/
RUN cd client && npm install && npm run build

COPY server/ ./server/

RUN mkdir -p /home/workspace/project

COPY entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

EXPOSE 8080 3000

ENTRYPOINT ["/app/entrypoint.sh"]
```

**Step 4: Create entrypoint.sh**

```bash
#!/bin/bash
set -e

if [ ! -f /home/workspace/project/package.json ]; then
  cd /home/workspace/project
  npm create vite@latest . -- --template react-ts <<< "y"
  npm install
  npm install -D tailwindcss @tailwindcss/vite
  echo "Project scaffolded successfully"
fi

cd /app
exec npx tsx server/index.ts
```

**Step 5: Commit**

```bash
git add loclaude-lite-instance/package.json loclaude-lite-instance/tsconfig.json loclaude-lite-instance/Dockerfile loclaude-lite-instance/entrypoint.sh
git commit -m "feat(loclaude-lite): scaffold directory structure"
```

---

### Task 5: Copy Vibe client UI to loclaude-lite-instance

**Files:**
- Create: `loclaude-lite-instance/client/` — copy entire directory from `vibe-instance/client/`

**Step 1: Copy the entire client directory**

```bash
cp -r vibe-instance/client loclaude-lite-instance/client
```

The client UI is identical — Chat + Preview + Code panels. No modifications needed. The backend differences are what distinguish Loclaude-lite.

**Step 2: Commit**

```bash
git add loclaude-lite-instance/client/
git commit -m "feat(loclaude-lite): add client UI (copied from vibe)"
```

---

### Task 6: Create loclaude-lite agent tools with bash, glob, grep, git

**Files:**
- Create: `loclaude-lite-instance/server/agent/tools.ts`

**Step 1: Create the tools file**

This file extends Vibe's 6 tools with 4 new ones. Copy `vibe-instance/server/agent/tools.ts` as a starting point, then add:

**bash_command tool:**
```typescript
async function bashCommand(command: string, timeoutMs: number = 30000): Promise<string> {
  const BLOCKED_PATTERNS = [/rm\s+-rf\s+\/(?!\S)/, /mkfs/, /dd\s+if=/, />\s*\/dev\/sd/];
  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(command)) {
      throw new Error(`Blocked dangerous command: ${command}`);
    }
  }

  return new Promise((resolve) => {
    const proc = spawn('bash', ['-c', command], {
      cwd: PROJECT_ROOT,
      timeout: timeoutMs,
      env: { ...process.env, HOME: '/home/workspace' },
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data: Buffer) => { stdout += data.toString(); });
    proc.stderr.on('data', (data: Buffer) => { stderr += data.toString(); });

    proc.on('close', (code) => {
      const output = stdout + (stderr ? `\nSTDERR:\n${stderr}` : '');
      resolve(JSON.stringify({ exit_code: code, output: output.slice(0, 50000) }));
    });

    proc.on('error', (err) => {
      resolve(JSON.stringify({ exit_code: 1, output: `Error: ${err.message}` }));
    });
  });
}
```

**glob tool:**
```typescript
async function globFiles(pattern: string, cwd?: string): Promise<string> {
  const resolved = resolveSandboxed(cwd ?? '.');
  const { glob } = await import('glob');
  const matches = await glob(pattern, { cwd: resolved, ignore: ['node_modules/**', '.git/**'] });
  return matches.join('\n') || 'No matches found';
}
```

Note: add `"glob": "^11.0.0"` to package.json dependencies.

**grep tool:**
```typescript
async function grepFiles(pattern: string, dirPath?: string, contextLines: number = 0): Promise<string> {
  return new Promise((resolve) => {
    const resolved = resolveSandboxed(dirPath ?? '.');
    const args = ['--no-heading', '--line-number', '--color=never'];
    if (contextLines > 0) args.push(`-C${contextLines}`);
    args.push(pattern, resolved);

    const proc = spawn('rg', args, { timeout: 10000 });
    let output = '';

    proc.stdout.on('data', (data: Buffer) => { output += data.toString(); });
    proc.on('close', () => {
      resolve(output || `No matches found for pattern: ${pattern}`);
    });
    proc.on('error', () => {
      resolve(`ripgrep not available, falling back to basic search`);
    });
  });
}
```

**git_status tool:**
```typescript
async function gitStatus(): Promise<string> {
  return new Promise((resolve) => {
    const proc = spawn('git', ['status', '--short'], { cwd: PROJECT_ROOT });
    let output = '';
    proc.stdout.on('data', (data: Buffer) => { output += data.toString(); });
    proc.on('close', () => { resolve(output || '(clean)'); });
    proc.on('error', (err) => { resolve(`Git error: ${err.message}`); });
  });
}
```

Add all 4 to TOOL_DEFINITIONS and executeTool switch.

**Step 2: Commit**

```bash
git add loclaude-lite-instance/server/agent/tools.ts
git commit -m "feat(loclaude-lite): add tools with bash, glob, grep, git support"
```

---

### Task 7: Create loclaude-lite AST-aware repo map

**Files:**
- Create: `loclaude-lite-instance/server/agent/repo-map.ts`

**Step 1: Create AST-aware repo map using ts-morph**

Start from `vibe-instance/server/agent/repo-map.ts` but replace the regex-based parsing with ts-morph:

```typescript
import { Project, SyntaxKind } from 'ts-morph';

function parseFileAST(filePath: string, project: Project): Omit<FileSummary, 'path'> {
  const sourceFile = project.addSourceFileAtPath(filePath);

  const imports = sourceFile.getImportDeclarations().map(
    (i) => i.getModuleSpecifierValue()
  );

  const exports = sourceFile.getExportedDeclarations();
  const exportNames: string[] = [];
  exports.forEach((_decls, name) => exportNames.push(name));

  const functions = sourceFile.getFunctions().map((f) => f.getName() || '(anonymous)');
  const classes = sourceFile.getClasses().map((c) => c.getName() || '(anonymous)');
  const variables = sourceFile.getVariableDeclarations()
    .filter((v) => v.isExported())
    .map((v) => v.getName());

  project.removeSourceFile(sourceFile);

  return {
    imports: [...new Set(imports)],
    exports: [...new Set(exportNames)],
    functions: [...new Set([...functions, ...classes, ...variables])],
  };
}
```

Keep the same `generateRepoMap` signature and formatting. Fall back to regex parsing for `.css` and `.json` files.

**Step 2: Commit**

```bash
git add loclaude-lite-instance/server/agent/repo-map.ts
git commit -m "feat(loclaude-lite): add AST-aware repo map using ts-morph"
```

---

### Task 8: Create loclaude-lite agent loop with enhanced system prompt

**Files:**
- Create: `loclaude-lite-instance/server/agent/agent-loop.ts`

**Step 1: Create agent loop**

Copy from `vibe-instance/server/agent/agent-loop.ts` (post-Task 1 version with no dual-mode) and update the system prompt:

```typescript
function buildSystemPrompt(repoMap?: string): string {
  const basePrompt = `You are a powerful AI coding assistant helping a hackathon participant build a React web app.

Key capabilities:
- Read, write, and edit project files
- Run shell commands (npm install, git, tests, build tools)
- Search the codebase with glob patterns and regex grep
- Check git status and make commits

Key rules:
- Always explain what you are doing before and after making changes.
- After code changes, remind the user to check the live preview.
- When creating new files, make sure they are properly imported.
- Use bash_command to install packages, run tests, or execute build steps.
- Use grep/glob to find files and code patterns efficiently.
- If something goes wrong, explain the error clearly and fix it.
- Keep code simple and well-organized.`;

  if (repoMap) {
    return `${basePrompt}\n\nHere is a map of the current project:\n<repo-map>\n${repoMap}\n</repo-map>`;
  }

  return basePrompt;
}
```

No other changes to the agent loop logic — same Bedrock ConverseStream, same iteration limit.

**Step 2: Commit**

```bash
git add loclaude-lite-instance/server/agent/agent-loop.ts
git commit -m "feat(loclaude-lite): add agent loop with enhanced system prompt"
```

---

### Task 9: Create loclaude-lite server with file watcher

**Files:**
- Create: `loclaude-lite-instance/server/index.ts`
- Create: `loclaude-lite-instance/server/websocket.ts`

**Step 1: Create server/index.ts**

Copy from `vibe-instance/server/index.ts` (post-Task 2 version). Add chokidar file watcher that regenerates the repo map when files change:

```typescript
// After agentLoop creation, add file watcher
import chokidar from 'chokidar';

const watcher = chokidar.watch(PROJECT_ROOT, {
  ignored: /(node_modules|\.git|dist|\.next|\.cache)/,
  persistent: true,
  ignoreInitial: true,
});

let repoMapRefreshTimer: ReturnType<typeof setTimeout> | null = null;

watcher.on('all', () => {
  // Debounce repo map refresh to 2 seconds
  if (repoMapRefreshTimer) clearTimeout(repoMapRefreshTimer);
  repoMapRefreshTimer = setTimeout(async () => {
    try {
      const newMap = await generateRepoMap(PROJECT_ROOT);
      agentLoop.updateRepoMap(newMap);
      console.log('Repo map refreshed');
    } catch (err) {
      console.warn('Failed to refresh repo map:', err);
    }
  }, 2000);
});
```

Add `updateRepoMap(map: string)` method to AgentLoop class:
```typescript
updateRepoMap(newMap: string): void {
  this.repoMap = newMap;
}
```

**Step 2: Create server/websocket.ts** — copy from `vibe-instance/server/websocket.ts` unchanged.

**Step 3: Commit**

```bash
git add loclaude-lite-instance/server/
git commit -m "feat(loclaude-lite): add server with file watcher for auto repo map refresh"
```

---

## Phase 3: Loclaude Instance

### Task 10: Scaffold loclaude-instance directory structure

**Files:**
- Create: `loclaude-instance/package.json`
- Create: `loclaude-instance/tsconfig.json`
- Create: `loclaude-instance/Dockerfile`
- Create: `loclaude-instance/entrypoint.sh`

**Step 1: Create package.json**

```json
{
  "name": "loclaude-instance",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "dev": "tsx watch server/index.ts",
    "build:client": "cd client && npm run build",
    "start": "node dist/server/index.js",
    "test": "vitest run"
  },
  "dependencies": {
    "@aws-sdk/client-bedrock-runtime": "^3.972.0",
    "chokidar": "^4.0.0",
    "express": "^4.21.0",
    "glob": "^11.0.0",
    "ts-morph": "^25.0.0",
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

**Step 2: Create Dockerfile** — same as loclaude-lite but also install ripgrep.

**Step 3: Create entrypoint.sh** — identical to loclaude-lite.

**Step 4: Copy client directory from vibe-instance** — identical UI.

**Step 5: Commit**

```bash
git add loclaude-instance/
git commit -m "feat(loclaude): scaffold directory structure with client UI"
```

---

### Task 11: Create loclaude Claude Code-style tools

**Files:**
- Create: `loclaude-instance/server/agent/tools.ts`

**Step 1: Create tools matching Claude Code naming and behavior**

Key differences from loclaude-lite tools:
- **PascalCase tool names** (Bash, Read, Write, Edit, Glob, Grep, ListDir)
- **Bash has persistent working directory** via a long-lived bash process (using node-pty or a stateful spawn wrapper)
- **Read has offset/limit** for large files
- **Write enforces read-before-write** (tracks read files in a Set)
- **Grep uses ripgrep** with output_mode parameter (content/files_with_matches/count)

```typescript
// Persistent shell state
let shellCwd = PROJECT_ROOT;

async function bashTool(command: string, timeoutMs: number = 120000): Promise<string> {
  // ... same safety checks as loclaude-lite ...

  return new Promise((resolve) => {
    const proc = spawn('bash', ['-c', `cd "${shellCwd}" && ${command} && echo "___CWD___$(pwd)"`], {
      timeout: timeoutMs,
      env: { ...process.env, HOME: '/home/workspace' },
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data: Buffer) => { stdout += data.toString(); });
    proc.stderr.on('data', (data: Buffer) => { stderr += data.toString(); });

    proc.on('close', (code) => {
      // Extract and persist the working directory
      const cwdMatch = stdout.match(/___CWD___(.*)/);
      if (cwdMatch) {
        shellCwd = cwdMatch[1].trim();
        stdout = stdout.replace(/___CWD___.*/, '').trimEnd();
      }

      const output = stdout + (stderr ? `\nSTDERR:\n${stderr}` : '');
      resolve(JSON.stringify({ exit_code: code, output: output.slice(0, 50000) }));
    });
  });
}
```

```typescript
// Read-before-write tracking
const readFiles = new Set<string>();

async function readTool(filePath: string, offset?: number, limit?: number): Promise<string> {
  const resolved = resolveSandboxed(filePath);
  readFiles.add(resolved);
  const content = await fs.readFile(resolved, 'utf-8');
  const lines = content.split('\n');
  const start = offset ?? 0;
  const end = limit ? start + limit : lines.length;
  const sliced = lines.slice(start, end);
  return sliced.map((line, i) => `${start + i + 1}\t${line}`).join('\n');
}

async function writeTool(filePath: string, content: string): Promise<string> {
  const resolved = resolveSandboxed(filePath);
  // Enforce read-before-write for existing files
  try {
    await fs.access(resolved);
    if (!readFiles.has(resolved)) {
      throw new Error(`Must read ${filePath} before writing to it.`);
    }
  } catch (err: any) {
    if (err.code !== 'ENOENT') throw err;
    // New file — no read required
  }
  await fs.mkdir(path.dirname(resolved), { recursive: true });
  await fs.writeFile(resolved, content, 'utf-8');
  readFiles.add(resolved); // Mark as read after write
  return JSON.stringify({ status: 'ok', path: resolved, bytes: Buffer.byteLength(content) });
}
```

**Step 2: Commit**

```bash
git add loclaude-instance/server/agent/tools.ts
git commit -m "feat(loclaude): add Claude Code-style tools with persistent shell and read-before-write"
```

---

### Task 12: Create loclaude agent loop with extended thinking and sub-agents

**Files:**
- Create: `loclaude-instance/server/agent/agent-loop.ts`

**Step 1: Create agent loop with extended thinking**

Key differences from loclaude-lite:
- Uses Bedrock's `thinking` parameter in the ConverseStream request
- System prompt modeled after Claude Code
- Sub-agent support via Task tool

```typescript
const command = new ConverseStreamCommand({
  modelId: MODEL_ID,
  system: [{ text: systemPrompt }] as SystemContentBlock[],
  messages: this.conversationHistory,
  toolConfig: {
    tools: bedrockTools(),
  },
  inferenceConfig: {
    maxTokens: 16384,
  },
  additionalModelRequestFields: {
    thinking: {
      type: "enabled",
      budget_tokens: 8192,
    },
  },
});
```

**Sub-agent (Task tool) implementation:**
```typescript
async function executeTask(prompt: string, parentRepoMap?: string): Promise<string> {
  const subAgent = new AgentLoop(parentRepoMap);
  let result = '';

  return new Promise((resolve, reject) => {
    subAgent.on('agent:text', (data: { text: string }) => {
      result += data.text;
    });
    subAgent.on('agent:error', (data: { error: string }) => {
      resolve(`Sub-agent error: ${data.error}`);
    });

    subAgent.processMessage(prompt)
      .then(() => resolve(result || '(sub-agent produced no text output)'))
      .catch((err) => resolve(`Sub-agent failed: ${err.message}`));
  });
}
```

Add `Task` to TOOL_DEFINITIONS:
```typescript
{
  name: 'Task',
  description: 'Spawn a sub-agent to handle a complex task autonomously. The sub-agent has access to all tools. Use for independent tasks that can run in parallel.',
  input_schema: {
    type: 'object',
    properties: {
      prompt: {
        type: 'string',
        description: 'Detailed task description for the sub-agent',
      },
    },
    required: ['prompt'],
  },
}
```

**System prompt:**
```typescript
function buildSystemPrompt(repoMap?: string): string {
  const basePrompt = `You are an expert AI coding assistant, similar to Claude Code. You help hackathon participants build web applications autonomously and efficiently.

Capabilities:
- Bash: Execute any shell command. Working directory persists between calls. Use for npm, git, tests, builds.
- Read: Read files with optional offset/limit for large files.
- Write: Create or overwrite files. You must Read a file before Writing to it (unless creating new).
- Edit: Find-and-replace exact strings in files. The match must be unique.
- Glob: Find files by pattern (e.g. "**/*.tsx").
- Grep: Search file contents with regex. Supports context lines and output modes.
- ListDir: List directory contents.
- Task: Spawn a sub-agent for independent work. Use when tasks can run in parallel.

Rules:
- Be concise. Explain what you're doing briefly, then act.
- After code changes, remind the user to check the live preview.
- Use Bash to install packages, run tests, and manage git.
- Use Glob/Grep to understand the codebase before making changes.
- When creating files, ensure proper imports.
- Fix errors when they occur — read the error, understand it, fix it.`;

  if (repoMap) {
    return `${basePrompt}\n\nProject structure:\n<repo-map>\n${repoMap}\n</repo-map>`;
  }

  return basePrompt;
}
```

**Step 2: Commit**

```bash
git add loclaude-instance/server/agent/agent-loop.ts
git commit -m "feat(loclaude): add agent loop with extended thinking and sub-agents"
```

---

### Task 13: Create loclaude server and repo map

**Files:**
- Create: `loclaude-instance/server/index.ts`
- Create: `loclaude-instance/server/websocket.ts`
- Create: `loclaude-instance/server/agent/repo-map.ts`

**Step 1: Copy server/index.ts from loclaude-lite** — identical (same file watcher, same Express routes, same proxy).

**Step 2: Copy server/websocket.ts from loclaude-lite** — identical.

**Step 3: Copy server/agent/repo-map.ts from loclaude-lite** — identical AST-aware repo map.

**Step 4: Commit**

```bash
git add loclaude-instance/server/
git commit -m "feat(loclaude): add server, websocket, and AST repo map"
```

---

## Phase 4: Dashboard Integration

### Task 14: Add loclaude-lite and loclaude to dashboard backend

**Files:**
- Modify: `dashboard/server/routes/instances.ts:249-256`
- Modify: `dashboard/server/services/ecs-manager.ts:111-116,165-167`
- Modify: `dashboard/server/db/database.ts:144,156`

**Step 1: Update instances.ts**

Line 249:
```typescript
const validExtensions = ['continue', 'cline', 'vibe', 'loclaude-lite', 'loclaude'];
```

Lines 251-256:
```typescript
const extPrefixes: Record<string, string> = {
  continue: 'ct',
  cline: 'cl',
  vibe: 'vb',
  'loclaude-lite': 'll',
  loclaude: 'lc',
};
```

**Step 2: Update ecs-manager.ts**

Lines 111-116:
```typescript
const imageTagMap: Record<string, string> = {
  continue: 'continue',
  cline: 'cline',
  vibe: 'vibe',
  'loclaude-lite': 'loclaude-lite',
  loclaude: 'loclaude',
};
```

Lines 165-167:
```typescript
...(extension === 'vibe' || extension === 'loclaude-lite' || extension === 'loclaude' ? [
  { name: 'INSTANCE_MODE', value: extension },
] : []),
```

**Step 3: Update database.ts**

Line 144:
```typescript
ai_extension?: 'continue' | 'cline' | 'vibe' | 'loclaude-lite' | 'loclaude';
```

Line 156:
```typescript
export function createInstance(id: string, aiExtension?: 'continue' | 'cline' | 'vibe' | 'loclaude-lite' | 'loclaude'): Instance {
```

**Step 4: Commit**

```bash
git add dashboard/server/
git commit -m "feat(dashboard): add loclaude-lite and loclaude to backend"
```

---

### Task 15: Add loclaude-lite and loclaude to dashboard frontend

**Files:**
- Modify: `dashboard/client/src/components/SpinUpForm.tsx`
- Modify: `dashboard/client/src/components/ExtensionSelector.tsx`
- Modify: `dashboard/client/src/components/InstanceList.tsx`
- Modify: `dashboard/client/src/components/portal/ParticipantPortal.tsx`

**Step 1: Update SpinUpForm.tsx**

Line 8:
```typescript
type AIExtension = 'continue' | 'cline' | 'vibe' | 'loclaude-lite' | 'loclaude'
```

Add to AI_EXTENSIONS object:
```typescript
'loclaude-lite': {
  name: 'Loclaude Lite',
  description: 'Enhanced AI with shell commands, AST code understanding, and smart search.',
  color: 'text-cyan-400',
  bgColor: 'bg-cyan-600',
  enabled: true,
},
loclaude: {
  name: 'Loclaude',
  description: 'Claude Code-style AI with sub-agents, extended thinking, and persistent shell.',
  color: 'text-orange-400',
  bgColor: 'bg-orange-600',
  enabled: true,
},
```

**Step 2: Update ExtensionSelector.tsx**

Add to EXTENSIONS array:
```typescript
{
  id: 'loclaude-lite',
  name: 'Loclaude Lite',
  description: 'Enhanced AI coding assistant with shell access and AST-based code understanding',
  features: [
    'Shell command execution (npm, git, tests)',
    'AST-aware codebase understanding',
    'Smart file search with glob and grep',
    'Live preview UI',
    'Auto-refreshing code context'
  ],
  credentialSupport: 'AWS credentials auto-configured via task role',
},
{
  id: 'loclaude',
  name: 'Loclaude',
  description: 'Claude Code-style AI agent with sub-agents, extended thinking, and persistent shell',
  features: [
    'Claude Code-style tool design',
    'Sub-agent spawning for parallel tasks',
    'Extended thinking for complex reasoning',
    'Persistent shell state across commands',
    'Read-before-write safety enforcement'
  ],
  credentialSupport: 'AWS credentials auto-configured via task role',
  recommended: true,
},
```

**Step 3: Update InstanceList.tsx**

Add to EXTENSION_BADGES:
```typescript
'loclaude-lite': { label: 'Loclaude Lite', color: 'text-cyan-400', bgColor: 'bg-cyan-900/50 border-cyan-600' },
loclaude: { label: 'Loclaude', color: 'text-orange-400', bgColor: 'bg-orange-900/50 border-orange-600' },
```

Update all 3 vibe-check locations (lines 283, 491, 662) to also include loclaude variants:
```typescript
['vibe', 'loclaude-lite', 'loclaude'].includes(i.ai_extension || '')
```

Use "Loclaude Studio" as the label for loclaude instances:
```typescript
const studioLabel = ['loclaude-lite', 'loclaude'].includes(i.ai_extension || '') ? 'Loclaude Studio'
  : i.ai_extension === 'vibe' ? 'Vibe Studio' : 'VS Code';
```

**Step 4: Update ParticipantPortal.tsx**

Line 212:
```typescript
const isVibeInstance = ['vibe', 'loclaude-lite', 'loclaude'].includes(instance.ai_extension || '');
const isLoclaudeInstance = ['loclaude-lite', 'loclaude'].includes(instance.ai_extension || '');
```

Line 231: use `isLoclaudeInstance ? 'Open Loclaude Studio' : isVibeInstance ? 'Open Vibe Studio' : 'Open VS Code'`

Update tips section (lines 273-285) to add loclaude-specific tips:
```typescript
{isLoclaudeInstance ? (
  <>
    <li>Loclaude Studio runs in your browser - no installation needed</li>
    <li>Chat with AI to build your app - it can write code, run commands, and install packages</li>
    <li>Your app preview updates live as changes are made</li>
  </>
) : isVibeInstance ? (
  // ... existing vibe tips ...
```

**Step 5: Commit**

```bash
git add dashboard/client/
git commit -m "feat(dashboard): add loclaude-lite and loclaude to frontend UI"
```

---

## Phase 5: Terminal-style UI Enhancement

### Task 16: Add terminal-style rendering for bash/shell tool results in ChatPanel

**Files:**
- Modify: `loclaude-lite-instance/client/src/components/ChatPanel.tsx`
- Modify: `loclaude-instance/client/src/components/ChatPanel.tsx`

**Step 1: Update ToolCallCard to render bash/Bash tools with terminal styling**

In both loclaude client copies, update the ToolCallCard component:

```typescript
function ToolCallCard({ tool }: { tool: ToolCall }) {
  const [expanded, setExpanded] = useState(false);
  const isBashTool = tool.name === 'bash_command' || tool.name === 'Bash';

  return (
    <div
      className="mt-2 bg-gray-800 rounded-lg border border-gray-700 overflow-hidden cursor-pointer"
      onClick={() => setExpanded(!expanded)}
    >
      <div className="flex items-center justify-between px-3 py-2">
        <span className="text-sm font-bold text-gray-300">
          {isBashTool ? '$ ' : ''}{tool.name}
        </span>
        <span className="text-xs text-gray-500">{expanded ? '\u25B2' : '\u25BC'}</span>
      </div>
      {expanded && (
        <div className="border-t border-gray-700 px-3 py-2 space-y-2">
          {isBashTool ? (
            <div className="bg-black rounded p-3 font-mono text-xs text-green-400 whitespace-pre-wrap break-words max-h-64 overflow-y-auto">
              <div className="text-gray-500 mb-1">$ {typeof tool.input === 'string' ? JSON.parse(tool.input).command : tool.input}</div>
              <div>{typeof tool.result === 'string' ? (JSON.parse(tool.result).output || '') : tool.result}</div>
            </div>
          ) : (
            <>
              <div>
                <div className="text-xs text-gray-500 mb-1">Input</div>
                <pre className="text-xs text-gray-400 whitespace-pre-wrap break-words bg-gray-900 rounded p-2">
                  {tool.input}
                </pre>
              </div>
              <div>
                <div className="text-xs text-gray-500 mb-1">Result</div>
                <pre className="text-xs text-gray-400 whitespace-pre-wrap break-words bg-gray-900 rounded p-2">
                  {tool.result}
                </pre>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
```

**Step 2: Commit**

```bash
git add loclaude-lite-instance/client/ loclaude-instance/client/
git commit -m "feat(ui): add terminal-style rendering for bash tool results"
```

---

## Verification

### Task 17: Verify builds and run tests

**Step 1: Verify vibe-instance builds after changes**

```bash
cd vibe-instance && npm install && npm run build:client && npm test
```

Expected: all pass, no TypeScript errors.

**Step 2: Verify loclaude-lite-instance builds**

```bash
cd loclaude-lite-instance && npm install && npm run build:client && npm test
```

**Step 3: Verify loclaude-instance builds**

```bash
cd loclaude-instance && npm install && npm run build:client && npm test
```

**Step 4: Verify dashboard builds**

```bash
cd dashboard && npm install && cd client && npm run build
```

**Step 5: Commit any fixes**

```bash
git add -A
git commit -m "fix: resolve build issues from integration"
```

---

### Task 18: Final commit and push

**Step 1: Push feature branch**

```bash
git push -u origin feature/43-better-vibe-instance
```
