import { Component, Suspense, useState, useCallback, useEffect, type ReactNode } from 'react';
import { trpc } from '../../lib/trpc';
import { useUiStore } from '../../store/uiStore';
import type { Workspace } from '@maestro/shared-types';

interface Props {
  workspace: Workspace;
}

interface FsEntry {
  name: string;
  path: string;
  isDir: boolean;
}

type GitStatusMap = Record<string, 'M' | 'A' | 'D' | '?'>;

function statusColor(status: string | undefined): string {
  switch (status) {
    case 'M': return '#e2a94e'; // 수정 — 노란색
    case 'A': return '#73c991'; // 추가 — 초록색
    case 'D': return '#f14c4c'; // 삭제 — 빨간색
    case '?': return '#73c991'; // 미추적 — 초록색
    default: return 'var(--text-secondary)';
  }
}

interface TreeNodeProps {
  entry: FsEntry;
  depth: number;
  statusMap: GitStatusMap;
  repoPath: string;
  onFileClick: (filePath: string) => void;
  onBlame?: (filePath: string) => void;
}

function TreeNode({ entry, depth, statusMap, repoPath, onFileClick, onBlame }: TreeNodeProps) {
  const [children, setChildren] = useState<FsEntry[] | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [shouldFetch, setShouldFetch] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);

  const openFileMutation = trpc.shell.openPath.useMutation();

  const readDirQuery = trpc.git.readDir.useQuery(
    { dirPath: entry.path },
    {
      enabled: shouldFetch && entry.isDir,
      staleTime: 10_000,
    },
  );

  useEffect(() => {
    if (readDirQuery.data !== undefined) {
      setChildren((readDirQuery.data as unknown) as FsEntry[]);
    }
    if (readDirQuery.isError) {
      setChildren([]);
    }
  }, [readDirQuery.data, readDirQuery.isError]);

  const toggle = () => {
    if (!entry.isDir) {
      onFileClick(entry.path);
      return;
    }
    if (!expanded && children === null) setShouldFetch(true);
    setExpanded((e) => !e);
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY });
  };

  const handleOpenExternal = () => {
    openFileMutation.mutate({ filePath: entry.path });
    setContextMenu(null);
  };

  const handleBlame = () => {
    if (onBlame) {
      // 상대 경로로 변환
      const relativePath = entry.path.replace(repoPath + '/', '');
      onBlame(relativePath);
    }
    setContextMenu(null);
  };

  // 상대 경로로 status 찾기
  const relativePath = entry.path.replace(repoPath + '/', '');
  const fileStatus = statusMap[relativePath];

  return (
    <div>
      <button
        onClick={toggle}
        onContextMenu={handleContextMenu}
        className="w-full flex items-center gap-1 py-0.5 text-xs text-left transition-colors hover:bg-[var(--bg-hover)]"
        style={{ paddingLeft: `${8 + depth * 12}px`, color: fileStatus ? statusColor(fileStatus) : (entry.isDir ? 'var(--text-primary)' : 'var(--text-secondary)') }}
      >
        {entry.isDir ? (
          <span className={`transition-transform text-[9px] ${expanded ? 'rotate-90' : ''}`}>▶</span>
        ) : (
          <span className="w-[10px]" />
        )}
        <span className="truncate">{entry.name}</span>
        {fileStatus && !entry.isDir && (
          <span className="ml-auto mr-2 text-[9px] font-mono" style={{ color: statusColor(fileStatus) }}>
            {fileStatus}
          </span>
        )}
      </button>

      {contextMenu && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setContextMenu(null)} />
          <div
            className="fixed z-50 py-1 rounded shadow-lg text-xs min-w-[140px]"
            style={{
              left: contextMenu.x,
              top: contextMenu.y,
              backgroundColor: 'var(--bg-secondary)',
              border: '1px solid var(--border)',
            }}
          >
            <button
              className="w-full px-3 py-1.5 text-left hover:bg-[var(--bg-hover)]"
              style={{ color: 'var(--text-primary)' }}
              onClick={handleOpenExternal}
            >
              IDE로 열기
            </button>
            {!entry.isDir && onBlame && (
              <button
                className="w-full px-3 py-1.5 text-left hover:bg-[var(--bg-hover)]"
                style={{ color: 'var(--text-primary)' }}
                onClick={handleBlame}
              >
                Blame
              </button>
            )}
          </div>
        </>
      )}

      {expanded && children && children.map((child) => (
        <TreeNode
          key={child.path}
          entry={child}
          depth={depth + 1}
          statusMap={statusMap}
          repoPath={repoPath}
          onFileClick={onFileClick}
          onBlame={onBlame}
        />
      ))}
    </div>
  );
}

