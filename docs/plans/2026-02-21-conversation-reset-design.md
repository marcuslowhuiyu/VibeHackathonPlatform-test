# Conversation Reset Feature Design

## Goal

Add a "New Conversation" button to the shared instance client that clears chat history and regenerates the repo map, giving users a fresh AI context without a page reload.

## Scope

Applies to **loclaude, loclaude-lite, and vibe** instances (not continue-dev, which delegates conversation state to the Continue CLI).

## Architecture

### Client side (`shared/instance-client/`)

- Add a "New Conversation" button in the `ChatPanel` header next to the "Chat" title
- On click: send `{ type: 'reset_conversation' }` over WebSocket
- On receiving `{ type: 'conversation_reset' }` back: clear local `messages[]`, `isThinking`, `thinkingText`, `prefillMessage`
- Disable the button while the agent is processing to prevent reset mid-response

### Server side (each instance's `websocket.ts`)

- Handle new `reset_conversation` message type
- Clear `agentLoop.conversationHistory` array
- Regenerate repo map via `generateRepoMap()` and call `agentLoop.updateRepoMap()`
- Send `{ type: 'conversation_reset' }` back to client

### Files to change

| File | Change |
|------|--------|
| `shared/instance-client/src/hooks/useWebSocket.ts` | Add `resetConversation()` function, handle `conversation_reset` message type |
| `shared/instance-client/src/components/ChatPanel.tsx` | Add "New Conversation" button in header |
| `loclaude-instance/server/websocket.ts` | Handle `reset_conversation` message |
| `loclaude-lite-instance/server/websocket.ts` | Handle `reset_conversation` message |
| `vibe-instance/server/websocket.ts` | Handle `reset_conversation` message |

### Approach chosen

WebSocket message-based reset (vs. WebSocket reconnection or full page reload). Keeps the connection alive, is instant, and explicitly triggers repo map regeneration.

### UX

Small icon button (`RotateCcw` or `Plus` from lucide-react) in the chat header bar with tooltip "New Conversation". No confirmation dialog needed since only chat history is affected, not code files.
