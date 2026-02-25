# Chat Enhancements Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Add chat history persistence, response cancellation, and token limit handling to loclaude, loclaude-lite, and vibe instances.

**Architecture:** Cancel uses AbortController on the Bedrock ConverseStream, breaking the `for await` loop cleanly. Chat history saves display messages to a JSON file on the container filesystem, replayed on WebSocket connect. Token limits use character-based estimation (~4 chars/token) with smart summarization via a separate Bedrock Converse call, falling back to simple truncation.

**Tech Stack:** TypeScript, React, AWS Bedrock SDK (ConverseStreamCommand, ConverseCommand), WebSocket, Node.js fs, lucide-react

---

### Task 1: Add cancel support to the shared WebSocket hook

**Files:**
- Modify: `shared/instance-client/src/hooks/useWebSocket.ts`

**Step 1: Add `cancelResponse` callback**

After the `resetConversation` callback (line 202-206), add:

```typescript
  const cancelResponse = useCallback(() => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'cancel_response' }));
    }
  }, []);
```

**Step 2: Update the `agent:done` handler to support `cancelled` flag**

Replace the `agent:done` case (lines 125-128) with:

```typescript
          case 'agent:done':
            setIsThinking(false);
            setThinkingText('');
            break;
```

(No change needed — the partial text already stays in messages. The `cancelled` flag is informational only.)

**Step 3: Update the return type and return value**

Add `cancelResponse: () => void;` to the return type (after line 25):

```typescript
  cancelResponse: () => void;
```

And add `cancelResponse` to the return object (after line 217):

```typescript
    cancelResponse,
```

**Step 4: Commit**

```bash
git add shared/instance-client/src/hooks/useWebSocket.ts
git commit -m "feat(shared-client): add cancelResponse to WebSocket hook"
```

---

### Task 2: Add Stop button to ChatPanel and wire in App

**Files:**
- Modify: `shared/instance-client/src/components/ChatPanel.tsx`
- Modify: `shared/instance-client/src/App.tsx`

**Step 1: Add `onCancelResponse` to ChatPanelProps**

In `ChatPanel.tsx`, update the props interface (line 19-26):

```typescript
interface ChatPanelProps {
  messages: Message[];
  prefillMessage: string;
  onSendMessage: (msg: string) => void;
  onResetConversation: () => void;
  onCancelResponse: () => void;
  isThinking: boolean;
  thinkingText: string;
}
```

**Step 2: Add Square icon import**

Update the lucide-react import (line 4):

```typescript
import { RotateCcw, Square } from 'lucide-react';
```

**Step 3: Destructure the new prop**

Update the component signature (line 178):

```typescript
export default function ChatPanel({ messages, prefillMessage, onSendMessage, onResetConversation, onCancelResponse, isThinking, thinkingText }: ChatPanelProps) {
```

**Step 4: Add Stop button next to the Send button**

Replace the Send button area (lines 268-274) with:

```tsx
          {isThinking ? (
            <button
              onClick={onCancelResponse}
              className="self-end px-4 py-2 bg-red-600 text-white text-sm font-medium rounded-lg hover:bg-red-500 transition-colors flex items-center gap-1.5"
            >
              <Square className="w-3.5 h-3.5 fill-current" />
              Stop
            </button>
          ) : (
            <button
              onClick={handleSend}
              disabled={!input.trim()}
              className="self-end px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              Send
            </button>
          )}
```

**Step 5: Wire in App.tsx**

In `App.tsx`, add `cancelResponse` to the useWebSocket destructuring (line 14):

```typescript
  const { messages, isThinking, thinkingText, prefillMessage, currentFileChange, sendMessage, sendElementClick, sendPreviewError, basePath, resetConversation, cancelResponse } =
    useWebSocket();
```

And pass it to ChatPanel (after line 131):

```tsx
          onCancelResponse={cancelResponse}
```

**Step 6: Commit**

```bash
git add shared/instance-client/src/components/ChatPanel.tsx shared/instance-client/src/App.tsx
git commit -m "feat(shared-client): add Stop button to ChatPanel"
```

---

### Task 3: Add AbortController and cancel() to AgentLoop (all 3 instances)

**Files:**
- Modify: `loclaude-instance/server/agent/agent-loop.ts`
- Modify: `loclaude-lite-instance/server/agent/agent-loop.ts`
- Modify: `vibe-instance/server/agent/agent-loop.ts`

All three follow the same pattern. The loclaude version is shown here with its extended thinking specifics noted.

**Step 1: Add `currentAbortController` field and `cancel()` method**

