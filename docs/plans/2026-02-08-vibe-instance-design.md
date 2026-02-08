# Vibe & Vibe Pro Instance Design

## Overview

Two new instance types for non-technical hackathon participants. Instead of VS Code with AI extensions (Cline/Continue), participants get a custom UI where they describe what they want in natural language, watch the AI write code in real-time (typewriter effect), and see their app update live.

- **Vibe** — SWE-agent style. Pure agentic tool-use loop. AI explores and edits files on-demand via Bedrock.
- **Vibe Pro** — Hybrid. Same agentic loop, plus Aider-style repo map (tree-sitter AST parsing) for better codebase understanding on multi-file changes.

## Architecture

### Container (Single Docker Container, Node.js 20)

```
Single Docker Container (Node.js 20)
├── Express Server (port 8080)
│   ├── WebSocket server (real-time code streaming)
│   ├── AI Agent loop (Bedrock API)
│   ├── File system manager (read/write/watch project files)
│   └── Static file serving (React UI)
├── Vite Dev Server (port 3000)
│   └── Participant's app (live preview)
└── Project Files (/home/workspace/project)
    └── Scaffolded Vite + React app
```

Single Dockerfile differentiated by environment variable:
- `INSTANCE_MODE=vibe` — Skips repo map generation
- `INSTANCE_MODE=vibe-pro` — Runs tree-sitter repo map on startup and after each agent loop

Image tags: `vibe-coding-lab:vibe` and `vibe-coding-lab:vibe-pro`

### Sandboxing

The AI agent is locked to `/home/workspace/project/` only:
- All file paths resolved and validated — path traversal attempts rejected
- No shell access — only predefined file tools and Vite restart
- No access to Express server code, container system files, environment variables, or AWS credentials
- Bedrock API calls happen server-side on Express, never exposed to the participant

### Credentials

- Inherited from the dashboard's ECS task role via IAM
- Same credential flow as Cline/Continue instances
- Never exposed to the participant or the AI agent

## UI Layout

### Responsive Design (3 modes)

**Large Screen (>1200px) — All-in-one split panes:**
```
┌──────────┬─────────────────┬──────────────┐
│  Chat    │  Live Preview   │  Code Viewer  │
│          │  (iframe)       │  (read-only)  │
│  [input] │  [hover to      │  [typewriter] │
│          │   highlight]    │  [file tree]  │
└──────────┴─────────────────┴──────────────┘
```

**Medium Screen (768-1200px) — Two-panel with toggle:**
```
┌─────────────────────┬──────────────┐
│  Live Preview       │  Collapsible │
│                     │  Sidebar:    │
│                     │  Chat / Code │
└─────────────────────┴──────────────┘
```

**Small Screen (<768px) — Tab navigation:**
```
┌─────────────────────────────────────┐
│  [Preview]  [Chat]  [Code]          │
│─────────────────────────────────────│
│  (active tab content fills screen)  │
└─────────────────────────────────────┘
```

Manual override toggle in top-right corner to switch layouts regardless of screen size.

### Interaction Flow

1. Participant types in chat: "Add a contact form page"
2. AI agent plans the changes, starts editing files
3. Code viewer shows typewriter effect as files are written
4. Vite hot-reloads — live preview updates automatically
5. Participant hovers over an element in the preview — it highlights
6. They click it, chat pre-fills: "Change the [Contact Form submit button]..."
7. They complete the instruction: "...make it rounded and green"
8. AI edits the relevant file, typewriter streams, preview updates

### Element Highlighting

- Small script injected into the live preview iframe
- On hover: draws colored border overlay on the element
- On click: sends element info (tag name, text content, CSS selector path) to parent frame via `postMessage`
- Chat input pre-fills with element description

### Code Viewer

- Read-only (all changes go through the AI via chat/visual interaction)
- Typewriter effect for real-time code changes (character-by-character streaming)
- File tree sidebar for navigation
- Syntax highlighting via Monaco Editor (read-only mode)

## AI Agent Backend

### Tool-Use Loop

```
Participant message
  → Build prompt (system instructions + conversation history + tool definitions)
  → Call Bedrock (Claude via InvokeModelWithResponseStream)
  → Model returns tool calls or text response
  → Execute tool calls (sandboxed)
  → Stream results back to UI via WebSocket
  → Loop until model returns final text response
```

### Agent Tools

| Tool | Description |
|------|-------------|
| `read_file` | Read file contents within project |
| `write_file` | Create or overwrite a file |
| `edit_file` | Replace specific text in a file |
| `list_files` | List directory contents |
| `search_files` | Search file contents (grep-like) |
| `restart_preview` | Restart the Vite dev server |

All tools enforce the `/home/workspace/project/` sandbox.

### Vibe Pro Additions

- On container startup, runs tree-sitter parsing across the project
- Builds repo map: file relationships, exports, imports, function signatures
- Repo map included in the system prompt as context
- Re-generates after each agent loop completes
- Gives AI better awareness without reading every file

### Bedrock Integration

- Model: `anthropic.claude-sonnet-4-20250514-v1:0` (same as Cline)
- Streaming responses for real-time typewriter effect
- Credentials via ECS task role (same as existing instances)

## Technology Stack

### Client (React UI)
- React 18 + TypeScript
- Tailwind CSS
- Monaco Editor (read-only mode) — syntax-highlighted code viewer with typewriter effect
- WebSocket (native) — real-time streaming from agent

### Server (Agent Backend)
- Express + TypeScript
- AWS SDK v3 (`@aws-sdk/client-bedrock-runtime`)
- tree-sitter (`node-tree-sitter`) — AST parsing for Vibe Pro repo map
- chokidar — file watcher for change detection

### Live Preview
- Vite dev server on port 3000
- Embedded via iframe in custom UI
- Element highlighting via injected postMessage script

## Directory Structure

### Refactoring (Rename Existing)

```
cline-setup/    → continue-instance/   (Continue extension)
cline-ai/       → cline-instance/      (Cline extension)
```

All dashboard references updated: ECS manager, CodeBuild buildspec, setup service, GitHub Actions workflows.

### New Directory

```
vibe-instance/
├── Dockerfile
├── entrypoint.sh
├── server/
│   ├── index.ts
│   ├── agent/
│   │   ├── agent-loop.ts
│   │   ├── tools.ts
│   │   └── repo-map.ts
│   └── websocket.ts
└── client/
    ├── src/
    │   ├── components/
    │   │   ├── ChatPanel.tsx
    │   │   ├── CodeViewer.tsx
    │   │   ├── LivePreview.tsx
    │   │   ├── ElementHighlighter.tsx
    │   │   └── LayoutManager.tsx
    │   └── App.tsx
    └── package.json
```

## Dashboard Integration

### Extension Selector (4 options)

```
Extension:  [Continue]  [Cline]  [Vibe]  [Vibe Pro]
```

### Instance Configuration

| Type | Prefix | Image Tag | Directory |
|------|--------|-----------|-----------|
| Continue | `vibe-ct-` | `:continue` | `continue-instance/` |
| Cline | `vibe-cl-` | `:cline` | `cline-instance/` |
| Vibe | `vibe-vb-` | `:vibe` | `vibe-instance/` |
| Vibe Pro | `vibe-vp-` | `:vibe-pro` | `vibe-instance/` |

### Database Schema Update

`ai_extension` field accepts: `'continue' | 'cline' | 'vibe' | 'vibe-pro'`

### Participant Portal

Vibe/Vibe Pro instances link to the custom UI instead of VS Code. Same 5-character access code flow.

### Build & Push

CodeBuild buildspec updated to build 4 images instead of 2.
