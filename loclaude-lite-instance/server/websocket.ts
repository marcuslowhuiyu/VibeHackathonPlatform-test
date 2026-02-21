import { WebSocketServer, WebSocket } from 'ws';
import type { Server } from 'http';
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

  wss.on('connection', (ws: WebSocket) => {
    // Per-connection conversation history kept in memory
    const conversationHistory: Array<{ role: string; content: string }> = [];

    // Auto-fix state: prevent infinite error-fix loops
    let autoFixAttempts = 0;
    let lastErrorTime = 0;

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
      send(ws, { type: 'agent:tool_call', tool: data.name, input: data.input });
    };

    const onToolResult = (data: { name: string; result: unknown }) => {
      send(ws, { type: 'agent:tool_result', tool: data.name, result: data.result });
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
        const userMessage = parsed.message;
        autoFixAttempts = 0;

        // Track in per-connection history
        conversationHistory.push({ role: 'user', content: userMessage });

        try {
          await agentLoop.processMessage(userMessage);
          send(ws, { type: 'agent:done' });
        } catch (err: unknown) {
          const errorMessage = err instanceof Error ? err.message : String(err);
          send(ws, { type: 'error', message: errorMessage });
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
        const now = Date.now();
        if (now - lastErrorTime < 5000) return;
        if (autoFixAttempts >= 3) return;
        lastErrorTime = now;
        autoFixAttempts++;

        const errorMessage = `The live preview has an error:\n\`\`\`\n${parsed.error}\n\`\`\`\nPlease investigate and fix this error.`;
        send(ws, { type: 'agent:text', content: `[Auto-detected error] ${parsed.error}\n\nAttempting to fix...` });

        try {
          await agentLoop.processMessage(errorMessage);
          send(ws, { type: 'agent:done' });
        } catch (err: unknown) {
          const errMsg = err instanceof Error ? err.message : String(err);
          send(ws, { type: 'error', message: errMsg });
        }
        return;
      }

      // ---- reset_conversation --------------------------------------------
      if (parsed.type === 'reset_conversation') {
        agentLoop.clearHistory();
        conversationHistory.length = 0;
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
    });
  });
}