In each AgentLoop class, add a new private field after `private repoMap` and a public `cancel()` method after `clearHistory()`:

```typescript
  private currentAbortController: AbortController | null = null;

  // ... (existing methods) ...

  /** Abort the currently running agent loop iteration. */
  cancel(): void {
    if (this.currentAbortController) {
      this.currentAbortController.abort();
      this.currentAbortController = null;
    }
  }
```

**Step 2: Create AbortController before each `client.send()` and pass the signal**

In the `runLoop()` method, right before building the `ConverseStreamCommand`, create a fresh controller:

```typescript
      this.currentAbortController = new AbortController();
```

Then pass the signal to `client.send()`. Replace:

```typescript
      response = await this.client.send(command);
```

With:

```typescript
      response = await this.client.send(command, {
        abortSignal: this.currentAbortController.signal,
      });
```

For **loclaude-instance only** (which has the thinking fallback), also pass it to the fallback send:

```typescript
          response = await this.client.send(fallbackCommand, {
            abortSignal: this.currentAbortController!.signal,
          });
```

**Step 3: Handle AbortError in the streaming loop**

Wrap the `for await` streaming loop in a try/catch. In all three instances, replace the streaming section. After the `if (response.stream) {` block and before `// Append the full assistant message`, add abort handling:

```typescript
      // Check if cancelled during streaming
      if (this.currentAbortController?.signal.aborted) {
        // Save partial assistant content
        if (assistantContent.length > 0) {
          this.conversationHistory.push({
            role: "assistant",
            content: assistantContent,
          });
        }
        this.currentAbortController = null;
        return;
      }
```

**Step 4: Wrap the entire `client.send()` + streaming in a try/catch for AbortError**

In the `catch` block for `client.send()`, add an abort check **before** the existing thinking fallback (loclaude) or as a new catch (loclaude-lite, vibe):

For **loclaude-instance** — update the existing catch (after line 237):

```typescript
      } catch (err: unknown) {
        // Check for cancellation
        if (err instanceof Error && err.name === 'AbortError') {
          this.currentAbortController = null;
          return;
        }
        const errMsg = err instanceof Error ? err.message : String(err);
        if (!thinkingDisabled && errMsg.includes("thinking")) {
          // ... existing fallback logic
        } else {
          throw err;
        }
      }
```

For **loclaude-lite and vibe** — wrap the `client.send()` in a try/catch:

```typescript
      let response;
      try {
        response = await this.client.send(command, {
          abortSignal: this.currentAbortController.signal,
        });
      } catch (err: unknown) {
        if (err instanceof Error && err.name === 'AbortError') {
          this.currentAbortController = null;
          return;
        }
        throw err;
      }
```

**Step 5: Clean up controller on normal completion**

At the end of `runLoop()`, before `return;` (the normal completion path), add:

```typescript
      this.currentAbortController = null;
```

**Step 6: Commit**

```bash
git add loclaude-instance/server/agent/agent-loop.ts loclaude-lite-instance/server/agent/agent-loop.ts vibe-instance/server/agent/agent-loop.ts
git commit -m "feat(instances): add AbortController cancel support to AgentLoop"
```

---

### Task 4: Handle `cancel_response` in all 3 websocket.ts files

**Files:**
- Modify: `loclaude-instance/server/websocket.ts`
- Modify: `loclaude-lite-instance/server/websocket.ts`
- Modify: `vibe-instance/server/websocket.ts`

**Step 1: Add a `processing` flag and update the chat handler**

In each file, after the `let lastErrorTime = 0;` line, add:

```typescript
    let isProcessing = false;
```

Update the chat message handler — wrap the `processMessage` call:

```typescript
      if (parsed.type === 'chat' && typeof parsed.message === 'string') {
        const userMessage = parsed.message;
        autoFixAttempts = 0;
        conversationHistory.push({ role: 'user', content: userMessage });

        isProcessing = true;
        try {
          await agentLoop.processMessage(userMessage);
          send(ws, { type: 'agent:done' });
        } catch (err: unknown) {
          const errorMessage = err instanceof Error ? err.message : String(err);
          send(ws, { type: 'error', message: errorMessage });
        } finally {
          isProcessing = false;
        }

        return;
      }
```

**Step 2: Add the `cancel_response` handler**

After the `reset_conversation` handler, add:

```typescript
      // ---- cancel_response ------------------------------------------------
      if (parsed.type === 'cancel_response') {
        if (isProcessing) {
          agentLoop.cancel();
          send(ws, { type: 'agent:done', cancelled: true });
        }
        return;
      }
```

