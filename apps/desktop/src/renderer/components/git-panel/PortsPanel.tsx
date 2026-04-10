import { trpc } from '../../lib/trpc';
import { useSessionStore } from '../../store/sessionStore';

export function PortsPanel() {
  const { sessions, activeSessionId } = useSessionStore();
  const activeSession = sessions.find((s) => s.id === activeSessionId);

  const isRunning = activeSession?.status === 'running';

  const portsQuery = trpc.session.getPorts.useQuery(
    { sessionId: activeSession?.id ?? '' },
    {
      enabled: !!activeSession?.id && isRunning,
      refetchInterval: 5_000,
    },
  );

  const openPortMutation = trpc.session.openPort.useMutation();

  const ports = portsQuery.data ?? [];

  if (!activeSession) {
    return (
      <div
        className="h-full flex items-center justify-center text-xs px-4 text-center"
        style={{ color: 'var(--text-muted)' }}
      >
        Select a session to view ports
      </div>
    );
  }

  if (!isRunning) {
    return (
      <div
        className="h-full flex items-center justify-center text-xs px-4 text-center"
        style={{ color: 'var(--text-muted)' }}
      >
        Session is not running
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full p-3 gap-2">
      <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
        {activeSession.name}
      </div>

      {portsQuery.isLoading ? (
        <div
          className="flex-1 flex items-center justify-center text-xs"
          style={{ color: 'var(--text-muted)' }}
        >
          Scanning ports...
        </div>
      ) : ports.length === 0 ? (
        <div
          className="flex-1 flex items-center justify-center text-xs"
          style={{ color: 'var(--text-muted)' }}
        >
          No ports detected
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto">
          <ul className="flex flex-col gap-1">
            {ports.map((port) => (
              <li
                key={port}
                className="flex items-center justify-between px-3 py-2 rounded text-xs"
                style={{ backgroundColor: 'var(--bg-secondary)' }}
              >
                <div className="flex items-center gap-2">
                  <span
                    className="inline-block w-2 h-2 rounded-full"
                    style={{ backgroundColor: 'var(--accent)' }}
                  />
                  <span style={{ color: 'var(--text-primary)' }}>
                    localhost:{port}
                  </span>
                </div>

                <button
                  onClick={() => openPortMutation.mutate({ port })}
                  className="px-2 py-1 text-xs rounded transition-colors hover:opacity-80"
                  style={{
                    backgroundColor: 'var(--accent)',
                    color: '#fff',
                  }}
                >
                  Open
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
