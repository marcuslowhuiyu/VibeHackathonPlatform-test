import { WebSocketServer, WebSocket } from 'ws';
import type { Server } from 'http';
import fs from 'fs/promises';
import { ContinueBridge } from './agent/continue-bridge.js';

function send(ws: WebSocket, data: Record<string, unknown>): void {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

export function setupWebSocket(server: Server, bridge: ContinueBridge): void {
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req, socket, head) => {
    const url = req.url || '';
    if (url.includes('/preview')) return;
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req);
    });
  });

  const HISTORY_FILE = '/home/workspace/.chat-history.json';

  interface DisplayMessage {
    role: 'user' | 'assistant';
    content: string;
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

    const onFileChanged = (data: { path: string; content?: string }) => {
      send(ws, { type: 'agent:file_changed', path: data.path, content: data.content });
    };

    const onError = (data: { error: string }) => {
      send(ws, { type: 'error', message: data.error });
    };

    bridge.on('agent:thinking', onThinking);
    bridge.on('agent:text', onText);
    bridge.on('agent:file_changed', onFileChanged);
    bridge.on('agent:error', onError);

    // Track display messages for persistence
    const onTextForHistory = (data: { text: string }) => {
      const last = displayMessages[displayMessages.length - 1];
      if (last && last.role === 'assistant' && !last.isError) {
        last.content += data.text;
      } else {
        displayMessages.push({ role: 'assistant', content: data.text });
      }
    };

    bridge.on('agent:text', onTextForHistory);

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
          send(ws, { type: 'error', message: 'Still processing previous message' });
          return;
        }
        autoFixAttempts = 0;
        displayMessages.push({ role: 'user', content: parsed.message });

        isProcessing = true;
        try {
          await bridge.processMessage(parsed.message);
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
        typeof parsed.textContent === 'string'
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

        send(ws, { type: 'agent:text', content: `[Auto-detected error] ${parsed.error}\n\nAttempting to fix...` });

        isProcessing = true;
        try {
          await bridge.processMessage(
            `The live preview has an error:\n\`\`\`\n${parsed.error}\n\`\`\`\nPlease investigate and fix this error.`
          );
          send(ws, { type: 'agent:done' });
          saveHistory(displayMessages);
        } catch (err: unknown) {
          send(ws, { type: 'error', message: err instanceof Error ? err.message : String(err) });
        } finally {
          isProcessing = false;
        }
        return;
      }

      // ---- reset_conversation --------------------------------------------
      if (parsed.type === 'reset_conversation') {
        bridge.clearHistory();
        displayMessages = [];
        saveHistory([]);
        autoFixAttempts = 0;
        lastErrorTime = 0;

        console.log('Conversation reset: history cleared, session reset');
        send(ws, { type: 'conversation_reset' });
        return;
      }

      // ---- cancel_response ------------------------------------------------
      if (parsed.type === 'cancel_response') {
        if (isProcessing) {
          bridge.cancel();
          // The chat/preview_error handler will send agent:done after processMessage resolves
        }
        return;
      }
    });

    // ------------------------------------------------------------------
    // Clean up listeners when the connection closes
    // ------------------------------------------------------------------

    ws.on('close', () => {
      bridge.off('agent:thinking', onThinking);
      bridge.off('agent:text', onText);
      bridge.off('agent:file_changed', onFileChanged);
      bridge.off('agent:error', onError);
      bridge.off('agent:text', onTextForHistory);
    });
  });
}
