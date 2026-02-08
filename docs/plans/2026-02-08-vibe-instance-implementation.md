# Vibe & Vibe Pro Instance Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add two new non-technical instance types (Vibe & Vibe Pro) with a custom chat+preview UI, rename legacy directories, and update all dashboard references.

**Architecture:** Single Node.js container per instance with Express (port 8080) serving the custom React UI and running the AI agent loop via Bedrock, plus a Vite dev server (port 3000) for the participant's live preview app. Vibe uses a pure agentic tool-use loop; Vibe Pro adds tree-sitter repo map generation.

**Tech Stack:** Node.js 20, Express, React 18, TypeScript, Tailwind CSS, Monaco Editor, WebSocket, AWS SDK v3 (Bedrock Runtime), tree-sitter, chokidar, Vite.

---

## Phase 1: Directory Rename & Refactor

### Task 1: Rename cline-setup/ to continue-instance/

**Files:**
- Rename: `cline-setup/` → `continue-instance/`

**Step 1: Rename directory**

```bash
git mv cline-setup continue-instance
```

**Step 2: Commit**

```bash
git add -A
git commit -m "refactor: rename cline-setup/ to continue-instance/"
```

---

### Task 2: Rename cline-ai/ to cline-instance/

**Files:**
- Rename: `cline-ai/` → `cline-instance/`

**Step 1: Rename directory**

```bash
git mv cline-ai cline-instance
```

**Step 2: Commit**

```bash
git add -A
git commit -m "refactor: rename cline-ai/ to cline-instance/"
```

---

### Task 3: Update AWS Setup directory references

**Files:**
- Modify: `dashboard/server/services/aws-setup.ts:616-619` (EXTENSION_DIRECTORIES)
- Modify: `dashboard/server/services/aws-setup.ts:505-531` (CodeBuild buildspec)

**Step 1: Update EXTENSION_DIRECTORIES constant (~line 616)**

Change:
```typescript
continue: 'cline-setup',
cline: 'cline-ai',
```

To:
```typescript
continue: 'continue-instance',
cline: 'cline-instance',
```

**Step 2: Update CodeBuild buildspec directory references (~lines 505-531)**

Replace all references to `cline-setup` with `continue-instance` and `cline-ai` with `cline-instance` in the buildspec string.

**Step 3: Update getDockerPushCommands (~lines 762-786)**

Replace directory references from `cline-setup` to `continue-instance` and `cline-ai` to `cline-instance`.

**Step 4: Commit**

```bash
git add dashboard/server/services/aws-setup.ts
git commit -m "refactor: update aws-setup directory refs for renamed instance dirs"
```

---

### Task 4: Update CodeBuild Manager directory references

**Files:**
- Modify: `dashboard/server/services/codebuild-manager.ts:51-77` (buildspec)

**Step 1: Update buildspec directory references**

Replace `cline-setup` with `continue-instance` and `cline-ai` with `cline-instance` in the buildspec definition.

**Step 2: Commit**

```bash
git add dashboard/server/services/codebuild-manager.ts
git commit -m "refactor: update codebuild-manager directory refs for renamed instance dirs"
```

---

### Task 5: Update GitHub Actions workflows

**Files:**
- Modify: `.github/workflows/deploy-dashboard.yml:164-198`

**Step 1: Update deploy workflow**

Replace all references:
- `cline-setup/` → `continue-instance/`
- `cline-ai/` → `cline-instance/`
- `./cline-setup` → `./continue-instance`
- `./cline-ai` → `./cline-instance`

**Step 2: Commit**

```bash
git add .github/workflows/deploy-dashboard.yml
git commit -m "refactor: update deploy workflow for renamed instance dirs"
```

---

## Phase 2: Vibe Instance Container — Server

### Task 6: Scaffold vibe-instance directory and package.json

**Files:**
- Create: `vibe-instance/package.json`
- Create: `vibe-instance/tsconfig.json`

**Step 1: Create package.json**

