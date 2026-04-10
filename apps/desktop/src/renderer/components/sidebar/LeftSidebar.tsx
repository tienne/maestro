import { useState, useMemo, useCallback } from 'react';
import { useRepositoryStore } from '../../store/repositoryStore';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { useSessionStore } from '../../store/sessionStore';
import { useUiStore } from '../../store/uiStore';
import { trpc } from '../../lib/trpc';
import { AddRepositoryModal } from '../modals/AddRepositoryModal';
import { CreateWorkspaceModal } from '../modals/CreateWorkspaceModal';
import { AgentDashboard } from '../dashboard/AgentDashboard';
import { EmptyState } from '../shared/EmptyState';
import { Tooltip } from '../shared/Tooltip';
import { ContextMenu, type ContextMenuEntry } from './ContextMenu';
import {
  DndContext,
  closestCenter,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import type { Workspace, Repository, IdeType } from '@maestro/shared-types';

type LeftTab = 'repos' | 'dashboard';

const IDE_OPTIONS: { id: IdeType; label: string; shortLabel: string }[] = [
  { id: 'vscode', label: 'VS Code', shortLabel: 'VS' },
  { id: 'cursor', label: 'Cursor', shortLabel: 'Cu' },
  { id: 'webstorm', label: 'WebStorm', shortLabel: 'WS' },
  { id: 'zed', label: 'Zed', shortLabel: 'Zd' },
];

export function LeftSidebar() {
  const { repositories, removeRepository } = useRepositoryStore();
  const { workspaces, removeWorkspace, repoOrder, setRepoOrder } = useWorkspaceStore();
  const { sessions, activeSessionId } = useSessionStore();
  const { openRepoSettings, openSettings } = useUiStore();

  const [leftTab, setLeftTab] = useState<LeftTab>('repos');
  const [expandedRepoIds, setExpandedRepoIds] = useState<Set<string>>(new Set());
  const [showAddRepo, setShowAddRepo] = useState(false);
  const [showCreateWorkspace, setShowCreateWorkspace] = useState(false);
  const [createWorkspaceForRepoId, setCreateWorkspaceForRepoId] = useState<string | null>(null);
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; items: ContextMenuEntry[] } | null>(null);

  // M8-04: DnD 센서
  const dndSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  // M8-04: repoOrder에 따라 정렬된 레포 목록
  const sortedRepositories = useMemo(() => {
    if (repoOrder.length === 0) return repositories;
    const orderMap = new Map(repoOrder.map((id, i) => [id, i]));
    return [...repositories].sort((a, b) => {
      const ai = orderMap.get(a.id) ?? Infinity;
      const bi = orderMap.get(b.id) ?? Infinity;
      return ai - bi;
    });
  }, [repositories, repoOrder]);

  const handleRepoDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;

    const ids = sortedRepositories.map((r) => r.id);
    const oldIndex = ids.indexOf(active.id as string);
    const newIndex = ids.indexOf(over.id as string);
    if (oldIndex === -1 || newIndex === -1) return;

    const newOrder = [...ids];
    newOrder.splice(oldIndex, 1);
    newOrder.splice(newIndex, 0, active.id as string);
    setRepoOrder(newOrder);
  }, [sortedRepositories, setRepoOrder]);

  // active workspace derived from active session
  const activeSession = sessions.find((s) => s.id === activeSessionId);
  const activeWorkspace = workspaces.find((w) => w.id === activeSession?.workspaceId);

  const openInIdeMutation = trpc.workspace.openInIde.useMutation();
  const openPathMutation = trpc.shell.openPath.useMutation();
  const deleteRepoMutation = trpc.repository.delete.useMutation({
    onSuccess: (_, vars) => removeRepository(vars.id),
  });
  const deleteWorkspaceMutation = trpc.workspace.delete.useMutation({
    onSuccess: (_, vars) => removeWorkspace(vars.id),
  });

  const totalRunningCount = useMemo(
    () => sessions.filter((s) => s.status === 'running').length,
    [sessions],
  );

  const toggleRepo = (repoId: string) => {
    setExpandedRepoIds((prev) => {
      const next = new Set(prev);
      if (next.has(repoId)) next.delete(repoId);
      else next.add(repoId);
      return next;
    });
  };

  const handleAddWorkspace = (repoId: string) => {
    setCreateWorkspaceForRepoId(repoId);
    setShowCreateWorkspace(true);
  };

  const handleOpenInIde = (ws: Workspace, ide: IdeType) => {
    openInIdeMutation.mutate(
      { workspaceId: ws.id, ide },
      { onError: (err) => console.error(`Failed to open in ${ide}:`, err.message) },
    );
  };

  const openRepoCtxMenu = useCallback((e: React.MouseEvent, repo: Repository) => {
    e.preventDefault();
    e.stopPropagation();
    setCtxMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        {
          label: 'New Workspace',
          onClick: () => handleAddWorkspace(repo.id),
        },
        { separator: true },
        {
          label: 'Settings',
          onClick: () => openRepoSettings(repo.id),
        },
        {
          label: 'Reveal in Finder',
          onClick: () => openPathMutation.mutate({ filePath: repo.path }),
        },
        { separator: true },
        {
          label: 'Delete Repository',
          danger: true,
          onClick: () => {
            if (window.confirm(`Delete "${repo.name}"?\nAll workspaces and worktrees will be removed.`)) {
              deleteRepoMutation.mutate({ id: repo.id });
            }
          },
        },
      ],
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openWorkspaceCtxMenu = useCallback((e: React.MouseEvent, ws: Workspace) => {
    e.preventDefault();
    e.stopPropagation();
    setCtxMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        {
          label: 'Open in VS Code',
          onClick: () => handleOpenInIde(ws, 'vscode'),
        },
        {
          label: 'Open in Cursor',
          onClick: () => handleOpenInIde(ws, 'cursor'),
        },
        {
          label: 'Open in Zed',
          onClick: () => handleOpenInIde(ws, 'zed'),
        },
        { separator: true },
        {
          label: 'Reveal in Finder',
          onClick: () => openPathMutation.mutate({ filePath: ws.worktreePath }),
        },
        { separator: true },
        {
          label: 'Delete Workspace',
          danger: true,
          onClick: () => {
            if (window.confirm(`Delete "${ws.name}"?\nThe worktree directory will also be removed.`)) {
              deleteWorkspaceMutation.mutate({ id: ws.id });
            }
          },
        },
      ],
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div
        className="flex items-center justify-between px-3 py-2 border-b"
        style={{ borderColor: 'var(--border)' }}
      >
        <span className="flex items-center gap-2">
          <span
            className="text-xs font-semibold uppercase tracking-wider"
            style={{ color: 'var(--text-secondary)' }}
          >
            Maestro
          </span>
          {totalRunningCount > 0 && (
            <span
              className="text-[10px] leading-none px-1.5 py-0.5 rounded-full font-medium"
              style={{ color: '#22c55e', backgroundColor: 'rgba(34, 197, 94, 0.12)' }}
            >
              실행 중 {totalRunningCount}
            </span>
          )}
        </span>
        {leftTab === 'repos' && (
          <Tooltip content="레포지토리 추가">
            <button
              onClick={() => setShowAddRepo(true)}
              className="text-lg leading-none transition-colors"
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              style={{ color: 'var(--text-secondary)', ...({ WebkitAppRegion: 'no-drag' } as any) }}
              onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--text-primary)')}
              onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--text-secondary)')}
              aria-label="레포지토리 추가"
            >
              +
            </button>
          </Tooltip>
        )}
      </div>

      {/* Tabs: Repos | Dashboard */}
      <div className="flex flex-shrink-0 border-b" style={{ borderColor: 'var(--border)' }} role="tablist" aria-label="사이드바 탭">
        {([['repos', 'Repos'], ['dashboard', 'Agents']] as [LeftTab, string][]).map(([tab, label]) => (
          <button
            key={tab}
            onClick={() => setLeftTab(tab)}
            role="tab"
            aria-selected={leftTab === tab}
            className="flex-1 py-1.5 text-[11px] font-medium uppercase tracking-wide transition-colors"
            style={{
              color: leftTab === tab ? 'var(--text-primary)' : 'var(--text-muted)',
              borderBottom: leftTab === tab ? '2px solid var(--accent)' : '2px solid transparent',
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Agent Dashboard tab */}
      {leftTab === 'dashboard' && (
        <div className="flex-1 overflow-hidden min-h-0">
          <AgentDashboard />
        </div>
      )}

      {/* Repository Tree (repos tab only) */}
      {leftTab === 'repos' && <div className="flex-1 overflow-y-auto py-1">
        {repositories.length === 0 ? (
          <EmptyState
            icon="📁"
            title="레포지토리를 추가해보세요"
            description="프로젝트 폴더를 추가하여 시작하세요"
            action={{ label: '+ 추가', onClick: () => setShowAddRepo(true) }}
          />
        ) : (
          <DndContext sensors={dndSensors} collisionDetection={closestCenter} onDragEnd={handleRepoDragEnd}>
          <SortableContext items={sortedRepositories.map((r) => r.id)} strategy={verticalListSortingStrategy}>
          {sortedRepositories.map((repo) => {
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
                  onContextMenu={(e) => openRepoCtxMenu(e, repo)}
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
                        const isActive = activeWorkspace?.id === ws.id;
                        const wsRunningCount = sessions.filter(
                          (s) => s.workspaceId === ws.id && s.status === 'running'
                        ).length;

                        return (
                          <div key={ws.id}>
                            {/* Workspace Row */}
                            <div
                              className="flex items-center gap-1.5 pl-6 pr-2 py-2 cursor-default group transition-colors"
                              style={{ backgroundColor: isActive ? 'var(--bg-active)' : undefined }}
                              onMouseEnter={(e) => { if (!isActive) e.currentTarget.style.backgroundColor = 'var(--bg-hover)'; }}
                              onMouseLeave={(e) => { if (!isActive) e.currentTarget.style.backgroundColor = 'transparent'; }}
                              onContextMenu={(e) => openWorkspaceCtxMenu(e, ws)}
                            >
                              <span
                                className="text-xs truncate flex-1"
                                style={{ color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)' }}
                              >
                                {ws.name}
                              </span>
                              {wsRunningCount > 0 && (
                                <span
                                  className="text-[10px] leading-none px-1.5 py-0.5 rounded-full font-medium flex-shrink-0"
                                  style={{ color: '#22c55e', backgroundColor: 'rgba(34,197,94,0.12)' }}
                                >
                                  ● {wsRunningCount}
                                </span>
                              )}
                              <span
                                className="text-[10px] font-mono opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
                                style={{ color: 'var(--text-muted)' }}
                              >
                                {ws.branch}
                              </span>
                              <div className="opacity-0 group-hover:opacity-100 flex items-center gap-0.5 transition-opacity">
                                {IDE_OPTIONS.map((ide) => (
                                  <button
                                    key={ide.id}
                                    onClick={(e) => { e.stopPropagation(); handleOpenInIde(ws, ide.id); }}
                                    className="text-[9px] leading-none px-1 py-0.5 rounded font-medium transition-colors"
                                    style={{ color: 'var(--text-muted)' }}
                                    onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--text-primary)'; e.currentTarget.style.backgroundColor = 'var(--bg-hover)'; }}
                                    onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-muted)'; e.currentTarget.style.backgroundColor = 'transparent'; }}
                                    title={`Open in ${ide.label}`}
                                  >
                                    {ide.shortLabel}
                                  </button>
                                ))}
                                <button
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    if (window.confirm(`"${ws.name}" 워크스페이스를 삭제하시겠습니까?\n워크트리 디렉토리도 함께 삭제됩니다.`)) {
                                      deleteWorkspaceMutation.mutate({ id: ws.id });
                                    }
                                  }}
                                  disabled={deleteWorkspaceMutation.isPending}
                                  className="text-[9px] leading-none px-1 py-0.5 rounded font-medium transition-colors"
                                  style={{ color: 'var(--text-muted)' }}
                                  onMouseEnter={(e) => { e.currentTarget.style.color = '#f87171'; e.currentTarget.style.backgroundColor = 'rgba(239,68,68,0.1)'; }}
                                  onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--text-muted)'; e.currentTarget.style.backgroundColor = 'transparent'; }}
                                  title="워크스페이스 삭제"
                                >
                                  ✕
                                </button>
                              </div>
                            </div>
                          </div>
                        );
                      })
                    )}
                  </div>
                )}
              </div>
            );
          })
        }
          </SortableContext>
          </DndContext>
        )}
      </div>}

      {/* Footer */}
      <div className="border-t px-3 py-2 flex items-center gap-3" style={{ borderColor: 'var(--border)' }}>
        <Tooltip content="에이전트 설정">
          <button
            onClick={() => openSettings('agents')}
            className="text-xs flex items-center gap-1 transition-colors"
            style={{ color: 'var(--text-secondary)' }}
            onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--text-primary)')}
            onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--text-secondary)')}
            aria-label="에이전트 설정"
          >
            ⚙ Agents
          </button>
        </Tooltip>
        <Tooltip content="MCP 서버 관리">
          <button
            onClick={() => openSettings('mcp')}
            className="text-xs flex items-center gap-1 transition-colors"
            style={{ color: 'var(--text-secondary)' }}
            onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--text-primary)')}
            onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--text-secondary)')}
            aria-label="MCP 서버 관리"
          >
            ⬡ MCP
          </button>
        </Tooltip>
        <Tooltip content="앱 설정">
          <button
            onClick={() => openSettings()}
            className="text-xs flex items-center gap-1 transition-colors ml-auto"
            style={{ color: 'var(--text-secondary)' }}
            onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--text-primary)')}
            onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--text-secondary)')}
            aria-label="앱 설정"
          >
            ⚙ 설정
          </button>
        </Tooltip>
      </div>

      {/* Context Menu */}
      {ctxMenu && (
        <ContextMenu
          x={ctxMenu.x}
          y={ctxMenu.y}
          items={ctxMenu.items}
          onClose={() => setCtxMenu(null)}
        />
      )}

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
    </div>
  );
}
