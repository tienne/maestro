'use client';

import { useState } from 'react';
import { useAgentStore } from '@/store/agentStore';
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

export function AgentSettingsModal({ onClose }: Props) {
  const { agents, createAgent, updateAgent, deleteAgent } = useAgentStore();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [form, setForm] = useState<AgentFormState>(EMPTY_FORM);
  const [isNew, setIsNew] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const selectedAgent = agents.find((a) => a.id === selectedId);

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

  const handleSave = async () => {
    if (!form.name.trim() || !form.command.trim()) {
      setError('Name and command are required');
      return;
    }
    setLoading(true);
    setError('');
    try {
      const args = parseArgs(form.args);
      const env = parseEnv(form.env);
      if (isNew) {
        const agent = await createAgent(form.name, form.command, args, env);
        setSelectedId(agent.id);
        setIsNew(false);
      } else if (selectedId) {
        await updateAgent(selectedId, form.name, form.command, args, env);
      }
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!selectedId) return;
    setLoading(true);
    setError('');
    try {
      await deleteAgent(selectedId);
      setSelectedId(null);
      setForm(EMPTY_FORM);
      setIsNew(false);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={onClose}>
      <div
        className="bg-gray-900 border border-gray-700 rounded-lg w-[640px] h-[480px] flex overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Left: agent list */}
        <div className="w-44 border-r border-gray-800 flex flex-col">
          <div className="flex items-center justify-between px-3 py-2 border-b border-gray-800">
            <span className="text-xs font-semibold text-gray-400">Agents</span>
            <button
              onClick={handleNew}
              className="text-gray-400 hover:text-gray-200 text-base leading-none"
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
                className={`w-full flex flex-col px-3 py-2 text-left text-xs border-b border-gray-800/50 hover:bg-gray-800 transition-colors ${
                  selectedId === agent.id ? 'bg-gray-800 text-gray-100' : 'text-gray-400'
                }`}
              >
                <span className="truncate">{agent.name}</span>
                {agent.isBuiltIn && (
                  <span className="text-[9px] text-gray-600">built-in</span>
                )}
              </button>
            ))}
          </div>
        </div>

        {/* Right: form */}
        <div className="flex-1 flex flex-col">
          <div className="flex items-center justify-between px-4 py-2 border-b border-gray-800">
            <span className="text-xs font-semibold text-gray-200">
              {isNew ? 'New Agent' : selectedAgent ? selectedAgent.name : 'Agent Settings'}
            </span>
            <button onClick={onClose} className="text-gray-500 hover:text-gray-300 text-lg">×</button>
          </div>

          {(isNew || selectedId) ? (
            <div className="flex-1 overflow-y-auto px-4 py-3 flex flex-col gap-3">
              <div className="flex flex-col gap-1">
                <label className="text-[10px] text-gray-500 uppercase tracking-wider">Name</label>
                <input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  disabled={selectedAgent?.isBuiltIn}
                  className="bg-gray-800 text-gray-100 text-xs rounded px-3 py-1.5 outline-none border border-gray-700 focus:border-blue-600 disabled:opacity-50"
                />
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-[10px] text-gray-500 uppercase tracking-wider">Command</label>
                <input
                  value={form.command}
                  onChange={(e) => setForm({ ...form, command: e.target.value })}
                  disabled={selectedAgent?.isBuiltIn}
                  placeholder="e.g. claude"
                  className="bg-gray-800 text-gray-100 text-xs font-mono rounded px-3 py-1.5 outline-none border border-gray-700 focus:border-blue-600 disabled:opacity-50"
                />
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-[10px] text-gray-500 uppercase tracking-wider">
                  Args <span className="normal-case text-gray-600">(space-separated)</span>
                </label>
                <input
                  value={form.args}
                  onChange={(e) => setForm({ ...form, args: e.target.value })}
                  disabled={selectedAgent?.isBuiltIn}
                  placeholder="e.g. --dangerously-skip-permissions"
                  className="bg-gray-800 text-gray-100 text-xs font-mono rounded px-3 py-1.5 outline-none border border-gray-700 focus:border-blue-600 disabled:opacity-50"
                />
              </div>

              <div className="flex flex-col gap-1">
                <label className="text-[10px] text-gray-500 uppercase tracking-wider">
                  Env <span className="normal-case text-gray-600">(KEY=value per line)</span>
                </label>
                <textarea
                  value={form.env}
                  onChange={(e) => setForm({ ...form, env: e.target.value })}
                  disabled={selectedAgent?.isBuiltIn}
                  placeholder="OPENAI_API_KEY=sk-..."
                  rows={3}
                  className="bg-gray-800 text-gray-100 text-xs font-mono rounded px-3 py-1.5 outline-none border border-gray-700 focus:border-blue-600 resize-none disabled:opacity-50"
                />
              </div>

              {/* Preview */}
              <div className="text-[10px] font-mono text-gray-600 bg-gray-800 px-3 py-2 rounded">
                $ {form.command || '<command>'} {form.args}
              </div>

              {error && (
                <div className="text-xs text-red-400 bg-red-900/30 px-3 py-2 rounded">{error}</div>
              )}
            </div>
          ) : (
            <div className="flex-1 flex items-center justify-center text-xs text-gray-600">
              Select an agent or create a new one
            </div>
          )}

          {/* Footer actions */}
          <div className="border-t border-gray-800 px-4 py-2 flex items-center justify-between">
            <div>
              {selectedId && !selectedAgent?.isBuiltIn && (
                <button
                  onClick={handleDelete}
                  disabled={loading}
                  className="text-xs text-red-500 hover:text-red-400 disabled:opacity-50"
                >
                  Delete
                </button>
              )}
            </div>
            <div className="flex gap-2">
              <button onClick={onClose} className="px-3 py-1.5 text-xs text-gray-400 hover:text-gray-200">
                Close
              </button>
              {(isNew || (selectedId && !selectedAgent?.isBuiltIn)) && (
                <button
                  onClick={handleSave}
                  disabled={loading}
                  className="px-4 py-1.5 text-xs bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 text-white rounded transition-colors"
                >
                  {loading ? 'Saving...' : 'Save'}
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
