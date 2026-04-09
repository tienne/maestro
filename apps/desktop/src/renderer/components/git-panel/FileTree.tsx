import { useState, useEffect } from 'react';
import { trpc } from '../../lib/trpc';
import type { Workspace } from '@maestro/shared-types';

interface Props {
  workspace: Workspace;
}

interface FsEntry {
  name: string;
  path: string;
  isDir: boolean;
}

interface TreeNodeProps {
  entry: FsEntry;
  depth: number;
}

function TreeNode({ entry, depth }: TreeNodeProps) {
  const [children, setChildren] = useState<FsEntry[] | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [shouldFetch, setShouldFetch] = useState(false);

  const readDirQuery = trpc.git.readDir.useQuery(
    { dirPath: entry.path },
    { enabled: shouldFetch && entry.isDir, staleTime: 10_000 },
  );

  useEffect(() => {
    const d = readDirQuery.data as unknown;
    if (d !== undefined) {
      setChildren(d as FsEntry[]);
    }
    if (readDirQuery.isError) {
      setChildren([]);
    }
  }, [readDirQuery.data, readDirQuery.isError]);

  const toggle = () => {
    if (!entry.isDir) return;
    if (!expanded && children === null) {
      setShouldFetch(true);
    }
    setExpanded((e) => !e);
  };

  return (
    <div>
      <button
        onClick={toggle}
        className="w-full flex items-center gap-1 py-0.5 text-xs text-left transition-colors"
        style={{ paddingLeft: `${8 + depth * 12}px`, color: 'var(--text-secondary)' }}
        onMouseEnter={(e) => {
          e.currentTarget.style.color = 'var(--text-primary)';
          e.currentTarget.style.backgroundColor = 'var(--bg-hover)';
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.color = 'var(--text-secondary)';
          e.currentTarget.style.backgroundColor = 'transparent';
        }}
      >
        {entry.isDir ? (
          <span className={`transition-transform text-[9px] ${expanded ? 'rotate-90' : ''}`}>▶</span>
        ) : (
          <span className="w-[10px]" />
        )}
        <span className={entry.isDir ? 'text-blue-400' : ''}>{entry.name}</span>
      </button>
      {expanded && children && children.map((child) => (
        <TreeNode key={child.path} entry={child} depth={depth + 1} />
      ))}
    </div>
  );
}

export function FileTree({ workspace }: Props) {
  const query = trpc.git.readDir.useQuery(
    { dirPath: workspace.worktreePath },
    { staleTime: 10_000 },
  );

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
      <div className="px-2 py-1 text-[10px] truncate" style={{ color: 'var(--text-muted)' }}>{workspace.worktreePath}</div>
      {rootEntries.length === 0 ? (
        <div className="px-3 py-2 text-xs" style={{ color: 'var(--text-muted)' }}>Empty directory</div>
      ) : (
        rootEntries.map((entry) => (
          <TreeNode key={entry.path} entry={entry} depth={0} />
        ))
      )}
    </div>
  );
}
