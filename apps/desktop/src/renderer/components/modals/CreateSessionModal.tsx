import { useState } from 'react';
import { useAgentStore } from '../../store/agentStore';
import { useSessionStore } from '../../store/sessionStore';
import { useUiStore } from '../../store/uiStore';
import { trpc } from '../../lib/trpc';
import { AgentIcon } from '../shared/AgentIcon';
import type { Workspace, Session, AgentPreset } from '@maestro/shared-types';

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
  const { addSession, sessions } = useSessionStore();
  const { activePaneIndex, setPaneSession, setCurrentView } = useUiStore();

  const [selectedAgentId, setSelectedAgentId] = useState(agents[0]?.id ?? '');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  // M4-01: 의존성 체인
  const [dependsOnSessionId, setDependsOnSessionId] = useState<string | null>(null);
  // M4-02: 컨텍스트 소스
  const [contextSourceSessionId, setContextSourceSessionId] = useState<string | null>(null);

  // M4-04: 프리셋
  const { data: presets } = trpc.preset.list.useQuery();

  const selectedAgent = agents.find((a) => a.id === selectedAgentId);

  // 현재 워크스페이스의 세션들 (의존성 선택용)
  const workspaceSessions = sessions.filter((s) => s.workspaceId === workspace.id);

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

  const presetLaunchMutation = trpc.preset.launch.useMutation({
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
    createMutation.mutate({
      name: name.trim(),
      workspaceId: workspace.id,
      agentId: selectedAgentId,
      dependsOnSessionId: dependsOnSessionId || null,
      contextSourceSessionId: contextSourceSessionId || null,
    });
  };

  const handlePresetLaunch = (preset: AgentPreset) => {
    presetLaunchMutation.mutate({ presetId: preset.id, cols: 120, rows: 40 });
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={onClose} role="dialog" aria-modal="true" aria-label="세션 생성">
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
            {agents.map((agent) => {
              const isSelected = selectedAgentId === agent.id;
              return (
                <button
                  key={agent.id}
                  onClick={() => setSelectedAgentId(agent.id)}
                  className="flex flex-col items-center gap-2 px-3 py-3 rounded border text-center transition-colors"
                  style={{
                    borderColor: isSelected ? 'var(--accent)' : 'var(--border)',
                    backgroundColor: isSelected ? 'var(--bg-active)' : 'transparent',
                    color: isSelected ? 'var(--text-primary)' : 'var(--text-secondary)',
                  }}
                  onMouseEnter={(e) => {
                    if (!isSelected) {
                      e.currentTarget.style.borderColor = 'var(--text-muted)';
                      e.currentTarget.style.color = 'var(--text-primary)';
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!isSelected) {
                      e.currentTarget.style.borderColor = 'var(--border)';
                      e.currentTarget.style.color = 'var(--text-secondary)';
                    }
                  }}
                >
                  <AgentIcon agent={agent} size="lg" />
                  <div className="flex flex-col gap-0.5">
                    <span className="text-xs font-medium leading-tight">{agent.name}</span>
                    <span className="text-[10px] font-mono" style={{ color: 'var(--text-muted)' }}>{agent.command}</span>
                  </div>
                </button>
              );
            })}
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

        {/* M4-01: Depends On (Pipeline) */}
        {workspaceSessions.length > 0 && (
          <div className="flex flex-col gap-1">
            <label className="text-xs" style={{ color: 'var(--text-muted)' }}>Depends On (Pipeline)</label>
            <select
              value={dependsOnSessionId ?? ''}
              onChange={(e) => setDependsOnSessionId(e.target.value || null)}
              className="text-xs rounded px-3 py-2 outline-none border"
              style={inputStyle}
            >
              <option value="">None</option>
              {workspaceSessions.map((s) => (
                <option key={s.id} value={s.id}>{s.name} ({s.status})</option>
              ))}
            </select>
          </div>
        )}

        {/* M4-02: Context Source */}
        {workspaceSessions.length > 0 && (
          <div className="flex flex-col gap-1">
            <label className="text-xs" style={{ color: 'var(--text-muted)' }}>Context Source Session</label>
            <select
              value={contextSourceSessionId ?? ''}
              onChange={(e) => setContextSourceSessionId(e.target.value || null)}
              className="text-xs rounded px-3 py-2 outline-none border"
              style={inputStyle}
            >
              <option value="">None</option>
              {workspaceSessions.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
            <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
              Last 100 lines (max 4000 chars) will be sent as input on launch
            </span>
          </div>
        )}

        {/* M4-04: From Preset */}
        {presets && presets.length > 0 && (
          <div className="flex flex-col gap-1">
            <label className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>From Preset</label>
            <div className="flex gap-2 flex-wrap">
              {(presets as AgentPreset[]).filter((p) => p.workspaceId === workspace.id).map((preset) => (
                <button
                  key={preset.id}
                  onClick={() => handlePresetLaunch(preset)}
                  disabled={presetLaunchMutation.isPending}
                  className="text-xs px-3 py-1.5 rounded border transition-colors"
                  style={{ borderColor: 'var(--accent)', color: 'var(--accent)' }}
                  onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--bg-active)')}
                  onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                >
                  {preset.name}
                </button>
              ))}
            </div>
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
