'use client';

import { useState } from 'react';
import { useWorkspaceStore } from '@/store/workspaceStore';

interface Props {
  onClose: () => void;
}

export function CreateWorkspaceModal({ onClose }: Props) {
  const { repositories, addRepository, createWorkspace } = useWorkspaceStore();

  const [step, setStep] = useState<'repo' | 'workspace'>(repositories.length > 0 ? 'workspace' : 'repo');
  const [repoPath, setRepoPath] = useState('');
  const [selectedRepoId, setSelectedRepoId] = useState(repositories[0]?.id ?? '');
  const [name, setName] = useState('');
  const [branch, setBranch] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleAddRepo = async () => {
    if (!repoPath.trim()) return;
    setLoading(true);
    setError('');
    try {
      const repo = await addRepository(repoPath.trim());
      setSelectedRepoId(repo.id);
      setStep('workspace');
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  const handleCreate = async () => {
    if (!name.trim() || !branch.trim() || !selectedRepoId) return;
    setLoading(true);
    setError('');
    try {
      await createWorkspace(name.trim(), selectedRepoId, branch.trim());
      onClose();
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={onClose}>
      <div
        className="bg-gray-900 border border-gray-700 rounded-lg w-[440px] p-5 flex flex-col gap-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-100">
            {step === 'repo' ? 'Add Repository' : 'New Workspace'}
          </h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300 text-lg">×</button>
        </div>

        {step === 'repo' ? (
          <>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-gray-400">Repository Path</label>
              <input
                autoFocus
                value={repoPath}
                onChange={(e) => setRepoPath(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleAddRepo()}
                placeholder="/path/to/your/git/repo"
                className="bg-gray-800 text-gray-100 text-xs rounded px-3 py-2 outline-none border border-gray-700 focus:border-blue-600 placeholder-gray-600"
              />
            </div>
            {repositories.length > 0 && (
              <button
                onClick={() => setStep('workspace')}
                className="text-xs text-blue-400 hover:text-blue-300 text-left"
              >
                Use an existing repository →
              </button>
            )}
          </>
        ) : (
          <>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-gray-400">Repository</label>
              <select
                value={selectedRepoId}
                onChange={(e) => setSelectedRepoId(e.target.value)}
                className="bg-gray-800 text-gray-100 text-xs rounded px-3 py-2 outline-none border border-gray-700 focus:border-blue-600"
              >
                {repositories.map((r) => (
                  <option key={r.id} value={r.id}>{r.name} ({r.path})</option>
                ))}
              </select>
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-gray-400">Workspace Name</label>
              <input
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="feature/my-feature"
                className="bg-gray-800 text-gray-100 text-xs rounded px-3 py-2 outline-none border border-gray-700 focus:border-blue-600 placeholder-gray-600"
              />
            </div>
            <div className="flex flex-col gap-1">
              <label className="text-xs text-gray-400">Branch Name</label>
              <input
                value={branch}
                onChange={(e) => setBranch(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
                placeholder="feature/my-feature"
                className="bg-gray-800 text-gray-100 text-xs rounded px-3 py-2 outline-none border border-gray-700 focus:border-blue-600 placeholder-gray-600"
              />
            </div>
            <button
              onClick={() => { setStep('repo'); setError(''); }}
              className="text-xs text-blue-400 hover:text-blue-300 text-left"
            >
              + Add a new repository
            </button>
          </>
        )}

        {error && (
          <div className="text-xs text-red-400 bg-red-900/30 px-3 py-2 rounded">{error}</div>
        )}

        <div className="flex gap-2 justify-end">
          <button
            onClick={onClose}
            className="px-3 py-1.5 text-xs text-gray-400 hover:text-gray-200"
          >
            Cancel
          </button>
          <button
            onClick={step === 'repo' ? handleAddRepo : handleCreate}
            disabled={loading}
            className="px-4 py-1.5 text-xs bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 text-white rounded transition-colors"
          >
            {loading ? 'Loading...' : step === 'repo' ? 'Add Repository' : 'Create Workspace'}
          </button>
        </div>
      </div>
    </div>
  );
}