interface FileTreeProps extends Props {
  onBlame?: (filePath: string) => void;
}

// ── FileTreeContent — useSuspenseQuery 패턴으로 데이터 로드 ──────────────────
// Suspense 경계 안에서 렌더링되므로 isLoading 분기 불필요.

function FileTreeContent({ workspace, onBlame }: FileTreeProps) {
  // useUiStore는 handleFileClick에서 getState()로 직접 접근

  // useSuspenseQuery는 [data, queryResult] 튜플을 반환 — 로딩/에러 분기 불필요
  const [rootEntries] = trpc.git.readDir.useSuspenseQuery(
    { dirPath: workspace.worktreePath },
    { staleTime: 10_000 },
  );

  const statusQuery = trpc.git.status.useQuery(
    { repoPath: workspace.worktreePath },
    { staleTime: 5_000, refetchInterval: 10_000 },
  );

  const handleFileClick = useCallback((filePath: string) => {
    useUiStore.getState().openFileTab(filePath);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // git status를 파일 경로 → 상태 코드 맵으로 변환
  const statusMap: GitStatusMap = {};
  if (statusQuery.data) {
    const s = statusQuery.data as { modified?: string[]; staged?: { path: string }[]; not_added?: string[]; deleted?: string[]; created?: string[] };
    s.modified?.forEach((p) => { statusMap[p] = 'M'; });
    s.staged?.forEach((f) => { statusMap[f.path] = 'A'; });
    s.deleted?.forEach((p) => { statusMap[p] = 'D'; });
    s.not_added?.forEach((p) => { statusMap[p] = '?'; });
    s.created?.forEach((p) => { statusMap[p] = 'A'; });
  }

  const entries = ((rootEntries as unknown as FsEntry[]) ?? []) as FsEntry[];

  return (
    <div className="overflow-y-auto h-full py-1">
      <div className="px-2 py-1 text-[10px] truncate" style={{ color: 'var(--text-muted)' }}>
        {workspace.worktreePath}
      </div>
      {entries.length === 0 ? (
        <div className="px-3 py-2 text-xs" style={{ color: 'var(--text-muted)' }}>Empty directory</div>
      ) : (
        entries.map((entry) => (
          <TreeNode
            key={entry.path}
            entry={entry}
            depth={0}
            statusMap={statusMap}
            repoPath={workspace.worktreePath}
            onFileClick={handleFileClick}
            onBlame={onBlame}
          />
        ))
      )}
    </div>
  );
}

// ── FileTreeErrorFallback ─────────────────────────────────────────────────────

function FileTreeErrorFallback({ worktreePath, error }: { worktreePath: string; error: Error }) {
  return (
    <div className="p-3 text-xs text-red-400 break-all">
      <div className="font-semibold mb-1">Failed to read directory</div>
      <div className="font-mono" style={{ color: 'var(--text-secondary)' }}>{worktreePath}</div>
      <div className="mt-1 text-red-300">{error.message}</div>
    </div>
  );
}

// ── FileTree (public export) — Suspense 경계 포함 ─────────────────────────────

export function FileTree({ workspace, onBlame }: FileTreeProps) {
  return (
    <Suspense
      fallback={
        <div className="p-3 text-xs" style={{ color: 'var(--text-muted)' }}>Loading...</div>
      }
    >
      <FileTreeErrorBoundary worktreePath={workspace.worktreePath}>
        <FileTreeContent workspace={workspace} onBlame={onBlame} />
      </FileTreeErrorBoundary>
    </Suspense>
  );
}

// ── FileTreeErrorBoundary ─────────────────────────────────────────────────────

class FileTreeErrorBoundary extends Component<
  { children: ReactNode; worktreePath: string },
  { error: Error | null }
> {
  state = { error: null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    if (this.state.error) {
      return (
        <FileTreeErrorFallback
          worktreePath={this.props.worktreePath}
          error={this.state.error}
        />
      );
    }
    return this.props.children;
  }
}
