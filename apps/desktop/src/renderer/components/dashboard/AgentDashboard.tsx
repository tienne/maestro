import { Suspense, useEffect, useRef, useState, Component, type ReactNode } from 'react';
import { useSessionStore } from '../../store/sessionStore';
import { useSettingsStore } from '../../store/settingsStore';
import { useAgentStore } from '../../store/agentStore';
import { useUiStore } from '../../store/uiStore';
import { useResourceMetrics } from '../../hooks/useResourceMetrics';
import { useResourceHistory, type ResourceHistoryPoint } from '../../hooks/useResourceHistory';
import { trpc } from '../../lib/trpc';
import { toast } from '../../lib/toast';
import type { SessionStatus, SessionIntelligence } from '@maestro/shared-types';
import { StatusIndicator } from '../shared/StatusIndicator';
import type { StatusType } from '../shared/StatusIndicator';

const STATUS_CONFIG: Record<SessionStatus, { label: string; color: string; dot: string; statusType: StatusType }> = {
  running: { label: 'Running', color: 'var(--mk-status-running)', dot: '', statusType: 'running' },
  pending: { label: 'Waiting', color: 'var(--mk-status-warning)', dot: '', statusType: 'warning' },
  stopped: { label: 'Stopped', color: 'var(--mk-status-idle)', dot: '', statusType: 'idle' },
  error: { label: 'Error', color: 'var(--mk-status-danger)', dot: '', statusType: 'danger' },
  blocked: { label: 'Blocked', color: 'var(--mk-status-warning)', dot: '', statusType: 'warning' },
};

/**
 * 에이전트 진행 상태 대시보드.
 * - 전체 세션 상태 카운터
 * - 세션 카드: 에이전트명, 상태, 마지막 활동 시간
 * - 카드 클릭 → 해당 세션 탭 포커스
 */
type FilterStatus = SessionStatus | 'all';

const FILTER_OPTIONS: { value: FilterStatus; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'running', label: 'Running' },
  { value: 'pending', label: 'Waiting' },
  { value: 'stopped', label: 'Done' },
  { value: 'error', label: 'Error' },
  { value: 'blocked', label: 'Blocked' },
];

