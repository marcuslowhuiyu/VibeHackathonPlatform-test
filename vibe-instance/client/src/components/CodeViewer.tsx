import { useState, useEffect, useRef } from 'react';
import Editor from '@monaco-editor/react';

interface FileEntry {
  path: string;
  content: string;
}

interface FileChange {
  path: string;
  content: string;
}

interface CodeViewerProps {
  files: FileEntry[];
  activeFile: string | null;
  onSelectFile: (path: string) => void;
  fileChange: FileChange | null;
}

function getFileName(path: string): string {
  const parts = path.split('/');
  return parts[parts.length - 1];
}

function getFileIcon(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'ts':
    case 'tsx':
      return '\u{1F1F9}';
    case 'js':
    case 'jsx':
      return '\u{1F1EF}';
    case 'css':
      return '\u{1F3A8}';
    case 'html':
      return '\u{1F310}';
    case 'json':
      return '\u{1F4CB}';
    case 'md':
      return '\u{1F4DD}';
    default:
      return '\u{1F4C4}';
  }
}

function getLanguage(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'ts':
    case 'tsx':
      return 'typescript';
    case 'js':
    case 'jsx':
      return 'javascript';
    case 'css':
      return 'css';
    case 'html':
      return 'html';
    case 'json':
      return 'json';
    case 'md':
      return 'markdown';
    default:
      return 'plaintext';
  }
}

export default function CodeViewer({ files, activeFile, onSelectFile, fileChange }: CodeViewerProps) {
  const [displayContent, setDisplayContent] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const typewriterRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const targetContentRef = useRef('');
  const charIndexRef = useRef(0);

  // Handle fileChange: auto-switch and typewriter effect
  useEffect(() => {
    if (!fileChange) return;

    // Auto-switch to the changed file
    onSelectFile(fileChange.path);

    // Clear any existing typewriter
    if (typewriterRef.current) {
      clearInterval(typewriterRef.current);
    }

    // Start typewriter effect
    targetContentRef.current = fileChange.content;
    charIndexRef.current = 0;
    setDisplayContent('');
    setIsTyping(true);

    typewriterRef.current = setInterval(() => {
      charIndexRef.current += 1;
      const nextContent = targetContentRef.current.slice(0, charIndexRef.current);
      setDisplayContent(nextContent);

      if (charIndexRef.current >= targetContentRef.current.length) {
        if (typewriterRef.current) {
          clearInterval(typewriterRef.current);
          typewriterRef.current = null;
        }
        setIsTyping(false);
      }
    }, 15);

    return () => {
      if (typewriterRef.current) {
        clearInterval(typewriterRef.current);
        typewriterRef.current = null;
      }
    };
  }, [fileChange]);

  // When manually selecting a file (not via typewriter), show full content
  useEffect(() => {
    if (isTyping) return;
    if (!activeFile) {
      setDisplayContent('');
      return;
    }
    const file = files.find((f) => f.path === activeFile);
    if (file) {
      setDisplayContent(file.content);
    }
  }, [activeFile, files, isTyping]);

  const activeLanguage = activeFile ? getLanguage(activeFile) : 'plaintext';

  return (
    <div className="h-full flex bg-gray-900">
      {/* File tree sidebar */}
      <div className="w-48 shrink-0 bg-gray-800 border-r border-gray-700 overflow-y-auto">
        <div className="px-3 py-2 border-b border-gray-700">
          <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Files</h3>
        </div>
        <div className="py-1">
          {files.map((file) => (
            <button
              key={file.path}
              onClick={() => {
                if (isTyping && typewriterRef.current) {
                  clearInterval(typewriterRef.current);
                  typewriterRef.current = null;
                  setIsTyping(false);
                }
                onSelectFile(file.path);
              }}
              className={`w-full text-left px-3 py-1.5 text-xs flex items-center gap-2 hover:bg-gray-700 transition-colors ${
                activeFile === file.path
                  ? 'bg-gray-700 text-blue-400'
                  : 'text-gray-400'
              }`}
              title={file.path}
            >
              <span className="shrink-0">{getFileIcon(file.path)}</span>
              <span className="truncate">{getFileName(file.path)}</span>
            </button>
          ))}
          {files.length === 0 && (
            <p className="px-3 py-4 text-xs text-gray-600 text-center">No files yet</p>
          )}
        </div>
      </div>

      {/* Editor area */}
      <div className="flex-1 overflow-hidden">
        {activeFile ? (
          <Editor
            height="100%"
            language={activeLanguage}
            value={displayContent}
            theme="vs-dark"
            options={{
              readOnly: true,
              minimap: { enabled: false },
              fontSize: 13,
              lineNumbers: 'on',
              scrollBeyondLastLine: false,
              wordWrap: 'on',
              automaticLayout: true,
            }}
          />
        ) : (
          <div className="h-full flex items-center justify-center text-gray-600 text-sm">
            Select a file to view
          </div>
        )}
      </div>
    </div>
  );
}
