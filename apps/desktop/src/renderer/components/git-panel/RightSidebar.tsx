import { useUiStore, type RightPanelTab } from '../../store/uiStore';
import { FileTree } from './FileTree';
import { GitPanel } from './GitPanel';
import { CommitHistoryView } from './CommitHistoryView';
import { MergePanel } from './MergePanel';
import { PortsPanel } from './PortsPanel';
import { BlamePanel } from './BlamePanel';
import { ConfigPreview } from '../shared/ConfigPreview';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { useSessionStore } from '../../store/sessionStore';

const TABS: { id: RightPanelTab; label: string }[] = [
  { id: 'files', label: 'Files' },
  { id: 'git', label: 'Git' },
  { id: 'history', label: 'History' },
  { id: 'merge', label: 'Merge' },
  { id: 'ports', label: 'Ports' },
];

export function RightSidebar() {
  const { rightPanelTab, setRightPanelTab, blameFilePath, openBlame, closeBlame } = useUiStore();
  const { workspaces } = useWorkspaceStore();
  const { sessions, activeSessionId } = useSessionStore();

  // active session → workspace 방향으로 derive
  const activeSession = sessions.find((s) => s.id === activeSessionId);
  const activeWorkspace = workspaces.find((w) => w.id === activeSession?.workspaceId);

  return (
    <div className="flex flex-col h-full">
      {/* Tab headers */}
      <div className="flex border-b" style={{ borderColor: 'var(--border)' }}>
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setRightPanelTab(tab.id)}
            className="flex-1 text-xs py-2 border-b-2 transition-colors"
            style={{
              borderBottomColor: rightPanelTab === tab.id ? 'var(--accent)' : 'transparent',
              color: rightPanelTab === tab.id ? 'var(--text-primary)' : 'var(--text-muted)',
            }}
            onMouseEnter={(e) => {
              if (rightPanelTab !== tab.id) e.currentTarget.style.color = 'var(--text-secondary)';
            }}
            onMouseLeave={(e) => {
              if (rightPanelTab !== tab.id) e.currentTarget.style.color = 'var(--text-muted)';
            }}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-hidden">
        {rightPanelTab === 'ports' ? (
          <PortsPanel />
        ) : !activeWorkspace ? (
          <div className="h-full flex items-center justify-center text-xs px-4 text-center" style={{ color: 'var(--text-muted)' }}>
            Select a workspace to view files
          </div>
        ) : rightPanelTab === 'files' ? (
          blameFilePath ? (
            <BlamePanel
              repoPath={activeWorkspace.worktreePath}
              filePath={blameFilePath}
              onClose={closeBlame}
            />
          ) : (
            <div className="flex flex-col h-full overflow-y-auto">
              <FileTree workspace={activeWorkspace} onBlame={openBlame} />
              <div className="border-t flex-shrink-0" style={{ borderColor: 'var(--border)' }}>
                <ConfigPreview worktreePath={activeWorkspace.worktreePath} />
              </div>
            </div>
          )
        ) : rightPanelTab === 'git' ? (
          <GitPanel workspace={activeWorkspace} />
        ) : rightPanelTab === 'history' ? (
          <CommitHistoryView workspace={activeWorkspace} />
        ) : (
          <MergePanel workspace={activeWorkspace} />
        )}
      </div>
    </div>
  );
}
