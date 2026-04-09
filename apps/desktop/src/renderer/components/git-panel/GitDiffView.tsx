import { useState, useEffect } from 'react';
import { trpc } from '../../lib/trpc';
import type { Workspace } from '@maestro/shared-types';

interface Props {
  workspace: Workspace;
}

interface DiffLine {
  lineType: 'added' | 'removed' | 'context';
  content: string;
}

interface Hunk {
  header: string;
  lines: DiffLine[];
}

interface FileDiff {
  path: string;
  hunks: Hunk[];
}

export function GitDiffView({ workspace }: Props) {
  const [selectedPath, setSelectedPath] = useState<string | null>(null);

  const query = trpc.git.getDiff.useQuery(
    { workspacePath: workspace.worktreePath },
    { staleTime: 5_000 },
  );

  useEffect(() => {
    const d = query.data as unknown;
    if (d) {
      const diffs = d as FileDiff[];
      if (diffs.length > 0 && !selectedPath) {
        setSelectedPath(diffs[0].path);
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query.data]);

  const files = ((query.data as unknown) ?? []) as FileDiff[];
  const selectedFile = files.find((f) => f.path === selectedPath) ?? null;

  if (query.isLoading) {
    return <div className="p-3 text-xs" style={{ color: 'var(--text-muted)' }}>Loading...</div>;
  }

  return (
    <div className="flex flex-col h-full">
      {/* File list */}
      <div className="overflow-y-auto border-b" style={{ maxHeight: '40%', borderColor: 'var(--border)' }}>
        {files.length === 0 ? (
          <div className="p-3 text-xs" style={{ color: 'var(--text-muted)' }}>No changes</div>
        ) : (
          files.map((file) => (
            <button
              key={file.path}
              onClick={() => setSelectedPath(file.path)}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left transition-colors"
              style={{
                backgroundColor: selectedPath === file.path ? 'var(--bg-active)' : 'transparent',
                color: selectedPath === file.path ? 'var(--text-primary)' : 'var(--text-secondary)',
              }}
              onMouseEnter={(e) => {
                if (selectedPath !== file.path)
                  e.currentTarget.style.backgroundColor = 'var(--bg-hover)';
              }}
              onMouseLeave={(e) => {
                if (selectedPath !== file.path)
                  e.currentTarget.style.backgroundColor = 'transparent';
              }}
            >
              <span className="flex-shrink-0" style={{ color: 'var(--accent)', fontSize: '10px' }}>M</span>
              <span className="truncate font-mono">{file.path}</span>
              <span className="flex-shrink-0 text-[10px] ml-auto" style={{ color: 'var(--text-muted)' }}>
                {file.hunks.reduce((acc, h) => acc + h.lines.length, 0)}
              </span>
            </button>
          ))
        )}
      </div>

      {/* Diff content */}
      <div className="flex-1 overflow-auto">
        {!selectedFile ? (
          <div className="h-full flex items-center justify-center text-xs" style={{ color: 'var(--text-muted)' }}>
            Select a file to view diff
          </div>
        ) : selectedFile.hunks.length === 0 ? (
          <div className="p-3 text-xs" style={{ color: 'var(--text-muted)' }}>No diff available</div>
        ) : (
          <div className="font-mono text-[11px] leading-relaxed">
            {selectedFile.hunks.map((hunk, hi) => (
              <div key={hi}>
                <div
                  className="px-3 py-0.5 sticky top-0"
                  style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--accent)', fontSize: '10px' }}
                >
                  {hunk.header}
                </div>
                {hunk.lines.map((line, li) => (
                  <div
                    key={li}
                    className="px-3 py-px whitespace-pre-wrap break-all"
                    style={{
                      backgroundColor:
                        line.lineType === 'added'
                          ? 'rgba(34,197,94,0.1)'
                          : line.lineType === 'removed'
                            ? 'rgba(239,68,68,0.1)'
                            : 'transparent',
                      color:
                        line.lineType === 'added'
                          ? '#4ade80'
                          : line.lineType === 'removed'
                            ? '#f87171'
                            : 'var(--text-secondary)',
                    }}
                  >
                    <span className="select-none mr-1" style={{ opacity: 0.5 }}>
                      {line.lineType === 'added' ? '+' : line.lineType === 'removed' ? '-' : ' '}
                    </span>
                    {line.content}
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