```json
{
  "name": "vibe-instance",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "dev": "tsx watch server/index.ts",
    "build:client": "cd client && npm run build",
    "start": "node dist/server/index.js"
  },
  "dependencies": {
    "@aws-sdk/client-bedrock-runtime": "^3.972.0",
    "chokidar": "^4.0.0",
    "express": "^4.21.0",
    "ws": "^8.18.0"
  },
  "devDependencies": {
    "@types/express": "^5.0.0",
    "@types/node": "^22.10.0",
    "@types/ws": "^8.5.0",
    "tsx": "^4.19.0",
    "typescript": "^5.6.0"
  }
}
```

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
git add vibe-instance/package.json vibe-instance/tsconfig.json
git commit -m "feat(vibe): scaffold vibe-instance with package.json and tsconfig"
```

---

### Task 7: Create sandboxed file tools

**Files:**
- Create: `vibe-instance/server/agent/tools.ts`

**Step 1: Implement sandboxed file tools**

Build the 6 tools the AI agent can use. Every tool must:
1. Resolve the file path against `PROJECT_ROOT` (`/home/workspace/project`)
2. Validate the resolved path starts with `PROJECT_ROOT` (reject path traversal)
3. Return a JSON result suitable for the Bedrock tool_result format

Tools to implement:
- `read_file(path: string)` — Read file contents, return with line numbers
- `write_file(path: string, content: string)` — Write/overwrite a file
- `edit_file(path: string, old_string: string, new_string: string)` — Find and replace in file
- `list_files(path: string)` — List directory contents recursively (max 2 levels)
- `search_files(pattern: string, path?: string)` — Grep-like search across project files
- `restart_preview()` — Kill and restart the Vite dev server process on port 3000

Export a `TOOL_DEFINITIONS` array with Bedrock-compatible tool schemas (name, description, input_schema) and an `executeTool(name, input)` function.

**Step 2: Commit**

```bash
git add vibe-instance/server/agent/tools.ts
git commit -m "feat(vibe): implement sandboxed file tools for AI agent"
```

---

### Task 8: Create AI agent loop

**Files:**
- Create: `vibe-instance/server/agent/agent-loop.ts`

**Step 1: Implement the agent loop**

The agent loop:
1. Accepts a user message and conversation history
2. Builds the prompt: system instructions + conversation history + tool definitions
3. Calls Bedrock `InvokeModelWithResponseStream` (model: `anthropic.claude-sonnet-4-20250514-v1:0`)
4. Parses streaming response chunks
5. If the model returns `tool_use` blocks: execute each tool via `executeTool()`, append tool results to conversation, loop back to step 3
6. If the model returns a `text` block as the stop reason: return the final response
7. Emit events for each step: `agent:thinking`, `agent:tool_call`, `agent:tool_result`, `agent:text`, `agent:file_changed`

Use an EventEmitter pattern so the WebSocket layer can stream events to the client.

System prompt should instruct the agent:
- You are helping a non-technical hackathon participant build a React web app
- You can only modify files within the project directory
- Always explain what you're doing in simple terms
- After making changes, tell the user to check the live preview
- Keep code simple and beginner-friendly

**Step 2: Commit**

```bash
git add vibe-instance/server/agent/agent-loop.ts
git commit -m "feat(vibe): implement Bedrock-powered AI agent loop"
```

---

### Task 9: Create repo map for Vibe Pro

**Files:**
- Create: `vibe-instance/server/agent/repo-map.ts`

**Step 1: Implement repo map generation**

When `INSTANCE_MODE=vibe-pro`:
1. Walk all `.ts`, `.tsx`, `.js`, `.jsx`, `.css`, `.json` files in the project directory
2. For each file, extract a summary: file path, exports, imports, function/component names
3. Use simple regex-based parsing (avoid tree-sitter native dependency complexity for now — can upgrade later)
4. Build a structured map: `{ files: [{ path, imports, exports, functions, components }] }`
5. Format as a condensed string for inclusion in the system prompt
6. Export `generateRepoMap(projectDir: string): Promise<string>`

Keep the repo map under 4000 tokens to leave room for conversation context.

**Step 2: Commit**

```bash
git add vibe-instance/server/agent/repo-map.ts
git commit -m "feat(vibe-pro): implement repo map generation for enhanced context"
```

---

### Task 10: Create WebSocket server

**Files:**
- Create: `vibe-instance/server/websocket.ts`

**Step 1: Implement WebSocket handler**

Using the `ws` library:
1. Accept WebSocket connections on the Express server (upgrade handler)
2. On message from client: parse JSON `{ type: 'chat', message: string }` or `{ type: 'element_click', selector: string, tagName: string, textContent: string }`
3. For `chat`: run the agent loop, stream events back as JSON messages:
   - `{ type: 'agent:thinking' }` — agent is processing
   - `{ type: 'agent:text', content: string }` — streamed text response (character by character)
   - `{ type: 'agent:tool_call', tool: string, input: object }` — tool being called
   - `{ type: 'agent:tool_result', tool: string, result: string }` — tool result
   - `{ type: 'agent:file_changed', path: string, content: string }` — file was modified (triggers typewriter in UI)
   - `{ type: 'agent:done' }` — agent loop complete
4. For `element_click`: pre-format a message like "Change the [tagName] element that says '[textContent]'..." and send it back as `{ type: 'prefill', message: string }`
5. Maintain conversation history per connection (in-memory array)

**Step 2: Commit**

```bash
git add vibe-instance/server/websocket.ts
git commit -m "feat(vibe): implement WebSocket server for real-time agent streaming"
```

---

### Task 11: Create Express server entry point

**Files:**
- Create: `vibe-instance/server/index.ts`

**Step 1: Implement server entry point**

1. Create Express app
2. Serve static files from `client/dist/` on `/`
3. Add health check endpoint `GET /health`
4. Add endpoint `GET /api/project-files` — returns file tree of `/home/workspace/project`
5. Add endpoint `GET /api/file/:path` — returns file contents (sandboxed)
6. Create HTTP server, attach WebSocket upgrade handler
7. On startup:
   - If `INSTANCE_MODE === 'vibe-pro'`: generate repo map
   - Start Vite dev server as child process on port 3000 (from `/home/workspace/project`)
   - Start Express on port 8080
8. Log: `Vibe instance running (mode: ${INSTANCE_MODE})`

**Step 2: Commit**

```bash
git add vibe-instance/server/index.ts
git commit -m "feat(vibe): implement Express server entry point"
```

---

## Phase 3: Vibe Instance Container — Client UI

### Task 12: Scaffold React client app

**Files:**
- Create: `vibe-instance/client/package.json`
- Create: `vibe-instance/client/index.html`
- Create: `vibe-instance/client/vite.config.ts`
- Create: `vibe-instance/client/tailwind.config.js`
- Create: `vibe-instance/client/postcss.config.js`
- Create: `vibe-instance/client/tsconfig.json`
- Create: `vibe-instance/client/src/main.tsx`
- Create: `vibe-instance/client/src/index.css`

**Step 1: Create React + Vite + Tailwind scaffolding**

Standard React 18 + Vite + TypeScript + Tailwind setup. The `vite.config.ts` should proxy WebSocket connections to the Express server during development.

**Step 2: Commit**

```bash
git add vibe-instance/client/
git commit -m "feat(vibe): scaffold React client with Vite and Tailwind"
```

---

### Task 13: Create LayoutManager component

**Files:**
- Create: `vibe-instance/client/src/components/LayoutManager.tsx`

**Step 1: Implement responsive layout manager**

1. Track window width with `useEffect` + resize listener
2. Determine layout mode: `'full'` (>1200px), `'panel'` (768-1200px), `'tabs'` (<768px)
3. Allow manual override via state + toggle button in top-right corner
4. Render children in the appropriate layout:
   - `full`: CSS Grid with 3 columns (chat 25%, preview 50%, code 25%)
   - `panel`: CSS Grid with 2 columns (preview 70%, collapsible sidebar 30%)
   - `tabs`: Tab bar at top, one panel visible at a time
5. Accept `chatPanel`, `previewPanel`, `codePanel` as render props

**Step 2: Commit**

```bash
git add vibe-instance/client/src/components/LayoutManager.tsx
git commit -m "feat(vibe): implement responsive LayoutManager component"
```

---

### Task 14: Create ChatPanel component

**Files:**
- Create: `vibe-instance/client/src/components/ChatPanel.tsx`

**Step 1: Implement chat interface**

1. Message list displaying conversation history (scrollable, auto-scroll to bottom)
2. Each message shows: role (user/assistant), content (markdown-rendered)
3. Tool calls shown as collapsible cards: tool name, input summary, result summary
4. Input area at bottom: textarea + send button
5. Accept a `prefillMessage` prop to pre-fill input from element clicks
6. Accept an `onSendMessage(message: string)` callback
7. Show typing indicator when agent is processing
8. Display `agent:text` content streaming character-by-character

**Step 2: Commit**

```bash
git add vibe-instance/client/src/components/ChatPanel.tsx
git commit -m "feat(vibe): implement ChatPanel component"
```

---

### Task 15: Create CodeViewer component

**Files:**
- Create: `vibe-instance/client/src/components/CodeViewer.tsx`

**Step 1: Implement read-only code viewer with typewriter effect**

1. Left sidebar: file tree (fetched from `GET /api/project-files`)
2. Main area: Monaco Editor in read-only mode
3. Click a file in the tree to view it
4. When a `agent:file_changed` event arrives:
   - Auto-switch to the changed file
   - Apply typewriter effect: show the new content character-by-character using a timer (e.g., 10ms per character)
   - Highlight the changed region with a subtle background color
5. File tree auto-refreshes when files are created/deleted (via WebSocket events)

Use `@monaco-editor/react` package for React integration.

**Step 2: Commit**

```bash
git add vibe-instance/client/src/components/CodeViewer.tsx
git commit -m "feat(vibe): implement CodeViewer with typewriter effect"
```

---

### Task 16: Create LivePreview component

**Files:**
- Create: `vibe-instance/client/src/components/LivePreview.tsx`

**Step 1: Implement live preview iframe**

1. Render an iframe pointing to `http://localhost:3000` (the participant's Vite app)
2. On Vite HMR update, the iframe auto-refreshes (Vite handles this natively)
3. Add a refresh button in the toolbar above the iframe
4. Add a URL bar showing the current path within the preview

