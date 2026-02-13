import { useState, useEffect, useRef } from 'react';

interface ToolCall {
  name: string;
  input: string;
  result: string;
}

export interface Message {
  role: 'user' | 'assistant';
  content: string;
  toolCalls?: ToolCall[];
  isError?: boolean;
}

interface ChatPanelProps {
  messages: Message[];
  prefillMessage: string;
  onSendMessage: (msg: string) => void;
  isThinking: boolean;
}

function ToolCallCard({ tool }: { tool: ToolCall }) {
  const [expanded, setExpanded] = useState(false);
  const isBashTool = tool.name === 'bash_command' || tool.name === 'Bash';

  // Try to parse JSON for bash tools to show command and output nicely
  let bashCommand = '';
  let bashOutput = '';
  if (isBashTool) {
    try {
      const inputObj = typeof tool.input === 'string' ? JSON.parse(tool.input) : tool.input;
      bashCommand = inputObj.command || JSON.stringify(tool.input);
    } catch {
      bashCommand = String(tool.input);
    }
    try {
      const resultObj = typeof tool.result === 'string' ? JSON.parse(tool.result) : tool.result;
      bashOutput = resultObj.output || String(tool.result);
    } catch {
      bashOutput = String(tool.result);
    }
  }

  return (
    <div
      className="mt-2 bg-gray-800 rounded-lg border border-gray-700 overflow-hidden cursor-pointer"
      onClick={() => setExpanded(!expanded)}
    >
      <div className="flex items-center justify-between px-3 py-2">
        <span className="text-sm font-bold text-gray-300">
          {isBashTool ? '$ ' : ''}{tool.name}
        </span>
        <span className="text-xs text-gray-500">{expanded ? '\u25B2' : '\u25BC'}</span>
      </div>
      {expanded && (
        <div className="border-t border-gray-700 px-3 py-2 space-y-2">
          {isBashTool ? (
            <div className="bg-black rounded p-3 font-mono text-xs text-green-400 whitespace-pre-wrap break-words max-h-64 overflow-y-auto">
              <div className="text-gray-500 mb-1">$ {bashCommand}</div>
              <div>{bashOutput}</div>
            </div>
          ) : (
            <>
              <div>
                <div className="text-xs text-gray-500 mb-1">Input</div>
                <pre className="text-xs text-gray-400 whitespace-pre-wrap break-words bg-gray-900 rounded p-2">
                  {tool.input}
                </pre>
              </div>
              <div>
                <div className="text-xs text-gray-500 mb-1">Result</div>
                <pre className="text-xs text-gray-400 whitespace-pre-wrap break-words bg-gray-900 rounded p-2">
                  {tool.result}
                </pre>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function ThinkingDots() {
  const [dots, setDots] = useState('');

  useEffect(() => {
    const interval = setInterval(() => {
      setDots((prev) => (prev.length >= 3 ? '' : prev + '.'));
    }, 400);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="flex items-start gap-3 px-4 py-3">
      <div className="w-7 h-7 rounded-full bg-purple-600 shrink-0 flex items-center justify-center">
        <span className="text-xs font-bold text-white">A</span>
      </div>
      <div className="text-gray-400 text-sm pt-1">
        Thinking<span className="inline-block w-6 text-left">{dots}</span>
      </div>
    </div>
  );
}

export default function ChatPanel({ messages, prefillMessage, onSendMessage, isThinking }: ChatPanelProps) {
  const [input, setInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isThinking]);

  // Prefill message
  useEffect(() => {
    if (prefillMessage) {
      setInput(prefillMessage);
      textareaRef.current?.focus();
    }
  }, [prefillMessage]);

  const handleSend = () => {
    const trimmed = input.trim();
    if (!trimmed) return;
    onSendMessage(trimmed);
    setInput('');
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="h-full flex flex-col bg-gray-900">
      {/* Header */}
      <div className="shrink-0 px-4 py-3 border-b border-gray-800">
        <h2 className="text-sm font-semibold text-gray-300">Chat</h2>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto">
        {messages.map((msg, idx) => (
          <div key={idx} className="px-4 py-3 border-b border-gray-800/50">
            <div className="flex items-start gap-3">
              <div
                className={`w-7 h-7 rounded-full shrink-0 flex items-center justify-center ${
                  msg.role === 'user' ? 'bg-blue-600' : msg.isError ? 'bg-red-600' : 'bg-purple-600'
                }`}
              >
                <span className="text-xs font-bold text-white">
                  {msg.role === 'user' ? 'U' : 'A'}
                </span>
              </div>
              <div className="flex-1 min-w-0">
                <p className={`text-sm whitespace-pre-wrap break-words ${msg.isError ? 'text-red-400' : 'text-gray-200'}`}>{msg.content}</p>
                {msg.toolCalls?.map((tool, tIdx) => (
                  <ToolCallCard key={tIdx} tool={tool} />
                ))}
              </div>
            </div>
          </div>
        ))}
        {isThinking && <ThinkingDots />}
        <div ref={messagesEndRef} />
      </div>

      {/* Input area */}
      <div className="shrink-0 p-3 border-t border-gray-800">
        <div className="flex gap-2">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Type a message..."
            rows={2}
            className="flex-1 bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-sm text-gray-200 placeholder-gray-500 resize-none focus:outline-none focus:border-blue-500 transition-colors"
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || isThinking}
            className="self-end px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}
