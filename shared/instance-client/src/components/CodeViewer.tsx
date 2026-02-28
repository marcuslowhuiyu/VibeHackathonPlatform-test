import { useState, useMemo } from 'react';
import Editor from '@monaco-editor/react';
import { Search, X, ChevronRight, ChevronDown, Folder } from 'lucide-react';

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

interface TreeNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: TreeNode[];
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

function buildFileTree(files: FileEntry[]): TreeNode[] {
  const root: TreeNode = { name: '', path: '', type: 'directory', children: [] };
  for (const file of files) {
    const parts = file.path.split('/');
    let current = root;
    for (let i = 0; i < parts.length; i++) {
      const isFile = i === parts.length - 1;
      const name = parts[i];
      const path = parts.slice(0, i + 1).join('/');
      let child = current.children!.find((c) => c.name === name);
      if (!child) {
        child = {
          name,
          path,
          type: isFile ? 'file' : 'directory',
          children: isFile ? undefined : [],
        };
        current.children!.push(child);
      }
      if (!isFile) current = child;
    }
  }
  const sortTree = (nodes: TreeNode[]) => {
    nodes.sort((a, b) =>
      a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'directory' ? -1 : 1
    );
    nodes.forEach((n) => n.children && sortTree(n.children));
  };
  sortTree(root.children!);
  return root.children!;
}

function collectAllDirs(nodes: TreeNode[]): Set<string> {
  const dirs = new Set<string>();
  const walk = (list: TreeNode[]) => {
    for (const n of list) {
      if (n.type === 'directory') {
        dirs.add(n.path);
        if (n.children) walk(n.children);
      }
    }
  };
  walk(nodes);
  return dirs;
}

function getMatchingPaths(nodes: TreeNode[], query: string): Set<string> {
  const matches = new Set<string>();
  const lq = query.toLowerCase();
  const walk = (list: TreeNode[]) => {
    for (const n of list) {
      if (n.type === 'file' && n.path.toLowerCase().includes(lq)) {
        matches.add(n.path);
        // Add all parent dirs
        const parts = n.path.split('/');
        for (let i = 1; i < parts.length; i++) {
          matches.add(parts.slice(0, i).join('/'));
        }
      }
      if (n.children) walk(n.children);
    }
  };
  walk(nodes);
  return matches;
}

function TreeRow({
  node,
  depth,
  activeFile,
  onSelectFile,
  expandedDirs,
  toggleDir,
  filterPaths,
}: {
  node: TreeNode;
  depth: number;
  activeFile: string | null;
  onSelectFile: (path: string) => void;
  expandedDirs: Set<string>;
  toggleDir: (path: string) => void;
  filterPaths: Set<string> | null;
}) {
  if (filterPaths && !filterPaths.has(node.path)) return null;

  if (node.type === 'directory') {
    const isExpanded = expandedDirs.has(node.path);
    return (
      <>
        <button
          onClick={() => toggleDir(node.path)}
          className="w-full text-left py-1 text-xs flex items-center gap-1 hover:bg-gray-700 transition-colors text-gray-400"
          style={{ paddingLeft: `${depth * 12 + 8}px` }}
        >
          {isExpanded ? (
            <ChevronDown className="w-3 h-3 shrink-0" />
          ) : (
            <ChevronRight className="w-3 h-3 shrink-0" />
          )}
          <Folder className="w-3.5 h-3.5 shrink-0 text-yellow-500" />
          <span className="truncate">{node.name}</span>
        </button>
        {isExpanded &&
          node.children?.map((child) => (
            <TreeRow
              key={child.path}
              node={child}
              depth={depth + 1}
              activeFile={activeFile}
              onSelectFile={onSelectFile}
              expandedDirs={expandedDirs}
              toggleDir={toggleDir}
              filterPaths={filterPaths}
            />
          ))}
      </>
    );
  }

  return (
    <button
      onClick={() => onSelectFile(node.path)}
      className={`w-full text-left py-1.5 text-xs flex items-center gap-2 hover:bg-gray-700 transition-colors ${
        activeFile === node.path ? 'bg-gray-700 text-blue-400' : 'text-gray-400'
      }`}
      style={{ paddingLeft: `${depth * 12 + 8}px` }}
      title={node.path}
    >
      <span className="shrink-0">{getFileIcon(node.path)}</span>
      <span className="truncate">{node.name}</span>
    </button>
  );
}

export function FileTree({ files, activeFile, onSelectFile }: FileTreeProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(() => new Set<string>());

  const tree = useMemo(() => buildFileTree(files), [files]);

  // Auto-expand all dirs on initial load or when files change
  useMemo(() => {
    setExpandedDirs(collectAllDirs(tree));
  }, [tree]);

  const toggleDir = (path: string) => {
    setExpandedDirs((prev) => {
      const next = new Set(prev);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  };

  const filterPaths = useMemo(() => {
    if (!searchQuery.trim()) return null;
    return getMatchingPaths(tree, searchQuery.trim());
  }, [tree, searchQuery]);

  // When filtering, expand all matching parent dirs
  const effectiveExpanded = useMemo(() => {
    if (!filterPaths) return expandedDirs;
    const expanded = new Set(expandedDirs);
    for (const p of filterPaths) {
      expanded.add(p);
    }
    return expanded;
  }, [expandedDirs, filterPaths]);

  return (
    <div className="h-full bg-gray-800 flex flex-col overflow-hidden">
      <div className="px-3 py-2 border-b border-gray-700">
        <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Files</h3>
      </div>
      <div className="px-2 py-1.5 border-b border-gray-700">
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 w-3 h-3 text-gray-500" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search files..."
            className="w-full bg-gray-900 border border-gray-700 rounded pl-7 pr-7 py-1 text-xs text-gray-300 placeholder-gray-600 focus:outline-none focus:border-blue-500"
          />
          {searchQuery && (
            <button
              onClick={() => setSearchQuery('')}
              className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300"
            >
              <X className="w-3 h-3" />
            </button>
          )}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto py-1">
        {tree.map((node) => (
          <TreeRow
            key={node.path}
            node={node}
            depth={0}
            activeFile={activeFile}
            onSelectFile={onSelectFile}
            expandedDirs={effectiveExpanded}
            toggleDir={toggleDir}
            filterPaths={filterPaths}
          />
        ))}
        {files.length === 0 && (
          <p className="px-3 py-4 text-xs text-gray-600 text-center">No files yet</p>
        )}
        {searchQuery && filterPaths && filterPaths.size === 0 && (
          <p className="px-3 py-4 text-xs text-gray-600 text-center">No matching files</p>
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
