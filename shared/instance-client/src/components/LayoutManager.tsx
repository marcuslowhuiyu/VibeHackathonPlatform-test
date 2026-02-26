import { useState, useEffect, useCallback, useRef, ReactNode } from 'react';
import { Layout, Model, Actions, TabNode, DockLocation, IJsonModel } from 'flexlayout-react';
import { Code2, RotateCcw } from 'lucide-react';

interface LayoutManagerProps {
  chatPanel: ReactNode;
  previewPanel: ReactNode;
  codePanel: ReactNode;
}

const LAYOUT_STORAGE_KEY = 'flexlayout-model-v1';

const DEFAULT_LAYOUT: IJsonModel = {
  global: {
    splitterSize: 6,
    splitterExtra: 4,
    tabEnableClose: false,
    tabEnableRename: false,
    tabSetEnableMaximize: true,
    tabSetEnableSingleTabStretch: true,
    tabSetEnableTabStrip: true,
  },
  borders: [],
  layout: {
    type: 'row',
    children: [
      {
        type: 'tabset',
        id: 'tabset-chat',
        weight: 25,
        children: [
          { type: 'tab', id: 'tab-chat', name: 'Chat', component: 'chat', enableClose: false },
        ],
      },
      {
        type: 'tabset',
        id: 'tabset-preview',
        weight: 50,
        children: [
          { type: 'tab', id: 'tab-preview', name: 'Preview', component: 'preview', enableClose: false },
        ],
      },
      {
        type: 'tabset',
        id: 'tabset-code',
        weight: 25,
        children: [
          { type: 'tab', id: 'tab-code', name: 'Code', component: 'code', enableClose: true },
        ],
      },
    ],
  },
};

function loadModel(): Model {
  try {
    const saved = localStorage.getItem(LAYOUT_STORAGE_KEY);
    if (saved) {
      const json = JSON.parse(saved) as IJsonModel;
      return Model.fromJson(json);
    }
  } catch {
    // fall through to default
  }
  return Model.fromJson(DEFAULT_LAYOUT);
}

function saveModel(model: Model) {
  try {
    localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(model.toJson()));
  } catch {
    // ignore storage errors
  }
}

export default function LayoutManager({ chatPanel, previewPanel, codePanel }: LayoutManagerProps) {
  const [windowWidth, setWindowWidth] = useState(window.innerWidth);
  const [activeTab, setActiveTab] = useState<'chat' | 'preview' | 'code'>('chat');
  const [model] = useState(loadModel);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [codeTabExists, setCodeTabExists] = useState(() => !!model.getNodeById('tab-code'));

  useEffect(() => {
    const handleResize = () => setWindowWidth(window.innerWidth);
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const isMobile = windowWidth < 768;

  const factory = useCallback((node: TabNode) => {
    const component = node.getComponent();
    switch (component) {
      case 'chat':
        return chatPanel;
      case 'preview':
        return previewPanel;
      case 'code':
        return codePanel;
      default:
        return <div>Unknown: {component}</div>;
    }
  }, [chatPanel, previewPanel, codePanel]);

  const onModelChange = useCallback(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => saveModel(model), 500);
    setCodeTabExists(!!model.getNodeById('tab-code'));
  }, [model]);

  useEffect(() => {
    return () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    };
  }, []);

  const toggleCode = useCallback(() => {
    const existing = model.getNodeById('tab-code');
    if (existing) {
      model.doAction(Actions.deleteTab('tab-code'));
    } else {
      // Add code tab to the right of the preview tabset
      const targetTabset = model.getNodeById('tabset-preview') || model.getNodeById('tabset-chat');
      if (targetTabset) {
        model.doAction(
          Actions.addNode(
            { type: 'tab', id: 'tab-code', name: 'Code', component: 'code', enableClose: true },
            targetTabset.getId(),
            DockLocation.RIGHT,
            -1,
            true
          )
        );
      }
    }
    setCodeTabExists(!!model.getNodeById('tab-code'));
  }, [model]);

  const resetLayout = useCallback(() => {
    localStorage.removeItem(LAYOUT_STORAGE_KEY);
    window.location.reload();
  }, []);

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

  return (
    <div className="h-screen w-screen bg-gray-900 text-white relative">
      <div className="fixed top-2 right-2 z-50 flex gap-1">
        <button
          onClick={resetLayout}
          className="p-2 rounded-md border bg-gray-800 border-gray-700 text-gray-400 hover:text-gray-200 hover:bg-gray-700 transition-colors"
          title="Reset layout"
        >
          <RotateCcw className="w-4 h-4" />
        </button>
        <button
          onClick={toggleCode}
          className={`p-2 rounded-md border transition-colors ${
            codeTabExists
              ? 'bg-blue-600 border-blue-500 text-white'
              : 'bg-gray-800 border-gray-700 text-gray-400 hover:text-gray-200 hover:bg-gray-700'
          }`}
          title={codeTabExists ? 'Hide code panel' : 'Show code panel'}
        >
          <Code2 className="w-4 h-4" />
        </button>
      </div>
      <Layout
        model={model}
        factory={factory}
        onModelChange={onModelChange}
        realtimeResize={true}
      />
    </div>
  );
}
