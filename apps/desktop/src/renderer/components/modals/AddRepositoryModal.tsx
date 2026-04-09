import { useState } from 'react';
import { useRepositoryStore } from '../../store/repositoryStore';
import { trpc } from '../../lib/trpc';
import type { Repository } from '@maestro/shared-types';

type Tab = 'local' | 'clone';

interface Props {
  onClose: () => void;
}

const inputStyle = {
  backgroundColor: 'var(--bg-secondary)',
  color: 'var(--text-primary)',
  borderColor: 'var(--border)',
};

export function AddRepositoryModal({ onClose }: Props) {
  const { addRepository } = useRepositoryStore();
  const [tab, setTab] = useState<Tab>('local');

  const [localPath, setLocalPath] = useState('');
  const [cloneUrl, setCloneUrl] = useState('');
  const [cloneDir, setCloneDir] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const openDirMutation = trpc.dialog.openDirectory.useMutation({
    onError: (e) => setError(e.message),
  });

  const addMutation = trpc.repository.add.useMutation({
    onSuccess: (repo) => {
      addRepository(repo as Repository);
      onClose();
    },
    onError: (e) => setError(e.message),
    onSettled: () => setLoading(false),
  });

  const cloneMutation = trpc.repository.clone.useMutation({
    onSuccess: (repo) => {
      addRepository(repo as Repository);
      onClose();
    },
    onError: (e) => setError(e.message),
    onSettled: () => setLoading(false),
  });

  const handleAddLocal = () => {
    if (!localPath.trim()) return;
    setLoading(true);
    setError('');
    addMutation.mutate({ path: localPath.trim() });
  };

  const handleClone = () => {
    if (!cloneUrl.trim() || !cloneDir.trim()) return;
    setLoading(true);
    setError('');
    const urlParts = cloneUrl.replace(/\.git$/, '').split('/');
    const repoName = urlParts[urlParts.length - 1] || 'repo';
    const targetPath = `${cloneDir.replace(/\/$/, '')}/${repoName}`;
    cloneMutation.mutate({ url: cloneUrl.trim(), targetPath });
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={onClose}>
      <div
        className="rounded-lg w-[440px] p-5 flex flex-col gap-4 border"
        style={{ backgroundColor: 'var(--bg-panel)', borderColor: 'var(--border)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
            Add Repository
          </h2>
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

        {/* Tabs */}
        <div className="flex gap-1 rounded p-0.5" style={{ backgroundColor: 'var(--bg-secondary)' }}>
          {(['local', 'clone'] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => { setTab(t); setError(''); }}
              className="flex-1 text-xs py-1.5 rounded transition-colors"
              style={{
                backgroundColor: tab === t ? 'var(--bg-hover)' : 'transparent',
                color: tab === t ? 'var(--text-primary)' : 'var(--text-secondary)',
              }}
            >
              {t === 'local' ? 'Local Folder' : 'Clone from URL'}
            </button>
          ))}
        </div>

        {/* Local Tab */}
        {tab === 'local' && (
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                Repository Path
              </label>
              <div className="flex gap-1.5">
                <input
                  autoFocus
                  value={localPath}
                  onChange={(e) => setLocalPath(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleAddLocal()}
                  placeholder="/path/to/your/git/repo"
                  className="flex-1 text-xs rounded px-3 py-2 outline-none border focus:border-blue-600 placeholder-gray-600"
                  style={inputStyle}
                />
                <button
                  onClick={() => openDirMutation.mutate(undefined, { onSuccess: (p) => { if (p) setLocalPath(p as string); } })}
                  className="px-2.5 py-1.5 text-xs rounded border transition-colors flex-shrink-0"
                  style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)', backgroundColor: 'var(--bg-secondary)' }}
                  onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--text-primary)')}
                  onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--text-secondary)')}
                  title="Browse folder"
                >
                  Browse
                </button>
              </div>
            </div>
            {localPath && (
              <div
                className="text-[10px] font-mono px-3 py-2 rounded truncate"
                style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--text-muted)' }}
              >
                {localPath}
              </div>
            )}
          </div>
        )}

        {/* Clone Tab */}
        {tab === 'clone' && (
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1">
              <label className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                Git URL (HTTPS or SSH)
              </label>
              <input
                autoFocus
                value={cloneUrl}
                onChange={(e) => setCloneUrl(e.target.value)}
                placeholder="https://github.com/org/repo.git"
                className="text-xs rounded px-3 py-2 outline-none border focus:border-blue-600 placeholder-gray-600"
                style={inputStyle}
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                Clone Into Directory
              </label>
              <div className="flex gap-1.5">
                <input
                  value={cloneDir}
                  onChange={(e) => setCloneDir(e.target.value)}
                  placeholder="/path/to/parent/directory"
                  className="flex-1 text-xs rounded px-3 py-2 outline-none border focus:border-blue-600 placeholder-gray-600"
                  style={inputStyle}
                />
                <button
                  onClick={() => openDirMutation.mutate(undefined, { onSuccess: (p) => { if (p) setCloneDir(p as string); } })}
                  className="px-2.5 py-1.5 text-xs rounded border transition-colors flex-shrink-0"
                  style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)', backgroundColor: 'var(--bg-secondary)' }}
                  onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--text-primary)')}
                  onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--text-secondary)')}
                  title="Browse folder"
                >
                  Browse
                </button>
              </div>
            </div>
            {cloneUrl && cloneDir && (
              <div
                className="text-[10px] font-mono px-3 py-2 rounded"
                style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--text-muted)' }}
              >
                git clone {cloneUrl.length > 40 ? '...' + cloneUrl.slice(-40) : cloneUrl}
                <br />
                → {cloneDir}/{cloneUrl.replace(/\.git$/, '').split('/').pop()}
              </div>
            )}
            {loading && (
              <div className="text-xs text-blue-400 text-center">Cloning repository...</div>
            )}
          </div>
        )}

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
            onClick={tab === 'local' ? handleAddLocal : handleClone}
            disabled={loading || (tab === 'local' ? !localPath.trim() : !cloneUrl.trim() || !cloneDir.trim())}
            className="px-4 py-1.5 text-xs text-white rounded transition-colors disabled:opacity-50"
            style={{ backgroundColor: 'var(--accent)' }}
          >
            {loading
              ? tab === 'local' ? 'Adding...' : 'Cloning...'
              : tab === 'local' ? 'Add Repository' : 'Clone & Add'}
          </button>
        </div>
      </div>
    </div>
  );
}