**Step 2: Commit**

```bash
git add vibe-instance/client/src/components/LivePreview.tsx
git commit -m "feat(vibe): implement LivePreview iframe component"
```

---

### Task 17: Create ElementHighlighter

**Files:**
- Create: `vibe-instance/client/src/components/ElementHighlighter.tsx`
- Create: `vibe-instance/client/public/highlighter-inject.js`

**Step 1: Create the injected highlighter script**

`highlighter-inject.js` is injected into the preview iframe:
1. On `mouseover`: draw a semi-transparent blue overlay on the hovered element (using a floating div positioned absolutely)
2. On `mouseout`: remove the overlay
3. On `click` (with a modifier key or special mode): prevent default, send `postMessage` to parent with `{ type: 'element_click', tagName, textContent: (first 50 chars), selector: (CSS path) }`
4. CSS selector path: build from tag name, classes, and nth-child

**Step 2: Create the ElementHighlighter component**

Wraps the LivePreview iframe:
1. Inject the highlighter script into the iframe on load
2. Listen for `postMessage` events from the iframe
3. On `element_click` message: call `onElementClick(info)` callback which sends to WebSocket

**Step 3: Commit**

```bash
git add vibe-instance/client/src/components/ElementHighlighter.tsx vibe-instance/client/public/highlighter-inject.js
git commit -m "feat(vibe): implement element highlighting for live preview"
```

