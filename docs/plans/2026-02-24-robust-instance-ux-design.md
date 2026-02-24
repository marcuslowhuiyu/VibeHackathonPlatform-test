# Robust Instance UX Design

**Goal:** Make all vibe instance types bullet-proof: default 2-panel layout with togglable code panel, comprehensive auto-error-handling, proactive token management, and consistent behavior across all 4 instances.

**Scope:** loclaude, loclaude-lite, vibe, continue-dev instances. Backend process management is Phase 2.

---

## 1. Default 2-Panel Layout

**Default:** Chat (30%) | Preview (70%) on screens > 768px.

**Code toggle:** A `</>` button in the top-right header. Clicking expands to 3-col: Chat (25%) | Preview (50%) | Code (25%). Clicking again collapses back to 2 panels. State persists in localStorage.

**Mobile (<768px):** Tabs mode (Chat, Preview, Code) — unchanged.

**Remove** the current mode dropdown selector — the toggle button replaces it.

**Draggable dividers** work in both 2-col and 3-col modes.

### Files
- `shared/instance-client/src/components/LayoutManager.tsx` — new default, toggle logic
- `shared/instance-client/src/App.tsx` — remove dropdown, add toggle button

---

## 2. Comprehensive Error Auto-Handling

### Error Matrix

| Error Type | Detection | Auto-Handle | User Feedback |
|---|---|---|---|
| Preview runtime errors | error-capture.js (exists) | AI auto-fix, 3 attempts, 5s cooldown | Toast: "Auto-fixing preview error..." |
| Token/rate limit | Bedrock "too many tokens" / "throttl" | Truncate + sanitize + backoff retry (exists) | Toast: "Context too long, compacting..." |
| Bedrock API errors (other) | Non-token 5xx / timeout / network | Retry 3x, exponential backoff (2s, 4s, 8s) | Toast: "Retrying..." then error if all fail |
| WebSocket disconnect | ws.onclose | Auto-reconnect (exists, 2s timer) | Banner: "Reconnecting..." at top of chat |
| Vite crash | Server health check pings :3000 | Auto-restart Vite, up to 3x | Toast: "Preview server restarting..." |
| Malformed history | "Expected toolResult" errors | sanitizeHistory() (exists) | Silent |

### Toast System
- Non-blocking notifications at bottom-right of chat panel
- Auto-dismiss after 5 seconds
- Types: info (blue), warning (yellow), error (red), success (green)
- Replaces raw error strings in chat message list

### Vite Health Check (server-side)
- Every 30s, Express pings localhost:3000
- 3 consecutive failures → restart Vite child process
- Emit `agent:preview_status` event to client

### Bedrock API Retry (in AgentLoop)
- Wrap `client.send()` for non-token transient errors
- 3 attempts, exponential backoff (2s, 4s, 8s)
- Only retry 5xx / timeout / network — not validation errors

### Files
- `shared/instance-client/src/components/ChatPanel.tsx` — toast component, reconnecting banner
- `shared/instance-client/src/hooks/useWebSocket.ts` — reconnect status, toast events
- `*/server/agent/agent-loop.ts` (3 files) — Bedrock retry wrapper
- `*/server/index.ts` (4 files) — Vite health check loop
- `*/server/websocket.ts` (4 files) — emit toast-style messages

---

## 3. Proactive Token Management

### Layer 1: Pre-flight Check (NEW)
- Before each `client.send()`, call `estimateTokens()`
- If > 120K tokens (~80% of model limit), proactively run `compactHistory()` before the API call
- Prevents errors instead of reacting

### Layer 2: Smarter Compaction Split
- Currently splits at 60% oldest — can break mid-tool-exchange
- New: Walk forward from 60% mark until a clean boundary (user text message, not toolResult)

### Layer 3: Hard Reset Fallback (NEW)
- Track `tokenErrorCount` — consecutive token errors
- If 3 consecutive errors despite truncation + retry → auto-reset conversation
- Emit summary to user: "Conversation too long. Fresh context started. You were working on: [last user message]"
- Reset counter on any successful API call

### Files
- `*/server/agent/agent-loop.ts` (3 files) — pre-flight check, smart split, hard reset

---

## 4. Instance Matrix

| Feature | loclaude | loclaude-lite | vibe | continue-dev |
|---|---|---|---|---|
| 2-panel layout + code toggle | Yes (shared) | Yes (shared) | Yes (shared) | Yes (shared) |
| Toast system | Yes (shared) | Yes (shared) | Yes (shared) | Yes (shared) |
| Reconnecting banner | Yes (shared) | Yes (shared) | Yes (shared) | Yes (shared) |
| Bedrock API retry | Yes | Yes | Yes | No (CLI handles own) |
| Pre-flight token check | Yes | Yes | Yes | No |
| Smart compaction split | Yes | Yes | Yes | No |
| Hard reset fallback | Yes | Yes | Yes | Yes (resets sessionId) |
| Vite health check | Yes | Yes | Yes | Yes |

---

## Out of Scope (Phase 2)
- Backend process management with tabbed interface
- Port registry and dynamic proxy
- Multi-process lifecycle management
