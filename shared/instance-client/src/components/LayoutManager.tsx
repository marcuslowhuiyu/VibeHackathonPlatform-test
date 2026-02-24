import { useState, useEffect, useCallback, useRef, ReactNode } from 'react';
import { Code2 } from 'lucide-react';

interface LayoutManagerProps {
  chatPanel: ReactNode;
  previewPanel: ReactNode;
  codePanel: ReactNode;
}

function DragHandle({ onDrag }: { onDrag: (deltaX: number) => void }) {
  const handleRef = useRef<HTMLDivElement>(null);
  const startX = useRef(0);
  const hasMoved = useRef(false);

  const onPointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    startX.current = e.clientX;
    hasMoved.current = false;
    handleRef.current?.setPointerCapture(e.pointerId);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!handleRef.current?.hasPointerCapture(e.pointerId)) return;
    const delta = e.clientX - startX.current;
    if (!hasMoved.current && Math.abs(delta) < 2) return;
    hasMoved.current = true;
    startX.current = e.clientX;
    onDrag(delta);
  }, [onDrag]);

  const onPointerUp = useCallback((e: React.PointerEvent) => {
    handleRef.current?.releasePointerCapture(e.pointerId);
    document.body.style.cursor = '';
    document.body.style.userSelect = '';
  }, []);

  return (
    <div
      ref={handleRef}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      className="w-1.5 shrink-0 cursor-col-resize bg-gray-800 hover:bg-blue-500 transition-colors relative group touch-none"
      title="Drag to resize"
    >
      <div className="absolute inset-y-0 -left-1.5 -right-1.5" />
    </div>
  );
}

export default function LayoutManager({ chatPanel, previewPanel, codePanel }: LayoutManagerProps) {
  const [windowWidth, setWindowWidth] = useState(window.innerWidth);
  const [codeOpen, setCodeOpen] = useState(() => {
    try { return localStorage.getItem('codePanel') === 'open'; } catch { return false; }
  });
  const [activeTab, setActiveTab] = useState<'chat' | 'preview' | 'code'>('chat');

  const [twoColWidths, setTwoColWidths] = useState<[number, number]>([30, 70]);
  const [threeColWidths, setThreeColWidths] = useState<[number, number, number]>([25, 50, 25]);

  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleResize = () => setWindowWidth(window.innerWidth);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    try { localStorage.setItem('codePanel', codeOpen ? 'open' : 'closed'); } catch {}
  }, [codeOpen]);

  const isMobile = windowWidth < 768;

  const handleDrag2Col = useCallback((deltaX: number) => {
    if (!containerRef.current) return;
    const pct = (deltaX / containerRef.current.offsetWidth) * 100;
    setTwoColWidths(prev => [
      Math.max(15, Math.min(50, prev[0] + pct)),
      Math.max(30, Math.min(85, prev[1] - pct)),
    ]);
  }, []);

  const handleDrag3Left = useCallback((deltaX: number) => {
    if (!containerRef.current) return;
    const pct = (deltaX / containerRef.current.offsetWidth) * 100;
    setThreeColWidths(prev => [
      Math.max(10, Math.min(40, prev[0] + pct)),
      Math.max(20, Math.min(70, prev[1] - pct)),
      prev[2],
    ]);
  }, []);

  const handleDrag3Right = useCallback((deltaX: number) => {
    if (!containerRef.current) return;
    const pct = (deltaX / containerRef.current.offsetWidth) * 100;
    setThreeColWidths(prev => [
      prev[0],
      Math.max(20, Math.min(70, prev[1] + pct)),
      Math.max(10, Math.min(40, prev[2] - pct)),
    ]);
  }, []);

  const codeToggle = !isMobile && (
    <button
      onClick={() => setCodeOpen(prev => !prev)}
      className={`fixed top-2 right-2 z-50 p-2 rounded-md border transition-colors ${
        codeOpen
          ? 'bg-blue-600 border-blue-500 text-white'
          : 'bg-gray-800 border-gray-700 text-gray-400 hover:text-gray-200 hover:bg-gray-700'
      }`}
      title={codeOpen ? 'Hide code panel' : 'Show code panel'}
    >
      <Code2 className="w-4 h-4" />
    </button>
  );

  if (isMobile) {
    const tabs = [
      { key: 'chat' as const, label: 'Chat' },
      { key: 'preview' as const, label: 'Preview' },
      { key: 'code' as const, label: 'Code' },
    ];
    return (
      <div className="h-screen w-screen bg-gray-900 text-white flex flex-col">
        <div className="flex border-b border-gray-800 shrink-0">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`flex-1 px-4 py-2.5 text-sm font-medium transition-colors ${
                activeTab === tab.key
                  ? 'text-blue-400 border-b-2 border-blue-400 bg-gray-800/50'
                  : 'text-gray-400 hover:text-gray-300'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
        <div className="flex-1 overflow-hidden">
          {activeTab === 'chat' && chatPanel}
          {activeTab === 'preview' && previewPanel}
          {activeTab === 'code' && codePanel}
        </div>
      </div>
    );
  }

  if (codeOpen) {
    return (
      <div ref={containerRef} className="h-screen w-screen bg-gray-900 text-white">
        {codeToggle}
        <div className="h-full flex">
          <div className="h-full overflow-hidden" style={{ width: `${threeColWidths[0]}%` }}>{chatPanel}</div>
          <DragHandle onDrag={handleDrag3Left} />
          <div className="h-full overflow-hidden" style={{ width: `${threeColWidths[1]}%` }}>{previewPanel}</div>
          <DragHandle onDrag={handleDrag3Right} />
          <div className="h-full overflow-hidden" style={{ width: `${threeColWidths[2]}%` }}>{codePanel}</div>
        </div>
      </div>
    );
  }

  return (
    <div ref={containerRef} className="h-screen w-screen bg-gray-900 text-white">
      {codeToggle}
      <div className="h-full flex">
        <div className="h-full overflow-hidden" style={{ width: `${twoColWidths[0]}%` }}>{chatPanel}</div>
        <DragHandle onDrag={handleDrag2Col} />
        <div className="h-full overflow-hidden" style={{ width: `${twoColWidths[1]}%` }}>{previewPanel}</div>
      </div>
    </div>
  );
}
