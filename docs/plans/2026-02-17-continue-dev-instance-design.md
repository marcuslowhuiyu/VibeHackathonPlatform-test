# Continue-Dev Instance Design

## Overview

A new instance type `continue-dev` that uses the open-source Continue CLI (`@continuedev/cli`) as a headless AI backend, paired with the platform's shared/instance-client React UI. This gives participants the full Continue feature set (chat, codebase indexing, context providers, slash commands) through a custom browser-based interface — no VS Code required.

## Architecture

### Approach: Continue CLI Headless + Custom UI

The instance runs an Express server that bridges between the shared/instance-client WebSocket UI and the Continue CLI's headless mode. For each user message, the server spawns `cn -p "message" --format json` and returns the complete response.

```
Browser (shared/instance-client)
    ↕ WebSocket
Express Server (server/index.ts)
    ↕ child_process.spawn
Continue CLI (cn -p --format json)
    ↕ Bedrock API
Claude (via AWS Bedrock)
```

No token-by-token streaming — headless mode returns the full response. The UI shows a "thinking" indicator while waiting.

### Why This Approach

- Full Continue feature set with minimal custom code
- Published npm package (`@continuedev/cli`), designed for headless use
- Clean boundary: we own the UI, Continue owns the AI backend
- Same pattern as vibe/loclaude instances for consistency

## Components

### 1. Container (Dockerfile)

Base image: `node:20-slim` (same as loclaude instances).

Install chain:
1. System deps: git, curl, build tools
2. `npm i -g @continuedev/cli` — Continue CLI
3. Build shared/instance-client React app
4. Copy server source
5. Scaffold starter React project in `/home/workspace`

Ports: 8080 (Express), 3000 (Vite dev server for preview)

### 2. Continue Configuration (config.yaml)

Written at container start by entrypoint.sh. Uses Bedrock provider with credentials from environment variables.

```yaml
name: Hackathon Assistant
version: 0.0.1
schema: v1
models:
  - name: Claude Sonnet
    provider: bedrock
    model: us.anthropic.claude-sonnet-4-20250514
    env:
      region: ap-southeast-1
    roles:
      - chat
      - edit
```

AWS credentials written to `~/.aws/credentials` from env vars (same pattern as existing continue-instance).

### 3. Express Server (server/index.ts)

REST API:
- `GET /api/project-files` — list workspace files
- `GET /api/file/:path` — read file content
- `POST /api/write-file` — write file content
- `GET /api/health` — health check

WebSocket (`/ws`):
- Receives user messages
- Spawns Continue CLI headless process
- Returns AI response + any file changes

Preview proxy:
- `/preview/*` proxied to Vite dev server on port 3000

### 4. Continue Bridge (server/agent/continue-bridge.ts)

The bridge between WebSocket messages and Continue CLI:

1. Receive user message via WebSocket
2. Spawn: `cn -p "message" --format json --config /path/to/config.yaml`
3. Run in workspace directory so cn has file access
4. Parse JSON response
5. Detect file changes (diff workspace before/after)
6. Send response + file changes back via WebSocket

Session continuity via `cn --resume` flag for multi-turn conversations.

### 5. UI (shared/instance-client)

Reuses the existing shared client with:
- ChatPanel for message display and input
- CodeViewer for file browsing with Monaco Editor
- LivePreview for the participant's app
- LayoutManager for resizable panels

### 6. Entrypoint (entrypoint.sh)

Startup sequence:
1. Write AWS credentials to `~/.aws/credentials`
2. Write Continue `config.yaml` with Bedrock settings
3. Scaffold starter project if workspace is empty
4. Start Vite dev server (port 3000, background)
5. Start Express server (port 8080)

## Platform Registration

Add to existing registries:

- `AI_EXTENSIONS`: add `'continue-dev'`
- `EXTENSION_DIRECTORIES`: `'continue-dev': 'continue-dev-instance'`
- `imageTagMap`: `'continue-dev': 'continue-dev'`
- Dashboard UI automatically picks up the new type
- CI/CD auto-detects `continue-dev-instance/` directory changes

## Directory Structure

```
continue-dev-instance/
├── Dockerfile
├── entrypoint.sh
├── package.json
├── tsconfig.json
├── config.yaml.template
└── server/
    ├── index.ts          (Express app, REST API, WebSocket, preview proxy)
    ├── websocket.ts       (WebSocket message handler)
    └── agent/
        └── continue-bridge.ts  (CLI spawn, JSON parse, file change detection)
```

## Key Decisions

1. **Headless mode over TUI**: Simpler, more reliable. No streaming but acceptable UX with thinking indicator.
2. **Per-message process spawn**: Each message spawns a new `cn -p` process. Simple, stateless, no long-running process management.
3. **Session resume**: Use `cn --resume` for conversation continuity across messages.
4. **File change detection**: Diff workspace before/after CLI execution to detect AI-written files.
5. **Reuse shared/instance-client**: Consistent UI across all custom instances.
