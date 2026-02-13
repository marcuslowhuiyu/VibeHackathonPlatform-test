import { useState, useEffect, useRef, useCallback } from 'react';

export interface Message {
  role: 'user' | 'assistant';
  content: string;
  toolCalls?: { name: string; input: string; result: string }[];
  isError?: boolean;
}

// Derive the base path from the URL pathname (e.g., /i/vibe-vb-xxxxx)
function getBasePath(): string {
  const match = window.location.pathname.match(/^(\/i\/[^/]+)/);
  return match ? match[1] : '';
}

export function useWebSocket(): {
  messages: Message[];
  isThinking: boolean;
  prefillMessage: string;
  currentFileChange: { path: string; content: string } | null;
  sendMessage: (text: string) => void;
  sendElementClick: (info: { tagName: string; textContent: string; selector: string }) => void;
  basePath: string;
} {
  const [messages, setMessages] = useState<Message[]>([]);
  const [isThinking, setIsThinking] = useState(false);
  const [prefillMessage, setPrefillMessage] = useState('');
  const [currentFileChange, setCurrentFileChange] = useState<{ path: string; content: string } | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const basePath = getBasePath();

  useEffect(() => {
    function connect() {
      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      const wsUrl = `${protocol}//${window.location.host}${basePath}`;
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        // Connected
      };

      ws.onmessage = (event) => {
        let data: any;
        try {
          data = JSON.parse(event.data);
        } catch {
          return;
        }

        switch (data.type) {
          case 'agent:thinking':
            setIsThinking(true);
            break;

          case 'agent:text':
            setMessages((prev) => {
              const updated = [...prev];
              const last = updated[updated.length - 1];
              if (last && last.role === 'assistant') {
                updated[updated.length - 1] = {
                  ...last,
                  content: last.content + (data.content ?? ''),
                };
              } else {
                updated.push({ role: 'assistant', content: data.content ?? '' });
              }
              return updated;
            });
            break;

          case 'agent:tool_call':
            setMessages((prev) => {
              const updated = [...prev];
              const last = updated[updated.length - 1];
              if (last && last.role === 'assistant') {
                const toolCalls = [...(last.toolCalls ?? [])];
                toolCalls.push({
                  name: data.name ?? '',
                  input: data.input ?? '',
                  result: '',
                });
                updated[updated.length - 1] = { ...last, toolCalls };
              }
              return updated;
            });
            break;

          case 'agent:tool_result':
            setMessages((prev) => {
              const updated = [...prev];
              const last = updated[updated.length - 1];
              if (last && last.role === 'assistant' && last.toolCalls) {
                const toolCalls = [...last.toolCalls];
                // Find the matching tool call by name (last one without a result)
                for (let i = toolCalls.length - 1; i >= 0; i--) {
                  if (toolCalls[i].name === data.name && !toolCalls[i].result) {
                    toolCalls[i] = { ...toolCalls[i], result: data.result ?? '' };
                    break;
                  }
                }
                updated[updated.length - 1] = { ...last, toolCalls };
              }
              return updated;
            });
            break;

          case 'agent:file_changed':
            setCurrentFileChange({ path: data.path, content: data.content });
            break;

          case 'agent:done':
            setIsThinking(false);
            break;

          case 'prefill':
            setPrefillMessage(data.message ?? '');
            break;

          case 'error':
            setIsThinking(false);
            setMessages((prev) => [
              ...prev,
              { role: 'assistant', content: `Error: ${data.message || 'Something went wrong'}`, isError: true },
            ]);
            break;
        }
      };

      ws.onclose = () => {
        wsRef.current = null;
        reconnectTimerRef.current = setTimeout(() => {
          connect();
        }, 2000);
      };

      ws.onerror = () => {
        ws.close();
      };
    }

    connect();

    return () => {
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
      }
      if (wsRef.current) {
        wsRef.current.close();
      }
    };
  }, []);

  const sendMessage = useCallback((text: string) => {
    setMessages((prev) => [...prev, { role: 'user', content: text }]);
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'chat', message: text }));
    }
  }, []);

  const sendElementClick = useCallback(
    (info: { tagName: string; textContent: string; selector: string }) => {
      if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
        wsRef.current.send(JSON.stringify({ type: 'element_click', ...info }));
      }
    },
    [],
  );

  return {
    messages,
    isThinking,
    prefillMessage,
    currentFileChange,
    sendMessage,
    sendElementClick,
    basePath,
  };
}