**Step 3: Also update the preview_error handler with the `isProcessing` flag**

Wrap the preview_error `processMessage` call similarly:

```typescript
        isProcessing = true;
        try {
          await agentLoop.processMessage(errorMessage);
          send(ws, { type: 'agent:done' });
        } catch (err: unknown) {
          const errMsg = err instanceof Error ? err.message : String(err);
          send(ws, { type: 'error', message: errMsg });
        } finally {
          isProcessing = false;
        }
```

**Step 4: Commit**

```bash
git add loclaude-instance/server/websocket.ts loclaude-lite-instance/server/websocket.ts vibe-instance/server/websocket.ts
git commit -m "feat(instances): handle cancel_response in WebSocket handlers"
```

---

### Task 5: Add chat history file persistence (server-side)

**Files:**
- Modify: `loclaude-instance/server/websocket.ts`
- Modify: `loclaude-lite-instance/server/websocket.ts`
- Modify: `vibe-instance/server/websocket.ts`

**Step 1: Add fs import and history file path constant**

At the top of each `websocket.ts`, add:

```typescript
import fs from 'fs/promises';
```

Inside the `setupWebSocket` function, before the `wss.on('connection')` handler, add:

```typescript
  const HISTORY_FILE = '/home/workspace/.chat-history.json';
```

**Step 2: Add helper functions for save/load**

After the `HISTORY_FILE` constant, add:

```typescript
  interface DisplayMessage {
    role: 'user' | 'assistant';
    content: string;
    toolCalls?: { name: string; input: string; result: string }[];
    isError?: boolean;
  }

  async function loadHistory(): Promise<DisplayMessage[]> {
    try {
      const data = await fs.readFile(HISTORY_FILE, 'utf-8');
      return JSON.parse(data);
    } catch {
      return [];
    }
  }

  async function saveHistory(messages: DisplayMessage[]): Promise<void> {
    try {
      await fs.writeFile(HISTORY_FILE, JSON.stringify(messages, null, 2));
    } catch (err) {
      console.warn('Failed to save chat history:', err);
    }
  }
```

**Step 3: Track display messages and send history on connect**

Inside the `wss.on('connection')` handler, add a display messages array and load history on connect:

```typescript
    // Display messages for persistence (matches client Message format)
    let displayMessages: DisplayMessage[] = [];

    // Send saved history to client on connect
    loadHistory().then((saved) => {
      if (saved.length > 0) {
        displayMessages = saved;
        send(ws, { type: 'chat_history', messages: saved });
      }
    });
```

**Step 4: Build display messages from agent events**

Add event listeners that track display messages. After the existing `onError` handler, add:

```typescript
    // Track display messages for persistence
    const onTextForHistory = (data: { text: string }) => {
      const last = displayMessages[displayMessages.length - 1];
      if (last && last.role === 'assistant' && !last.isError) {
        last.content += data.text;
      } else {
        displayMessages.push({ role: 'assistant', content: data.text });
      }
    };

    const onToolCallForHistory = (data: { name: string; input: unknown }) => {
      const last = displayMessages[displayMessages.length - 1];
      if (last && last.role === 'assistant') {
        if (!last.toolCalls) last.toolCalls = [];
        last.toolCalls.push({
          name: data.name,
          input: typeof data.input === 'string' ? data.input : JSON.stringify(data.input),
          result: '',
        });
      }
    };

    const onToolResultForHistory = (data: { name: string; result: unknown }) => {
      const last = displayMessages[displayMessages.length - 1];
      if (last && last.role === 'assistant' && last.toolCalls) {
        for (let i = last.toolCalls.length - 1; i >= 0; i--) {
          if (last.toolCalls[i].name === data.name && !last.toolCalls[i].result) {
            last.toolCalls[i].result = typeof data.result === 'string' ? data.result : JSON.stringify(data.result);
            break;
          }
        }
      }
    };

    agentLoop.on('agent:text', onTextForHistory);
    agentLoop.on('agent:tool_call', onToolCallForHistory);
    agentLoop.on('agent:tool_result', onToolResultForHistory);
```

**Step 5: Save on user message and on agent:done**

Update the chat message handler to track user messages:

After `conversationHistory.push(...)`, add:

```typescript
        displayMessages.push({ role: 'user', content: userMessage });
```

After `send(ws, { type: 'agent:done' });` (for both chat and preview_error handlers), add:

```typescript
          saveHistory(displayMessages);
```

Also save after the cancelled agent:done in the cancel handler:

