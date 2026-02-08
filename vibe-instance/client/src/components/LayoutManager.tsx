import { useState, useEffect, ReactNode } from 'react';

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

export default function LayoutManager({ chatPanel, previewPanel, codePanel }: LayoutManagerProps) {
  const [windowWidth, setWindowWidth] = useState(window.innerWidth);
  const [manualMode, setManualMode] = useState<LayoutMode | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [activeTab, setActiveTab] = useState<'chat' | 'preview' | 'code'>('preview');
  const [dropdownOpen, setDropdownOpen] = useState(false);

  useEffect(() => {
    const handleResize = () => setWindowWidth(window.innerWidth);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const autoMode = getAutoMode(windowWidth);
  const mode = manualMode ?? autoMode;

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
      <div className="h-screen w-screen bg-gray-900 text-white">
        {layoutToggle}
        <div className="h-full grid" style={{ gridTemplateColumns: '25% 50% 25%' }}>
          <div className="h-full border-r border-gray-800 overflow-hidden">{chatPanel}</div>
          <div className="h-full border-r border-gray-800 overflow-hidden">{previewPanel}</div>
          <div className="h-full overflow-hidden">{codePanel}</div>
        </div>
      </div>
    );
  }

  if (mode === 'panel') {
    return (
      <div className="h-screen w-screen bg-gray-900 text-white">
        {layoutToggle}
        <div
          className="h-full grid"
          style={{
            gridTemplateColumns: sidebarOpen ? '70% 30%' : '100%',
          }}
        >
          <div className="h-full border-r border-gray-800 overflow-hidden">{previewPanel}</div>
          {sidebarOpen && (
            <div className="h-full overflow-hidden flex flex-col">
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