export function AgentDashboard() {
  const sessions = useSessionStore((s) => s.sessions);
  const statusFilter = useSessionStore((s) => s.statusFilter);
  const setStatusFilter = useSessionStore((s) => s.setStatusFilter);
  const agents = useAgentStore((s) => s.agents);
  const { setPaneSession } = useUiStore();
  const metricsMap = useResourceMetrics();
  const historyMap = useResourceHistory();

  const stopAllMutation = trpc.session.stopAll.useMutation({
    onSuccess: (result) => {
      toast.success('세션 일괄 정지', `${result.stopped}개 세션 정지됨`);
    },
  });

  const restartAllErrorsMutation = trpc.session.restartAllErrors.useMutation({
    onSuccess: (result) => {
      toast.success('에러 세션 재시작', `${result.restarted}개 세션 재시작됨`);
    },
  });

  const agentMap = Object.fromEntries(agents.map((a) => [a.id, a]));

  const counts: Record<string, number> = {
    running: sessions.filter((s) => s.status === 'running').length,
    pending: sessions.filter((s) => s.status === 'pending').length,
    error: sessions.filter((s) => s.status === 'error').length,
    stopped: sessions.filter((s) => s.status === 'stopped').length,
    blocked: sessions.filter((s) => s.status === 'blocked').length,
  };

  // M4-01: 세션 의존성 맵 (dependsOnSessionId -> sessionId[])
  const dependencyMap = new Map<string, string[]>();
  for (const s of sessions) {
    if (s.dependsOnSessionId) {
      const deps = dependencyMap.get(s.dependsOnSessionId) ?? [];
      deps.push(s.id);
      dependencyMap.set(s.dependsOnSessionId, deps);
    }
  }

  const filteredSessions = statusFilter === 'all'
    ? sessions
    : sessions.filter((s) => s.status === statusFilter);

  const handleCardClick = (sessionId: string) => {
    setPaneSession(0, sessionId);
  };

  if (sessions.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 py-8 px-4 text-center">
        <span className="text-2xl" role="img" aria-hidden="true">📊</span>
        <span className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
          활성 세션이 없습니다
        </span>
        <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
          에이전트 세션을 시작하면 여기에 상태가 표시됩니다
        </span>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2 p-3 overflow-y-auto h-full">
      {/* M4-03: 필터 + 일괄 제어 */}
      <div className="flex items-center gap-2 flex-wrap">
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as FilterStatus)}
          className="text-[10px] px-2 py-1 rounded border outline-none"
          style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--text-primary)', borderColor: 'var(--border)' }}
        >
          {FILTER_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>{opt.label}</option>
          ))}
        </select>

        {counts.running > 0 && (
          <button
            onClick={() => stopAllMutation.mutate()}
            disabled={stopAllMutation.isPending}
            className="text-[10px] px-2 py-1 rounded font-medium transition-colors"
            style={{ backgroundColor: 'rgba(241,76,76,0.15)', color: '#f14c4c' }}
          >
            Stop All ({counts.running})
          </button>
        )}
        {counts.error > 0 && (
          <button
            onClick={() => restartAllErrorsMutation.mutate()}
            disabled={restartAllErrorsMutation.isPending}
            className="text-[10px] px-2 py-1 rounded font-medium transition-colors"
            style={{ backgroundColor: 'rgba(226,169,78,0.15)', color: '#e2a94e' }}
          >
            Restart Errors ({counts.error})
          </button>
        )}
      </div>

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
        {counts.blocked > 0 && (
          <span className="text-[10px] px-2 py-0.5 rounded-full font-medium" style={{ backgroundColor: 'rgba(249,115,22,0.15)', color: '#f97316' }}>
            Blocked {counts.blocked}
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
        {filteredSessions.map((session) => (
          <SessionCard
            key={session.id}
            session={session}
            agent={agentMap[session.agentId]}
            metrics={metricsMap[session.id]}
            history={historyMap[session.id]}
            dependents={dependencyMap.get(session.id)}
            dependsOn={session.dependsOnSessionId ? sessions.find((s) => s.id === session.dependsOnSessionId)?.name : undefined}
            onClick={() => handleCardClick(session.id)}
          />
        ))}
      </div>
    </div>
  );
}

// ── SessionIntelligenceContent — useSuspenseQuery 패턴 ───────────────────────

