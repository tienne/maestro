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

type DiffViewMode = 'inline' | 'side-by-side';

// ── Side-by-side 라인 페어링 ─────────────────────────────────────────────────

interface SideBySideRow {
  left: DiffLine | null;
  right: DiffLine | null;
}

function buildSideBySideRows(lines: DiffLine[]): SideBySideRow[] {
  const rows: SideBySideRow[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];

    if (line.lineType === 'context') {
      rows.push({ left: line, right: line });
      i++;
      continue;
    }

    // removed 블록과 added 블록을 모아서 나란히 배치
    if (line.lineType === 'removed') {
      const removedBlock: DiffLine[] = [];
      while (i < lines.length && lines[i].lineType === 'removed') {
        removedBlock.push(lines[i]);
        i++;
      }
      const addedBlock: DiffLine[] = [];
      while (i < lines.length && lines[i].lineType === 'added') {
        addedBlock.push(lines[i]);
        i++;
      }

      const maxLen = Math.max(removedBlock.length, addedBlock.length);
      for (let j = 0; j < maxLen; j++) {
        rows.push({
          left: j < removedBlock.length ? removedBlock[j] : null,
          right: j < addedBlock.length ? addedBlock[j] : null,
        });
      }
      continue;
    }

    // added만 단독으로 나오는 경우
    if (line.lineType === 'added') {
      rows.push({ left: null, right: line });
      i++;
      continue;
    }

    i++;
  }

  return rows;
}

// ── Side-by-side 셀 렌더링 ──────────────────────────────────────────────────

function SideBySideCell({ line }: { line: DiffLine | null }) {
  if (!line) {
    return (
      <div
        className="px-2 py-px min-h-[1.375rem]"
        style={{ backgroundColor: 'var(--bg-secondary)', opacity: 0.3 }}
      />
    );
  }

  const isAdded = line.lineType === 'added';
  const isRemoved = line.lineType === 'removed';

  return (
    <div
      className="px-2 py-px whitespace-pre-wrap break-all min-h-[1.375rem]"
      style={{
        backgroundColor: isAdded
          ? 'rgba(34,197,94,0.1)'
          : isRemoved
            ? 'rgba(239,68,68,0.1)'
            : 'transparent',
        color: isAdded
          ? '#4ade80'
          : isRemoved
            ? '#f87171'
            : 'var(--text-secondary)',
      }}
    >
      <span className="select-none mr-1" style={{ opacity: 0.5 }}>
        {isAdded ? '+' : isRemoved ? '-' : ' '}
      </span>
      {line.content}
    </div>
  );
}

// ── 뷰 모드 토글 버튼 ───────────────────────────────────────────────────────

function ViewModeToggle({
  mode,
  onChange,
}: {
  mode: DiffViewMode;
  onChange: (m: DiffViewMode) => void;
}) {
  return (
    <div
      className="flex rounded overflow-hidden"
      style={{ border: '1px solid var(--border)' }}
    >
      {(['inline', 'side-by-side'] as const).map((m) => (
        <button
          key={m}
          onClick={() => onChange(m)}
          className="px-2 py-0.5 text-[10px] transition-colors"
          style={{
            backgroundColor: mode === m ? 'var(--accent)' : 'transparent',
            color: mode === m ? '#fff' : 'var(--text-muted)',
          }}
          onMouseEnter={(e) => {
            if (mode !== m) e.currentTarget.style.backgroundColor = 'var(--bg-hover)';
          }}
          onMouseLeave={(e) => {
            if (mode !== m) e.currentTarget.style.backgroundColor = 'transparent';
          }}
        >
          {m === 'inline' ? 'Inline' : 'Side-by-side'}
        </button>
      ))}
    </div>
  );
}

// ── Inline Diff 렌더링 ──────────────────────────────────────────────────────

function InlineDiff({ hunks }: { hunks: Hunk[] }) {
  return (
    <div className="font-mono text-[11px] leading-relaxed">
      {hunks.map((hunk, hi) => (
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
  );
}

// ── Side-by-side Diff 렌더링 ────────────────────────────────────────────────

function SideBySideDiff({ hunks }: { hunks: Hunk[] }) {
  return (
    <div className="font-mono text-[11px] leading-relaxed">
      {hunks.map((hunk, hi) => {
        const rows = buildSideBySideRows(hunk.lines);
        return (
          <div key={hi}>
            <div
              className="px-3 py-0.5 sticky top-0"
              style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--accent)', fontSize: '10px' }}
            >
              {hunk.header}
            </div>
            {rows.map((row, ri) => (
              <div
                key={ri}
                className="flex"
                style={{ borderBottom: '1px solid var(--border)', borderBottomWidth: '0.5px' }}
              >
                <div className="flex-1 min-w-0 overflow-hidden" style={{ borderRight: '1px solid var(--border)' }}>
                  <SideBySideCell line={row.left} />
                </div>
                <div className="flex-1 min-w-0 overflow-hidden">
                  <SideBySideCell line={row.right} />
                </div>
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}

// ── GitDiffView (main) ──────────────────────────────────────────────────────

export function GitDiffView({ workspace }: Props) {
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<DiffViewMode>('inline');

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

      {/* View mode toggle + Diff content */}
      <div className="flex-1 overflow-hidden flex flex-col min-h-0">
        {selectedFile && selectedFile.hunks.length > 0 && (
          <div
            className="flex items-center justify-end px-3 py-1 flex-shrink-0"
            style={{ borderBottom: '1px solid var(--border)' }}
          >
            <ViewModeToggle mode={viewMode} onChange={setViewMode} />
          </div>
        )}

        <div className="flex-1 overflow-auto min-h-0">
          {!selectedFile ? (
            <div className="h-full flex items-center justify-center text-xs" style={{ color: 'var(--text-muted)' }}>
              Select a file to view diff
            </div>
          ) : selectedFile.hunks.length === 0 ? (
            <div className="p-3 text-xs" style={{ color: 'var(--text-muted)' }}>No diff available</div>
          ) : viewMode === 'inline' ? (
            <InlineDiff hunks={selectedFile.hunks} />
          ) : (
            <SideBySideDiff hunks={selectedFile.hunks} />
          )}
        </div>
      </div>
    </div>
  );
}
