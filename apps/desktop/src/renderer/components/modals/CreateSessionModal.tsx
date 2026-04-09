import { useState } from 'react';
import { useAgentStore } from '../../store/agentStore';
import { useSessionStore } from '../../store/sessionStore';
import { useUiStore } from '../../store/uiStore';
import { trpc } from '../../lib/trpc';
import type { Workspace, Session } from '@maestro/shared-types';

interface Props {
  workspace: Workspace;
  onClose: () => void;
}

const inputStyle = {
  backgroundColor: 'var(--bg-secondary)',
  color: 'var(--text-primary)',
  borderColor: 'var(--border)',
};

export function CreateSessionModal({ workspace, onClose }: Props) {
  const { agents } = useAgentStore();
  const { addSession } = useSessionStore();
  const { activePaneIndex, setPaneSession, setCurrentView } = useUiStore();

  const [selectedAgentId, setSelectedAgentId] = useState(agents[0]?.id ?? '');
  const [name, setName] = useState('');
  const [error, setError] = useState('');

  const selectedAgent = agents.find((a) => a.id === selectedAgentId);

  const createMutation = trpc.session.create.useMutation({
    onSuccess: (session) => {
      const sess = session as Session;
      addSession(sess);
      setPaneSession(activePaneIndex, sess.id);
      setCurrentView('terminal');
      onClose();
    },
    onError: (e) => setError(e.message),
  });

  const handleCreate = () => {
    if (!selectedAgentId || !name.trim()) return;
    setError('');
    createMutation.mutate({ name: name.trim(), workspaceId: workspace.id, agentId: selectedAgentId });
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={onClose}>
      <div
        className="rounded-lg w-[400px] p-5 flex flex-col gap-4 max-h-[90vh] overflow-y-auto border"
        style={{ backgroundColor: 'var(--bg-panel)', borderColor: 'var(--border)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>New Session</h2>
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

        <div
          className="text-xs rounded px-3 py-2"
          style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--text-muted)' }}
        >
          Workspace: <span style={{ color: 'var(--text-secondary)' }}>{workspace.name}</span>
          {' '}({workspace.branch})
        </div>

        <div className="flex flex-col gap-1">
          <label className="text-xs" style={{ color: 'var(--text-muted)' }}>Session Name</label>
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
            placeholder="e.g. auth-refactor"
            className="text-xs rounded px-3 py-2 outline-none border focus:border-blue-600 placeholder-gray-600"
            style={inputStyle}
          />
        </div>

        <div className="flex flex-col gap-2">
          <label className="text-xs" style={{ color: 'var(--text-muted)' }}>Agent</label>
          <div className="grid grid-cols-2 gap-2">
            {agents.map((agent) => (
              <button
                key={agent.id}
                onClick={() => setSelectedAgentId(agent.id)}
                className="flex flex-col gap-0.5 px-3 py-2 rounded border text-left transition-colors"
                style={{
                  borderColor: selectedAgentId === agent.id ? 'var(--accent)' : 'var(--border)',
                  backgroundColor: selectedAgentId === agent.id ? 'var(--bg-active)' : 'transparent',
                  color: selectedAgentId === agent.id ? 'var(--text-primary)' : 'var(--text-secondary)',
                }}
                onMouseEnter={(e) => {
                  if (selectedAgentId !== agent.id) {
                    e.currentTarget.style.borderColor = 'var(--text-muted)';
                    e.currentTarget.style.color = 'var(--text-primary)';
                  }
                }}
                onMouseLeave={(e) => {
                  if (selectedAgentId !== agent.id) {
                    e.currentTarget.style.borderColor = 'var(--border)';
                    e.currentTarget.style.color = 'var(--text-secondary)';
                  }
                }}
              >
                <span className="text-xs font-medium">{agent.name}</span>
                <span className="text-[10px] font-mono" style={{ color: 'var(--text-muted)' }}>{agent.command}</span>
              </button>
            ))}
          </div>
        </div>

        {selectedAgent && (
          <div
            className="text-[10px] font-mono px-3 py-2 rounded"
            style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--text-muted)' }}
          >
            $ {selectedAgent.command} {selectedAgent.args.join(' ')}
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
            onClick={handleCreate}
            disabled={createMutation.isPending || !name.trim() || !selectedAgentId}
            className="px-4 py-1.5 text-xs text-white rounded transition-colors disabled:opacity-50"
            style={{ backgroundColor: 'var(--accent)' }}
          >
            {createMutation.isPending ? 'Starting...' : 'Start Session'}
          </button>
        </div>
      </div>
    </div>
  );
}
