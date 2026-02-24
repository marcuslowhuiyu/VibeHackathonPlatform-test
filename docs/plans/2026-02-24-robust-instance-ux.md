# Robust Instance UX Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Make all instance types bullet-proof: default 2-panel layout with togglable code panel, toast-based error handling, proactive token management, and Vite auto-restart.

**Architecture:** Shared client gets layout + toast changes (built once, used by all 4 instances). Server-side changes to AgentLoop (3 instances) for token management and Bedrock retry. Vite health check added to all 4 index.ts files. WebSocket handler updated to emit toast events.

**Tech Stack:** React + Tailwind (client), TypeScript + Express + AWS Bedrock SDK (server), lucide-react icons

---

### Task 1: Default 2-Panel Layout

**Files:**
- Modify: `shared/instance-client/src/components/LayoutManager.tsx`

**Step 1: Rewrite LayoutManager for 2-panel default with code toggle**

Replace the entire `LayoutManager.tsx` with:

```tsx
import { useState, useEffect, useCallback, useRef, ReactNode } from 'react';
import { Code2 } from 'lucide-react';

interface LayoutManagerProps {
  chatPanel: ReactNode;
  previewPanel: ReactNode;
  codePanel: ReactNode;
}

function DragHandle({ onDrag }: { onDrag: (deltaX: number) => void }) {
  const handleRef = useRef<HTMLDivElement>(null);
  const startX = useRef(0);
  const hasMoved = useRef(false);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    startX.current = e.clientX;
    hasMoved.current = false;
    handleRef.current?.setPointerCapture(e.pointerId);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!handleRef.current?.hasPointerCapture(e.pointerId)) return;
    const delta = e.clientX - startX.current;
    if (!hasMoved.current && Math.abs(delta) < 2) return;
    hasMoved.current = true;
    startX.current = e.clientX;
    onDrag(delta);
  }, [onDrag]);

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    handleRef.current?.releasePointerCapture(e.pointerId);
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  }, []);

  return (
    <div
      ref={handleRef}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      className="w-1.5 shrink-0 cursor-col-resize bg-gray-800 hover:bg-blue-500 transition-colors relative group touch-none"
      title="Drag to resize"
    >
      <div className="absolute inset-y-0 -left-1.5 -right-1.5" />
    </div>
  );
}

export default function LayoutManager({ chatPanel, previewPanel, codePanel }: LayoutManagerProps) {
  const [windowWidth, setWindowWidth] = useState(window.innerWidth);
  const [codeOpen, setCodeOpen] = useState(() => {
    try { return localStorage.getItem('codePanel') === 'open'; } catch { return false; }
  });
  const [activeTab, setActiveTab] = useState<'chat' | 'preview' | 'code'>('chat');

  // 2-col widths [chat, preview] as percentages
  const [twoColWidths, setTwoColWidths] = useState<[number, number]>([30, 70]);
  // 3-col widths [chat, preview, code] as percentages
  const [threeColWidths, setThreeColWidths] = useState<[number, number, number]>([25, 50, 25]);

  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleResize = () => setWindowWidth(window.innerWidth);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Persist code panel state
  useEffect(() => {
    try { localStorage.setItem('codePanel', codeOpen ? 'open' : 'closed'); } catch {}
  }, [codeOpen]);

  const isMobile = windowWidth < 768;

  // --- Drag handlers ---
  const handleDrag2Col = useCallback((deltaX: number) => {
    if (!containerRef.current) return;
    const pct = (deltaX / containerRef.current.offsetWidth) * 100;
    setTwoColWidths(prev => [
      Math.max(15, Math.min(50, prev[0] + pct)),
      Math.max(30, Math.min(85, prev[1] - pct)),
    ]);
  }, []);

  const handleDrag3Left = useCallback((deltaX: number) => {
    if (!containerRef.current) return;
    const pct = (deltaX / containerRef.current.offsetWidth) * 100;
    setThreeColWidths(prev => [
      Math.max(10, Math.min(40, prev[0] + pct)),
      Math.max(20, Math.min(70, prev[1] - pct)),
      prev[2],
    ]);
  }, []);

  const handleDrag3Right = useCallback((deltaX: number) => {
    if (!containerRef.current) return;
    const pct = (deltaX / containerRef.current.offsetWidth) * 100;
    setThreeColWidths(prev => [
      prev[0],
      Math.max(20, Math.min(70, prev[1] + pct)),
      Math.max(10, Math.min(40, prev[2] - pct)),
    ]);
  }, []);

  // Code toggle button — shared across desktop modes
  const codeToggle = !isMobile && (
    <button
      onClick={() => setCodeOpen(prev => !prev)}
      className={`fixed top-2 right-2 z-50 p-2 rounded-md border transition-colors ${
        codeOpen
          ? 'bg-blue-600 border-blue-500 text-white'
          : 'bg-gray-800 border-gray-700 text-gray-400 hover:text-gray-200 hover:bg-gray-700'
      }`}
      title={codeOpen ? 'Hide code panel' : 'Show code panel'}
    >
      <Code2 className="w-4 h-4" />
    </button>
  );

  // --- Mobile: tabs ---
  if (isMobile) {
    const tabs = [
      { key: 'chat' as const, label: 'Chat' },
      { key: 'preview' as const, label: 'Preview' },
      { key: 'code' as const, label: 'Code' },
    ];
    return (
      <div className="h-screen w-screen bg-gray-900 text-white flex flex-col">
        <div className="flex border-b border-gray-800 shrink-0">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex-1 px-4 py-2.5 text-sm font-medium transition-colors ${
                activeTab === tab.key
                  ? 'text-blue-400 border-b-2 border-blue-400 bg-gray-800/50'
                  : 'text-gray-400 hover:text-gray-300'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <div className="flex-1 overflow-hidden">
          {activeTab === 'chat' && chatPanel}
          {activeTab === 'preview' && previewPanel}
          {activeTab === 'code' && codePanel}
        </div>
      </div>
    );
  }

  // --- Desktop: 3-col (code open) ---
  if (codeOpen) {
    return (
      <div ref={containerRef} className="h-screen w-screen bg-gray-900 text-white">
        {codeToggle}
        <div className="h-full flex">
          <div className="h-full overflow-hidden" style={{ width: `${threeColWidths[0]}%` }}>{chatPanel}</div>
          <DragHandle onDrag={handleDrag3Left} />
          <div className="h-full overflow-hidden" style={{ width: `${threeColWidths[1]}%` }}>{previewPanel}</div>
          <DragHandle onDrag={handleDrag3Right} />
          <div className="h-full overflow-hidden" style={{ width: `${threeColWidths[2]}%` }}>{codePanel}</div>
        </div>
      </div>
    );
  }

  // --- Desktop: 2-col (default) ---
  return (
    <div ref={containerRef} className="h-screen w-screen bg-gray-900 text-white">
      {codeToggle}
      <div className="h-full flex">
        <div className="h-full overflow-hidden" style={{ width: `${twoColWidths[0]}%` }}>{chatPanel}</div>
        <DragHandle onDrag={handleDrag2Col} />
        <div className="h-full overflow-hidden" style={{ width: `${twoColWidths[1]}%` }}>{previewPanel}</div>
      </div>
    </div>
  );
}
```

