/**
 * GitPanel — 완전한 Git 워크플로우 패널
 *
 * 포함 기능:
 * - Branch 선택기 (현재 브랜치 표시 + 전환)
 * - staged/unstaged 파일 트리 (체크박스 stage 토글)
 * - 파일 선택 시 diff 하이라이팅
 * - Commit 메시지 입력 + 커밋 버튼
 * - Push/Pull 버튼
 *
 * Superset Warm Dark 테마 CSS 변수 사용.
 */

import { useState, useEffect, useRef } from 'react';
import { trpc } from '../../lib/trpc';
import { StashPanel } from './StashPanel';
import { TagPanel } from './TagPanel';
import { SquashPanel } from './SquashPanel';
import type { Workspace } from '@maestro/shared-types';

interface Props {
  workspace: Workspace;
}

// ── 타입 ─────────────────────────────────────────────────────────────────────

interface DiffHunk {
  header: string;
  oldStart?: number;
  newStart?: number;
  lines: { type: 'add' | 'added' | 'remove' | 'removed' | 'context'; content: string }[];
}

// ── BranchSelector (F-M1-03: ahead/behind 카운터 추가) ─────────────────────

function BranchSelector({ repoPath }: { repoPath: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const branchQuery = trpc.git.branches.useQuery({ repoPath }, { staleTime: 10_000 });
  const branchStatusQuery = trpc.git.getBranchStatus.useQuery({ repoPath }, { staleTime: 15_000 });
  const checkoutMutation = trpc.git.checkout.useMutation({
    onSuccess: () => { setOpen(false); branchQuery.refetch(); branchStatusQuery.refetch(); },
  });

  const current = branchQuery.data?.current ?? '...';
  const branches = branchQuery.data?.branches ?? [];
  const ahead = branchStatusQuery.data?.ahead ?? 0;
  const behind = branchStatusQuery.data?.behind ?? 0;

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-1.5 w-full px-3 py-1.5 text-xs rounded transition-colors"
        style={{
          backgroundColor: 'var(--bg-secondary)',
          color: 'var(--text-secondary)',
          border: '1px solid var(--border)',
        }}
        onMouseEnter={(e) => (e.currentTarget.style.borderColor = 'var(--accent)')}
        onMouseLeave={(e) => (e.currentTarget.style.borderColor = 'var(--border)')}
      >
        <span style={{ color: 'var(--accent)' }}>⎇</span>
        <span className="truncate flex-1 text-left font-mono" style={{ color: 'var(--text-primary)' }}>
          {current}
        </span>
        {/* F-M1-03: ahead/behind counter */}
        {(ahead > 0 || behind > 0) && (
          <span className="flex-shrink-0 text-[10px] font-mono" style={{ color: 'var(--text-muted)' }}>
            {ahead > 0 && <span style={{ color: '#4ade80' }}>↑{ahead}</span>}
            {ahead > 0 && behind > 0 && ' '}
            {behind > 0 && <span style={{ color: '#f87171' }}>↓{behind}</span>}
          </span>
        )}
        <span style={{ opacity: 0.5 }}>▾</span>
      </button>

      {open && branches.length > 0 && (
        <div
          className="absolute top-full left-0 right-0 z-50 rounded shadow-lg overflow-y-auto mt-0.5"
          style={{
            backgroundColor: 'var(--bg-panel)',
            border: '1px solid var(--border)',
            maxHeight: '180px',
          }}
        >
          {branches.map((b) => (
            <button
              key={b.name}
              onClick={() => checkoutMutation.mutate({ repoPath, branch: b.name })}
              disabled={b.name === current}
              className="w-full flex items-center gap-2 px-3 py-1.5 text-xs text-left transition-colors"
              style={{
                color: b.name === current ? 'var(--accent)' : 'var(--text-secondary)',
                opacity: checkoutMutation.isPending ? 0.5 : 1,
              }}
              onMouseEnter={(e) => { if (b.name !== current) e.currentTarget.style.backgroundColor = 'var(--bg-hover)'; }}
              onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
            >
              {b.name === current && <span style={{ color: 'var(--accent)' }}>✓</span>}
              <span className="truncate font-mono">{b.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── DiffViewer ────────────────────────────────────────────────────────────────

function DiffViewer({ repoPath, filePath, staged }: { repoPath: string; filePath: string; staged: boolean }) {
  const { data, isLoading } = trpc.git.fileDiff.useQuery(
    { repoPath, filePath, staged },
    { staleTime: 3_000 },
  );

  if (isLoading) {
    return <div className="p-3 text-xs" style={{ color: 'var(--text-muted)' }}>Loading diff…</div>;
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
                  (line.type === 'added' || line.type === 'add')
                    ? 'rgba(34,197,94,0.1)'
                    : (line.type === 'removed' || line.type === 'remove')
                      ? 'rgba(239,68,68,0.1)'
                      : 'transparent',
                color:
                  (line.type === 'added' || line.type === 'add')
                    ? '#4ade80'
                    : (line.type === 'removed' || line.type === 'remove')
                      ? '#f87171'
                      : 'var(--text-secondary)',
              }}
            >
              <span className="select-none mr-1 opacity-50">
                {(line.type === 'added' || line.type === 'add') ? '+' : (line.type === 'removed' || line.type === 'remove') ? '-' : ' '}
              </span>
              {line.content}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

// ── FileStatusList ────────────────────────────────────────────────────────────

interface FileEntry {
  path: string;
  isStaged: boolean;
}

function FileStatusList({
  repoPath,
  files,
  selectedFile,
  onSelect,
  onStageToggle,
  isToggling,
}: {
  repoPath: string;
  files: FileEntry[];
  selectedFile: FileEntry | null;
  onSelect: (f: FileEntry) => void;
  onStageToggle: (f: FileEntry) => void;
  isToggling: boolean;
}) {
  const staged = files.filter((f) => f.isStaged);
  const unstaged = files.filter((f) => !f.isStaged);

  const renderGroup = (label: string, group: FileEntry[], color: string) => (
    <div>
      <div
        className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wider select-none"
        style={{ color: 'var(--text-muted)' }}
      >
        {label} ({group.length})
      </div>
      {group.map((f) => {
        const isSelected = selectedFile?.path === f.path && selectedFile?.isStaged === f.isStaged;
        return (
          <div
            key={`${f.isStaged}-${f.path}`}
            className="flex items-center gap-1.5 px-2 py-1 cursor-pointer transition-colors group"
            style={{
              backgroundColor: isSelected ? 'var(--bg-active)' : 'transparent',
              color: isSelected ? 'var(--text-primary)' : 'var(--text-secondary)',
            }}
            onMouseEnter={(e) => { if (!isSelected) e.currentTarget.style.backgroundColor = 'var(--bg-hover)'; }}
            onMouseLeave={(e) => { if (!isSelected) e.currentTarget.style.backgroundColor = 'transparent'; }}
            onClick={() => onSelect(f)}
          >
            <input
              type="checkbox"
              checked={f.isStaged}
              disabled={isToggling}
              onChange={(e) => { e.stopPropagation(); onStageToggle(f); }}
              onClick={(e) => e.stopPropagation()}
              className="cursor-pointer flex-shrink-0"
              style={{ accentColor: 'var(--accent)' }}
            />
            <span
              className="text-[10px] w-3 flex-shrink-0 font-mono"
              style={{ color }}
            >
              {f.isStaged ? 'S' : 'M'}
            </span>
            <span className="truncate text-[11px] font-mono flex-1">{f.path}</span>
          </div>
        );
      })}
    </div>
  );

  if (files.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-2">
        <span style={{ color: 'var(--text-muted)', fontSize: '24px' }}>✓</span>
        <span className="text-xs" style={{ color: 'var(--text-muted)' }}>워킹 트리가 깨끗합니다</span>
      </div>
    );
  }

  return (
    <div className="overflow-y-auto">
      {staged.length > 0 && renderGroup('Staged', staged, '#4ade80')}
      {unstaged.length > 0 && renderGroup('Changes', unstaged, 'var(--accent)')}
    </div>
  );
}

// ── GitPanel (main) ───────────────────────────────────────────────────────────

export function GitPanel({ workspace }: Props) {
  const repoPath = workspace.worktreePath;
  const [selectedFile, setSelectedFile] = useState<FileEntry | null>(null);
  const [commitMessage, setCommitMessage] = useState('');
  const [actionResult, setActionResult] = useState<{ ok: boolean; text: string } | null>(null);

  // real-time status subscription
  const statusSub = trpc.git.watchStatus.useSubscription(
    { repoPath },
    {
      onData: () => { /* status reflected via refetch */ },
      onError: (e) => console.warn('[GitPanel] watchStatus error:', e),
    },
  );

  // Fallback: poll status query
  const statusQuery = trpc.git.status.useQuery(
    { repoPath },
    { staleTime: 2_000, refetchInterval: 5_000 },
  );

  const stageMutation = trpc.git.stage.useMutation({
    onSuccess: () => statusQuery.refetch(),
  });
  const unstageMutation = trpc.git.unstage.useMutation({
    onSuccess: () => statusQuery.refetch(),
  });
  const commitMutation = trpc.git.commit.useMutation({
    onSuccess: () => { setCommitMessage(''); setActionResult({ ok: true, text: 'Committed!' }); statusQuery.refetch(); },
    onError: (e) => setActionResult({ ok: false, text: e.message }),
  });
  const pushMutation = trpc.git.push.useMutation({
    onSuccess: () => setActionResult({ ok: true, text: 'Pushed!' }),
    onError: (e) => setActionResult({ ok: false, text: e.message }),
  });
  const pullMutation = trpc.git.pull.useMutation({
    onSuccess: () => { setActionResult({ ok: true, text: 'Pulled!' }); statusQuery.refetch(); },
    onError: (e) => setActionResult({ ok: false, text: e.message }),
  });
  // F-M1-03: Fetch
  const fetchMutation = trpc.git.fetch.useMutation({
    onSuccess: () => setActionResult({ ok: true, text: 'Fetched all remotes' }),
    onError: (e) => setActionResult({ ok: false, text: e.message }),
  });
  // F-M1-04: Discard All
  const discardAllMutation = trpc.git.discardAll.useMutation({
    onSuccess: () => { setActionResult({ ok: true, text: 'All changes discarded' }); statusQuery.refetch(); },
    onError: (e) => setActionResult({ ok: false, text: e.message }),
  });

  const status = statusQuery.data;

  // build file list from status
  const files: FileEntry[] = [];
  if (status) {
    status.staged.forEach((f) => files.push({ path: f.path, isStaged: true }));
    const stagedPaths = new Set(status.staged.map((f) => f.path));
    status.modified.forEach((p) => { if (!stagedPaths.has(p)) files.push({ path: p, isStaged: false }); });
    status.not_added.forEach((p) => { if (!stagedPaths.has(p)) files.push({ path: p, isStaged: false }); });
    status.deleted.forEach((p) => { if (!stagedPaths.has(p)) files.push({ path: p, isStaged: false }); });
    status.created.forEach((p) => { if (!stagedPaths.has(p)) files.push({ path: p, isStaged: false }); });
  }

  const isToggling = stageMutation.isPending || unstageMutation.isPending;

  const handleStageToggle = (f: FileEntry) => {
    if (f.isStaged) {
      unstageMutation.mutate({ repoPath, filePath: f.path });
    } else {
      stageMutation.mutate({ repoPath, filePath: f.path });
    }
  };

  const handleCommit = () => {
    if (!commitMessage.trim()) return;
    const hasStagedFiles = files.some((f) => f.isStaged);
    if (!hasStagedFiles) {
      setActionResult({ ok: false, text: 'No staged files to commit' });
      return;
    }
    setActionResult(null);
    commitMutation.mutate({ repoPath, message: commitMessage.trim() });
  };

  const isActing = commitMutation.isPending || pushMutation.isPending || pullMutation.isPending || fetchMutation.isPending || discardAllMutation.isPending;

  // auto-dismiss result after 4s
  useEffect(() => {
    if (!actionResult) return;
    const t = setTimeout(() => setActionResult(null), 4000);
    return () => clearTimeout(t);
  }, [actionResult]);

  return (
    <div className="flex flex-col h-full text-xs" style={{ color: 'var(--text-primary)' }}>
      {/* Branch selector */}
      <div className="px-2 pt-2 pb-1 flex-shrink-0">
        <BranchSelector repoPath={repoPath} />
      </div>

      {/* Push/Pull/Fetch actions */}
      <div className="px-2 pb-2 flex gap-1.5 flex-shrink-0">
        <button
          onClick={() => { setActionResult(null); fetchMutation.mutate({ repoPath }); }}
          disabled={isActing}
          className="py-1 rounded text-[11px] transition-colors px-2"
          style={{
            backgroundColor: isActing ? 'var(--bg-hover)' : 'var(--bg-secondary)',
            color: isActing ? 'var(--text-muted)' : 'var(--text-secondary)',
            border: '1px solid var(--border)',
          }}
          onMouseEnter={(e) => { if (!isActing) e.currentTarget.style.borderColor = 'var(--accent)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border)'; }}
          title="Fetch all remotes"
        >
          {fetchMutation.isPending ? '...' : '⟳ Fetch'}
        </button>
        <button
          onClick={() => { setActionResult(null); pullMutation.mutate({ repoPath }); }}
          disabled={isActing}
          className="flex-1 py-1 rounded text-[11px] transition-colors"
          style={{
            backgroundColor: isActing ? 'var(--bg-hover)' : 'var(--bg-secondary)',
            color: isActing ? 'var(--text-muted)' : 'var(--text-secondary)',
            border: '1px solid var(--border)',
          }}
          onMouseEnter={(e) => { if (!isActing) e.currentTarget.style.borderColor = 'var(--accent)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border)'; }}
        >
          {pullMutation.isPending ? '...' : '↓ Pull'}
        </button>
        <button
          onClick={() => { setActionResult(null); pushMutation.mutate({ repoPath }); }}
          disabled={isActing}
          className="flex-1 py-1 rounded text-[11px] transition-colors"
          style={{
            backgroundColor: isActing ? 'var(--bg-hover)' : 'var(--bg-secondary)',
            color: isActing ? 'var(--text-muted)' : 'var(--text-secondary)',
            border: '1px solid var(--border)',
          }}
          onMouseEnter={(e) => { if (!isActing) e.currentTarget.style.borderColor = 'var(--accent)'; }}
          onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border)'; }}
        >
          {pushMutation.isPending ? '...' : '↑ Push'}
        </button>
      </div>

      {/* Divider */}
      <div className="h-px flex-shrink-0" style={{ backgroundColor: 'var(--border)' }} />

      {/* File status + diff (split view) */}
      <div className="flex-1 overflow-hidden flex flex-col min-h-0">
        {/* File list */}
        <div style={{ flex: selectedFile ? '0 0 40%' : '1', minHeight: 0, overflow: 'hidden' }}>
          <FileStatusList
            repoPath={repoPath}
            files={files}
            selectedFile={selectedFile}
            onSelect={setSelectedFile}
            onStageToggle={handleStageToggle}
            isToggling={isToggling}
          />
        </div>

        {/* Diff viewer */}
        {selectedFile && (
          <>
            <div className="flex-shrink-0 px-2 py-1 flex items-center gap-1" style={{ borderTop: '1px solid var(--border)', borderBottom: '1px solid var(--border)', backgroundColor: 'var(--bg-secondary)' }}>
              <span className="font-mono truncate flex-1 text-[10px]" style={{ color: 'var(--text-secondary)' }}>
                {selectedFile.path}
              </span>
              <button
                onClick={() => setSelectedFile(null)}
                className="text-[10px] flex-shrink-0"
                style={{ color: 'var(--text-muted)' }}
              >
                ✕
              </button>
            </div>
            <div className="flex-1 overflow-hidden min-h-0">
              <DiffViewer repoPath={repoPath} filePath={selectedFile.path} staged={selectedFile.isStaged} />
            </div>
          </>
        )}
      </div>

      {/* Divider */}
      <div className="h-px flex-shrink-0" style={{ backgroundColor: 'var(--border)' }} />

      {/* F-M1-04: Discard All Changes */}
      {files.length > 0 && (
        <div className="flex-shrink-0 px-2 pt-1.5">
          <button
            onClick={() => {
              if (window.confirm('Discard ALL uncommitted changes? This cannot be undone.')) {
                setActionResult(null);
                discardAllMutation.mutate({ repoPath });
              }
            }}
            disabled={isActing}
            className="w-full py-1 rounded text-[10px] transition-colors"
            style={{
              backgroundColor: 'rgba(239,68,68,0.1)',
              color: '#f87171',
              border: '1px solid rgba(239,68,68,0.2)',
              opacity: isActing ? 0.5 : 1,
            }}
            onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'rgba(239,68,68,0.2)')}
            onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'rgba(239,68,68,0.1)')}
          >
            {discardAllMutation.isPending ? 'Discarding...' : 'Discard All Changes'}
          </button>
        </div>
      )}

      {/* Commit section */}
      <div className="flex-shrink-0 p-2 flex flex-col gap-1.5">
        <textarea
          value={commitMessage}
          onChange={(e) => setCommitMessage(e.target.value)}
          placeholder="Commit message…"
          rows={2}
          className="w-full resize-none rounded px-2 py-1.5 text-xs outline-none transition-colors"
          style={{
            backgroundColor: 'var(--bg-secondary)',
            color: 'var(--text-primary)',
            border: '1px solid var(--border)',
          }}
          onFocus={(e) => (e.currentTarget.style.borderColor = 'var(--accent)')}
          onBlur={(e) => (e.currentTarget.style.borderColor = 'var(--border)')}
          onKeyDown={(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleCommit(); }}
        />
        <button
          onClick={handleCommit}
          disabled={isActing || !commitMessage.trim()}
          className="py-1.5 rounded text-[11px] font-medium transition-colors"
          style={{
            backgroundColor: commitMessage.trim() && !isActing ? 'var(--accent)' : 'var(--bg-hover)',
            color: commitMessage.trim() && !isActing ? '#fff' : 'var(--text-muted)',
          }}
          onMouseEnter={(e) => { if (commitMessage.trim() && !isActing) e.currentTarget.style.backgroundColor = 'var(--accent-hover)'; }}
          onMouseLeave={(e) => { if (commitMessage.trim() && !isActing) e.currentTarget.style.backgroundColor = 'var(--accent)'; }}
        >
          {commitMutation.isPending ? 'Committing…' : 'Commit'}
        </button>

        {actionResult && (
          <div
            className="rounded px-2 py-1 text-[10px] break-all"
            style={{
              backgroundColor: actionResult.ok ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)',
              color: actionResult.ok ? '#4ade80' : '#f87171',
            }}
          >
            {actionResult.text}
          </div>
        )}
      </div>

      {/* F-M1-02: Stash section */}
      <StashPanel repoPath={repoPath} />

      {/* F-M1-06: Tag section */}
      <TagPanel repoPath={repoPath} />

      {/* F-M1-08: Squash Rebase section */}
      <SquashPanel repoPath={repoPath} />

      {/* suppress unused warning */}
      <div style={{ display: 'none' }}>{statusSub.status}</div>
    </div>
  );
}
