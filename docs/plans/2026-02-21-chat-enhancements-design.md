# Chat Enhancements Design

## Goal

Add chat history persistence, response cancellation, and token limit handling to loclaude, loclaude-lite, and vibe instances.

## Scope

Applies to **loclaude, loclaude-lite, and vibe** instances (not continue-dev, which delegates conversation state to the Continue CLI).

## Feature 1: Chat History Persistence

### Storage

Server writes display messages to `/home/workspace/.chat-history.json` — a JSON array of UI-format messages (role, content, tool info). Separate from AgentLoop's `conversationHistory` (Bedrock API format).

### Save trigger

After each complete message exchange — when `agent:done` fires, the server appends the latest messages to the file.

### Load trigger

When a new WebSocket connection opens, the server reads the file and sends a `chat_history` event with all saved messages. The client populates its `messages[]` state from this.

### Reset integration

The existing `reset_conversation` handler also deletes/clears the history file.

### Message format

```json
[
  { "role": "user", "content": "Build a todo app" },
  { "role": "assistant", "content": "I'll create a todo app...", "toolCalls": [...] }
]
```

### Files to change

| File | Change |
|------|--------|
| `loclaude-instance/server/websocket.ts` | Save messages to file on agent:done, load on connect |
| `loclaude-lite-instance/server/websocket.ts` | Same |
| `vibe-instance/server/websocket.ts` | Same |
| `shared/instance-client/src/hooks/useWebSocket.ts` | Handle `chat_history` event on connect |

## Feature 2: Cancel Response

### Client side

A "Stop" button replaces the thinking spinner in ChatPanel when `isThinking` is true. On click, sends `{ type: 'cancel_response' }` over WebSocket.

### Server side

Each AgentLoop gets an `AbortController` instance, created fresh before each `client.send()` call. The controller's signal is passed to the Bedrock ConverseStream command. When `cancel_response` arrives:

1. Call `abortController.abort()`
2. The `for await` loop throws an abort error, caught gracefully
3. Whatever text was streamed so far stays in `conversationHistory` as a partial assistant message
4. Server emits `agent:done` with `{ cancelled: true }`
5. Partial response is saved to chat history file

### Client handling

On `agent:done` with `cancelled: true`, the client stops the thinking spinner and keeps the partial message as-is. No special UI marker needed.

### Edge cases

- **Cancel during tool execution:** Abort the stream, but don't kill running bash commands (they have their own timeout). The tool result is discarded.
- **Cancel when not processing:** Server ignores the message (no-op).

### Files to change

| File | Change |
|------|--------|
| `loclaude-instance/server/agent/agent-loop.ts` | Add AbortController, pass signal to Bedrock, handle abort |
| `loclaude-lite-instance/server/agent/agent-loop.ts` | Same |
| `vibe-instance/server/agent/agent-loop.ts` | Same |
| `loclaude-instance/server/websocket.ts` | Handle `cancel_response` message |
| `loclaude-lite-instance/server/websocket.ts` | Same |
| `vibe-instance/server/websocket.ts` | Same |
| `shared/instance-client/src/hooks/useWebSocket.ts` | Add `cancelResponse` callback |
| `shared/instance-client/src/components/ChatPanel.tsx` | Add Stop button (visible when isThinking) |

## Feature 3: Token Limit Handling

### Token estimation

Use ~4 chars/token heuristic (already proven in `repo-map.ts`). Count total characters in `conversationHistory` before each API call.

### Threshold

When conversation exceeds ~600K characters (~150K tokens), trigger summarization. Leaves ~50K tokens headroom for system prompt, repo map, and response.

### Summarization flow

1. Before each `client.send()`, estimate total tokens
2. If over threshold, take the oldest ~60% of messages
3. Make a separate Bedrock API call: "Summarize this conversation so far in 2-3 paragraphs, preserving key decisions, file changes, and current task context"
4. Replace those old messages with a single user message containing the summary
5. Keep the most recent ~40% of messages intact
6. Proceed with the normal API call

### Fallback

If the summarization API call itself fails, fall back to simple truncation — drop the oldest messages until under threshold.

### Error recovery

Wrap the main `client.send()` in a catch for token limit errors (Bedrock returns `ValidationException` with "too many tokens" message). On catch: force-truncate to ~100K tokens and retry once.

### Files to change

| File | Change |
|------|--------|
| `loclaude-instance/server/agent/agent-loop.ts` | Token counting + summarization before API call |
| `loclaude-lite-instance/server/agent/agent-loop.ts` | Same |
| `vibe-instance/server/agent/agent-loop.ts` | Same |
| Possible shared utility `shared/token-manager.ts` | Extract shared token counting + summarization logic |

## Approach chosen

- **Chat history:** Server-side JSON file with WebSocket replay on connect
- **Cancel:** AbortController on Bedrock ConverseStream
- **Token limits:** Smart summarization with sliding window fallback + error recovery