**Step 2: Verify build**

Run: `cd shared/instance-client && npm run build`
Expected: Build succeeds (lucide-react already installed)

**Step 3: Commit**

```bash
git add shared/instance-client/src/components/LayoutManager.tsx
git commit -m "feat(shared-client): default 2-panel layout with code toggle"
```

---

### Task 2: Toast Notification System

**Files:**
- Modify: `shared/instance-client/src/hooks/useWebSocket.ts`
- Modify: `shared/instance-client/src/components/ChatPanel.tsx`

**Step 1: Add toast state to useWebSocket.ts**

Add a new state and handler. In the state declarations (after `currentFileChange` state):

```typescript
const [toasts, setToasts] = useState<Array<{ id: number; type: 'info' | 'warning' | 'error' | 'success'; message: string }>>([]);
const toastIdRef = useRef(0);
```

Add a helper function inside the hook:

```typescript
const addToast = useCallback((type: 'info' | 'warning' | 'error' | 'success', message: string) => {
  const id = ++toastIdRef.current;
  setToasts(prev => [...prev, { id, type, message }]);
  setTimeout(() => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, 5000);
}, []);
```

Add `toast` case in the switch statement:

```typescript
case 'toast':
  if (data.toast_type && data.message) {
    addToast(data.toast_type, data.message);
  }
  break;
```

