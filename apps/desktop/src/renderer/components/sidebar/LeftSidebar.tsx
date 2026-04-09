import { useState } from 'react';
import { useRepositoryStore } from '../../store/repositoryStore';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { useSessionStore } from '../../store/sessionStore';
import { useUiStore } from '../../store/uiStore';
import { trpc } from '../../lib/trpc';
import { AddRepositoryModal } from '../modals/AddRepositoryModal';
import { CreateWorkspaceModal } from '../modals/CreateWorkspaceModal';
import { CreateSessionModal } from '../modals/CreateSessionModal';
import { AgentSettingsModal } from '../modals/AgentSettingsModal';
import { SettingsModal } from '../modals/SettingsModal';
import { MCPServersModal } from '../modals/MCPServersModal';
import { GitPanel } from '../git-panel/GitPanel';
import type { Workspace } from '@maestro/shared-types';

type LeftTab = 'repos' | 'git';

const SESSION_STATUS_COLORS: Record<string, string> = {
  pending: 'bg-yellow-500 animate-pulse',
  running: 'bg-green-400 animate-pulse',
  stopped: 'bg-gray-500',
  error: 'bg-red-400',
};

export function LeftSidebar() {
  const { repositories } = useRepositoryStore();
  const { workspaces } = useWorkspaceStore();
  const { sessions, setActiveSession, activeSessionId } = useSessionStore();
  const { openRepoSettings, setCurrentView, setPaneSession, activePaneIndex } = useUiStore();

  const [leftTab, setLeftTab] = useState<LeftTab>('repos');
  const [expandedRepoIds, setExpandedRepoIds] = useState<Set<string>>(new Set());
  const [expandedWorkspaceIds, setExpandedWorkspaceIds] = useState<Set<string>>(new Set());
  const [showAddRepo, setShowAddRepo] = useState(false);
  const [showCreateWorkspace, setShowCreateWorkspace] = useState(false);
  const [createWorkspaceForRepoId, setCreateWorkspaceForRepoId] = useState<string | null>(null);
  const [showCreateSession, setShowCreateSession] = useState(false);
  const [sessionWorkspace, setSessionWorkspace] = useState<Workspace | null>(null);
  const [showAgentSettings, setShowAgentSettings] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showMcpServers, setShowMcpServers] = useState(false);

  // active workspace derived from active session
  const activeSession = sessions.find((s) => s.id === activeSessionId);
  const activeWorkspace = workspaces.find((w) => w.id === activeSession?.workspaceId);

  const setLastActiveMutation = trpc.session.setLastActive.useMutation();

  const toggleRepo = (repoId: string) => {
    setExpandedRepoIds((prev) => {
      const next = new Set(prev);
      if (next.has(repoId)) next.delete(repoId);
      else next.add(repoId);
      return next;
    });
  };

  const toggleWorkspace = (wsId: string) => {
    setExpandedWorkspaceIds((prev) => {
      const next = new Set(prev);
      if (next.has(wsId)) next.delete(wsId);
      else next.add(wsId);
      return next;
    });
  };

  const handleWorkspaceClick = (ws: Workspace) => {
    const wsSessions = sessions.filter((s) => s.workspaceId === ws.id);
    const runningSession = wsSessions.find((s) => s.status === 'running');

    if (runningSession) {
      setActiveSession(runningSession.id);
      setPaneSession(activePaneIndex, runningSession.id);
      setCurrentView('terminal');
      if (!expandedWorkspaceIds.has(ws.id)) toggleWorkspace(ws.id);
    } else {
      if (!expandedWorkspaceIds.has(ws.id)) toggleWorkspace(ws.id);
      handleAddSession(ws);
    }
  };

  const handleSessionClick = (sessionId: string) => {
    setActiveSession(sessionId);
    setPaneSession(activePaneIndex, sessionId);
    setCurrentView('terminal');
    setLastActiveMutation.mutate({ sessionId });
  };

  const handleAddWorkspace = (repoId: string) => {
    setCreateWorkspaceForRepoId(repoId);
    setShowCreateWorkspace(true);
  };

  const handleAddSession = (ws: Workspace) => {
    setSessionWorkspace(ws);
    setShowCreateSession(true);
  };

  return (
    <div className="flex flex-col h-full">
      {/* Titlebar drag region — macOS hiddenInset 신호등 버튼 영역 확보 */}
      {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
      <div
        className="flex-shrink-0"
        style={{ height: '28px', ...({ WebkitAppRegion: 'drag' } as any) }}
      />

      {/* Header */}
      <div
        className="flex items-center justify-between px-3 py-2 border-b"
        style={{ borderColor: 'var(--border)' }}
      >
        <span
          className="text-xs font-semibold uppercase tracking-wider"
          style={{ color: 'var(--text-secondary)' }}
        >
          Maestro
        </span>
        {leftTab === 'repos' && (
          <button
            onClick={() => setShowAddRepo(true)}
            className="text-lg leading-none transition-colors"
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            style={{ color: 'var(--text-secondary)', ...({ WebkitAppRegion: 'no-drag' } as any) }}
            onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--text-primary)')}
            onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--text-secondary)')}
            title="Add Repository"
          >
            +
          </button>
        )}
      </div>

      {/* Tabs: Repos | Git */}
      <div className="flex flex-shrink-0 border-b" style={{ borderColor: 'var(--border)' }}>
        {(['repos', 'git'] as LeftTab[]).map((tab) => (
          <button
            key={tab}
            onClick={() => setLeftTab(tab)}
            className="flex-1 py-1.5 text-[11px] font-medium uppercase tracking-wide transition-colors"
            style={{
              color: leftTab === tab ? 'var(--text-primary)' : 'var(--text-muted)',
              borderBottom: leftTab === tab ? '2px solid var(--accent)' : '2px solid transparent',
            }}
          >
            {tab === 'repos' ? 'Repos' : 'Git'}
          </button>
        ))}
      </div>

      {/* Git tab content */}
      {leftTab === 'git' && (
        <div className="flex-1 overflow-hidden min-h-0">
          {activeWorkspace ? (
            <GitPanel workspace={activeWorkspace} />
          ) : (
            <div className="h-full flex items-center justify-center px-4 text-center">
              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                세션을 선택하면 Git 패널이 표시됩니다
              </span>
            </div>
          )}
        </div>
      )}

      {/* Repository Tree (repos tab only) */}
      {leftTab === 'repos' && <div className="flex-1 overflow-y-auto py-1">
        {repositories.length === 0 ? (
          <div className="px-3 py-6 text-xs text-center" style={{ color: 'var(--text-muted)' }}>
            No repositories yet.
            <br />
            Click <span style={{ color: 'var(--text-secondary)' }}>+</span> to add one.
          </div>
        ) : (
          repositories.map((repo) => {
            const repoWorkspaces = workspaces.filter((w) => w.repositoryId === repo.id);
            const isExpanded = expandedRepoIds.has(repo.id);

            return (
              <div key={repo.id}>
                {/* Repository Header */}
                <div
                  className="flex items-center gap-1.5 px-2 py-2 cursor-pointer group transition-colors"
                  style={{ color: 'var(--text-primary)' }}
                  onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--bg-hover)')}
                  onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                  onClick={() => toggleRepo(repo.id)}
                >
                  <span
                    className={`text-[10px] transition-transform flex-shrink-0 ${isExpanded ? 'rotate-90' : ''}`}
                    style={{ color: 'var(--text-muted)' }}
                  >
                    ▶
                  </span>
                  <span
                    className="w-2 h-2 rounded-full flex-shrink-0"
                    style={{ backgroundColor: repo.color }}
                  />
                  <span
                    className="text-xs truncate flex-1 font-medium"
                    style={{ color: 'var(--text-primary)' }}
                  >
                    {repo.name}
                  </span>
                  <div className="opacity-0 group-hover:opacity-100 flex items-center gap-0.5 transition-opacity">
                    <button
                      onClick={(e) => { e.stopPropagation(); handleAddWorkspace(repo.id); }}
                      className="text-sm leading-none px-1.5 py-1 rounded transition-colors"
                      style={{ color: 'var(--text-secondary)' }}
                      onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-primary)'; e.currentTarget.style.backgroundColor = 'var(--bg-hover)'; }}
                      onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-secondary)'; e.currentTarget.style.backgroundColor = 'transparent'; }}
                      title="New Workspace"
                    >
                      +
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); openRepoSettings(repo.id); }}
                      className="text-sm leading-none px-1.5 py-1 rounded transition-colors"
                      style={{ color: 'var(--text-secondary)' }}
                      onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-primary)'; e.currentTarget.style.backgroundColor = 'var(--bg-hover)'; }}
                      onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-secondary)'; e.currentTarget.style.backgroundColor = 'transparent'; }}
                      title="Repository Settings"
                    >
                      ⚙
                    </button>
                  </div>
                </div>

                {/* Workspaces */}
                {isExpanded && (
                  <div>
                    {repoWorkspaces.length === 0 ? (
                      <div className="pl-8 pr-3 py-1.5 text-[11px]" style={{ color: 'var(--text-muted)' }}>
                        No workspaces.{' '}
                        <button
                          onClick={() => handleAddWorkspace(repo.id)}
                          style={{ color: 'var(--accent)' }}
                        >
                          Create one
                        </button>
                      </div>
                    ) : (
                      repoWorkspaces.map((ws) => {
                        const wsSessions = sessions.filter((s) => s.workspaceId === ws.id);
                        const isWsExpanded = expandedWorkspaceIds.has(ws.id);

                        return (
                          <div key={ws.id}>
                            {/* Workspace Row */}
                            <div
                              className="flex items-center gap-1.5 pl-6 pr-2 py-2 cursor-pointer group transition-colors"
                              onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--bg-hover)')}
                              onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                              onClick={() => handleWorkspaceClick(ws)}
                            >
                              <span
                                className={`text-[9px] transition-transform flex-shrink-0 ${isWsExpanded ? 'rotate-90' : ''}`}
                                style={{ color: 'var(--text-muted)' }}
                              >
                                ▶
                              </span>
                              <span
                                className="text-xs truncate flex-1"
                                style={{ color: 'var(--text-secondary)' }}
                              >
                                {ws.name}
                              </span>
                              {wsSessions.length > 0 && (
                                <div className="flex items-center gap-0.5 flex-shrink-0">
                                  {wsSessions.map((s) => (
                                    <span
                                      key={s.id}
                                      className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${SESSION_STATUS_COLORS[s.status] ?? 'bg-gray-500'}`}
                                    />
                                  ))}
                                </div>
                              )}
                              <span
                                className="text-[10px] font-mono opacity-0 group-hover:opacity-100 transition-opacity"
                                style={{ color: 'var(--text-muted)' }}
                              >
                                {ws.branch}
                              </span>
                              <button
                                onClick={(e) => { e.stopPropagation(); handleAddSession(ws); }}
                                className="opacity-0 group-hover:opacity-100 text-sm leading-none px-1.5 py-1 rounded transition-all"
                                style={{ color: 'var(--text-secondary)' }}
                                onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-primary)'; e.currentTarget.style.backgroundColor = 'var(--bg-hover)'; }}
                                onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-secondary)'; e.currentTarget.style.backgroundColor = 'transparent'; }}
                                title="New Session"
                              >
                                +
                              </button>
                            </div>

                            {/* Sessions */}
                            {isWsExpanded && wsSessions.map((session) => (
                              <button
                                key={session.id}
                                onClick={() => handleSessionClick(session.id)}
                                className="w-full flex items-center gap-2 pl-10 pr-3 py-1 text-left text-xs transition-colors"
                                style={{ color: 'var(--text-secondary)' }}
                                onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--bg-hover)'; e.currentTarget.style.color = 'var(--text-primary)'; }}
                                onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.color = 'var(--text-secondary)'; }}
                              >
                                <span
                                  className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${SESSION_STATUS_COLORS[session.status] ?? 'bg-gray-500'}`}
                                />
                                <span className="truncate">{session.name}</span>
                              </button>
                            ))}
                          </div>
                        );
                      })
                    )}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>}

      {/* Footer */}
      <div className="border-t px-3 py-2 flex items-center gap-3" style={{ borderColor: 'var(--border)' }}>
        <button
          onClick={() => setShowAgentSettings(true)}
          className="text-xs flex items-center gap-1 transition-colors"
          style={{ color: 'var(--text-secondary)' }}
          onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--text-primary)')}
          onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--text-secondary)')}
        >
          ⚙ Agents
        </button>
        <button
          onClick={() => setShowMcpServers(true)}
          className="text-xs flex items-center gap-1 transition-colors"
          style={{ color: 'var(--text-secondary)' }}
          onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--text-primary)')}
          onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--text-secondary)')}
          title="MCP Servers"
        >
          ⬡ MCP
        </button>
        <button
          onClick={() => setShowSettings(true)}
          className="text-xs flex items-center gap-1 transition-colors ml-auto"
          style={{ color: 'var(--text-secondary)' }}
          onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--text-primary)')}
          onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--text-secondary)')}
          title="Settings"
        >
          ⚙ 설정
        </button>
      </div>

      {/* Modals */}
      {showAddRepo && (
        <AddRepositoryModal onClose={() => setShowAddRepo(false)} />
      )}
      {showCreateWorkspace && createWorkspaceForRepoId && (
        <CreateWorkspaceModal
          repositoryId={createWorkspaceForRepoId}
          onClose={() => { setShowCreateWorkspace(false); setCreateWorkspaceForRepoId(null); }}
        />
      )}
      {showCreateSession && sessionWorkspace && (
        <CreateSessionModal
          workspace={sessionWorkspace}
          onClose={() => { setShowCreateSession(false); setSessionWorkspace(null); }}
        />
      )}
      {showAgentSettings && (
        <AgentSettingsModal onClose={() => setShowAgentSettings(false)} />
      )}
      {showMcpServers && (
        <MCPServersModal onClose={() => setShowMcpServers(false)} />
      )}
      {showSettings && (
        <SettingsModal onClose={() => setShowSettings(false)} />
      )}
    </div>
  );
}
