import { useState } from 'react';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { useRepositoryStore } from '../../store/repositoryStore';
import { trpc } from '../../lib/trpc';
import type { Workspace } from '@maestro/shared-types';

interface Props {
  repositoryId: string;
  onClose: () => void;
  /** 완료 후 세션 생성 모달 열기 콜백 (선택) */
  onCreated?: (workspace: Workspace) => void;
}

const inputStyle = {
  backgroundColor: 'var(--bg-secondary)',
  color: 'var(--text-primary)',
  borderColor: 'var(--border)',
};

// 생성 단계 정의
type Step = 'idle' | 'worktree' | 'setup' | 'done';

function StepIndicator({ step, label, current }: { step: Step; label: string; current: Step }) {
  const steps: Step[] = ['worktree', 'setup', 'done'];
  const currentIdx = steps.indexOf(current);
  const stepIdx = steps.indexOf(step);
  const isDone = currentIdx > stepIdx;
  const isActive = current === step;
  return (
    <div className="flex items-center gap-2 text-xs">
      <span
        className="w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-bold flex-shrink-0"
        style={{
          backgroundColor: isDone ? '#22c55e' : isActive ? 'var(--accent)' : 'var(--bg-hover)',
          color: isDone || isActive ? '#fff' : 'var(--text-muted)',
        }}
      >
        {isDone ? '✓' : stepIdx + 1}
      </span>
      <span style={{ color: isActive ? 'var(--text-primary)' : isDone ? '#22c55e' : 'var(--text-muted)' }}>
        {label}
        {isActive && <span className="ml-1 animate-pulse">...</span>}
      </span>
    </div>
  );
}

export function CreateWorkspaceModal({ repositoryId, onClose, onCreated }: Props) {
  const { addWorkspace } = useWorkspaceStore();
  const { repositories } = useRepositoryStore();
  const repo = repositories.find((r) => r.id === repositoryId);

  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [step, setStep] = useState<Step>('idle');
  const [createdWorkspace, setCreatedWorkspace] = useState<Workspace | null>(null);

  const createMutation = trpc.workspace.create.useMutation({
    onMutate: () => {
      setStep('worktree');
      // 250ms 후 setup 단계로 전환 (시각적 피드백)
      setTimeout(() => setStep('setup'), 250);
    },
    onSuccess: (workspace) => {
      const ws = workspace as Workspace;
      addWorkspace(ws);
      setCreatedWorkspace(ws);
      setStep('done');
    },
    onError: (e) => {
      setStep('idle');
      setError(e.message);
    },
  });

  const handleCreate = () => {
    if (!name.trim()) return;
    setError('');
    createMutation.mutate({ name: name.trim(), repositoryId });
  };

  const branchPreview = repo
    ? repo.branchPrefix
      ? `${repo.branchPrefix}/${name || '...'}`
      : name || '...'
    : name || '...';

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={onClose}>
      <div
        className="rounded-lg w-[400px] p-5 flex flex-col gap-4 border"
        style={{ backgroundColor: 'var(--bg-panel)', borderColor: 'var(--border)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>New Workspace</h2>
          <button
            onClick={onClose}
            className="text-lg leading-none"
            style={{ color: 'var(--text-muted)' }}
            onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--text-primary)')}
            onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--text-muted)')}
          >
            ×
          </button>
        </div>

        {repo && (
          <div
            className="text-xs rounded px-3 py-2"
            style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--text-muted)' }}
          >
            Repository: <span style={{ color: 'var(--text-secondary)' }}>{repo.name}</span>
          </div>
        )}

        <div className="flex flex-col gap-1">
          <label className="text-xs" style={{ color: 'var(--text-muted)' }}>Workspace Name</label>
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
            placeholder="my-feature"
            className="text-xs rounded px-3 py-2 outline-none border focus:border-blue-600 placeholder-gray-600"
            style={inputStyle}
          />
        </div>

        <div
          className="text-[10px] font-mono px-3 py-2 rounded"
          style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--text-muted)' }}
        >
          Branch: <span style={{ color: 'var(--text-secondary)' }}>{branchPreview}</span>
          {repo?.baseBranch && (
            <> · Base: <span style={{ color: 'var(--text-secondary)' }}>{repo.baseBranch}</span></>
          )}
        </div>

        {/* 생성 진행 상태 */}
        {step !== 'idle' && (
          <div
            className="flex flex-col gap-2 px-3 py-3 rounded"
            style={{ backgroundColor: 'var(--bg-secondary)' }}
          >
            <StepIndicator step="worktree" label="git worktree 생성" current={step} />
            <StepIndicator step="setup" label="의존성 설치 (setup script)" current={step} />
            <StepIndicator step="done" label="워크스페이스 준비 완료" current={step} />
          </div>
        )}

        {error && (
          <div className="text-xs text-red-400 bg-red-900/30 px-3 py-2 rounded">{error}</div>
        )}

        {step === 'done' ? (
          <div className="flex gap-2 justify-end">
            <button
              onClick={onClose}
              className="px-3 py-1.5 text-xs transition-colors"
              style={{ color: 'var(--text-secondary)' }}
              onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--text-primary)')}
              onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--text-secondary)')}
            >
              Close
            </button>
            {onCreated && createdWorkspace && (
              <button
                onClick={() => {
                  onCreated(createdWorkspace);
                  onClose();
                }}
                className="px-4 py-1.5 text-xs text-white rounded transition-colors"
                style={{ backgroundColor: 'var(--accent)' }}
              >
                Start Session Now
              </button>
            )}
          </div>
        ) : (
          <div className="flex gap-2 justify-end">
            <button
              onClick={onClose}
              className="px-3 py-1.5 text-xs transition-colors"
              style={{ color: 'var(--text-secondary)' }}
              onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--text-primary)')}
              onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--text-secondary)')}
            >
              Cancel
            </button>
            <button
              onClick={handleCreate}
              disabled={step !== 'idle' || !name.trim()}
              className="px-4 py-1.5 text-xs text-white rounded transition-colors disabled:opacity-50"
              style={{ backgroundColor: 'var(--accent)' }}
            >
              {step !== 'idle' ? 'Creating...' : 'Create Workspace'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