function SessionIntelligenceContent({
  sessionId,
  session,
  config,
  cpuExceeded,
  memExceeded,
  metrics,
  agent,
  history,
  dependents,
  dependsOn,
  relTime,
}: {
  sessionId: string;
  session: { name: string; lastExitCode?: number | null };
  config: { label: string; color: string; dot: string; statusType: StatusType };
  cpuExceeded: boolean;
  memExceeded: boolean;
  metrics?: { cpu: number; memory: number };
  agent?: { name: string };
  history?: ResourceHistoryPoint[];
  dependents?: string[];
  dependsOn?: string;
  relTime: string;
}) {
  const memMb = metrics ? metrics.memory / 1024 / 1024 : 0;

  // M3: 인텔리전스 쿼리 — useSuspenseQuery 패턴 (Suspense 경계 안에서 렌더링)
  const [intelligence] = trpc.session.getIntelligence.useSuspenseQuery(
    { sessionId },
    { refetchInterval: 5000 },
  );

  const tasks = (intelligence as SessionIntelligence | null)?.tasks ?? [];
  const doneTasks = tasks.filter((t) => t.status === 'done').length;
  const totalTasks = tasks.length;
  const progressPct = totalTasks > 0 ? Math.round((doneTasks / totalTasks) * 100) : 0;
  const costUsd = (intelligence as SessionIntelligence | null)?.costs?.totalCostUsd ?? 0;
  const lastError = (intelligence as SessionIntelligence | null)?.lastError;

  return (
    <>
      {/* 헤더: 세션명 + 상태 dot */}
      <div className="flex items-center gap-2 justify-between">
        <span className="text-xs font-medium truncate" style={{ color: 'var(--text-primary)' }}>
          {session.name}
        </span>
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {/* M7-04: exit code 표시 */}
          {session.lastExitCode != null && session.lastExitCode !== 0 && (
            <span
              className="text-[9px] px-1 rounded font-mono font-bold"
              style={{ backgroundColor: 'rgba(241,76,76,0.15)', color: '#f14c4c' }}
              title={`Exit code: ${session.lastExitCode}`}
            >
              exit {session.lastExitCode}
            </span>
          )}
          {/* M3-04: 에러 뱃지 */}
          {lastError && (
            <span
              className="text-[9px] px-1 rounded font-bold"
              style={{ backgroundColor: 'rgba(241,76,76,0.15)', color: '#f14c4c' }}
              title={(lastError as { message: string }).message}
            >
              {(lastError as { type: string }).type}
            </span>
          )}
          <StatusIndicator status={config.statusType} size={6} />
          <span className="text-[10px]" style={{ color: config.color }}>
            {config.label}
          </span>
        </div>
      </div>

      {/* M3-02: 작업 진행률 바 */}
      {totalTasks > 0 && (
        <div className="flex items-center gap-2">
          <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ backgroundColor: 'var(--bg-hover)' }}>
            <div
              className="h-full rounded-full transition-all"
              style={{
                width: `${progressPct}%`,
                backgroundColor: progressPct === 100 ? '#22c55e' : '#818cf8',
              }}
            />
          </div>
          <span className="text-[9px] font-mono flex-shrink-0" style={{ color: 'var(--text-muted)' }}>
            {doneTasks}/{totalTasks}
          </span>
        </div>
      )}

      {/* 에이전트 + 메트릭 + 비용 + 시간 */}
      <div className="flex items-center gap-2 text-[10px]" style={{ color: 'var(--text-muted)' }}>
        {agent && <span>{agent.name}</span>}
        {metrics && (
          <>
            <span
              className="font-mono"
              style={{ color: cpuExceeded ? '#f14c4c' : 'var(--text-muted)' }}
            >
              CPU {metrics.cpu.toFixed(1)}%
            </span>
            <span
              className="font-mono"
              style={{ color: memExceeded ? '#f14c4c' : 'var(--text-muted)' }}
            >
              {memMb.toFixed(0)}MB
            </span>
          </>
        )}
        {/* M3-01: 비용 */}
        {costUsd > 0 && (
          <span className="font-mono" style={{ color: '#22c55e' }}>
            ${costUsd.toFixed(2)}
          </span>
        )}
        <span className="ml-auto">{relTime}</span>
      </div>

      {/* M4-01: 의존성 관계 표시 */}
      {dependsOn && (
        <div className="text-[9px] flex items-center gap-1" style={{ color: 'var(--text-muted)' }}>
          <span style={{ color: '#f97316' }}>{'<-'}</span> depends on: {dependsOn}
        </div>
      )}
      {dependents && dependents.length > 0 && (
        <div className="text-[9px] flex items-center gap-1" style={{ color: 'var(--text-muted)' }}>
          <span style={{ color: '#818cf8' }}>{'->'}</span> {dependents.length} dependent(s)
        </div>
      )}

      {/* M7-02: 리소스 히스토리 미니 차트 */}
      {history && history.length > 1 && <MiniResourceChart history={history} />}
    </>
  );
}

// ── SessionCardErrorBoundary ──────────────────────────────────────────────────

class SessionCardErrorBoundary extends Component<
  { children: ReactNode; sessionName: string; config: { label: string; color: string; dot: string; statusType: StatusType } },
  { error: Error | null }
