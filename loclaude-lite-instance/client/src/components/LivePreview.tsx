import { useRef, useState } from 'react';

interface LivePreviewProps {
  previewUrl?: string;
}

function getDefaultPreviewUrl(): string {
  const { protocol, hostname } = window.location;
  return `${protocol}//${hostname}:3000`;
}

export default function LivePreview({ previewUrl }: LivePreviewProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [currentPath, setCurrentPath] = useState('/');
  const resolvedUrl = previewUrl || getDefaultPreviewUrl();

  const handleRefresh = () => {
    if (iframeRef.current) {
      iframeRef.current.src = resolvedUrl + currentPath;
    }
  };

  const handleLoad = () => {
    try {
      const iframeSrc = iframeRef.current?.contentWindow?.location?.pathname;
      if (iframeSrc) {
        setCurrentPath(iframeSrc);
      }
    } catch {
      // Cross-origin access may be blocked; ignore
    }
  };

  return (
    <div className="h-full flex flex-col bg-gray-900">
      {/* Toolbar */}
      <div className="h-10 shrink-0 bg-gray-800 border-b border-gray-700 flex items-center px-3 gap-3">
        <button
          onClick={handleRefresh}
          className="px-2 py-1 text-xs font-medium text-gray-300 bg-gray-700 rounded hover:bg-gray-600 transition-colors"
          title="Refresh preview"
        >
          Refresh
        </button>
        <span className="text-xs text-gray-500 truncate flex-1">{resolvedUrl}{currentPath === '/' ? '' : currentPath}</span>
      </div>

      {/* Iframe */}
      <div className="flex-1 overflow-hidden">
        <iframe
          ref={iframeRef}
          src={resolvedUrl}
          onLoad={handleLoad}
          className="w-full h-full bg-white border-none"
          title="Live Preview"
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
        />
      </div>
    </div>
  );
}
