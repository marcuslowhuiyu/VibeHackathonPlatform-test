# Loclaude Instances Design

## Context

The Vibe Hackathon Platform provisions cloud-based coding environments for hackathon participants. It currently supports 4 instance types: Continue, Cline, Vibe, and Vibe Pro. We are consolidating Vibe/Vibe Pro and adding two new Claude Code-inspired instance types.

## Changes

### 1. Rename Vibe Pro to Vibe, delete old Vibe mode

The current `vibe-instance/` supports two modes via `INSTANCE_MODE`: `vibe` (basic, no repo map) and `vibe-pro` (repo map injected into system prompt). The basic `vibe` mode is removed. Only the `vibe-pro` behavior remains, renamed to just `vibe`.

Changes:
- Remove `vibe` vs `vibe-pro` branching in `buildSystemPrompt()` — always use the enhanced prompt with repo map
- Always generate repo map on startup (no conditional on `INSTANCE_MODE`)
- Remove `INSTANCE_MODE` env var from vibe-instance (only one mode now)
- Dashboard: remove old "Vibe" option, rename "Vibe Pro" to "Vibe"
- Instance ID prefix stays `vibe-vb-`

### 2. Loclaude-lite (Approach A — Enhanced Agent Loop)

**Directory:** `loclaude-lite-instance/`

**Architecture:** Same as Vibe (Express + WebSocket + React chat UI) with an upgraded agent backend.

**Tools (10 total):**

| Tool | Description |
|------|-------------|
| `read_file` | Read file with line numbers |
| `write_file` | Create/overwrite files |
| `edit_file` | Find-and-replace (exact unique match) |
| `list_files` | Directory listing (max 2 levels) |
| `search_files` | Regex grep across project (kept for compatibility) |
| `restart_preview` | Kill/restart Vite dev server |
| `bash_command` | Execute shell commands with timeout + output capture |
| `glob` | Fast file pattern matching |
| `grep` | Regex content search with context lines |
| `git_status` | Git status/diff/log helper |

**Upgrades over Vibe:**
- AST-aware repo map using `ts-morph` instead of regex
- Repo map auto-refresh via `chokidar` file watcher
- Shell output streaming through WebSocket (real-time command output)
- Sandboxed shell with deny-list for dangerous operations

**System prompt:** Enhanced — mentions shell capabilities, encourages installing packages, running tests, using git.

**Instance ID prefix:** `vibe-ll-`

### 3. Loclaude (Approach C — Claude Code-style Tools)

**Directory:** `loclaude-instance/`

**Architecture:** Same Express + WebSocket + React UI, agent backend rebuilt to mirror Claude Code's tool design.

**Tools — matching Claude Code's spec:**

| Tool | Description |
|------|-------------|
| `Bash` | Full shell execution, working directory persists between calls via long-lived shell process |
| `Read` | Read files with optional offset/limit for large files |
| `Write` | Create/overwrite files (requires prior Read) |
| `Edit` | Exact string replacement (unique match required) |
| `Glob` | File pattern matching, sorted by modification time |
| `Grep` | Ripgrep-style search with context, multiple output modes (content/files/count) |
| `Task` | Spawn parallel sub-agent loops with own conversation + tools |
| `ListDir` | Directory listing |

**Key Claude Code behaviors:**
- Extended thinking via Bedrock's `thinking` parameter with thinking budget
- Sub-agents: `Task` tool spawns child `AgentLoop` instances that run in parallel
- Persistent shell state: working directory persists between `Bash` calls
- Multi-tool per turn: agent can call multiple tools per turn
- Repo map v2: same AST-aware map as Loclaude-lite, auto-refreshed
- Safety: read-before-write enforcement, path sandboxing, dangerous command confirmation via WebSocket

**System prompt:** Modeled after Claude Code — capable, autonomous, concise. Aware of all tools, shell, git, sub-agents.

**Instance ID prefix:** `vibe-lc-`

### 4. Dashboard & Infrastructure

**Dashboard:**
- Add `loclaude-lite` and `loclaude` to `validExtensions` and `extPrefixes` in `instances.ts`
- Add to `AIExtension` type and `AI_EXTENSIONS` config in `SpinUpForm.tsx`
- Add entries in `ExtensionSelector.tsx` with tier descriptions
- Update `InstanceList.tsx` with color-coded badges
- Update participant portal to label Loclaude instances as "Loclaude Studio"
- Remove old "Vibe" option, rename "Vibe Pro" to "Vibe"

**Docker/ECR:**
- New Dockerfiles for both instances, based on `node:20-slim`
- Additional packages: `git`, `ripgrep`, `chokidar`, `ts-morph`
- New ECR image tags: `loclaude-lite`, `loclaude`
- Update CodeBuild buildspec

**ECS manager:**
- Add to `imageTagMap`: `loclaude-lite` and `loclaude`
- Environment variables: `INSTANCE_MODE=loclaude-lite` or `INSTANCE_MODE=loclaude`

**Shared UI:**
- Both Loclaude variants reuse the same React client as Vibe
- Terminal-style rendering for bash/shell tool results in chat

## Final Instance Matrix

| Instance | ID Prefix | UI | Agent | Model | Key Differentiator |
|----------|-----------|-----|-------|-------|--------------------|
| Continue | `vibe-ct-` | VS Code | Continue extension | Claude 3.5 Sonnet | Full IDE + extension |
| Cline | `vibe-cl-` | VS Code | Cline extension | Claude Sonnet 4 | Autonomous VS Code agent |
| Vibe | `vibe-vb-` | Chat+Preview+Code | Basic agent + repo map | Claude Sonnet 4 | Beginner-friendly chat |
| Loclaude-lite | `vibe-ll-` | Chat+Preview+Code | Enhanced agent + shell + AST | Claude Sonnet 4 | Shell access, better code understanding |
| Loclaude | `vibe-lc-` | Chat+Preview+Code | Claude Code-style agent | Claude Sonnet 4 | Sub-agents, extended thinking, persistent shell |

## Out of Scope

- No changes to Continue or Cline instances
- No new models (all use Claude Sonnet 4 via Bedrock)
- No changes to ALB/CloudFront/networking (same port 8080)
- No authentication changes
