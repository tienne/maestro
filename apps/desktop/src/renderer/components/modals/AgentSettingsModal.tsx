import { useState } from 'react';
import { useAgentStore } from '../../store/agentStore';
import { trpc } from '../../lib/trpc';
import { AgentIcon } from '../shared/AgentIcon';
import type { Agent } from '@maestro/shared-types';

interface Props {
  onClose: () => void;
}

interface AgentFormState {
  name: string;
  command: string;
  args: string;
  env: string;
}

const EMPTY_FORM: AgentFormState = { name: '', command: '', args: '', env: '' };

function agentToForm(agent: Agent): AgentFormState {
  return {
    name: agent.name,
    command: agent.command,
    args: agent.args.join(' '),
    env: Object.entries(agent.env)
      .map(([k, v]) => `${k}=${v}`)
      .join('\n'),
  };
}

function parseArgs(raw: string): string[] {
  return raw.trim().split(/\s+/).filter(Boolean);
}

function parseEnv(raw: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of raw.split('\n')) {
    const eq = line.indexOf('=');
    if (eq > 0) {
      result[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
    }
  }
  return result;
}

const fieldInputClass = 'text-xs rounded px-3 py-1.5 outline-none border focus:border-blue-600 disabled:opacity-50';
const fieldInputStyle = {
  backgroundColor: 'var(--bg-secondary)',
  color: 'var(--text-primary)',
  borderColor: 'var(--border)',
};

