import { useState } from 'react';
import { trpc } from '../../lib/trpc';
import { useWorkspaceStore } from '../../store/workspaceStore';
import type { Workspace } from '@maestro/shared-types';

type MergeStrategy = 'squash' | 'rebase' | 'merge';

interface Props {
  workspace: Workspace;
}

const STRATEGIES: { id: MergeStrategy; label: string; description: string }[] = [
  {
    id: 'squash',
    label: 'Squash & Merge',
    description: 'Combine all commits into one before merging',
  },
  {
    id: 'rebase',
    label: 'Rebase & Merge',
    description: 'Rebase commits onto base branch, keeping linear history',
  },
  {
    id: 'merge',
    label: 'Merge Commit',
    description: 'Create a merge commit preserving full history',
  },
];

export function MergePanel({ workspace }: Props) {
  const [strategy, setStrategy] = useState<MergeStrategy>('squash');
  const [result, setResult] = useState<{ success: boolean; message: string } | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const { repositories } = useWorkspaceStore();
  const repo = repositories.find((r) => r.id === workspace.repositoryId);
  const baseBranch = repo?.baseBranch || 'main';
  const currentBranch = workspace.branch;
  const isSameBranch = currentBranch === baseBranch;

  const utils = trpc.useUtils();

  const mergeMutation = trpc.git.merge.useMutation({
    onSuccess: (data) => {
      setResult(data);
      setConfirmOpen(false);
      if (data.success) {
        // 성공 시 git status 새로고침
        utils.git.status.invalidate();
        utils.git.branches.invalidate();
      }
    },
    onError: (error) => {
      setResult({ success: false, message: error.message });
      setConfirmOpen(false);
    },
  });

  const handleMerge = () => {
    setResult(null);
    mergeMutation.mutate({
      workspaceId: workspace.id,
      strategy,
    });
  };

  return (
    <div className="flex flex-col h-full p-3 gap-3">
      {/* Header */}
      <div className="flex flex-col gap-1">
        <div className="text-xs font-medium" style={{ color: 'var(--text-primary)' }}>
          Approve & Merge
        </div>
        <div className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
          {workspace.name}
        </div>
      </div>

      {/* Branch info */}
      <div
        className="rounded px-3 py-2 flex flex-col gap-1.5"
        style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border)' }}
      >
        <div className="flex items-center gap-2 text-[11px]">
          <span style={{ color: 'var(--text-muted)' }}>From:</span>
          <span className="font-mono" style={{ color: 'var(--accent)' }}>
            {currentBranch}
          </span>
        </div>
        <div className="flex items-center gap-2 text-[11px]">
          <span style={{ color: 'var(--text-muted)' }}>Into:</span>
          <span className="font-mono" style={{ color: 'var(--text-primary)' }}>
            {baseBranch}
          </span>
        </div>
      </div>

      {isSameBranch && (
        <div
          className="rounded px-3 py-2 text-[11px]"
          style={{ backgroundColor: 'rgba(234,179,8,0.1)', color: '#facc15' }}
        >
          Already on base branch. Nothing to merge.
        </div>
      )}

      {/* Strategy selector */}
      {!isSameBranch && (
        <div className="flex flex-col gap-1.5">
          <div className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
            Merge Strategy
          </div>
          {STRATEGIES.map((s) => (
            <button
              key={s.id}
              onClick={() => setStrategy(s.id)}
              className="flex flex-col gap-0.5 rounded px-3 py-2 text-left transition-colors"
              style={{
                backgroundColor: strategy === s.id ? 'var(--bg-active)' : 'var(--bg-secondary)',
                border: `1px solid ${strategy === s.id ? 'var(--accent)' : 'var(--border)'}`,
              }}
              onMouseEnter={(e) => {
                if (strategy !== s.id) e.currentTarget.style.borderColor = 'var(--accent)';
              }}
              onMouseLeave={(e) => {
                if (strategy !== s.id) e.currentTarget.style.borderColor = 'var(--border)';
              }}
            >
              <div className="flex items-center gap-2">
                <div
                  className="w-3 h-3 rounded-full border-2 flex items-center justify-center flex-shrink-0"
                  style={{
                    borderColor: strategy === s.id ? 'var(--accent)' : 'var(--text-muted)',
                  }}
                >
                  {strategy === s.id && (
                    <div
                      className="w-1.5 h-1.5 rounded-full"
                      style={{ backgroundColor: 'var(--accent)' }}
                    />
                  )}
                </div>
                <span className="text-xs font-medium" style={{ color: 'var(--text-primary)' }}>
                  {s.label}
                </span>
              </div>
              <span className="text-[10px] ml-5" style={{ color: 'var(--text-muted)' }}>
                {s.description}
              </span>
            </button>
          ))}
        </div>
      )}

      {/* Spacer */}
      <div className="flex-1" />

      {/* Merge button / confirm */}
      {!isSameBranch && !confirmOpen && (
        <button
          onClick={() => setConfirmOpen(true)}
          disabled={mergeMutation.isPending}
          className="py-2 rounded text-xs font-medium transition-colors"
          style={{
            backgroundColor: 'var(--accent)',
            color: '#fff',
          }}
          onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--accent-hover)')}
          onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'var(--accent)')}
        >
          Merge Branch
        </button>
      )}

      {confirmOpen && (
        <div
          className="rounded px-3 py-2.5 flex flex-col gap-2"
          style={{ backgroundColor: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.3)' }}
        >
          <div className="text-[11px]" style={{ color: '#f87171' }}>
            This will merge <span className="font-mono font-medium">{currentBranch}</span> into{' '}
            <span className="font-mono font-medium">{baseBranch}</span> using{' '}
            <span className="font-medium">{strategy}</span> strategy. Continue?
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleMerge}
              disabled={mergeMutation.isPending}
              className="flex-1 py-1.5 rounded text-xs font-medium transition-colors"
              style={{
                backgroundColor: mergeMutation.isPending ? 'var(--bg-hover)' : '#ef4444',
                color: mergeMutation.isPending ? 'var(--text-muted)' : '#fff',
              }}
            >
              {mergeMutation.isPending ? 'Merging...' : 'Confirm Merge'}
            </button>
            <button
              onClick={() => setConfirmOpen(false)}
              disabled={mergeMutation.isPending}
              className="flex-1 py-1.5 rounded text-xs transition-colors"
              style={{
                backgroundColor: 'var(--bg-secondary)',
                color: 'var(--text-secondary)',
                border: '1px solid var(--border)',
              }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Result */}
      {result && (
        <div
          className="rounded px-3 py-2 text-[11px] break-words"
          style={{
            backgroundColor: result.success ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)',
            color: result.success ? '#4ade80' : '#f87171',
          }}
        >
          {result.message}
        </div>
      )}
    </div>
  );
}
