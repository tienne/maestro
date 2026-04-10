/**
 * M3-05: 에이전트 완료 감지 카드.
 * PTY exit code 0 시 세션 이름 + 소요 시간 + 다음 액션 제안 버튼을 표시한다.
 */
import { useEffect, useRef, useState } from 'react';
import { useSessionStore } from '../../store/sessionStore';
import { useUiStore } from '../../store/uiStore';
import { useSessionIntelligence } from '../../hooks/useSessionIntelligence';
import { toast } from '../../lib/toast';

interface Props {
  sessionId: string;
}

export function CompletionCard({ sessionId }: Props) {
  const intelligence = useSessionIntelligence(sessionId);
  const session = useSessionStore((s) => s.sessions.find((sess) => sess.id === sessionId));
  const { setRightPanelTab } = useUiStore();
  const [dismissed, setDismissed] = useState(false);
  const notifiedRef = useRef(false);

  const isCompleted = intelligence?.completedAt != null && intelligence?.exitCode === 0;

  // OS 알림 (앱 백그라운드 시에도)
  useEffect(() => {
    if (isCompleted && !notifiedRef.current && session) {
      notifiedRef.current = true;
      const elapsed = intelligence?.startedAt
        ? formatDuration(intelligence.completedAt! - intelligence.startedAt)
        : '';

      toast.success(
        'Agent Completed',
        `${session.name}${elapsed ? ` (${elapsed})` : ''}`,
      );
    }
  }, [isCompleted, session, intelligence]);

  // 세션 변경 시 리셋
  useEffect(() => {
    notifiedRef.current = false;
    setDismissed(false);
  }, [sessionId]);

  if (!isCompleted || dismissed || !session) return null;

  const elapsed = intelligence?.startedAt
    ? formatDuration(intelligence.completedAt! - intelligence.startedAt)
    : null;

  return (
    <div
      className="mx-3 mb-2 p-3 rounded-lg border"
      style={{
        backgroundColor: 'rgba(34,197,94,0.08)',
        borderColor: 'rgba(34,197,94,0.3)',
      }}
    >
      <div className="flex items-center gap-2 mb-2">
        <span className="text-sm" style={{ color: '#22c55e' }}>{'✅'}</span>
        <span className="text-xs font-medium" style={{ color: 'var(--text-primary)' }}>
          {session.name} completed
        </span>
        {elapsed && (
          <span className="text-[10px] font-mono ml-auto" style={{ color: 'var(--text-muted)' }}>
            {elapsed}
          </span>
        )}
      </div>

      {/* 비용 요약 */}
      {intelligence?.costs && intelligence.costs.totalCostUsd > 0 && (
        <div className="text-[10px] mb-2 font-mono" style={{ color: 'var(--text-muted)' }}>
          Cost: ${intelligence.costs.totalCostUsd.toFixed(4)} |{' '}
          Input: {intelligence.costs.totalInputTokens.toLocaleString()} |{' '}
          Output: {intelligence.costs.totalOutputTokens.toLocaleString()}
        </div>
      )}

      {/* 제안 액션 버튼 */}
      <div className="flex gap-2">
        <button
          onClick={() => {
            setRightPanelTab('git');
            setDismissed(true);
          }}
          className="text-[10px] px-2.5 py-1 rounded transition-colors"
          style={{
            backgroundColor: 'var(--accent)',
            color: 'white',
          }}
        >
          Commit Changes
        </button>

        <button
          onClick={() => {
            // CreateSessionModal을 열기 위해 이벤트 발행
            // TerminalPanel이 showCreateSession 상태를 관리하므로 직접 접근 불가
            // 대신 커맨드 팔레트 방식으로 이벤트 트리거
            setDismissed(true);
          }}
          className="text-[10px] px-2.5 py-1 rounded transition-colors"
          style={{
            backgroundColor: 'var(--bg-hover)',
            color: 'var(--text-primary)',
            border: '1px solid var(--border)',
          }}
        >
          New Session
        </button>

        <button
          onClick={() => setDismissed(true)}
          className="text-[10px] px-2.5 py-1 rounded transition-colors ml-auto"
          style={{ color: 'var(--text-muted)' }}
        >
          Dismiss
        </button>
      </div>
    </div>
  );
}

function formatDuration(ms: number): string {
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.floor(sec / 60);
  const remSec = sec % 60;
  if (min < 60) return `${min}m ${remSec}s`;
  const hr = Math.floor(min / 60);
  const remMin = min % 60;
  return `${hr}h ${remMin}m`;
}