```typescript
      if (parsed.type === 'cancel_response') {
        if (isProcessing) {
          agentLoop.cancel();
          send(ws, { type: 'agent:done', cancelled: true });
          saveHistory(displayMessages);
        }
        return;
      }
```

**Step 6: Clear history file on reset**

In the `reset_conversation` handler, after `conversationHistory.length = 0;`, add:

```typescript
        displayMessages = [];
        saveHistory([]);
```

**Step 7: Clean up listeners on close**

In the `ws.on('close')` handler, add:

```typescript
      agentLoop.off('agent:text', onTextForHistory);
      agentLoop.off('agent:tool_call', onToolCallForHistory);
      agentLoop.off('agent:tool_result', onToolResultForHistory);
```

**Step 8: Commit**

```bash
git add loclaude-instance/server/websocket.ts loclaude-lite-instance/server/websocket.ts vibe-instance/server/websocket.ts
git commit -m "feat(instances): add chat history file persistence"
```

---

### Task 6: Handle `chat_history` replay on client

**Files:**
- Modify: `shared/instance-client/src/hooks/useWebSocket.ts`

**Step 1: Add `chat_history` handler to the switch statement**

After the `conversation_reset` case (line 149), add:

```typescript
          case 'chat_history':
            if (Array.isArray(data.messages)) {
              setMessages(data.messages);
            }
            break;
```

**Step 2: Commit**

```bash
git add shared/instance-client/src/hooks/useWebSocket.ts
git commit -m "feat(shared-client): handle chat_history replay on connect"
```

---

### Task 7: Add token estimation and smart summarization to AgentLoop

**Files:**
- Modify: `loclaude-instance/server/agent/agent-loop.ts`
- Modify: `loclaude-lite-instance/server/agent/agent-loop.ts`
- Modify: `vibe-instance/server/agent/agent-loop.ts`

**Step 1: Add `ConverseCommand` to imports**

In each file, update the import from `@aws-sdk/client-bedrock-runtime` to include `ConverseCommand`:

For loclaude-instance (line 3-10):

```typescript
import {
  BedrockRuntimeClient,
  ConverseCommand,
  ConverseStreamCommand,
  type ContentBlock,
  type Message,
  type SystemContentBlock,
  type Tool,
  type ConverseStreamOutput,
} from "@aws-sdk/client-bedrock-runtime";
```

For loclaude-lite and vibe (same pattern, just add `ConverseCommand`).

**Step 2: Add token threshold constants**

After the `MAX_ITERATIONS` constant, add:

```typescript
const TOKEN_THRESHOLD = 150_000;  // ~150K tokens — trigger summarization
const TOKEN_HARD_CAP = 100_000;   // ~100K tokens — force truncation fallback
```

**Step 3: Add `estimateTokens()` private method**

In each AgentLoop class, add after the `cancel()` method:

```typescript
  /** Estimate total tokens in conversation history using ~4 chars/token heuristic. */
  private estimateTokens(): number {
    let chars = 0;
    for (const msg of this.conversationHistory) {
      if (!msg.content) continue;
      for (const block of msg.content as ContentBlock[]) {
        if (block.text) chars += block.text.length;
        if (block.toolUse) {
          chars += (block.toolUse.name?.length || 0);
          chars += JSON.stringify(block.toolUse.input || {}).length;
        }
        if (block.toolResult?.content) {
          for (const c of block.toolResult.content) {
            if ('text' in c && c.text) chars += c.text.length;
          }
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const rc = (block as any)?.reasoningContent;
        if (rc?.reasoningText?.text) chars += rc.reasoningText.text.length;
      }
    }
    return Math.ceil(chars / 4);
  }
```

**Step 4: Add `extractMessageText()` helper**

Add a helper to extract readable text from Bedrock Message format:

```typescript
  /** Extract plain text from a conversation message for summarization. */
  private extractMessageText(msg: Message): string {
    if (!msg.content) return '';
    const parts: string[] = [];
    for (const block of msg.content as ContentBlock[]) {
      if (block.text) parts.push(block.text);
      if (block.toolUse) {
        parts.push(`[Tool: ${block.toolUse.name}]`);
      }
      if (block.toolResult?.content) {
        for (const c of block.toolResult.content) {
          if ('text' in c && c.text) {
            // Truncate long tool results in summary
            parts.push(c.text.length > 500 ? c.text.slice(0, 500) + '...' : c.text);
          }
        }
      }
    }
    return `${msg.role}: ${parts.join(' ')}`;
  }
```

**Step 5: Add `compactHistory()` method with summarization**

