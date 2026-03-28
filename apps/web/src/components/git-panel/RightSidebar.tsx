'use client';

import { useUiStore, type RightPanelTab } from '@/store/uiStore';
import { FileTree } from './FileTree';
import { GitDiffView } from './GitDiffView';
import { CommitPanel } from './CommitPanel';
import { useWorkspaceStore } from '@/store/workspaceStore';

const TABS: { id: RightPanelTab; label: string }[] = [
  { id: 'files', label: 'Files' },
  { id: 'git', label: 'Git' },
  { id: 'commit', label: 'Commit' },
];

export function RightSidebar() {
  const { rightPanelTab, setRightPanelTab } = useUiStore();
  const { workspaces, activeWorkspaceId } = useWorkspaceStore();
  const activeWorkspace = workspaces.find((w) => w.id === activeWorkspaceId);

  return (
    <div className="flex flex-col h-full">
      {/* Tab headers */}
      <div className="flex border-b border-gray-800">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setRightPanelTab(tab.id)}
            className={`flex-1 text-xs py-2 border-b-2 transition-colors ${
              rightPanelTab === tab.id
                ? 'border-blue-500 text-gray-100'
                : 'border-transparent text-gray-500 hover:text-gray-300'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-hidden">
        {!activeWorkspace ? (
          <div className="h-full flex items-center justify-center text-xs text-gray-600 px-4 text-center">
            Select a workspace to view files
          </div>
        ) : rightPanelTab === 'files' ? (
          <FileTree workspace={activeWorkspace} />
        ) : rightPanelTab === 'git' ? (
          <GitDiffView workspace={activeWorkspace} />
        ) : (
          <CommitPanel workspace={activeWorkspace} />
        )}
      </div>
    </div>
  );
}
