import { useUiStore, type RelayStatus } from '../../store/uiStore';

const VIEW_LABEL: Record<string, string> = {
  terminal: '',
  repoSettings: 'Repository Settings',
  settings: 'Settings',
};

const RELAY_DOT_COLOR: Record<RelayStatus, string> = {
  connected: '#22c55e',   // 초록
  connecting: '#eab308',  // 노랑
  disconnected: '#ef4444', // 빨강
};

const RELAY_LABEL: Record<RelayStatus, string> = {
  connected: 'Relay Connected',
  connecting: 'Relay Connecting...',
  disconnected: 'Relay Off',
};

/**
 * 앱 최상단 타이틀바.
 * macOS hiddenInset 모드 — 신호등 버튼이 이 영역 왼쪽에 오버레이된다.
 * 전체가 draggable, 인터랙티브 요소는 no-drag 처리.
 */
export function TitleBar() {
  const { currentView, relayStatus, relayLatencyMs } = useUiStore();
  const label = VIEW_LABEL[currentView] ?? '';

  const latencyWarning = relayLatencyMs !== null && relayLatencyMs > 30;

  return (
    <div
      className="flex-shrink-0 flex items-center"
      style={{
        height: 38,
        backgroundColor: 'var(--bg-secondary)',
        borderBottom: '1px solid var(--border)',
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ...({ WebkitAppRegion: 'drag' } as any),
      }}
    >
      {/* macOS 신호등 버튼 영역 (약 72px) */}
      <div style={{ width: 72, flexShrink: 0 }} />

      {/* 현재 뷰 레이블 */}
      {label && (
        <span
          className="text-xs select-none"
          style={{ color: 'var(--text-muted)', letterSpacing: '0.02em' }}
        >
          {label}
        </span>
      )}

      {/* spacer */}
      <div className="flex-1" />

      {/* M6-05: Relay 상태 인디케이터 */}
      <div
        className="flex items-center gap-1.5 px-3 select-none"
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        style={{ ...({ WebkitAppRegion: 'no-drag' } as any) }}
        title={RELAY_LABEL[relayStatus]}
      >
        {relayLatencyMs !== null && relayStatus === 'connected' && (
          <span
            className="text-[10px] font-mono"
            style={{ color: latencyWarning ? '#eab308' : 'var(--text-muted)' }}
          >
            {relayLatencyMs}ms
          </span>
        )}
        <div
          style={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            backgroundColor: latencyWarning ? '#eab308' : RELAY_DOT_COLOR[relayStatus],
            boxShadow: `0 0 4px ${latencyWarning ? '#eab30880' : RELAY_DOT_COLOR[relayStatus] + '80'}`,
          }}
        />
      </div>
    </div>
  );
}