export function AgentSettingsModal({ onClose }: Props) {
  const { agents, addAgent, updateAgent: updateAgentStore, removeAgent } = useAgentStore();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [form, setForm] = useState<AgentFormState>(EMPTY_FORM);
  const [isNew, setIsNew] = useState(false);
  const [error, setError] = useState('');

  const selectedAgent = agents.find((a) => a.id === selectedId);

  const createMutation = trpc.agent.create.useMutation({
    onSuccess: (agent) => {
      addAgent(agent as Agent);
      setSelectedId((agent as Agent).id);
      setIsNew(false);
    },
    onError: (e) => setError(e.message),
  });

  const updateMutation = trpc.agent.update.useMutation({
    onSuccess: (agent) => updateAgentStore(agent as Agent),
    onError: (e) => setError(e.message),
  });

  const deleteMutation = trpc.agent.delete.useMutation({
    onSuccess: () => {
      if (selectedId) removeAgent(selectedId);
      setSelectedId(null);
      setForm(EMPTY_FORM);
      setIsNew(false);
    },
    onError: (e) => setError(e.message),
  });

  const handleSelect = (agent: Agent) => {
    setSelectedId(agent.id);
    setForm(agentToForm(agent));
    setIsNew(false);
    setError('');
  };

  const handleNew = () => {
    setSelectedId(null);
    setForm(EMPTY_FORM);
    setIsNew(true);
    setError('');
  };

  const handleSave = () => {
    if (!form.name.trim() || !form.command.trim()) {
      setError('Name and command are required');
      return;
    }
    setError('');
    const args = parseArgs(form.args);
    const env = parseEnv(form.env);
    if (isNew) {
      createMutation.mutate({ name: form.name, command: form.command, args, env });
    } else if (selectedId) {
      updateMutation.mutate({ id: selectedId, name: form.name, command: form.command, args, env });
    }
  };

  const handleDelete = () => {
    if (!selectedId) return;
    setError('');
    deleteMutation.mutate({ id: selectedId });
  };

  const isSaving = createMutation.isPending || updateMutation.isPending || deleteMutation.isPending;

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={onClose}>
      <div
        className="rounded-lg w-[640px] h-[480px] flex overflow-hidden border"
        style={{ backgroundColor: 'var(--bg-panel)', borderColor: 'var(--border)' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Left: agent list */}
        <div className="w-44 flex flex-col border-r" style={{ borderColor: 'var(--border)' }}>
          <div
            className="flex items-center justify-between px-3 py-2 border-b"
            style={{ borderColor: 'var(--border)' }}
          >
            <span className="text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>
              Agents
            </span>
            <button
              onClick={handleNew}
              className="text-base leading-none"
              style={{ color: 'var(--text-secondary)' }}
              onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--text-primary)')}
              onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--text-secondary)')}
              title="New agent"
            >
              +
            </button>
          </div>
          <div className="flex-1 overflow-y-auto">
            {agents.map((agent) => (
              <button
                key={agent.id}
                onClick={() => handleSelect(agent)}
                className="w-full flex items-center gap-2 px-3 py-2 text-left text-xs border-b transition-colors"
                style={{
                  borderColor: 'var(--border)',
                  backgroundColor: selectedId === agent.id ? 'var(--bg-hover)' : 'transparent',
                  color: selectedId === agent.id ? 'var(--text-primary)' : 'var(--text-secondary)',
                }}
                onMouseEnter={(e) => {
                  if (selectedId !== agent.id) e.currentTarget.style.backgroundColor = 'var(--bg-hover)';
                }}
                onMouseLeave={(e) => {
                  if (selectedId !== agent.id) e.currentTarget.style.backgroundColor = 'transparent';
                }}
              >
                <AgentIcon agent={agent} size="sm" />
                <div className="flex flex-col min-w-0">
                  <span className="truncate">{agent.name}</span>
                  {agent.isBuiltIn && (
                    <span className="text-[9px]" style={{ color: 'var(--text-muted)' }}>built-in</span>
                  )}
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Right: form */}
        <div className="flex-1 flex flex-col">
          <div
            className="flex items-center justify-between px-4 py-2 border-b"
            style={{ borderColor: 'var(--border)' }}
          >
            <span className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>
              {isNew ? 'New Agent' : selectedAgent ? selectedAgent.name : 'Agent Settings'}
            </span>
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

          {(isNew || selectedId) ? (
            <div className="flex-1 overflow-y-auto px-4 py-3 flex flex-col gap-3">
              <div className="flex flex-col gap-1">
                <label className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
                  Name
                </label>
                <input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  disabled={selectedAgent?.isBuiltIn}
                  className={fieldInputClass}
                  style={fieldInputStyle}
                />
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
                  Command
                </label>
                <input
                  value={form.command}
                  onChange={(e) => setForm({ ...form, command: e.target.value })}
                  disabled={selectedAgent?.isBuiltIn}
                  placeholder="e.g. claude"
                  className={`${fieldInputClass} font-mono`}
                  style={fieldInputStyle}
                />
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
                  Args{' '}
                  <span className="normal-case" style={{ color: 'var(--text-muted)' }}>
                    (space-separated)
                  </span>
                </label>
                <input
                  value={form.args}
                  onChange={(e) => setForm({ ...form, args: e.target.value })}
                  disabled={selectedAgent?.isBuiltIn}
                  placeholder="e.g. --dangerously-skip-permissions"
                  className={`${fieldInputClass} font-mono`}
                  style={fieldInputStyle}
                />
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
                  Env{' '}
                  <span className="normal-case" style={{ color: 'var(--text-muted)' }}>
                    (KEY=value per line)
                  </span>
                </label>
                <textarea
                  value={form.env}
                  onChange={(e) => setForm({ ...form, env: e.target.value })}
                  disabled={selectedAgent?.isBuiltIn}
                  placeholder="OPENAI_API_KEY=sk-..."
                  rows={3}
                  className={`${fieldInputClass} font-mono resize-none`}
                  style={fieldInputStyle}
                />
              </div>

              {/* Preview */}
              <div
                className="text-[10px] font-mono px-3 py-2 rounded"
                style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--text-muted)' }}
              >
                $ {form.command || '<command>'} {form.args}
              </div>

              {error && (
                <div className="text-xs text-red-400 bg-red-900/30 px-3 py-2 rounded">{error}</div>
              )}
            </div>
          ) : (
            <div className="flex-1 flex items-center justify-center text-xs" style={{ color: 'var(--text-muted)' }}>
              Select an agent or create a new one
            </div>
          )}

          {/* Footer actions */}
          <div
            className="border-t px-4 py-2 flex items-center justify-between"
            style={{ borderColor: 'var(--border)' }}
          >
            <div>
              {selectedId && !selectedAgent?.isBuiltIn && (
                <button
                  onClick={handleDelete}
                  disabled={isSaving}
                  className="text-xs text-red-500 hover:text-red-400 disabled:opacity-50"
                >
                  Delete
                </button>
              )}
            </div>
            <div className="flex gap-2">
              <button
                onClick={onClose}
                className="px-3 py-1.5 text-xs transition-colors"
                style={{ color: 'var(--text-secondary)' }}
                onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--text-primary)')}
                onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--text-secondary)')}
              >
                Close
              </button>
              {(isNew || (selectedId && !selectedAgent?.isBuiltIn)) && (
                <button
                  onClick={handleSave}
                  disabled={isSaving}
                  className="px-4 py-1.5 text-xs text-white rounded transition-colors disabled:opacity-50"
                  style={{ backgroundColor: 'var(--accent)' }}
                >
                  {isSaving ? 'Saving...' : 'Save'}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
