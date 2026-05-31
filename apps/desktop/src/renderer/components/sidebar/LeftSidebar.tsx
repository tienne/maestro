import { useState, useMemo, useCallback } from 'react';
import { ChevronRight, Plus, Settings } from 'lucide-react';
import { useNavigate } from '@tanstack/react-router';
import { useRepositoryStore } from '../../store/repositoryStore';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { useSessionStore } from '../../store/sessionStore';
import { useUiStore } from '../../store/uiStore';
import { trpc } from '../../lib/trpc';
import { AddRepositoryModal } from '../modals/AddRepositoryModal';
import { CreateWorkspaceModal } from '../modals/CreateWorkspaceModal';
import { EmptyState } from '../shared/EmptyState';
import { Tooltip } from '../shared/Tooltip';
import { StatusIndicator } from '../shared/StatusIndicator';
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
} from '@dnd-kit/sortable';
import type { Workspace, Repository, IdeType } from '@maestro/shared-types';

const IDE_OPTIONS: { id: IdeType; label: string; shortLabel: string }[] = [
  { id: 'vscode', label: 'VS Code', shortLabel: 'VS' },
  { id: 'cursor', label: 'Cursor', shortLabel: 'Cu' },
  { id: 'webstorm', label: 'WebStorm', shortLabel: 'WS' },
  { id: 'zed', label: 'Zed', shortLabel: 'Zd' },
];

export function LeftSidebar() {
  const navigate = useNavigate();
  const { repositories, removeRepository } = useRepositoryStore();
  const { workspaces, activeWorkspaceId, setActiveWorkspace, removeWorkspace, repoOrder, setRepoOrder } = useWorkspaceStore();
  const { sessions, activeSessionId } = useSessionStore();
  const { openRepoSettings, openSettings } = useUiStore();

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

  // active workspace: workspaceStore.activeWorkspaceId를 1차 소스로,
  // 없으면 activeSession의 workspaceId로 fallback
  const activeSession = sessions.find((s) => s.id === activeSessionId);
  const derivedActiveWorkspaceId = activeWorkspaceId ?? activeSession?.workspaceId ?? null;

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
          onClick: () => void navigate({ to: '/settings/projects/$projectId', params: { projectId: repo.id } }),
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
    <div className="flex flex-col h-full bg-sidebar text-sidebar-foreground">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border">
        <span className="flex items-center gap-2">
          <span className="text-[13px] font-semibold text-foreground">
            Maestro
          </span>
          {totalRunningCount > 0 && (
            <StatusIndicator status="running" size={6} showLabel={false} />
          )}
        </span>
        <Tooltip content="레포지토리 추가">
          <button
            onClick={() => setShowAddRepo(true)}
            className="size-5 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-all"
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            style={{ ...({ WebkitAppRegion: 'no-drag' } as any) }}
            aria-label="레포지토리 추가"
          >
            <Plus size={13} />
          </button>
        </Tooltip>
      </div>

      {/* Repository Tree */}
      <div className="flex-1 overflow-y-auto py-1">
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
                        className="flex items-center gap-2 px-3 py-2 cursor-pointer group hover:bg-accent/40 rounded-md mx-1 transition-colors"
                        onClick={() => toggleRepo(repo.id)}
                        onContextMenu={(e) => openRepoCtxMenu(e, repo)}
                      >
                        <ChevronRight
                          size={10}
                          className={`text-muted-foreground transition-transform shrink-0 ${isExpanded ? 'rotate-90' : ''}`}
                        />
                        <span
                          className="w-2 h-2 rounded-full shrink-0"
                          style={{ backgroundColor: repo.color }}
                        />
                        <span className="text-[13px] font-medium text-foreground truncate flex-1">
                          {repo.name}
                        </span>
                        <button
                          onClick={(e) => { e.stopPropagation(); handleAddWorkspace(repo.id); }}
                          className="opacity-0 group-hover:opacity-100 size-5 flex items-center justify-center rounded hover:bg-accent text-muted-foreground hover:text-foreground transition-all shrink-0"
                          title="New Workspace"
                        >
                          <Plus size={12} />
                        </button>
                      </div>

                      {/* Workspaces */}
                      {isExpanded && (
                        <div>
                          {repoWorkspaces.length === 0 ? (
                            <div className="pl-8 pr-3 py-1.5 text-[11px] text-muted-foreground">
                              No workspaces.{' '}
                              <button
                                onClick={() => handleAddWorkspace(repo.id)}
                                className="text-[var(--accent)] hover:opacity-80 transition-opacity"
                              >
                                Create one
                              </button>
                            </div>
                          ) : (
                            repoWorkspaces.map((ws) => {
                              const isActive = derivedActiveWorkspaceId === ws.id;
                              const wsRunningCount = sessions.filter(
                                (s) => s.workspaceId === ws.id && s.status === 'running'
                              ).length;

                              return (
                                <div key={ws.id}>
                                  {/* Workspace Row */}
                                  <div
                                    className={`relative flex items-center gap-2 pl-7 pr-2 py-1.5 cursor-pointer group rounded-md mx-1 transition-colors ${
                                      isActive
                                        ? 'bg-secondary text-foreground'
                                        : 'hover:bg-accent/40'
                                    }`}
                                    onClick={() => {
                                      setActiveWorkspace(ws.id);
                                      void navigate({ to: '/workspace/$workspaceId', params: { workspaceId: ws.id } });
                                    }}
                                    onContextMenu={(e) => openWorkspaceCtxMenu(e, ws)}
                                  >
                                    {/* 활성 indicator — 왼쪽 accent 바 */}
                                    {isActive && (
                                      <span className="absolute left-0 top-1 bottom-1 w-0.5 rounded-full bg-primary" />
                                    )}
                                    <div className="flex items-center gap-1.5 min-w-0 flex-1">
                                      {wsRunningCount > 0 && (
                                        <StatusIndicator status="running" size={6} />
                                      )}
                                      <span className={`text-[12px] truncate transition-colors ${
                                        isActive
                                          ? 'text-foreground font-medium'
                                          : 'text-muted-foreground/70 group-hover:text-muted-foreground'
                                      }`}>
                                        {ws.name}
                                      </span>
                                    </div>
                                    <span className="text-[10px] font-mono text-muted-foreground/60 truncate hidden group-hover:block shrink-0 max-w-[80px]">
                                      {ws.branch}
                                    </span>
                                    {/* IDE 빠른 열기 버튼 (hover 시) */}
                                    <div className="opacity-0 group-hover:opacity-100 flex items-center gap-0.5 transition-opacity shrink-0">
                                      {IDE_OPTIONS.map((ide) => (
                                        <button
                                          key={ide.id}
                                          onClick={(e) => { e.stopPropagation(); handleOpenInIde(ws, ide.id); }}
                                          className="text-[9px] leading-none px-1 py-0.5 rounded font-medium text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
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
                                        className="text-[9px] leading-none px-1 py-0.5 rounded font-medium text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors disabled:opacity-40"
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
                })}
              </SortableContext>
            </DndContext>
          )}
        </div>

      {/* Footer */}
      <div className="border-t border-border px-3 py-2 flex items-center">
        <Tooltip content="앱 설정">
          <button
            onClick={() => void navigate({ to: '/settings/general' })}
            className="flex items-center gap-1.5 text-[11px] text-muted-foreground hover:text-foreground transition-colors ml-auto"
            aria-label="앱 설정"
          >
            <Settings size={11} />
            Settings
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