> {
  state = { error: null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  render() {
    if (this.state.error) {
      return (
        <div className="flex items-center gap-2 justify-between">
          <span className="text-xs font-medium truncate" style={{ color: 'var(--text-primary)' }}>
            {this.props.sessionName}
          </span>
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <StatusIndicator status={this.props.config.statusType} size={6} />
            <span className="text-[10px]" style={{ color: this.props.config.color }}>
              {this.props.config.label}
            </span>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

/** M3+M4+M7: 개별 세션 카드 — 인텔리전스 + 의존성 + 리소스 임계값 표시 */
function SessionCard({
  session,
  agent,
  metrics,
  history,
  dependents,
  dependsOn,
  onClick,
}: {
  session: { id: string; name: string; status: SessionStatus; createdAt: string; lastExitCode?: number | null };
  agent?: { name: string };
  metrics?: { cpu: number; memory: number };
  history?: ResourceHistoryPoint[];
  dependents?: string[];
  dependsOn?: string;
  onClick: () => void;
}) {
  const config = STATUS_CONFIG[session.status];
  const createdAt = new Date(session.createdAt);
  const relTime = formatRelTime(createdAt);

  // M7-02: 리소스 임계값
  const cpuAlertThreshold = useSettingsStore((s) => s.cpuAlertThreshold);
  const memAlertThresholdMb = useSettingsStore((s) => s.memAlertThresholdMb);
  const memMb = metrics ? metrics.memory / 1024 / 1024 : 0;
  const cpuExceeded = metrics ? metrics.cpu > cpuAlertThreshold : false;
  const memExceeded = metrics ? memMb > memAlertThresholdMb : false;
  const resourceAlert = cpuExceeded || memExceeded;

  // M7-02: 임계값 초과 시 토스트 알림 (세션당 1회)
  const alertedRef = useRef(false);
  useEffect(() => {
    if (resourceAlert && !alertedRef.current) {
      alertedRef.current = true;
      const parts: string[] = [];
      if (cpuExceeded) parts.push(`CPU ${metrics!.cpu.toFixed(1)}%`);
      if (memExceeded) parts.push(`MEM ${memMb.toFixed(0)}MB`);
      toast.error(`Resource Alert: ${session.name}`, parts.join(', '));
    }
    if (!resourceAlert) alertedRef.current = false;
  }, [resourceAlert, cpuExceeded, memExceeded, memMb, metrics, session.name]);

  // 카드 헤더 skeleton — Suspense fallback으로 사용
  const cardHeaderFallback = (
    <div className="flex items-center gap-2 justify-between">
      <span className="text-xs font-medium truncate" style={{ color: 'var(--text-primary)' }}>
        {session.name}
      </span>
      <div className="flex items-center gap-1.5 flex-shrink-0">
        <StatusIndicator status={config.statusType} size={6} />
        <span className="text-[10px]" style={{ color: config.color }}>
          {config.label}
        </span>
      </div>
    </div>
  );

  return (
    <button
      onClick={onClick}
      className="flex flex-col gap-1 p-2.5 rounded-lg text-left transition-colors hover:bg-[var(--bg-hover)]"
      style={{
        backgroundColor: 'var(--bg-primary)',
        border: resourceAlert ? '2px solid #f14c4c' : '1px solid var(--border)',
      }}
    >
      <Suspense fallback={cardHeaderFallback}>
        <SessionCardErrorBoundary sessionName={session.name} config={config}>
          <SessionIntelligenceContent
            sessionId={session.id}
            session={session}
            config={config}
            cpuExceeded={cpuExceeded}
            memExceeded={memExceeded}
            metrics={metrics}
            agent={agent}
            history={history}
            dependents={dependents}
            dependsOn={dependsOn}
            relTime={relTime}
          />
        </SessionCardErrorBoundary>
      </Suspense>
    </button>
  );
}

/** M7-02: SVG 미니 라인 차트 — CPU(파란) + 메모리(초록) */
function MiniResourceChart({ history }: { history: ResourceHistoryPoint[] }) {
  const W = 200;
  const H = 32;
  const pad = 2;

  const cpuMax = Math.max(100, ...history.map((p) => p.cpu));
  const memMax = Math.max(512, ...history.map((p) => p.memMb));

  const toPath = (values: number[], max: number): string => {
    const step = (W - pad * 2) / Math.max(values.length - 1, 1);
    return values
      .map((v, i) => {
        const x = pad + i * step;
        const y = H - pad - ((v / max) * (H - pad * 2));
        return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');
  };

  const cpuPath = toPath(history.map((p) => p.cpu), cpuMax);
  const memPath = toPath(history.map((p) => p.memMb), memMax);

  return (
    <svg width={W} height={H} className="w-full" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
      <path d={cpuPath} fill="none" stroke="#818cf8" strokeWidth="1.5" opacity="0.7" />
      <path d={memPath} fill="none" stroke="#34d399" strokeWidth="1.5" opacity="0.7" />
    </svg>
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