Add `isConnected` state:

```typescript
const [isConnected, setIsConnected] = useState(false);
```

Set it in `ws.onopen`:
```typescript
ws.onopen = () => { setIsConnected(true); };
```

Set it in `ws.onclose`:
```typescript
ws.onclose = () => {
  wsRef.current = null;
  setIsConnected(false);
  reconnectTimerRef.current = setTimeout(() => { connect(); }, 2000);
};
```

Add `toasts`, `isConnected`, and `dismissToast` to the return object:

```typescript
const dismissToast = useCallback((id: number) => {
  setToasts(prev => prev.filter(t => t.id !== id));
}, []);
```

**Step 2: Add Toast component and reconnect banner to ChatPanel**

Add `isConnected`, `toasts`, `dismissToast` to ChatPanelProps:

```typescript
interface ChatPanelProps {
  messages: Message[];
  prefillMessage: string;
  onSendMessage: (msg: string) => void;
  onResetConversation: () => void;
  onCancelResponse: () => void;
  isThinking: boolean;
  thinkingText: string;
  isConnected: boolean;
  toasts: Array<{ id: number; type: 'info' | 'warning' | 'error' | 'success'; message: string }>;
  dismissToast: (id: number) => void;
}
```

Add a Toast container after the message list, before the input area:

```tsx
{/* Reconnecting banner */}
{!isConnected && (
  <div className="shrink-0 px-4 py-2 bg-yellow-900/50 border-b border-yellow-700 text-yellow-300 text-xs text-center">
    Reconnecting...
  </div>
)}

{/* Toasts */}
{toasts.length > 0 && (
  <div className="absolute bottom-20 right-3 z-40 flex flex-col gap-2 max-w-xs">
    {toasts.map((toast) => (
      <div
        key={toast.id}
        onClick={() => dismissToast(toast.id)}
        className={`px-3 py-2 rounded-lg text-xs cursor-pointer shadow-lg border ${
          toast.type === 'info' ? 'bg-blue-900/80 border-blue-700 text-blue-200' :
          toast.type === 'warning' ? 'bg-yellow-900/80 border-yellow-700 text-yellow-200' :
          toast.type === 'error' ? 'bg-red-900/80 border-red-700 text-red-200' :
          'bg-green-900/80 border-green-700 text-green-200'
        }`}
      >
        {toast.message}
      </div>
    ))}
  </div>
)}
```

Make the ChatPanel wrapper `relative` so toasts position correctly:
```tsx
<div className="h-full flex flex-col bg-gray-900 relative">
```

**Step 3: Wire props in App.tsx**

Update App.tsx to pass the new props from useWebSocket to ChatPanel:

```tsx
const { messages, isThinking, thinkingText, prefillMessage, currentFileChange, sendMessage, sendElementClick, sendPreviewError, basePath, resetConversation, cancelResponse, isConnected, toasts, dismissToast } =
  useWebSocket();
```

And in the ChatPanel JSX:
```tsx
<ChatPanel
  messages={messages}
  prefillMessage={prefillMessage}
  onSendMessage={sendMessage}
  isThinking={isThinking}
  thinkingText={thinkingText}
  onResetConversation={resetConversation}
  onCancelResponse={cancelResponse}
  isConnected={isConnected}
  toasts={toasts}
  dismissToast={dismissToast}
/>
```

**Step 4: Build and verify**

Run: `cd shared/instance-client && npm run build`
Expected: Build succeeds

**Step 5: Commit**

```bash
git add shared/instance-client/src/hooks/useWebSocket.ts shared/instance-client/src/components/ChatPanel.tsx shared/instance-client/src/App.tsx
git commit -m "feat(shared-client): add toast notifications and reconnect banner"
```

---

### Task 3: Emit Toast Events from WebSocket Handlers

**Files:**
- Modify: `loclaude-instance/server/websocket.ts`
- Modify: `loclaude-lite-instance/server/websocket.ts`
- Modify: `vibe-instance/server/websocket.ts`
- Modify: `continue-dev-instance/server/websocket.ts`

