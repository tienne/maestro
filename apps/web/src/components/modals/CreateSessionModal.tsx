'use client';

import { useState } from 'react';
import { useAgentStore } from '@/store/agentStore';
import { useSessionStore } from '@/store/sessionStore';
import type { Workspace } from '@maestro/shared-types';

interface Props {
  workspace: Workspace;
  onClose: () => void;
}

export function CreateSessionModal({ workspace, onClose }: Props) {
  const { agents } = useAgentStore();
  const { startSession } = useSessionStore();

  const [selectedAgentId, setSelectedAgentId] = useState(agents[0]?.id ?? '');
  const [name, setName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const selectedAgent = agents.find((a) => a.id === selectedAgentId);

  const handleCreate = async () => {
    if (!selectedAgentId || !name.trim()) return;
    setLoading(true);
    setError('');
    try {
      await startSession(name.trim(), workspace.id, selectedAgentId);
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
        className="bg-gray-900 border border-gray-700 rounded-lg w-[400px] p-5 flex flex-col gap-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-100">New Session</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300 text-lg">×</button>
        </div>

        <div className="text-xs text-gray-500 bg-gray-800 rounded px-3 py-2">
          Workspace: <span className="text-gray-300">{workspace.name}</span>
          {' '}({workspace.branch})
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs text-gray-400">Session Name</label>
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. auth-refactor"
            className="bg-gray-800 text-gray-100 text-xs rounded px-3 py-2 outline-none border border-gray-700 focus:border-blue-600 placeholder-gray-600"
          />
        </div>

        <div className="flex flex-col gap-2">
          <label className="text-xs text-gray-400">Agent</label>
          <div className="grid grid-cols-2 gap-2">
            {agents.map((agent) => (
              <button
                key={agent.id}
                onClick={() => setSelectedAgentId(agent.id)}
                className={`flex flex-col gap-0.5 px-3 py-2 rounded border text-left transition-colors ${
                  selectedAgentId === agent.id
                    ? 'border-blue-600 bg-blue-900/20 text-gray-100'
                    : 'border-gray-700 text-gray-400 hover:border-gray-600 hover:text-gray-300'
                }`}
              >
                <span className="text-xs font-medium">{agent.name}</span>
                <span className="text-[10px] text-gray-600 font-mono">{agent.command}</span>
              </button>
            ))}
          </div>
        </div>

        {selectedAgent && (
          <div className="text-[10px] text-gray-600 font-mono bg-gray-800 px-3 py-2 rounded">
            $ {selectedAgent.command} {selectedAgent.args.join(' ')}
          </div>
        )}

        {error && (
          <div className="text-xs text-red-400 bg-red-900/30 px-3 py-2 rounded">{error}</div>
        )}

        <div className="flex gap-2 justify-end">
          <button onClick={onClose} className="px-3 py-1.5 text-xs text-gray-400 hover:text-gray-200">
            Cancel
          </button>
          <button
            onClick={handleCreate}
            disabled={loading || !name.trim() || !selectedAgentId}
            className="px-4 py-1.5 text-xs bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 text-white rounded transition-colors"
          >
            {loading ? 'Starting...' : 'Start Session'}
          </button>
        </div>
      </div>
    </div>
  );
}