---

### Task 18: Create App.tsx and wire everything together

**Files:**
- Create: `vibe-instance/client/src/App.tsx`
- Create: `vibe-instance/client/src/hooks/useWebSocket.ts`

**Step 1: Create WebSocket hook**

`useWebSocket.ts`:
1. Connect to `ws://localhost:8080` (or derive from `window.location`)
2. Parse incoming JSON messages
3. Maintain state: `messages`, `isAgentThinking`, `currentFileChange`, `prefillMessage`
4. Expose: `sendMessage(text)`, `sendElementClick(info)`, `messages`, `isAgentThinking`, `prefillMessage`, `currentFileChange`

**Step 2: Create App.tsx**

Wire together:
1. `useWebSocket` hook for all real-time communication
2. `LayoutManager` wrapping the three panels
3. `ChatPanel` — receives messages, sends via WebSocket
4. `LivePreview` wrapped in `ElementHighlighter` — sends element clicks via WebSocket
5. `CodeViewer` — receives file change events from WebSocket

**Step 3: Commit**

```bash
git add vibe-instance/client/src/App.tsx vibe-instance/client/src/hooks/useWebSocket.ts
git commit -m "feat(vibe): wire up App with WebSocket, layout, and all panels"
```

---

## Phase 4: Docker & Entrypoint