```typescript
  /** Compact conversation history if it exceeds the token threshold. */
  private async compactHistory(): Promise<void> {
    const estimated = this.estimateTokens();
    if (estimated < TOKEN_THRESHOLD) return;

    console.log(`Token estimate: ~${estimated}. Threshold: ${TOKEN_THRESHOLD}. Compacting...`);

    // Take the oldest 60% of messages for summarization
    const splitIndex = Math.max(2, Math.floor(this.conversationHistory.length * 0.6));
    const oldMessages = this.conversationHistory.slice(0, splitIndex);
    const recentMessages = this.conversationHistory.slice(splitIndex);

    // Build text summary of old messages
    const oldText = oldMessages.map((m) => this.extractMessageText(m)).join('\n');

    try {
      const summaryCommand = new ConverseCommand({
        modelId: MODEL_ID,
        messages: [{
          role: 'user',
          content: [{ text: `Summarize this conversation concisely in 2-3 paragraphs. Preserve: key decisions made, files created/modified, current task context, and any unfinished work.\n\n${oldText.slice(0, 50000)}` }],
        }],
        inferenceConfig: { maxTokens: 1024 },
      });

      const summaryResponse = await this.client.send(summaryCommand);
      const summaryText = summaryResponse.output?.message?.content?.[0]?.text || '';

      if (summaryText) {
        this.conversationHistory = [
          { role: 'user', content: [{ text: `[Previous conversation summary]\n${summaryText}` }] },
          { role: 'assistant', content: [{ text: 'Understood. I have the context from our previous conversation and will continue from here.' }] },
          ...recentMessages,
        ];
        console.log(`History compacted: ${oldMessages.length + recentMessages.length} messages → ${this.conversationHistory.length} messages`);
        return;
      }
    } catch (err) {
      console.warn('Summarization failed, falling back to truncation:', err);
    }

    // Fallback: simple truncation — keep only recent messages
    this.conversationHistory = recentMessages;
    console.log(`History truncated: kept ${recentMessages.length} most recent messages`);
  }
```

**Step 6: Call `compactHistory()` at the start of each iteration in `runLoop()`**

In each file's `runLoop()` method, add at the very beginning of the `for` loop body (before `const systemPrompt = ...`):

```typescript
      // Check if conversation is getting too long and compact if needed
      await this.compactHistory();
```

**Step 7: Add token limit error recovery**

In the `catch` block around `client.send()`, add handling for token limit errors.

For **loclaude-instance**, update the existing catch block — add before the thinking fallback check:

```typescript
        // Token limit error — force truncate and retry
        if (errMsg.includes('too many tokens') || errMsg.includes('too long') || errMsg.includes('Input is too long')) {
          console.warn('Token limit hit, force-truncating history...');
          const keepCount = Math.max(4, Math.floor(this.conversationHistory.length * 0.3));
          this.conversationHistory = this.conversationHistory.slice(-keepCount);
          continue; // Retry the iteration with truncated history
        }
```

For **loclaude-lite and vibe**, add the same logic in their catch block:

```typescript
      } catch (err: unknown) {
        if (err instanceof Error && err.name === 'AbortError') {
          this.currentAbortController = null;
          return;
        }
        const errMsg = err instanceof Error ? err.message : String(err);
        // Token limit error — force truncate and retry
        if (errMsg.includes('too many tokens') || errMsg.includes('too long') || errMsg.includes('Input is too long')) {
          console.warn('Token limit hit, force-truncating history...');
          const keepCount = Math.max(4, Math.floor(this.conversationHistory.length * 0.3));
          this.conversationHistory = this.conversationHistory.slice(-keepCount);
          continue;
        }
        throw err;
      }
```

**Step 8: Commit**

```bash
git add loclaude-instance/server/agent/agent-loop.ts loclaude-lite-instance/server/agent/agent-loop.ts vibe-instance/server/agent/agent-loop.ts
git commit -m "feat(instances): add token estimation, smart summarization, and error recovery"
```

---

### Task 8: Rebuild shared client and verify

**Step 1: Rebuild the shared client**

```bash
cd shared/instance-client && npm run build
```

Expected: Vite builds successfully with no TypeScript errors.

**Step 2: Verify functionality**

- Chat panel shows Send button normally, Stop button while thinking
- Clicking Stop cancels the response and keeps partial text
- Refreshing the page restores chat history
- New Conversation clears both UI and history file
- Long conversations trigger summarization (check server logs)

**Step 3: Commit and push**

```bash
git add -A
git commit -m "feat: chat enhancements - rebuild shared client"
git push origin feature/64-continue-dev-instance
```
