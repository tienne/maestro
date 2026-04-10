/**
 * CommitHistoryView -- F-M1-01 + F-M1-04
 *
 * git log 기반 커밋 히스토리를 표시하고, 커밋 클릭 시 diff 를 보여준다.
 * 우클릭 컨텍스트 메뉴에서 Reset / Revert 를 실행할 수 있다.
 */

import { useState, useRef, useEffect } from 'react';
import { trpc } from '../../lib/trpc';
import type { Workspace } from '@maestro/shared-types';

interface Props {
  workspace: Workspace;
}

interface CommitEntry {
  hash: string;
  shortHash: string;
  message: string;
  author: string;
  date: string;
  refs: string;
  graph: string;
}

interface DiffHunk {
  header: string;
  lines: { type: 'added' | 'removed' | 'context'; content: string }[];
}

type ResetMode = 'soft' | 'mixed' | 'hard';

// -- Reset Dialog ----------------------------------------------------------------

function ResetDialog({
  commit,
  onConfirm,
  onCancel,
  isPending,
}: {
  commit: CommitEntry;
  onConfirm: (mode: ResetMode) => void;
  onCancel: () => void;
  isPending: boolean;
}) {
  const [mode, setMode] = useState<ResetMode>('mixed');

  return (
    <div
      className="fixed inset-0 z-[999] flex items-center justify-center"
      style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}
      onClick={onCancel}
    >
      <div
        className="rounded-lg shadow-xl p-4 w-80"
        style={{ backgroundColor: 'var(--bg-panel)', border: '1px solid var(--border)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-xs font-semibold mb-3" style={{ color: 'var(--text-primary)' }}>
          Reset to {commit.shortHash}
        </h3>
        <p className="text-[11px] mb-3 truncate" style={{ color: 'var(--text-muted)' }}>
          {commit.message}
        </p>

        <div className="flex flex-col gap-1.5 mb-4">
          {(['soft', 'mixed', 'hard'] as const).map((m) => (
            <label
              key={m}
              className="flex items-center gap-2 text-[11px] cursor-pointer px-2 py-1 rounded transition-colors"
              style={{
                backgroundColor: mode === m ? 'var(--bg-active)' : 'transparent',
                color: mode === m ? 'var(--text-primary)' : 'var(--text-secondary)',
              }}
            >
              <input
                type="radio"
                name="reset-mode"
                checked={mode === m}
                onChange={() => setMode(m)}
                style={{ accentColor: 'var(--accent)' }}
              />
              <span className="font-mono font-medium">{m}</span>
              <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
                {m === 'soft' && '-- keep staged changes'}
                {m === 'mixed' && '-- unstage changes'}
                {m === 'hard' && '-- discard all changes'}
              </span>
            </label>
          ))}
        </div>

        {mode === 'hard' && (
          <div
            className="text-[10px] px-2 py-1 rounded mb-3"
            style={{ backgroundColor: 'rgba(239,68,68,0.1)', color: '#f87171' }}
          >
            Warning: --hard will permanently discard uncommitted changes.
          </div>
        )}

        <div className="flex gap-2 justify-end">
          <button
            onClick={onCancel}
            className="px-3 py-1.5 text-xs rounded transition-colors"
            style={{
              backgroundColor: 'var(--bg-secondary)',
              color: 'var(--text-secondary)',
              border: '1px solid var(--border)',
            }}
          >
            Cancel
          </button>
          <button
            onClick={() => onConfirm(mode)}
            disabled={isPending}
            className="px-3 py-1.5 text-xs rounded transition-colors"
            style={{
              backgroundColor: mode === 'hard' ? '#ef4444' : 'var(--accent)',
              color: '#fff',
              opacity: isPending ? 0.5 : 1,
            }}
          >
            {isPending ? 'Resetting...' : `Reset --${mode}`}
          </button>
        </div>
      </div>
    </div>
  );
}

// -- Context Menu ----------------------------------------------------------------

function ContextMenu({
  x,
  y,
  commit,
  onReset,
  onRevert,
  onCherryPick,
  onClose,
}: {
  x: number;
  y: number;
  commit: CommitEntry;
  onReset: (commit: CommitEntry) => void;
  onRevert: (commit: CommitEntry) => void;
  onCherryPick: (commit: CommitEntry) => void;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="fixed z-[998] rounded shadow-lg py-1"
      style={{
        left: x,
        top: y,
        backgroundColor: 'var(--bg-panel)',
        border: '1px solid var(--border)',
        minWidth: '160px',
      }}
    >
      <button
        onClick={() => { onReset(commit); onClose(); }}
        className="w-full text-left px-3 py-1.5 text-xs transition-colors"
        style={{ color: 'var(--text-secondary)' }}
        onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--bg-hover)')}
        onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
      >
        Reset to here...
      </button>
      <button
        onClick={() => { onRevert(commit); onClose(); }}
        className="w-full text-left px-3 py-1.5 text-xs transition-colors"
        style={{ color: 'var(--text-secondary)' }}
        onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--bg-hover)')}
        onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
      >
        Revert this commit
      </button>
      <button
        onClick={() => { onCherryPick(commit); onClose(); }}
        className="w-full text-left px-3 py-1.5 text-xs transition-colors"
        style={{ color: 'var(--text-secondary)' }}
        onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--bg-hover)')}
        onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
      >
        Cherry-pick to current branch
      </button>
    </div>
  );
}