**Step 1: Replace raw error sends with toast events**

In all 4 `websocket.ts` files, add a helper inside `setupWebSocket`:

```typescript
function sendToast(ws: WebSocket, type: 'info' | 'warning' | 'error' | 'success', message: string): void {
  send(ws, { type: 'toast', toast_type: type, message });
}
```

Then for auto-fix preview errors, before `bridge.processMessage` / `agentLoop.processMessage`, replace the raw `agent:text` send with:

```typescript
sendToast(ws, 'info', `Auto-fixing preview error...`);
```

For the `isProcessing` guard error, use toast:
```typescript
sendToast(ws, 'warning', 'Still processing previous message');
return;
```

For conversation reset success:
```typescript
sendToast(ws, 'success', 'Conversation reset');
```

**Step 2: Commit**

```bash
git add loclaude-instance/server/websocket.ts loclaude-lite-instance/server/websocket.ts vibe-instance/server/websocket.ts continue-dev-instance/server/websocket.ts
git commit -m "feat(instances): emit toast events from WebSocket handlers"
```

---

### Task 4: Bedrock API Retry for Transient Errors

**Files:**
- Modify: `loclaude-instance/server/agent/agent-loop.ts`
- Modify: `loclaude-lite-instance/server/agent/agent-loop.ts`
- Modify: `vibe-instance/server/agent/agent-loop.ts`

**Step 1: Add retry wrapper around `client.send()` in runLoop**

In the `runLoop()` method, replace the single `client.send()` try/catch with a retry loop. In the catch block, after the existing token error handling:

```typescript
// Transient API errors — retry with exponential backoff
const isTransient = errLower.includes('throttl') || errLower.includes('timeout') ||
  errLower.includes('service unavailable') || errLower.includes('internal server error') ||
  errLower.includes('too many requests') || errLower.includes('rate exceeded');
if (isTransient && !this.retryCount) {
  this.retryCount = 0;
}
if (isTransient && this.retryCount < 3) {
  this.retryCount++;
  const delaySec = 2 ** this.retryCount;
  console.warn(`Transient API error, retry ${this.retryCount}/3 in ${delaySec}s...`);
  await new Promise((r) => setTimeout(r, delaySec * 1000));
  continue;
}
this.retryCount = 0;
throw err;
```

Actually, simpler approach — add a private field `private retryCount = 0;` and reset it on successful API response. The retry logic goes in the existing catch block after the token error handling.

**Step 2: Reset retryCount on success**

After the successful `response = await this.client.send(command, ...)`:
```typescript
this.retryCount = 0;
```

**Step 3: Commit**

```bash
git add loclaude-instance/server/agent/agent-loop.ts loclaude-lite-instance/server/agent/agent-loop.ts vibe-instance/server/agent/agent-loop.ts
git commit -m "feat(instances): add exponential backoff retry for transient Bedrock errors"
```

---

### Task 5: Proactive Token Management

**Files:**
- Modify: `loclaude-instance/server/agent/agent-loop.ts`
- Modify: `loclaude-lite-instance/server/agent/agent-loop.ts`
- Modify: `vibe-instance/server/agent/agent-loop.ts`

**Step 1: Add pre-flight token check in runLoop**

At the top of the `for` loop in `runLoop()`, before `compactHistory()`:

```typescript
// Pre-flight: proactively compact if approaching model limit
const preFlightTokens = this.estimateTokens();
if (preFlightTokens > 120_000) {
  console.log(`Pre-flight token check: ~${preFlightTokens} tokens, proactively compacting...`);
  await this.compactHistory();
}
```

Replace the existing `await this.compactHistory()` call (which checks threshold internally) — the pre-flight check is now the entry point, and `compactHistory()` still has its internal `TOKEN_THRESHOLD` guard as a safety net.

**Step 2: Smart compaction split — find clean boundary**

In `compactHistory()`, replace the split logic:

```typescript
// Find a clean split boundary — a user text message (not toolResult)
let splitIndex = Math.max(2, Math.floor(this.conversationHistory.length * 0.6));
// Walk forward to find a user message that's a plain text message (not toolResult)
while (splitIndex < this.conversationHistory.length - 2) {
  const msg = this.conversationHistory[splitIndex];
  if (msg.role === 'user') {
    const blocks = (msg.content ?? []) as ContentBlock[];
    const isPlainText = blocks.some((b) => b.text !== undefined) && !blocks.some((b) => b.toolResult !== undefined);
    if (isPlainText) break;
  }
  splitIndex++;
}
```

