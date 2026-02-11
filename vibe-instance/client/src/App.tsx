import { useState, useEffect, useCallback } from 'react';
import { useWebSocket } from './hooks/useWebSocket';
import LayoutManager from './components/LayoutManager';
import ChatPanel from './components/ChatPanel';
import CodeViewer from './components/CodeViewer';
import ElementHighlighter from './components/ElementHighlighter';

interface FileEntry {
  path: string;
  content: string;
}

export default function App() {
  const { messages, isThinking, prefillMessage, currentFileChange, sendMessage, sendElementClick, basePath } =
    useWebSocket();

  const [files, setFiles] = useState<FileEntry[]>([]);
  const [activeFile, setActiveFile] = useState<string | null>(null);
  const [previewRefreshKey, setPreviewRefreshKey] = useState(0);

  // Fetch project files
  const fetchFiles = useCallback(() => {
    fetch(`${basePath}/api/project-files`)
      .then((res) => res.json())
      .then((data: { files?: FileEntry[] }) => {
        const fileList = data.files || [];
        setFiles(fileList);
        if (fileList.length > 0 && !activeFile) {
          setActiveFile(fileList[0].path);
        }
      })
      .catch(() => {
        // Failed to load project files
      });
  }, [basePath, activeFile]);

  // Fetch project files on mount
  useEffect(() => {
    fetchFiles();
  }, [fetchFiles]);

  // When a file changes, re-fetch the file tree and refresh the preview
  useEffect(() => {
    if (currentFileChange) {
      fetchFiles();
      setPreviewRefreshKey((k) => k + 1);
    }
  }, [currentFileChange, fetchFiles]);

  // Preview URL: behind ALB, port 3000 is unreachable. Use the /preview proxy.
  // In local dev (no basePath), use port 3000 directly.
  const previewUrl = basePath
    ? `${window.location.origin}${basePath}/preview`
    : `${window.location.protocol}//${window.location.hostname}:3000`;

  const handleSelectFile = useCallback((path: string) => {
    setActiveFile(path);
  }, []);

  return (
    <LayoutManager
      chatPanel={
        <ChatPanel
          messages={messages}
          prefillMessage={prefillMessage}
          onSendMessage={sendMessage}
          isThinking={isThinking}
        />
      }
      previewPanel={
        <ElementHighlighter
          previewUrl={previewUrl}
          onElementClick={sendElementClick}
          refreshKey={previewRefreshKey}
        />
      }
      codePanel={
        <CodeViewer
          files={files}
          activeFile={activeFile}
          onSelectFile={handleSelectFile}
          fileChange={currentFileChange}
        />
      }
    />
  );
}
