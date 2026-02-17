import { WebSocketServer, WebSocket } from 'ws';
import type { Server } from 'http';
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

  wss.on('connection', (ws: WebSocket) => {
    let autoFixAttempts = 0;
    let lastErrorTime = 0;

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

    ws.on('message', async (raw: Buffer | string) => {
      let parsed: Record<string, unknown>;
      try {
        parsed = JSON.parse(typeof raw === 'string' ? raw : raw.toString());
      } catch {
        send(ws, { type: 'error', message: 'Invalid JSON' });
        return;
      }

      if (parsed.type === 'chat' && typeof parsed.message === 'string') {
        autoFixAttempts = 0;
        try {
          await bridge.processMessage(parsed.message);
          send(ws, { type: 'agent:done' });
        } catch (err: unknown) {
          const errorMessage = err instanceof Error ? err.message : String(err);
          send(ws, { type: 'error', message: errorMessage });
        }
        return;
      }

      if (
        parsed.type === 'element_click' &&
        typeof parsed.tagName === 'string' &&
        typeof parsed.textContent === 'string'
      ) {
        const formattedMessage = `Change the ${parsed.tagName} element that says '${parsed.textContent}'...`;
        send(ws, { type: 'prefill', message: formattedMessage });
        return;
      }

      if (parsed.type === 'preview_error' && typeof parsed.error === 'string') {
        const now = Date.now();
        if (now - lastErrorTime < 5000) return;
        if (autoFixAttempts >= 3) return;
        lastErrorTime = now;
        autoFixAttempts++;

        send(ws, { type: 'agent:text', content: `[Auto-detected error] ${parsed.error}\n\nAttempting to fix...` });
        try {
          await bridge.processMessage(
            `The live preview has an error:\n\`\`\`\n${parsed.error}\n\`\`\`\nPlease investigate and fix this error.`
          );
          send(ws, { type: 'agent:done' });
        } catch (err: unknown) {
          send(ws, { type: 'error', message: err instanceof Error ? err.message : String(err) });
        }
      }
    });

    ws.on('close', () => {
      bridge.off('agent:thinking', onThinking);
      bridge.off('agent:text', onText);
      bridge.off('agent:file_changed', onFileChanged);
      bridge.off('agent:error', onError);
    });
  });
}
