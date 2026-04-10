import { useSessionStore } from '../../store/sessionStore';
import { useAgentStore } from '../../store/agentStore';
import { useUiStore } from '../../store/uiStore';
import type { SessionStatus } from '@maestro/shared-types';

const STATUS_CONFIG: Record<SessionStatus, { label: string; color: string; dot: string }> = {
  running: { label: 'Running', color: '#73c991', dot: 'bg-green-400 animate-pulse' },
  pending: { label: 'Waiting', color: '#e2a94e', dot: 'bg-yellow-400' },
  stopped: { label: 'Stopped', color: 'var(--text-muted)', dot: 'bg-gray-400' },
  error: { label: 'Error', color: '#f14c4c', dot: 'bg-red-400' },
};

/**
 * 에이전트 진행 상태 대시보드.
 * - 전체 세션 상태 카운터
 * - 세션 카드: 에이전트명, 상태, 마지막 활동 시간
 * - 카드 클릭 → 해당 세션 탭 포커스
 */
export function AgentDashboard() {
  const sessions = useSessionStore((s) => s.sessions);
  const agents = useAgentStore((s) => s.agents);
  const { setPaneSession } = useUiStore();

  const agentMap = Object.fromEntries(agents.map((a) => [a.id, a]));

  const counts = {
    running: sessions.filter((s) => s.status === 'running').length,
    pending: sessions.filter((s) => s.status === 'pending').length,
    error: sessions.filter((s) => s.status === 'error').length,
    stopped: sessions.filter((s) => s.status === 'stopped').length,
  };

  const handleCardClick = (sessionId: string) => {
    setPaneSession(0, sessionId);
  };

  if (sessions.length === 0) {
    return (
      <div className="flex-1 flex items-center justify-center text-xs" style={{ color: 'var(--text-muted)' }}>
        세션 없음
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 p-3 overflow-y-auto h-full">
      {/* 요약 카운터 */}
      <div className="flex gap-2 flex-wrap">
        {counts.running > 0 && (
          <span className="text-[10px] px-2 py-0.5 rounded-full font-medium" style={{ backgroundColor: 'rgba(115,201,145,0.15)', color: '#73c991' }}>
            Running {counts.running}
          </span>
        )}
        {counts.pending > 0 && (
          <span className="text-[10px] px-2 py-0.5 rounded-full font-medium" style={{ backgroundColor: 'rgba(226,169,78,0.15)', color: '#e2a94e' }}>
            Waiting {counts.pending}
          </span>
        )}
        {counts.error > 0 && (
          <span className="text-[10px] px-2 py-0.5 rounded-full font-medium" style={{ backgroundColor: 'rgba(241,76,76,0.15)', color: '#f14c4c' }}>
            Error {counts.error}
          </span>
        )}
        {counts.stopped > 0 && (
          <span className="text-[10px] px-2 py-0.5 rounded-full font-medium" style={{ backgroundColor: 'var(--bg-primary)', color: 'var(--text-muted)' }}>
            Stopped {counts.stopped}
          </span>
        )}
      </div>

      {/* 세션 카드 목록 */}
      <div className="flex flex-col gap-1.5">
        {sessions.map((session) => {
          const config = STATUS_CONFIG[session.status];
          const agent = agentMap[session.agentId];
          const createdAt = new Date(session.createdAt);
          const relTime = formatRelTime(createdAt);

          return (
            <button
              key={session.id}
              onClick={() => handleCardClick(session.id)}
              className="flex flex-col gap-1 p-2.5 rounded-lg text-left transition-colors hover:bg-[var(--bg-hover)]"
              style={{ backgroundColor: 'var(--bg-primary)', border: '1px solid var(--border)' }}
            >
              {/* 헤더: 세션명 + 상태 dot */}
              <div className="flex items-center gap-2 justify-between">
                <span className="text-xs font-medium truncate" style={{ color: 'var(--text-primary)' }}>
                  {session.name}
                </span>
                <div className="flex items-center gap-1.5 flex-shrink-0">
                  <div className={`w-1.5 h-1.5 rounded-full ${config.dot}`} />
                  <span className="text-[10px]" style={{ color: config.color }}>
                    {config.label}
                  </span>
                </div>
              </div>

              {/* 에이전트 + 시간 */}
              <div className="flex items-center gap-2 text-[10px]" style={{ color: 'var(--text-muted)' }}>
                {agent && <span>{agent.name}</span>}
                <span className="ml-auto">{relTime}</span>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}

function formatRelTime(date: Date): string {
  const diff = Date.now() - date.getTime();
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  return `${hr}h ago`;
}
