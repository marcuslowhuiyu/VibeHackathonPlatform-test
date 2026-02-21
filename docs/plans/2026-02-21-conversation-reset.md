# Conversation Reset Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add a "New Conversation" button that clears chat history and regenerates the repo map for loclaude, loclaude-lite, and vibe instances.

**Architecture:** Client sends `reset_conversation` over existing WebSocket. Server clears `agentLoop.conversationHistory`, regenerates repo map, sends `conversation_reset` back. Client clears local state. All changes go through the shared client and three server-side websocket handlers.

**Tech Stack:** TypeScript, React, WebSocket, lucide-react icons

---

### Task 1: Add `resetConversation` to the shared WebSocket hook

**Files:**
- Modify: `shared/instance-client/src/hooks/useWebSocket.ts`

**Step 1: Add `conversation_reset` handler to the switch statement**

In `useWebSocket.ts`, add a new case inside the `switch (data.type)` block (after the `'error'` case at line 140):

```typescript
          case 'conversation_reset':
            setMessages([]);
            setIsThinking(false);
            setThinkingText('');
            setPrefillMessage('');
            break;
```

**Step 2: Add `resetConversation` callback**

After the `sendPreviewError` callback (line 191), add:

```typescript
  const resetConversation = useCallback(() => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'reset_conversation' }));
    }
  }, []);
```

**Step 3: Update the return type and return value**

Update the return type signature (line 16-26) to include `resetConversation`:

```typescript
export function useWebSocket(): {
  messages: Message[];
  isThinking: boolean;
  thinkingText: string;
  prefillMessage: string;
  currentFileChange: { path: string; content: string } | null;
  sendMessage: (text: string) => void;
  sendElementClick: (info: { tagName: string; textContent: string; selector: string }) => void;
  sendPreviewError: (error: string) => void;
  resetConversation: () => void;
  basePath: string;
} {
```

And add `resetConversation` to the return object (line 193-203):

```typescript
  return {
    messages,
    isThinking,
    thinkingText,
    prefillMessage,
    currentFileChange,
    sendMessage,
    sendElementClick,
    sendPreviewError,
    resetConversation,
    basePath,
  };
```

**Step 4: Commit**

```bash
git add shared/instance-client/src/hooks/useWebSocket.ts
git commit -m "feat(shared-client): add resetConversation to WebSocket hook"
```

---

### Task 2: Add "New Conversation" button to ChatPanel

**Files:**
- Modify: `shared/instance-client/src/components/ChatPanel.tsx`

**Step 1: Update ChatPanelProps interface**

At line 18, add `onResetConversation` to the props:

```typescript
interface ChatPanelProps {
  messages: Message[];
  prefillMessage: string;
  onSendMessage: (msg: string) => void;
  onResetConversation: () => void;
  isThinking: boolean;
  thinkingText: string;
}
```

**Step 2: Add import for RotateCcw icon**

No extra install needed — lucide-react is already a dependency of the shared client. Add the import at the top of the file (after line 3):

```typescript
import { RotateCcw } from 'lucide-react';
```

**Step 3: Destructure the new prop**

Update the component signature at line 176:

```typescript
export default function ChatPanel({ messages, prefillMessage, onSendMessage, onResetConversation, isThinking, thinkingText }: ChatPanelProps) {
```

**Step 4: Add button to the header**

Replace the header `<div>` (lines 211-213) with:

```tsx
      <div className="shrink-0 px-4 py-3 border-b border-gray-800 flex items-center justify-between">
        <h2 className="text-sm font-semibold text-gray-300">Chat</h2>
        <button
          onClick={onResetConversation}
          disabled={isThinking}
          title="New Conversation"
          className="p-1.5 rounded-md text-gray-400 hover:text-gray-200 hover:bg-gray-800 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
        >
          <RotateCcw className="w-4 h-4" />
        </button>
      </div>
```

**Step 5: Commit**

```bash
git add shared/instance-client/src/components/ChatPanel.tsx
git commit -m "feat(shared-client): add New Conversation button to ChatPanel"
```

---

### Task 3: Wire up resetConversation in all App components that use ChatPanel

**Files:**
- Modify: All files that render `<ChatPanel>` and pass props from `useWebSocket()`

Find every file that renders `<ChatPanel` and passes props:

```bash
grep -rn "ChatPanel" shared/instance-client/src/ --include="*.tsx" | grep -v "import"
```

The main `App.tsx` (or equivalent) destructures `useWebSocket()` and passes props to `ChatPanel`. Add `resetConversation` to the destructuring and pass `onResetConversation={resetConversation}` to `<ChatPanel>`.

**Step 1: Find and update the parent component**

Look for the file that calls `useWebSocket()` and renders `<ChatPanel>`:

```bash
grep -rn "useWebSocket" shared/instance-client/src/ --include="*.tsx"
```

In that file, update the destructuring:

```typescript
const { messages, isThinking, thinkingText, prefillMessage, currentFileChange, sendMessage, sendElementClick, sendPreviewError, resetConversation, basePath } = useWebSocket();
```

And update the `<ChatPanel>` JSX to pass the new prop:

```tsx
<ChatPanel
  messages={messages}
  prefillMessage={prefillMessage}
  onSendMessage={sendMessage}
  onResetConversation={resetConversation}
  isThinking={isThinking}
  thinkingText={thinkingText}
/>
```

**Step 2: Commit**

```bash
git add shared/instance-client/src/
git commit -m "feat(shared-client): wire resetConversation to ChatPanel in App"
```

---

### Task 4: Add `clearHistory` method to AgentLoop (all 3 instances)

The server-side `AgentLoop` class stores `conversationHistory` as a private field. We need a public method to clear it.

**Files:**
- Modify: `loclaude-instance/server/agent/agent-loop.ts`
- Modify: `loclaude-lite-instance/server/agent/agent-loop.ts`
- Modify: `vibe-instance/server/agent/agent-loop.ts`

**Step 1: Add `clearHistory()` method to loclaude AgentLoop**

In `loclaude-instance/server/agent/agent-loop.ts`, add this method right after `updateRepoMap()` (after line 123):

```typescript
  /** Clear all conversation history to start a fresh conversation. */
  clearHistory(): void {
    this.conversationHistory = [];
  }
```

**Step 2: Add `clearHistory()` and `updateRepoMap()` to vibe AgentLoop**

In `vibe-instance/server/agent/agent-loop.ts`, vibe is missing `updateRepoMap`. Add both methods after the constructor:

```typescript
  /** Update the repo map used in the system prompt. */
  updateRepoMap(newMap: string): void {
    this.repoMap = newMap;
  }

  /** Clear all conversation history to start a fresh conversation. */
  clearHistory(): void {
    this.conversationHistory = [];
  }
```

**Step 3: Add `clearHistory()` method to loclaude-lite AgentLoop**

In `loclaude-lite-instance/server/agent/agent-loop.ts`, add after `updateRepoMap()` (after line 120):

```typescript
  /** Clear all conversation history to start a fresh conversation. */
  clearHistory(): void {
    this.conversationHistory = [];
  }
```

**Step 4: Commit**

```bash
git add loclaude-instance/server/agent/agent-loop.ts loclaude-lite-instance/server/agent/agent-loop.ts vibe-instance/server/agent/agent-loop.ts
git commit -m "feat(instances): add clearHistory method to AgentLoop"
```

---

### Task 5: Handle `reset_conversation` in all 3 websocket.ts files

**Files:**
- Modify: `loclaude-instance/server/websocket.ts`
- Modify: `loclaude-lite-instance/server/websocket.ts`
- Modify: `vibe-instance/server/websocket.ts`

All three files are nearly identical. The change is the same for each.

**Step 1: Add `generateRepoMap` import**

In each `websocket.ts`, add the import for `generateRepoMap` at the top:

```typescript
import { generateRepoMap } from './agent/repo-map.js';
```

**Step 2: Add the `reset_conversation` handler**

In each file's `ws.on('message', ...)` handler, add a new block after the `preview_error` handler (before the closing `});` of the message handler):

```typescript
      // ---- reset_conversation --------------------------------------------
      if (parsed.type === 'reset_conversation') {
        agentLoop.clearHistory();
        autoFixAttempts = 0;
        lastErrorTime = 0;

        try {
          const newMap = await generateRepoMap('/home/workspace/project');
          agentLoop.updateRepoMap(newMap);
          console.log('Conversation reset: history cleared, repo map regenerated');
        } catch (err) {
          console.warn('Conversation reset: history cleared, repo map failed:', err);
        }

        send(ws, { type: 'conversation_reset' });
        return;
      }
```

**Step 3: Commit**

```bash
git add loclaude-instance/server/websocket.ts loclaude-lite-instance/server/websocket.ts vibe-instance/server/websocket.ts
git commit -m "feat(instances): handle reset_conversation in WebSocket handlers"
```

---

### Task 6: Rebuild shared client and test

**Step 1: Rebuild the shared client**

```bash
cd shared/instance-client && npm run build
```

Expected: Vite builds successfully with no errors.

**Step 2: Verify the button appears**

Open any instance locally (or deploy). The chat header should show:
- "Chat" text on the left
- A rotate icon button on the right
- Button is disabled while the agent is thinking
- Clicking it clears chat and triggers repo map regeneration

**Step 3: Commit build output if needed and push**

```bash
git add -A
git commit -m "feat: conversation reset - rebuild shared client"
git push origin feature/64-continue-dev-instance
```
