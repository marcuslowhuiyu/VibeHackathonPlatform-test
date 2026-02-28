import Editor from '@monaco-editor/react';

interface FileEntry {
  path: string;
}

interface FileTreeProps {
  files: FileEntry[];
  activeFile: string | null;
  onSelectFile: (path: string) => void;
}

interface CodeEditorProps {
  activeFile: string | null;
  displayContent: string;
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

export function FileTree({ files, activeFile, onSelectFile }: FileTreeProps) {
  return (
    <div className="h-full bg-gray-800 overflow-y-auto">
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
  );
}

export function CodeEditor({ activeFile, displayContent }: CodeEditorProps) {
  const activeLanguage = activeFile ? getLanguage(activeFile) : 'plaintext';

  return (
    <div className="h-full bg-gray-900">
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
  );
}
