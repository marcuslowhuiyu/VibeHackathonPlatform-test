import { useState, useEffect } from 'react';
import Editor from '@monaco-editor/react';

interface FileEntry {
  path: string;
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
  basePath: string;
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

export default function CodeViewer({ files, activeFile, onSelectFile, fileChange, basePath }: CodeViewerProps) {
  const [displayContent, setDisplayContent] = useState('');

  // Handle fileChange: auto-switch and show content immediately
  useEffect(() => {
    if (!fileChange) return;

    // Auto-switch to the changed file
    onSelectFile(fileChange.path);

    // Show content immediately from the event
    if (fileChange.content) {
      setDisplayContent(fileChange.content);
    }
  }, [fileChange]);

  // When activeFile changes, fetch its content on demand
  useEffect(() => {
    if (!activeFile) {
      setDisplayContent('');
      return;
    }
    // If the fileChange just set content for this file, skip the fetch
    if (fileChange?.path === activeFile && fileChange?.content) {
      return;
    }
    fetch(`${basePath}/api/file/${activeFile}`)
      .then(res => res.json())
      .then(data => {
        if (data.content) {
          setDisplayContent(data.content);
        }
      })
      .catch(() => {
        setDisplayContent('// Failed to load file');
      });
  }, [activeFile, basePath]);

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
              onClick={() => onSelectFile(file.path)}
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