**Step 3: Add hard reset fallback with tokenErrorCount**

Add a private field:
```typescript
private tokenErrorCount = 0;
```

In the token error catch block, increment and check:
```typescript
this.tokenErrorCount++;
if (this.tokenErrorCount >= 3) {
  console.warn('3 consecutive token errors — hard-resetting conversation');
  const lastUserMsg = this.conversationHistory.filter(m => m.role === 'user').pop();
  const lastText = lastUserMsg?.content
    ? (lastUserMsg.content as ContentBlock[]).find(b => b.text)?.text ?? ''
    : '';
  this.conversationHistory = [
    { role: 'user', content: [{ text: `[Previous conversation was too long and has been reset. You were working on: ${lastText.slice(0, 500)}]` }] },
    { role: 'assistant', content: [{ text: 'Understood. The conversation was getting too long, so I have a fresh context now. Let me continue where we left off.' }] },
  ];
  this.tokenErrorCount = 0;
  continue;
}
```

Reset counter on successful API response:
```typescript
this.tokenErrorCount = 0;
```

**Step 4: Commit**

```bash
git add loclaude-instance/server/agent/agent-loop.ts loclaude-lite-instance/server/agent/agent-loop.ts vibe-instance/server/agent/agent-loop.ts
git commit -m "feat(instances): proactive token management with pre-flight check and hard reset"
```

---

### Task 6: Vite Health Check and Auto-Restart

**Files:**
- Modify: `vibe-instance/server/index.ts`
- Modify: `loclaude-instance/server/index.ts`
- Modify: `loclaude-lite-instance/server/index.ts`
- Modify: `continue-dev-instance/server/index.ts`

**Step 1: Add Vite health check function**

In all 4 `index.ts` files, after the Vite process spawn, add:

```typescript
// Vite health check — auto-restart if crashed
let viteFailCount = 0;
const VITE_MAX_FAILURES = 3;
let viteRestartCount = 0;
const VITE_MAX_RESTARTS = 3;

function startVite(): typeof viteProcess {
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

let viteProcess = startVite();

setInterval(async () => {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 3000);
    const res = await fetch('http://localhost:3000/', { signal: controller.signal });
    clearTimeout(timeout);
    if (res.ok || res.status === 404) {
      viteFailCount = 0; // Vite is responding
    } else {
      viteFailCount++;
    }
  } catch {
    viteFailCount++;
  }

  if (viteFailCount >= VITE_MAX_FAILURES && viteRestartCount < VITE_MAX_RESTARTS) {
    console.warn(`Vite health check failed ${viteFailCount} times, restarting...`);
    try { viteProcess.kill(); } catch {}
    viteProcess = startVite();
    viteFailCount = 0;
    viteRestartCount++;
  }
}, 30_000);
```

This replaces the existing `const viteProcess = spawn(...)` block. The existing `viteProcess.kill()` in the SIGTERM handler stays the same.

**Step 2: Commit**

```bash
git add vibe-instance/server/index.ts loclaude-instance/server/index.ts loclaude-lite-instance/server/index.ts continue-dev-instance/server/index.ts
git commit -m "feat(instances): add Vite health check with auto-restart"
```

---

### Task 7: Rebuild Shared Client

**Files:**
- Build: `shared/instance-client/`

**Step 1: Rebuild**

Run: `cd shared/instance-client && npm run build`
Expected: Build succeeds with no errors

**Step 2: Commit built output if tracked**

```bash
git add shared/instance-client/
git commit -m "chore: rebuild shared instance client"
```

---

### Task 8: Final Review and Push

**Step 1: Run git status and verify all changes**

Run: `git status`
Expected: Clean working directory, all changes committed

**Step 2: Push to remote**

```bash
git push
```

**Step 3: Create PR to dev and merge**

```bash
gh pr create --base dev --head feature/64-continue-dev-instance --title "feat: robust instance UX - 2-panel layout, toasts, token management, vite health" --body "..."
gh pr merge --merge --admin
```
