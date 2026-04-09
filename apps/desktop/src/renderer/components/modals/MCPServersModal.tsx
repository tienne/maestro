import { useState } from 'react';
import { useMcpStore, type McpServer } from '../../store/mcpStore';
import { trpc } from '../../lib/trpc';

interface Props {
  onClose: () => void;
}

const STATUS_DOT: Record<string, string> = {
  connected: 'bg-green-400',
  offline: 'bg-gray-500',
  error: 'bg-red-400',
};

const STATUS_LABEL: Record<string, string> = {
  connected: 'Connected',
  offline: 'Offline',
  error: 'Error',
};

export function MCPServersModal({ onClose }: Props) {
  const { servers, addServer, removeServer, updateServer } = useMcpStore();
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [addError, setAddError] = useState('');
  const [expandedError, setExpandedError] = useState<string | null>(null);

  const addMutation = trpc.mcp.add.useMutation({
    onSuccess: (server) => {
      addServer(server as McpServer);
      setName('');
      setUrl('');
    },
    onError: (e) => setAddError(e.message),
  });

  const deleteMutation = trpc.mcp.delete.useMutation({
    onSuccess: (_, vars) => removeServer(vars.id),
  });

  const toggleMutation = trpc.mcp.toggle.useMutation({
    onSuccess: (server) => updateServer(server as McpServer),
  });

  const handleAdd = () => {
    if (!name.trim() || !url.trim()) return;
    setAddError('');
    addMutation.mutate({ name: name.trim(), url: url.trim() });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/60" />
      <div
        className="relative rounded-xl shadow-2xl w-[480px] flex flex-col max-h-[80vh]"
        style={{ backgroundColor: 'var(--bg-panel)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b" style={{ borderColor: 'var(--border)' }}>
          <h2 className="text-sm font-semibold">MCP Servers</h2>
          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-md transition-colors text-lg"
            style={{ color: 'var(--text-secondary)' }}
            onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--bg-hover)')}
            onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
          >
            ×
          </button>
        </div>

        {/* Server list */}
        <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-2">
          {servers.length === 0 ? (
            <div className="text-xs text-center py-6" style={{ color: 'var(--text-muted)' }}>
              No MCP servers configured.
            </div>
          ) : (
            servers.map((server) => (
              <div
                key={server.id}
                className="rounded-lg p-3 flex flex-col gap-1.5"
                style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border)' }}
              >
                <div className="flex items-center gap-2">
                  <span
                    className={`w-2 h-2 rounded-full flex-shrink-0 ${STATUS_DOT[server.status] ?? 'bg-gray-500'} ${server.status === 'connected' ? 'animate-pulse' : ''}`}
                    title={STATUS_LABEL[server.status] ?? server.status}
                  />
                  <span className="text-xs font-medium flex-1 truncate" style={{ color: 'var(--text-primary)' }}>
                    {server.name}
                  </span>
                  <span
                    className="text-[10px] px-1.5 py-0.5 rounded"
                    style={{
                      backgroundColor:
                        server.status === 'connected'
                          ? 'rgba(34,197,94,0.1)'
                          : server.status === 'error'
                            ? 'rgba(239,68,68,0.1)'
                            : 'var(--bg-hover)',
                      color:
                        server.status === 'connected'
                          ? '#4ade80'
                          : server.status === 'error'
                            ? '#f87171'
                            : 'var(--text-muted)',
                    }}
                  >
                    {STATUS_LABEL[server.status] ?? server.status}
                  </span>
                  <button
                    onClick={() => toggleMutation.mutate({ id: server.id, enabled: !server.enabled })}
                    className="text-[10px] px-2 py-0.5 rounded transition-colors"
                    style={{
                      backgroundColor: server.enabled ? 'var(--accent)' : 'var(--bg-hover)',
                      color: server.enabled ? '#fff' : 'var(--text-muted)',
                    }}
                    title={server.enabled ? 'Disable' : 'Enable'}
                  >
                    {server.enabled ? 'ON' : 'OFF'}
                  </button>
                  <button
                    onClick={() => deleteMutation.mutate({ id: server.id })}
                    className="w-6 h-6 flex items-center justify-center rounded transition-colors text-sm"
                    style={{ color: 'var(--text-muted)' }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.backgroundColor = 'rgba(239,68,68,0.15)';
                      e.currentTarget.style.color = '#f87171';
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.backgroundColor = 'transparent';
                      e.currentTarget.style.color = 'var(--text-muted)';
                    }}
                    title="Remove server"
                  >
                    ×
                  </button>
                </div>

                <div className="text-[10px] font-mono truncate pl-4" style={{ color: 'var(--text-muted)' }}>
                  {server.url}
                </div>

                {server.status === 'error' && server.errorMsg && (
                  <div className="pl-4">
                    <button
                      onClick={() => setExpandedError(expandedError === server.id ? null : server.id)}
                      className="text-[10px] flex items-center gap-1"
                      style={{ color: '#f87171' }}
                    >
                      <span>{expandedError === server.id ? '▾' : '▸'}</span>
                      Error details
                    </button>
                    {expandedError === server.id && (
                      <div
                        className="mt-1 text-[10px] font-mono px-2 py-1 rounded"
                        style={{ backgroundColor: 'rgba(239,68,68,0.1)', color: '#f87171' }}
                      >
                        {server.errorMsg}
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))
          )}
        </div>

        {/* Add server form */}
        <div className="border-t p-4 flex flex-col gap-3" style={{ borderColor: 'var(--border)' }}>
          <div className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>Add Server</div>
          <div className="flex gap-2">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Name"
              className="flex-1 text-xs rounded px-2 py-1.5 outline-none"
              style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}
            />
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="URL (e.g. http://localhost:3000)"
              className="flex-[2] text-xs rounded px-2 py-1.5 outline-none font-mono"
              style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}
              onKeyDown={(e) => { if (e.key === 'Enter') handleAdd(); }}
            />
            <button
              onClick={handleAdd}
              disabled={addMutation.isPending || !name.trim() || !url.trim()}
              className="px-3 py-1.5 text-xs rounded transition-colors"
              style={{
                backgroundColor:
                  addMutation.isPending || !name.trim() || !url.trim()
                    ? 'var(--bg-hover)'
                    : 'var(--accent)',
                color:
                  addMutation.isPending || !name.trim() || !url.trim()
                    ? 'var(--text-muted)'
                    : '#fff',
              }}
            >
              {addMutation.isPending ? '...' : 'Add'}
            </button>
          </div>
          {addError && (
            <div
              className="text-xs px-2 py-1 rounded"
              style={{ backgroundColor: 'rgba(239,68,68,0.1)', color: '#f87171' }}
            >
              {addError}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
