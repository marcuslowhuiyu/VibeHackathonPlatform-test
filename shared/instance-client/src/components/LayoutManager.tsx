import { useState, useEffect, useCallback, useRef, ReactNode } from 'react';

type LayoutMode = 'full' | 'panel' | 'tabs';

interface LayoutManagerProps {
  chatPanel: ReactNode;
  previewPanel: ReactNode;
  codePanel: ReactNode;
}

function getAutoMode(width: number): LayoutMode {
  if (width > 1200) return 'full';
  if (width >= 768) return 'panel';
  return 'tabs';
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

    // Capture pointer for reliable tracking even outside the element
    handleRef.current?.setPointerCapture(e.pointerId);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, []);

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (!handleRef.current?.hasPointerCapture(e.pointerId)) return;
    const delta = e.clientX - startX.current;
    // Minimum 2px threshold to prevent accidental micro-shifts on click
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
  const [manualMode, setManualMode] = useState<LayoutMode | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [activeTab, setActiveTab] = useState<'chat' | 'preview' | 'code'>('preview');
  const [dropdownOpen, setDropdownOpen] = useState(false);

  // Column widths as percentages [chat, preview, code]
  const [colWidths, setColWidths] = useState<[number, number, number]>([25, 50, 25]);
  // Panel mode split as percentage for left panel
  const [panelSplit, setPanelSplit] = useState(70);

  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleResize = () => setWindowWidth(window.innerWidth);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const autoMode = getAutoMode(windowWidth);
  const mode = manualMode ?? autoMode;

  // Drag handler for the divider between chat and preview (index 0)
  const handleDragLeft = useCallback((deltaX: number) => {
    if (!containerRef.current) return;
    const totalWidth = containerRef.current.offsetWidth;
    const deltaPct = (deltaX / totalWidth) * 100;
    setColWidths(prev => {
      const newChat = Math.max(10, Math.min(60, prev[0] + deltaPct));
      const newPreview = Math.max(10, Math.min(80, prev[1] - deltaPct));
      return [newChat, newPreview, prev[2]];
    });
  }, []);

  // Drag handler for the divider between preview and code (index 1)
  const handleDragRight = useCallback((deltaX: number) => {
    if (!containerRef.current) return;
    const totalWidth = containerRef.current.offsetWidth;
    const deltaPct = (deltaX / totalWidth) * 100;
    setColWidths(prev => {
      const newPreview = Math.max(10, Math.min(80, prev[1] + deltaPct));
      const newCode = Math.max(10, Math.min(60, prev[2] - deltaPct));
      return [prev[0], newPreview, newCode];
    });
  }, []);

  // Drag handler for the panel mode divider
  const handleDragPanel = useCallback((deltaX: number) => {
    if (!containerRef.current) return;
    const totalWidth = containerRef.current.offsetWidth;
    const deltaPct = (deltaX / totalWidth) * 100;
    setPanelSplit(prev => Math.max(30, Math.min(85, prev + deltaPct)));
  }, []);

  const modeLabels: Record<LayoutMode, string> = {
    full: 'Full (3-col)',
    panel: 'Panel (2-col)',
    tabs: 'Tabs',
  };

  const layoutToggle = (
    <div className="fixed top-2 right-2 z-50">
      <button
        onClick={() => setDropdownOpen(!dropdownOpen)}
        className="px-3 py-1.5 text-xs font-medium bg-gray-800 border border-gray-700 text-gray-300 rounded hover:bg-gray-700 transition-colors"
      >
        {modeLabels[mode]} {manualMode ? '(manual)' : '(auto)'}
      </button>
      {dropdownOpen && (
        <div className="absolute right-0 mt-1 bg-gray-800 border border-gray-700 rounded shadow-lg overflow-hidden">
          <button
            onClick={() => { setManualMode(null); setDropdownOpen(false); }}
            className={`block w-full text-left px-4 py-2 text-xs hover:bg-gray-700 ${
              manualMode === null ? 'text-blue-400' : 'text-gray-300'
            }`}
          >
            Auto ({modeLabels[autoMode]})
          </button>
          {(['full', 'panel', 'tabs'] as LayoutMode[]).map((m) => (
            <button
              key={m}
              onClick={() => { setManualMode(m); setDropdownOpen(false); }}
              className={`block w-full text-left px-4 py-2 text-xs hover:bg-gray-700 ${
                manualMode === m ? 'text-blue-400' : 'text-gray-300'
              }`}
            >
              {modeLabels[m]}
            </button>
          ))}
        </div>
      )}
    </div>
  );

  if (mode === 'full') {
    return (
      <div ref={containerRef} className="h-screen w-screen bg-gray-900 text-white">
        {layoutToggle}
        <div className="h-full flex">
          <div className="h-full overflow-hidden" style={{ width: `${colWidths[0]}%` }}>{chatPanel}</div>
          <DragHandle onDrag={handleDragLeft} />
          <div className="h-full overflow-hidden" style={{ width: `${colWidths[1]}%` }}>{previewPanel}</div>
          <DragHandle onDrag={handleDragRight} />
          <div className="h-full overflow-hidden" style={{ width: `${colWidths[2]}%` }}>{codePanel}</div>
        </div>
      </div>
    );
  }

  if (mode === 'panel') {
    return (
      <div ref={containerRef} className="h-screen w-screen bg-gray-900 text-white">
        {layoutToggle}
        <div className="h-full flex">
          <div className="h-full overflow-hidden" style={{ width: sidebarOpen ? `${panelSplit}%` : '100%' }}>
            {previewPanel}
          </div>
          {sidebarOpen && (
            <>
              <DragHandle onDrag={handleDragPanel} />
              <div className="h-full overflow-hidden flex flex-col" style={{ width: `${100 - panelSplit}%` }}>
                <div className="flex border-b border-gray-800">
                  <button
                    onClick={() => setActiveTab('chat')}
                    className={`flex-1 px-3 py-2 text-xs font-medium ${
                      activeTab === 'chat' ? 'text-blue-400 border-b-2 border-blue-400' : 'text-gray-400'
                    }`}
                  >
                    Chat
                  </button>
                  <button
                    onClick={() => setActiveTab('code')}
                    className={`flex-1 px-3 py-2 text-xs font-medium ${
                      activeTab === 'code' ? 'text-blue-400 border-b-2 border-blue-400' : 'text-gray-400'
                    }`}
                  >
                    Code
                  </button>
                </div>
                <div className="flex-1 overflow-hidden">
                  {activeTab === 'chat' ? chatPanel : codePanel}
                </div>
              </div>
            </>
          )}
        </div>
        <button
          onClick={() => setSidebarOpen(!sidebarOpen)}
          className="fixed bottom-4 right-4 z-50 px-3 py-1.5 text-xs font-medium bg-gray-800 border border-gray-700 text-gray-300 rounded hover:bg-gray-700"
        >
          {sidebarOpen ? 'Hide Sidebar' : 'Show Sidebar'}
        </button>
      </div>
    );
  }

  // tabs mode
  const tabs = [
    { key: 'chat' as const, label: 'Chat' },
    { key: 'preview' as const, label: 'Preview' },
    { key: 'code' as const, label: 'Code' },
  ];

  return (
    <div className="h-screen w-screen bg-gray-900 text-white flex flex-col">
      {layoutToggle}
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
