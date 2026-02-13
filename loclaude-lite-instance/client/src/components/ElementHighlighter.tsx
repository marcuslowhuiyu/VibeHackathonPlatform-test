import { useEffect, useRef } from 'react';

interface ElementInfo {
  tagName: string;
  textContent: string;
  selector: string;
}

interface ElementHighlighterProps {
  previewUrl: string;
  onElementClick: (info: ElementInfo) => void;
  refreshKey?: number;
  basePath: string;
}

export default function ElementHighlighter({ previewUrl, onElementClick, refreshKey, basePath }: ElementHighlighterProps) {
  const iframeRef = useRef<HTMLIFrameElement>(null);

  // Reload the iframe when refreshKey changes (file was modified by agent)
  useEffect(() => {
    if (refreshKey && iframeRef.current) {
      iframeRef.current.src = iframeRef.current.src;
    }
  }, [refreshKey]);

  // Listen for postMessage events from the injected script
  useEffect(() => {
    const handleMessage = (event: MessageEvent) => {
      if (event.data && event.data.type === 'element_click') {
        onElementClick({
          tagName: event.data.tagName,
          textContent: event.data.textContent,
          selector: event.data.selector,
        });
      }
    };

    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, [onElementClick]);

  // Inject the highlighter script on iframe load
  const handleIframeLoad = async () => {
    const iframe = iframeRef.current;
    if (!iframe) return;

    try {
      const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
      if (!iframeDoc) return;

      // Fetch the highlighter inject script
      const response = await fetch(`${basePath}/highlighter-inject.js`);
      const scriptText = await response.text();

      // Create and inject script element
      const script = iframeDoc.createElement('script');
      script.textContent = scriptText;
      iframeDoc.body.appendChild(script);
    } catch {
      // Cross-origin or fetch error; script injection not possible
      console.warn('Could not inject highlighter script into iframe');
    }
  };

  return (
    <div className="h-full flex flex-col bg-gray-900">
      <div className="h-10 shrink-0 bg-gray-800 border-b border-gray-700 flex items-center px-3 gap-3">
        <span className="text-xs text-blue-400 font-medium">Element Inspector</span>
        <span className="text-xs text-gray-500">Alt+Click to select an element</span>
      </div>
      <div className="flex-1 overflow-hidden">
        <iframe
          ref={iframeRef}
          src={previewUrl}
          onLoad={handleIframeLoad}
          className="w-full h-full bg-white border-none"
          title="Element Highlighter Preview"
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
        />
      </div>
    </div>
  );
}
