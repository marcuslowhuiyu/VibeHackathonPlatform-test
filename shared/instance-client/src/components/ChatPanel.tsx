import { useState, useEffect, useRef } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { RotateCcw, Square, Copy, Check } from 'lucide-react';

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
  onResetConversation: () => void;
  onCancelResponse: () => void;
  isThinking: boolean;
  thinkingText: string;
  isConnected: boolean;
  toasts: Array<{ id: number; type: 'info' | 'warning' | 'error' | 'success'; message: string }>;
  dismissToast: (id: number) => void;
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

function ThinkingIndicator({ text }: { text: string }) {
  const [dots, setDots] = useState('');
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const interval = setInterval(() => {
      setDots((prev) => (prev.length >= 3 ? '' : prev + '.'));
    }, 400);
    return () => clearInterval(interval);
  }, []);

  // Auto-scroll the thinking text
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [text]);

  return (
    <div className="px-4 py-3">
      <div className="flex items-start gap-3">
        <div className="w-7 h-7 rounded-full bg-purple-600 shrink-0 flex items-center justify-center">
          <span className="text-xs font-bold text-white">A</span>
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-gray-400 text-sm">
            Thinking<span className="inline-block w-6 text-left">{dots}</span>
          </div>
          {text && (
            <div
              ref={scrollRef}
              className="mt-2 text-xs text-gray-500 italic whitespace-pre-wrap break-words max-h-32 overflow-y-auto bg-gray-800/50 rounded p-2 border border-gray-800"
            >
              {text}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function CodeBlock({ children }: { children: string }) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(children);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };
  return (
    <div className="relative group">
      <button
        onClick={copy}
        className="absolute right-2 top-2 p-1 rounded bg-gray-700 text-gray-400 hover:text-gray-200 opacity-0 group-hover:opacity-100 transition-opacity"
        title={copied ? 'Copied!' : 'Copy code'}
      >
        {copied ? <Check className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5" />}
      </button>
      <code className="block bg-gray-800 border border-gray-700 rounded-md p-3 text-xs font-mono text-gray-300 overflow-x-auto whitespace-pre">
        {children}
      </code>
    </div>
  );
}

/* eslint-disable @typescript-eslint/no-explicit-any */
const markdownComponents: Record<string, any> = {
  p: ({ children }: any) => <p className="my-1 text-sm text-gray-200">{children}</p>,
  h1: ({ children }: any) => <h1 className="text-lg font-bold text-gray-100 mt-3 mb-1">{children}</h1>,
  h2: ({ children }: any) => <h2 className="text-base font-bold text-gray-100 mt-3 mb-1">{children}</h2>,
  h3: ({ children }: any) => <h3 className="text-sm font-bold text-gray-100 mt-2 mb-1">{children}</h3>,
  ul: ({ children }: any) => <ul className="list-disc list-inside my-1 space-y-0.5 text-sm text-gray-200">{children}</ul>,
  ol: ({ children }: any) => <ol className="list-decimal list-inside my-1 space-y-0.5 text-sm text-gray-200">{children}</ol>,
  li: ({ children }: any) => <li className="text-sm">{children}</li>,
  a: ({ href, children }: any) => (
    <a href={href} target="_blank" rel="noopener noreferrer" className="text-blue-400 underline hover:text-blue-300">{children}</a>
  ),
  code: ({ className, children, ...props }: any) => {
    const isBlock = className?.includes('language-');
    if (isBlock) {
      const text = String(children).replace(/\n$/, '');
      return <CodeBlock>{text}</CodeBlock>;
    }
    return <code className="bg-gray-800 text-blue-300 px-1 py-0.5 rounded text-xs font-mono" {...props}>{children}</code>;
  },
  pre: ({ children }: any) => <pre className="my-2">{children}</pre>,
  blockquote: ({ children }: any) => (
    <blockquote className="border-l-2 border-gray-600 pl-3 my-2 text-gray-400 italic">{children}</blockquote>
  ),
  strong: ({ children }: any) => <strong className="font-bold text-gray-100">{children}</strong>,
  em: ({ children }: any) => <em className="italic">{children}</em>,
  hr: () => <hr className="border-gray-700 my-3" />,
  table: ({ children }: any) => (
    <div className="overflow-x-auto my-2"><table className="text-xs border-collapse border border-gray-700">{children}</table></div>
  ),
  th: ({ children }: any) => <th className="border border-gray-700 bg-gray-800 px-2 py-1 text-left text-gray-300 font-medium">{children}</th>,
  td: ({ children }: any) => <td className="border border-gray-700 px-2 py-1 text-gray-400">{children}</td>,
};
/* eslint-enable @typescript-eslint/no-explicit-any */

function MarkdownContent({ content }: { content: string }) {
  return (
    <div className="text-sm text-gray-200 break-words">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
        {content}
      </ReactMarkdown>
    </div>
  );
}

export default function ChatPanel({ messages, prefillMessage, onSendMessage, onResetConversation, onCancelResponse, isThinking, thinkingText, isConnected, toasts, dismissToast }: ChatPanelProps) {
  const [input, setInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-scroll to bottom when messages change
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isThinking, thinkingText]);

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
    <div className="h-full flex flex-col bg-gray-900 relative">
      {!isConnected && (
        <div className="shrink-0 px-4 py-2 bg-yellow-900/50 border-b border-yellow-700 text-yellow-300 text-xs text-center animate-pulse">
          Reconnecting...
        </div>
      )}
      {/* Header */}
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
                {msg.role === 'user' || msg.isError ? (
                  <p className={`text-sm whitespace-pre-wrap break-words ${msg.isError ? 'text-red-400' : 'text-gray-200'}`}>{msg.content}</p>
                ) : (
                  <MarkdownContent content={msg.content} />
                )}
                {msg.toolCalls?.map((tool, tIdx) => (
                  <ToolCallCard key={tIdx} tool={tool} />
                ))}
              </div>
            </div>
          </div>
        ))}
        {isThinking && <ThinkingIndicator text={thinkingText} />}
        <div ref={messagesEndRef} />
      </div>

      {toasts.length > 0 && (
        <div className="absolute bottom-20 right-3 z-40 flex flex-col gap-2 max-w-xs">
          {toasts.map((toast) => (
            <div
              key={toast.id}
              onClick={() => dismissToast(toast.id)}
              className={`px-3 py-2 rounded-lg text-xs cursor-pointer shadow-lg border ${
                toast.type === 'info' ? 'bg-blue-900/80 border-blue-700 text-blue-200' :
                toast.type === 'warning' ? 'bg-yellow-900/80 border-yellow-700 text-yellow-200' :
                toast.type === 'error' ? 'bg-red-900/80 border-red-700 text-red-200' :
                'bg-green-900/80 border-green-700 text-green-200'
              }`}
            >
              {toast.message}
            </div>
          ))}
        </div>
      )}

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
        </div>
      </div>
    </div>
  );
}
