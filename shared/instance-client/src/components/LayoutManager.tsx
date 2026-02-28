import { useState, useEffect, useCallback, useRef, ReactNode } from 'react';
import { Layout, Model, Actions, TabNode, DockLocation, IJsonModel } from 'flexlayout-react';
import { Code2, LayoutGrid } from 'lucide-react';

interface LayoutManagerProps {
  chatPanel: ReactNode;
  previewPanel: ReactNode;
  fileTreePanel: ReactNode;
  codeEditorPanel: ReactNode;
}

const LAYOUT_STORAGE_KEY = 'flexlayout-model-v2';

const GLOBAL_CONFIG: IJsonModel['global'] = {
  splitterSize: 6,
  splitterExtra: 4,
  tabEnableClose: false,
  tabEnableRename: false,
  tabSetEnableMaximize: true,
  tabSetEnableSingleTabStretch: true,
  tabSetEnableTabStrip: true,
};

interface PresetLayout {
  name: string;
  description: string;
  layout: IJsonModel;
}

const PRESET_LAYOUTS: Record<string, PresetLayout> = {
  default: {
    name: 'Default',
    description: 'Chat, Preview, Files & Code',
    layout: {
      global: GLOBAL_CONFIG,
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
            weight: 40,
            children: [
              { type: 'tab', id: 'tab-preview', name: 'Preview', component: 'preview', enableClose: false },
            ],
          },
          {
            type: 'tabset',
            id: 'tabset-files',
            weight: 10,
            children: [
              { type: 'tab', id: 'tab-files', name: 'Files', component: 'files', enableClose: true },
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
    },
  },
  previewFocus: {
    name: 'Preview Focus',
    description: 'Maximize preview, hide code',
    layout: {
      global: GLOBAL_CONFIG,
      borders: [],
      layout: {
        type: 'row',
        children: [
          {
            type: 'tabset',
            id: 'tabset-chat',
            weight: 30,
            children: [
              { type: 'tab', id: 'tab-chat', name: 'Chat', component: 'chat', enableClose: false },
            ],
          },
          {
            type: 'tabset',
            id: 'tabset-preview',
            weight: 70,
            children: [
              { type: 'tab', id: 'tab-preview', name: 'Preview', component: 'preview', enableClose: false },
            ],
          },
        ],
      },
    },
  },
  codeFocus: {
    name: 'Code Focus',
    description: 'Larger code panels for editing',
    layout: {
      global: GLOBAL_CONFIG,
      borders: [],
      layout: {
        type: 'row',
        children: [
          {
            type: 'tabset',
            id: 'tabset-chat',
            weight: 20,
            children: [
              { type: 'tab', id: 'tab-chat', name: 'Chat', component: 'chat', enableClose: false },
            ],
          },
          {
            type: 'tabset',
            id: 'tabset-files',
            weight: 10,
            children: [
              { type: 'tab', id: 'tab-files', name: 'Files', component: 'files', enableClose: true },
            ],
          },
          {
            type: 'tabset',
            id: 'tabset-code',
            weight: 40,
            children: [
              { type: 'tab', id: 'tab-code', name: 'Code', component: 'code', enableClose: true },
            ],
          },
          {
            type: 'tabset',
            id: 'tabset-preview',
            weight: 30,
            children: [
              { type: 'tab', id: 'tab-preview', name: 'Preview', component: 'preview', enableClose: false },
            ],
          },
        ],
      },
    },
  },
  presentation: {
    name: 'Presentation',
    description: 'Full-screen preview for demos',
    layout: {
      global: GLOBAL_CONFIG,
      borders: [],
      layout: {
        type: 'row',
        children: [
          {
            type: 'tabset',
            id: 'tabset-preview',
            weight: 100,
            children: [
              { type: 'tab', id: 'tab-preview', name: 'Preview', component: 'preview', enableClose: false },
            ],
          },
        ],
      },
    },
  },
};

const DEFAULT_LAYOUT = PRESET_LAYOUTS.default.layout;

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

export default function LayoutManager({ chatPanel, previewPanel, fileTreePanel, codeEditorPanel }: LayoutManagerProps) {
  const [windowWidth, setWindowWidth] = useState(window.innerWidth);
  const [activeTab, setActiveTab] = useState<'chat' | 'preview' | 'code'>('chat');
  const [model] = useState(loadModel);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [codeTabExists, setCodeTabExists] = useState(() => !!model.getNodeById('tab-code'));
  const [showPresets, setShowPresets] = useState(false);
  const presetsRef = useRef<HTMLDivElement>(null);

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
      case 'files':
        return fileTreePanel;
      case 'code':
        return codeEditorPanel;
      default:
        return <div>Unknown: {component}</div>;
    }
  }, [chatPanel, previewPanel, fileTreePanel, codeEditorPanel]);

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
    const codeExists = model.getNodeById('tab-code');
    const filesExists = model.getNodeById('tab-files');

    if (codeExists) {
      // Remove both tabs
      model.doAction(Actions.deleteTab('tab-code'));
      if (filesExists) {
        model.doAction(Actions.deleteTab('tab-files'));
      }
    } else {
      // Add both tabs to the right of the preview tabset
      const targetTabset = model.getNodeById('tabset-preview') || model.getNodeById('tabset-chat');
      if (targetTabset) {
        model.doAction(
          Actions.addNode(
            { type: 'tab', id: 'tab-files', name: 'Files', component: 'files', enableClose: true },
            targetTabset.getId(),
            DockLocation.RIGHT,
            -1,
            true
          )
        );
        // Add code tab to the right of the newly created files tabset
        const filesTabset = model.getNodeById('tab-files')?.getParent();
        if (filesTabset) {
          model.doAction(
            Actions.addNode(
              { type: 'tab', id: 'tab-code', name: 'Code', component: 'code', enableClose: true },
              filesTabset.getId(),
              DockLocation.RIGHT,
              -1,
              true
            )
          );
        }
      }
    }
    setCodeTabExists(!!model.getNodeById('tab-code'));
  }, [model]);

  const applyPreset = useCallback((key: string) => {
    const preset = PRESET_LAYOUTS[key];
    if (!preset) return;
    localStorage.setItem(LAYOUT_STORAGE_KEY, JSON.stringify(preset.layout));
    window.location.reload();
  }, []);

  useEffect(() => {
    if (!showPresets) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (presetsRef.current && !presetsRef.current.contains(e.target as Node)) {
        setShowPresets(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [showPresets]);

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
          {activeTab === 'code' && (
            <div className="h-full flex">
              <div className="w-48 shrink-0">{fileTreePanel}</div>
              <div className="flex-1 overflow-hidden">{codeEditorPanel}</div>
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen w-screen bg-gray-900 text-white relative">
      <div className="fixed top-2 right-2 z-50 flex gap-1">
        <div ref={presetsRef} className="relative">
          <button
            onClick={() => setShowPresets((v) => !v)}
            className="p-2 rounded-md border bg-gray-800 border-gray-700 text-gray-400 hover:text-gray-200 hover:bg-gray-700 transition-colors"
            title="Layout presets"
          >
            <LayoutGrid className="w-4 h-4" />
          </button>
          {showPresets && (
            <div className="absolute right-0 top-full mt-1 w-56 rounded-md border border-gray-700 bg-gray-800 shadow-lg py-1">
              {Object.entries(PRESET_LAYOUTS).map(([key, preset]) => (
                <button
                  key={key}
                  onClick={() => applyPreset(key)}
                  className="w-full text-left px-3 py-2 hover:bg-gray-700 transition-colors"
                >
                  <div className="text-sm text-gray-200">{preset.name}</div>
                  <div className="text-xs text-gray-500">{preset.description}</div>
                </button>
              ))}
            </div>
          )}
        </div>
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