// -- Commit Diff Viewer ----------------------------------------------------------

function CommitDiffViewer({ repoPath, commitHash }: { repoPath: string; commitHash: string }) {
  const { data, isLoading } = trpc.git.showCommit.useQuery(
    { repoPath, commitHash },
    { staleTime: 30_000 },
  );

  if (isLoading) {
    return <div className="p-3 text-xs" style={{ color: 'var(--text-muted)' }}>Loading diff...</div>;
  }

  const hunks = (data?.hunks ?? []) as DiffHunk[];

  if (hunks.length === 0) {
    return <div className="p-3 text-xs" style={{ color: 'var(--text-muted)' }}>No diff available</div>;
  }

  return (
    <div className="font-mono text-[11px] leading-relaxed overflow-auto h-full">
      {hunks.map((hunk, hi) => (
        <div key={hi}>
          <div
            className="px-3 py-0.5 sticky top-0 text-[10px]"
            style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--accent)' }}
          >
            {hunk.header}
          </div>
          {hunk.lines.map((line, li) => (
            <div
              key={li}
              className="px-3 py-px whitespace-pre-wrap break-all"
              style={{
                backgroundColor:
                  line.type === 'added'
                    ? 'rgba(34,197,94,0.1)'
                    : line.type === 'removed'
                      ? 'rgba(239,68,68,0.1)'
                      : 'transparent',
                color:
                  line.type === 'added'
                    ? '#4ade80'
                    : line.type === 'removed'
                      ? '#f87171'
                      : 'var(--text-secondary)',
              }}
            >
              <span className="select-none mr-1 opacity-50">
                {line.type === 'added' ? '+' : line.type === 'removed' ? '-' : ' '}
              </span>
              {line.content}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

// -- Main Component --------------------------------------------------------------

export function CommitHistoryView({ workspace }: Props) {
  const repoPath = workspace.worktreePath;
  const [selectedHash, setSelectedHash] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; commit: CommitEntry } | null>(null);
  const [resetTarget, setResetTarget] = useState<CommitEntry | null>(null);
  const [actionResult, setActionResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [cherryPickConflicts, setCherryPickConflicts] = useState<string[] | null>(null);

  const historyQuery = trpc.git.getHistory.useQuery(
    { repoPath, limit: 50 },
    { staleTime: 10_000 },
  );

  const resetMutation = trpc.git.reset.useMutation({
    onSuccess: () => {
      setActionResult({ ok: true, text: 'Reset successful' });
      setResetTarget(null);
      historyQuery.refetch();
    },
    onError: (e) => setActionResult({ ok: false, text: e.message }),
  });

  const revertMutation = trpc.git.revert.useMutation({
    onSuccess: () => {
      setActionResult({ ok: true, text: 'Revert successful' });
      historyQuery.refetch();
    },
    onError: (e) => setActionResult({ ok: false, text: e.message }),
  });

  // F-M1-07: Cherry-pick
  const cherryPickMutation = trpc.git.cherryPick.useMutation({
    onSuccess: (data) => {
      if (data.success) {
        setActionResult({ ok: true, text: 'Cherry-pick successful' });
        setCherryPickConflicts(null);
        historyQuery.refetch();
      } else {
        setCherryPickConflicts(data.conflicts);
        setActionResult({ ok: false, text: `Cherry-pick has conflicts (${data.conflicts.length} files)` });
      }
    },
    onError: (e) => setActionResult({ ok: false, text: e.message }),
  });

  const cherryPickAbortMutation = trpc.git.cherryPickAbort.useMutation({
    onSuccess: () => {
      setActionResult({ ok: true, text: 'Cherry-pick aborted' });
      setCherryPickConflicts(null);
    },
    onError: (e) => setActionResult({ ok: false, text: e.message }),
  });

  // auto-dismiss result after 4s
  useEffect(() => {
    if (!actionResult) return;
    const t = setTimeout(() => setActionResult(null), 4000);
    return () => clearTimeout(t);
  }, [actionResult]);

  const commits = historyQuery.data ?? [];
  const selectedCommit = commits.find((c) => c.hash === selectedHash);

  const handleContextMenu = (e: React.MouseEvent, commit: CommitEntry) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, commit });
  };

  const handleReset = (commit: CommitEntry) => {
    setResetTarget(commit);
  };

  const handleRevert = (commit: CommitEntry) => {
    revertMutation.mutate({ repoPath, commitHash: commit.hash });
  };

  const handleCherryPick = (commit: CommitEntry) => {
    cherryPickMutation.mutate({ repoPath, commitHash: commit.hash });
  };

  const handleResetConfirm = (mode: ResetMode) => {
    if (!resetTarget) return;
    resetMutation.mutate({ repoPath, commitHash: resetTarget.hash, mode });
  };

  if (historyQuery.isLoading) {
    return <div className="p-3 text-xs" style={{ color: 'var(--text-muted)' }}>Loading history...</div>;
  }

  return (
    <div className="flex flex-col h-full">
      {/* Action result toast */}
      {actionResult && (
        <div
          className="mx-2 mt-2 rounded px-2 py-1 text-[10px] flex-shrink-0"
          style={{
            backgroundColor: actionResult.ok ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)',
            color: actionResult.ok ? '#4ade80' : '#f87171',
          }}
        >
          {actionResult.text}
        </div>
      )}

      {/* Commit list */}
      <div
        className="overflow-y-auto border-b"
        style={{ flex: selectedHash ? '0 0 45%' : '1', borderColor: 'var(--border)' }}
      >
        {commits.length === 0 ? (
          <div className="p-3 text-xs" style={{ color: 'var(--text-muted)' }}>No commits found</div>
        ) : (
          commits.map((commit) => (
            <div
              key={commit.hash}
              onClick={() => setSelectedHash(selectedHash === commit.hash ? null : commit.hash)}
              onContextMenu={(e) => handleContextMenu(e, commit)}
              className="flex items-center gap-2 px-2 py-1.5 cursor-pointer transition-colors"
              style={{
                backgroundColor: selectedHash === commit.hash ? 'var(--bg-active)' : 'transparent',
                color: selectedHash === commit.hash ? 'var(--text-primary)' : 'var(--text-secondary)',
              }}
              onMouseEnter={(e) => {
                if (selectedHash !== commit.hash) e.currentTarget.style.backgroundColor = 'var(--bg-hover)';
              }}
              onMouseLeave={(e) => {
                if (selectedHash !== commit.hash) e.currentTarget.style.backgroundColor = 'transparent';
              }}
            >
              {/* Graph */}
              {commit.graph && (
                <span className="font-mono text-[10px] flex-shrink-0 w-4" style={{ color: 'var(--accent)' }}>
                  {commit.graph.trim()}
                </span>
              )}

              {/* Short hash */}
              <span className="font-mono text-[10px] flex-shrink-0 w-14" style={{ color: 'var(--accent)' }}>
                {commit.shortHash}
              </span>

              {/* Message */}
              <span className="truncate text-[11px] flex-1">{commit.message}</span>

              {/* Refs */}
              {commit.refs && (
                <span
                  className="flex-shrink-0 text-[9px] px-1 rounded"
                  style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--accent)' }}
                >
                  {commit.refs}
                </span>
              )}

              {/* Date */}
              <span className="flex-shrink-0 text-[10px]" style={{ color: 'var(--text-muted)' }}>
                {new Date(commit.date).toLocaleDateString()}
              </span>
            </div>
          ))
        )}
      </div>

      {/* Commit diff */}
      {selectedHash && (
        <>
          <div
            className="flex-shrink-0 px-2 py-1 flex items-center gap-1"
            style={{
              borderBottom: '1px solid var(--border)',
              backgroundColor: 'var(--bg-secondary)',
            }}
          >
            <span className="font-mono text-[10px] truncate flex-1" style={{ color: 'var(--text-secondary)' }}>
              {selectedCommit?.shortHash} {selectedCommit?.message}
            </span>
            <button
              onClick={() => setSelectedHash(null)}
              className="text-[10px] flex-shrink-0"
              style={{ color: 'var(--text-muted)' }}
            >
              ✕
            </button>
          </div>
          <div className="flex-1 overflow-hidden min-h-0">
            <CommitDiffViewer repoPath={repoPath} commitHash={selectedHash} />
          </div>
        </>
      )}

      {/* Cherry-pick conflicts */}
      {cherryPickConflicts && cherryPickConflicts.length > 0 && (
        <div
          className="flex-shrink-0 mx-2 mb-2 p-2 rounded"
          style={{
            backgroundColor: 'rgba(239,68,68,0.08)',
            border: '1px solid rgba(239,68,68,0.2)',
          }}
        >
          <div className="flex items-center justify-between mb-1">
            <span className="text-[10px] font-semibold" style={{ color: '#f87171' }}>
              Cherry-pick Conflicts
            </span>
            <button
              onClick={() => cherryPickAbortMutation.mutate({ repoPath })}
              disabled={cherryPickAbortMutation.isPending}
              className="px-2 py-0.5 text-[9px] rounded"
              style={{
                backgroundColor: 'rgba(239,68,68,0.15)',
                color: '#f87171',
              }}
            >
              {cherryPickAbortMutation.isPending ? '...' : 'Abort'}
            </button>
          </div>
          <div className="flex flex-col gap-0.5">
            {cherryPickConflicts.map((file) => (
              <div
                key={file}
                className="text-[10px] font-mono px-1 py-0.5 rounded"
                style={{
                  backgroundColor: 'rgba(239,68,68,0.05)',
                  color: '#f87171',
                }}
              >
                {file}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Context menu */}
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          commit={contextMenu.commit}
          onReset={handleReset}
          onRevert={handleRevert}
          onCherryPick={handleCherryPick}
          onClose={() => setContextMenu(null)}
        />
      )}

      {/* Reset dialog */}
      {resetTarget && (
        <ResetDialog
          commit={resetTarget}
          onConfirm={handleResetConfirm}
          onCancel={() => setResetTarget(null)}
          isPending={resetMutation.isPending}
        />
      )}
    </div>
  );
}
