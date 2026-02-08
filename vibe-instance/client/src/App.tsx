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
  const { messages, isThinking, prefillMessage, currentFileChange, sendMessage, sendElementClick } =
    useWebSocket();

  const [files, setFiles] = useState<FileEntry[]>([]);
  const [activeFile, setActiveFile] = useState<string | null>(null);

  // Fetch project files on mount
  useEffect(() => {
    fetch('/api/project-files')
      .then((res) => res.json())
      .then((data: FileEntry[]) => {
        setFiles(data);
        if (data.length > 0) {
          setActiveFile(data[0].path);
        }
      })
      .catch(() => {
        // Failed to load project files
      });
  }, []);

  // Derive preview URL: same host, port 3000
  const previewUrl = `${window.location.protocol}//${window.location.hostname}:3000`;

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
