import { useState, useCallback, useEffect } from 'react';
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

export function FileTree({ workspace, onBlame }: FileTreeProps) {
  const { setRightPanelTab } = useUiStore();

  const query = trpc.git.readDir.useQuery(
    { dirPath: workspace.worktreePath },
    { staleTime: 10_000 },
  );

  const statusQuery = trpc.git.status.useQuery(
    { repoPath: workspace.worktreePath },
    { staleTime: 5_000, refetchInterval: 10_000 },
  );

  const handleFileClick = useCallback((filePath: string) => {
    // Git diff 패널로 포커스 전환
    setRightPanelTab('git');
  }, [setRightPanelTab]);

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

  if (query.isLoading) {
    return <div className="p-3 text-xs" style={{ color: 'var(--text-muted)' }}>Loading...</div>;
  }

  if (query.isError) {
    return (
      <div className="p-3 text-xs text-red-400 break-all">
        <div className="font-semibold mb-1">Failed to read directory</div>
        <div className="font-mono" style={{ color: 'var(--text-secondary)' }}>{workspace.worktreePath}</div>
        <div className="mt-1 text-red-300">{query.error.message}</div>
      </div>
    );
  }

  const rootEntries = ((query.data as unknown) ?? []) as FsEntry[];

  return (
    <div className="overflow-y-auto h-full py-1">
      <div className="px-2 py-1 text-[10px] truncate" style={{ color: 'var(--text-muted)' }}>
        {workspace.worktreePath}
      </div>
      {rootEntries.length === 0 ? (
        <div className="px-3 py-2 text-xs" style={{ color: 'var(--text-muted)' }}>Empty directory</div>
      ) : (
        rootEntries.map((entry) => (
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
