'use client';

import { useEffect, useState } from 'react';
import { fsReadDir, type FsEntry } from '@/lib/tauri';
import type { Workspace } from '@maestro/shared-types';

interface Props {
  workspace: Workspace;
}

interface TreeNodeProps {
  entry: FsEntry;
  depth: number;
}

function TreeNode({ entry, depth }: TreeNodeProps) {
  const [children, setChildren] = useState<FsEntry[] | null>(null);
  const [expanded, setExpanded] = useState(false);

  const toggle = async () => {
    if (!entry.isDir) return;
    if (!expanded && children === null) {
      try {
        const entries = await fsReadDir(entry.path);
        setChildren(entries);
      } catch {
        setChildren([]);
      }
    }
    setExpanded((e) => !e);
  };

  return (
    <div>
      <button
        onClick={toggle}
        className="w-full flex items-center gap-1 px-2 py-0.5 text-xs text-gray-400 hover:text-gray-200 hover:bg-gray-800 text-left"
        style={{ paddingLeft: `${8 + depth * 12}px` }}
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
  const [rootEntries, setRootEntries] = useState<FsEntry[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    fsReadDir(workspace.worktreePath)
      .then(setRootEntries)
      .catch(() => setRootEntries([]))
      .finally(() => setLoading(false));
  }, [workspace.worktreePath]);

  if (loading) {
    return <div className="p-3 text-xs text-gray-600">Loading...</div>;
  }

  return (
    <div className="overflow-y-auto h-full py-1">
      <div className="px-2 py-1 text-[10px] text-gray-600 truncate">{workspace.worktreePath}</div>
      {rootEntries.map((entry) => (
        <TreeNode key={entry.path} entry={entry} depth={0} />
      ))}
    </div>
  );
}