### Task 19: Create Dockerfile

**Files:**
- Create: `vibe-instance/Dockerfile`

**Step 1: Write Dockerfile**

```dockerfile
FROM node:20-slim

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    && rm -rf /var/lib/apt/lists/*

# Copy and install server dependencies
COPY package.json tsconfig.json ./
RUN npm install

# Copy and build client
COPY client/ ./client/
RUN cd client && npm install && npm run build

# Copy server source
COPY server/ ./server/

# Create project directory with starter Vite+React app
RUN mkdir -p /home/workspace/project

# Copy entrypoint
COPY entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

ENV INSTANCE_MODE=vibe
EXPOSE 8080 3000

ENTRYPOINT ["/app/entrypoint.sh"]
```

**Step 2: Commit**

```bash
git add vibe-instance/Dockerfile
git commit -m "feat(vibe): add Dockerfile for vibe instance container"
```

---

### Task 20: Create entrypoint script

**Files:**
- Create: `vibe-instance/entrypoint.sh`

**Step 1: Write entrypoint.sh**

```bash
#!/bin/bash
set -e

# Scaffold starter project if empty
if [ ! -f /home/workspace/project/package.json ]; then
  cd /home/workspace/project
  npm create vite@latest . -- --template react-ts <<< "y"
  npm install
  npm install -D tailwindcss @tailwindcss/vite
  echo "Project scaffolded successfully"
fi

# Start the vibe server (which also starts the Vite dev server)
cd /app
exec node --loader tsx server/index.ts
```

**Step 2: Commit**

```bash
git add vibe-instance/entrypoint.sh
git commit -m "feat(vibe): add entrypoint script with project scaffolding"
```

---

## Phase 5: Dashboard Integration

### Task 21: Update database types for new extensions

**Files:**
- Modify: `dashboard/server/db/database.ts:131-154` (Instance interface)

**Step 1: Update ai_extension type**

Find the Instance interface and update the `ai_extension` field to accept the new types:

```typescript
ai_extension?: 'continue' | 'cline' | 'vibe' | 'vibe-pro';
```

**Step 2: Commit**

```bash
git add dashboard/server/db/database.ts
git commit -m "feat(dashboard): add vibe and vibe-pro to ai_extension type"
```

---

### Task 22: Update instance routes for new extensions

**Files:**
- Modify: `dashboard/server/routes/instances.ts:181-212`

**Step 1: Update valid extensions list (~line 187)**

```typescript
const validExtensions = ['continue', 'cline', 'vibe', 'vibe-pro'];
```

**Step 2: Update prefix map (~lines 190-194)**

```typescript
const extPrefixes: Record<string, string> = {
  continue: 'ct',
  cline: 'cl',
  vibe: 'vb',
  'vibe-pro': 'vp',
};
```

**Step 3: Commit**

```bash
git add dashboard/server/routes/instances.ts
git commit -m "feat(dashboard): support vibe/vibe-pro in instance routes"
```

---

### Task 23: Update ECS Manager for new image tags

**Files:**
- Modify: `dashboard/server/services/ecs-manager.ts:110-111`

**Step 1: Update image tag mapping (~line 110)**

Replace the simple ternary with a map:

```typescript
const imageTagMap: Record<string, string> = {
  continue: 'continue',
  cline: 'cline',
  vibe: 'vibe',
  'vibe-pro': 'vibe-pro',
};
const imageTag = imageTagMap[extension] || 'continue';
```

**Step 2: Add INSTANCE_MODE env var for vibe types (~lines 152-159)**

Add to the environment variables array:

```typescript
...(extension === 'vibe' || extension === 'vibe-pro' ? [
  { name: 'INSTANCE_MODE', value: extension === 'vibe-pro' ? 'vibe-pro' : 'vibe' },
] : []),
```

**Step 3: Commit**

```bash
git add dashboard/server/services/ecs-manager.ts
git commit -m "feat(dashboard): support vibe/vibe-pro image tags in ECS manager"
```

---

### Task 24: Update AWS Setup for new extensions

**Files:**
- Modify: `dashboard/server/services/aws-setup.ts:616-619` (EXTENSION_DIRECTORIES)
- Modify: `dashboard/server/services/aws-setup.ts:505-531` (CodeBuild buildspec)
- Modify: `dashboard/server/services/aws-setup.ts:762-786` (Docker push commands)

**Step 1: Add vibe to EXTENSION_DIRECTORIES (~line 616)**

```typescript
const EXTENSION_DIRECTORIES: Record<string, string> = {
  continue: 'continue-instance',
  cline: 'cline-instance',
  vibe: 'vibe-instance',
  'vibe-pro': 'vibe-instance',
};
```

**Step 2: Update CodeBuild buildspec to build 4 images (~lines 505-531)**

Add build commands for vibe and vibe-pro images:
```
cd vibe-instance && docker build -t vibe-coding-lab:vibe .
docker tag vibe-coding-lab:vibe $REPO:vibe
docker push $REPO:vibe
docker tag vibe-coding-lab:vibe $REPO:vibe-pro
docker push $REPO:vibe-pro
```

Note: vibe and vibe-pro use the same image. The `INSTANCE_MODE` env var differentiates behavior at runtime.

**Step 3: Update getDockerPushCommands to include vibe images**

Add commands for building and pushing the vibe image.

**Step 4: Commit**

```bash
git add dashboard/server/services/aws-setup.ts
git commit -m "feat(dashboard): add vibe/vibe-pro to AWS setup and build pipeline"
```

---

### Task 25: Update SpinUpForm extension selector

**Files:**
- Modify: `dashboard/client/src/components/SpinUpForm.tsx:8,20-49`

**Step 1: Update AIExtension type (~line 8)**

```typescript
type AIExtension = 'continue' | 'cline' | 'vibe' | 'vibe-pro';
```

**Step 2: Add Vibe entries to AI_EXTENSIONS config (~lines 20-42)**

Add two new entries to the `AI_EXTENSIONS` object:

```typescript
vibe: {
  name: 'Vibe',
  description: 'AI-powered coding for non-technical users. Chat + live preview UI.',
  imageTag: 'vibe',
},
'vibe-pro': {
  name: 'Vibe Pro',
  description: 'Enhanced Vibe with codebase-aware AI. Better for complex multi-file apps.',
  imageTag: 'vibe-pro',
},
```

**Step 3: Commit**

```bash
git add dashboard/client/src/components/SpinUpForm.tsx
git commit -m "feat(dashboard): add Vibe and Vibe Pro to extension selector"
```

---

### Task 26: Update SetupGuide extension references

**Files:**
- Modify: `dashboard/client/src/components/SetupGuide.tsx:575-620`

**Step 1: Update the duplicate AI_EXTENSIONS config in SetupGuide**

Add the same Vibe and Vibe Pro entries as in SpinUpForm.

**Step 2: Commit**

```bash
git add dashboard/client/src/components/SetupGuide.tsx
git commit -m "feat(dashboard): add Vibe/Vibe Pro to SetupGuide extension list"
```

---

### Task 27: Update ExtensionSelector component

**Files:**
- Modify: `dashboard/client/src/components/ExtensionSelector.tsx:16-31`

