import { WebSocketServer, WebSocket } from 'ws';
import type { Server } from 'http';
import fs from 'fs/promises';
import { AgentLoop } from './agent/agent-loop.js';
import { generateRepoMap } from './agent/repo-map.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Send a JSON-serialised message to the client if the socket is still open. */
function send(ws: WebSocket, data: Record<string, unknown>): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

function sendToast(ws: WebSocket, type: 'info' | 'warning' | 'error' | 'success', message: string): void {
  send(ws, { type: 'toast', toast_type: type, message });
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Attach a WebSocket server to an existing HTTP server and wire it up to the
 * provided {@link AgentLoop} so that every agent event is forwarded in
 * real-time to connected browser clients.
 */
export function setupWebSocket(server: Server, agentLoop: AgentLoop): void {
  const wss = new WebSocketServer({ noServer: true });

  // Handle HTTP → WebSocket upgrade (skip /preview paths — those are proxied to Vite)
  server.on('upgrade', (req, socket, head) => {
    const url = req.url || '';
    if (url.includes('/preview')) {
      return; // Let the preview WS proxy handler deal with this
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req);
    });
  });

  const HISTORY_FILE = '/home/workspace/.chat-history.json';

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

  wss.on('connection', (ws: WebSocket) => {
    // Per-connection conversation history kept in memory
    const conversationHistory: Array<{ role: string; content: string }> = [];

    // Auto-fix state: prevent infinite error-fix loops
    let autoFixAttempts = 0;
    let lastErrorTime = 0;
    let isProcessing = false;

    // Display messages for persistence (matches client Message format)
    let displayMessages: DisplayMessage[] = [];

    // Send saved history to client on connect
    loadHistory().then((saved) => {
      if (saved.length > 0) {
        displayMessages = saved;
        send(ws, { type: 'chat_history', messages: saved });
      }
    });

    // ------------------------------------------------------------------
    // Wire agent events → WebSocket messages
    // ------------------------------------------------------------------

    const onThinking = (data?: { text?: string }) => {
      send(ws, { type: 'agent:thinking', text: data?.text });
    };

    const onText = (data: { text: string }) => {
      send(ws, { type: 'agent:text', content: data.text });
    };

    const onToolCall = (data: { name: string; input: unknown }) => {
      send(ws, { type: 'agent:tool_call', name: data.name, input: data.input });
    };

    const onToolResult = (data: { name: string; result: unknown }) => {
      send(ws, { type: 'agent:tool_result', name: data.name, result: data.result });
    };

    const onFileChanged = (data: { path: string; content?: string }) => {
      send(ws, { type: 'agent:file_changed', path: data.path, content: data.content });
    };

    const onError = (data: { error: string }) => {
      send(ws, { type: 'error', message: data.error });
    };

    // Register listeners
    agentLoop.on('agent:thinking', onThinking);
    agentLoop.on('agent:text', onText);
    agentLoop.on('agent:tool_call', onToolCall);
    agentLoop.on('agent:tool_result', onToolResult);
    agentLoop.on('agent:file_changed', onFileChanged);
    agentLoop.on('agent:error', onError);

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

    // ------------------------------------------------------------------
    // Handle incoming messages from the client
    // ------------------------------------------------------------------

    ws.on('message', async (raw: Buffer | string) => {
      let parsed: Record<string, unknown>;

      try {
        parsed = JSON.parse(typeof raw === 'string' ? raw : raw.toString());
      } catch {
        send(ws, { type: 'error', message: 'Invalid JSON' });
        return;
      }

      // ---- chat message ------------------------------------------------
      if (parsed.type === 'chat' && typeof parsed.message === 'string') {
        if (isProcessing) {
          sendToast(ws, 'warning', 'Still processing previous message');
          return;
        }
        const userMessage = parsed.message;
        autoFixAttempts = 0;
        conversationHistory.push({ role: 'user', content: userMessage });
        displayMessages.push({ role: 'user', content: userMessage });

        isProcessing = true;
        try {
          await agentLoop.processMessage(userMessage);
          send(ws, { type: 'agent:done' });
          saveHistory(displayMessages);
        } catch (err: unknown) {
          const errorMessage = err instanceof Error ? err.message : String(err);
          send(ws, { type: 'error', message: errorMessage });
        } finally {
          isProcessing = false;
        }

        return;
      }

      // ---- element_click -----------------------------------------------
      if (
        parsed.type === 'element_click' &&
        typeof parsed.tagName === 'string' &&
        typeof parsed.textContent === 'string' &&
        typeof parsed.selector === 'string'
      ) {
        const formattedMessage = `Change the ${parsed.tagName} element that says '${parsed.textContent}'...`;
        send(ws, { type: 'prefill', message: formattedMessage });
        return;
      }

      // ---- preview_error (auto-fix) -------------------------------------
      if (parsed.type === 'preview_error' && typeof parsed.error === 'string') {
        // Debounce and prevent infinite loops
        const now = Date.now();
        if (now - lastErrorTime < 5000) return; // 5s cooldown between auto-fixes
        if (autoFixAttempts >= 3) return; // Max 3 attempts
        lastErrorTime = now;
        autoFixAttempts++;

        const errorMessage = `The live preview has an error:\n\`\`\`\n${parsed.error}\n\`\`\`\nPlease investigate and fix this error.`;

        sendToast(ws, 'info', 'Auto-fixing preview error...');

        isProcessing = true;
        try {
          await agentLoop.processMessage(errorMessage);
          send(ws, { type: 'agent:done' });
          saveHistory(displayMessages);
        } catch (err: unknown) {
          const errMsg = err instanceof Error ? err.message : String(err);
          send(ws, { type: 'error', message: errMsg });
        } finally {
          isProcessing = false;
        }
        return;
      }

      // ---- reset_conversation --------------------------------------------
      if (parsed.type === 'reset_conversation') {
        agentLoop.clearHistory();
        conversationHistory.length = 0;
        displayMessages = [];
        saveHistory([]);
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
        sendToast(ws, 'success', 'Conversation reset');
        return;
      }

      // ---- cancel_response ------------------------------------------------
      if (parsed.type === 'cancel_response') {
        if (isProcessing) {
          agentLoop.cancel();
          // The chat/preview_error handler will send agent:done after processMessage resolves
        }
        return;
      }
    });

    // ------------------------------------------------------------------
    // Clean up listeners when the connection closes
    // ------------------------------------------------------------------

    ws.on('close', () => {
      agentLoop.off('agent:thinking', onThinking);
      agentLoop.off('agent:text', onText);
      agentLoop.off('agent:tool_call', onToolCall);
      agentLoop.off('agent:tool_result', onToolResult);
      agentLoop.off('agent:file_changed', onFileChanged);
      agentLoop.off('agent:error', onError);
      agentLoop.off('agent:text', onTextForHistory);
      agentLoop.off('agent:tool_call', onToolCallForHistory);
      agentLoop.off('agent:tool_result', onToolResultForHistory);
    });
  });
}
