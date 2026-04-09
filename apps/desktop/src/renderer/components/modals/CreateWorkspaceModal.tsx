import { useState } from 'react';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { useRepositoryStore } from '../../store/repositoryStore';
import { trpc } from '../../lib/trpc';
import type { Workspace } from '@maestro/shared-types';

interface Props {
  repositoryId: string;
  onClose: () => void;
}

const inputStyle = {
  backgroundColor: 'var(--bg-secondary)',
  color: 'var(--text-primary)',
  borderColor: 'var(--border)',
};

export function CreateWorkspaceModal({ repositoryId, onClose }: Props) {
  const { addWorkspace } = useWorkspaceStore();
  const { repositories } = useRepositoryStore();
  const repo = repositories.find((r) => r.id === repositoryId);

  const [name, setName] = useState('');
  const [error, setError] = useState('');

  const createMutation = trpc.workspace.create.useMutation({
    onSuccess: (workspace) => {
      addWorkspace(workspace as Workspace);
      onClose();
    },
    onError: (e) => setError(e.message),
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

        {error && (
          <div className="text-xs text-red-400 bg-red-900/30 px-3 py-2 rounded">{error}</div>
        )}

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
            disabled={createMutation.isPending || !name.trim()}
            className="px-4 py-1.5 text-xs text-white rounded transition-colors disabled:opacity-50"
            style={{ backgroundColor: 'var(--accent)' }}
          >
            {createMutation.isPending ? 'Creating...' : 'Create Workspace'}
          </button>
        </div>
      </div>
    </div>
  );
}