**Step 1: Add Vibe entries to EXTENSIONS array**

Add two new extension objects for Vibe and Vibe Pro.

**Step 2: Commit**

```bash
git add dashboard/client/src/components/ExtensionSelector.tsx
git commit -m "feat(dashboard): add Vibe/Vibe Pro to ExtensionSelector"
```

---

### Task 28: Update Participant Portal for Vibe instances

**Files:**
- Modify: `dashboard/client/src/components/portal/ParticipantPortal.tsx:191-260`

**Step 1: Update URL display logic**

For Vibe/Vibe Pro instances, the VS Code URL points to the custom UI (port 8080), not VS Code. Update the button label and description:

```typescript
const isVibeInstance = instance.ai_extension === 'vibe' || instance.ai_extension === 'vibe-pro';
```

If `isVibeInstance`:
- Change "Open VS Code" button text to "Open Vibe Studio"
- Change description from "Start coding in your browser" to "Start building with AI"
- The `vscode_url` field still works — it points to port 8080 which is now the custom UI

The React app preview button stays the same (port 3000 is still the participant's app).

**Step 2: Commit**

```bash
git add dashboard/client/src/components/portal/ParticipantPortal.tsx
git commit -m "feat(dashboard): update portal to show Vibe Studio for vibe instances"
```

---

### Task 29: Update GitHub deploy workflow for 4 image types

**Files:**
- Modify: `.github/workflows/deploy-dashboard.yml`

**Step 1: Add vibe-instance change detection and build steps**

Add a new change detection block for `vibe-instance/` directory and corresponding Docker build+push steps for the vibe and vibe-pro images.

**Step 2: Commit**

```bash
git add .github/workflows/deploy-dashboard.yml
git commit -m "feat(ci): add vibe-instance build to deploy workflow"
```

---

## Phase 6: Final Integration & Verification

### Task 30: Verify directory structure and references

**Step 1: Search for any remaining old directory references**

```bash
grep -r "cline-setup" --include="*.ts" --include="*.tsx" --include="*.yml" --include="*.md" .
grep -r "cline-ai" --include="*.ts" --include="*.tsx" --include="*.yml" --include="*.md" .
```

Expected: No results (all renamed). If any found, update them.

**Step 2: Verify all 4 extension types are registered**

Check that `continue`, `cline`, `vibe`, and `vibe-pro` appear in:
- `dashboard/server/routes/instances.ts` (validExtensions)
- `dashboard/server/services/ecs-manager.ts` (imageTagMap)
- `dashboard/server/services/aws-setup.ts` (EXTENSION_DIRECTORIES)
- `dashboard/client/src/components/SpinUpForm.tsx` (AI_EXTENSIONS)
- `dashboard/client/src/components/SetupGuide.tsx` (AI_EXTENSIONS)

**Step 3: Commit any remaining fixes**

```bash
git add -A
git commit -m "chore: fix remaining directory references and verify integration"
```

---

## Task Dependency Overview

```
Phase 1: Directory Rename (Tasks 1-5) — Sequential, must complete first
    │
    ├── Phase 2: Vibe Server (Tasks 6-11) — Can start after Phase 1
    │       Task 6 (scaffold) → Task 7 (tools) → Task 8 (agent) → Task 9 (repo-map)
    │       Task 10 (websocket) depends on Task 8
    │       Task 11 (entry point) depends on Tasks 7-10
    │
    ├── Phase 3: Vibe Client (Tasks 12-18) — Can start after Task 6
    │       Task 12 (scaffold) → Tasks 13-17 (components, parallel)
    │       Task 18 (App.tsx) depends on Tasks 13-17
    │
    ├── Phase 4: Docker (Tasks 19-20) — After Phase 2 + 3
    │
    ├── Phase 5: Dashboard (Tasks 21-29) — After Phase 1, parallel with Phases 2-4
    │       Tasks 21-24 (server, parallel)
    │       Tasks 25-28 (client, parallel)
    │       Task 29 (CI, after Tasks 3-5)
    │
    └── Phase 6: Verification (Task 30) — After all other phases
```
