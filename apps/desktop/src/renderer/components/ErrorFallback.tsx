import type { FallbackProps } from 'react-error-boundary';

interface Props extends FallbackProps {
  /** 패널 이름 — 어느 영역에서 에러가 발생했는지 표시 */
  panelName?: string;
}

/**
 * 패널/전역 에러 바운더리 폴백 UI.
 * "새로고침" → resetErrorBoundary() (해당 패널만 리마운트)
 * "앱 재시작" → window.location.reload() (전체 새로고침)
 */
export function ErrorFallback({ error, resetErrorBoundary, panelName }: Props) {
  return (
    <div
      className="flex flex-col items-center justify-center h-full gap-4 p-6 text-center"
      style={{ backgroundColor: 'var(--bg-primary)', color: 'var(--text-primary)' }}
    >
      <div className="text-3xl">⚠️</div>
      <div className="flex flex-col gap-1">
        <p className="text-sm font-semibold">
          {panelName ? `${panelName} 패널에서 오류가 발생했습니다` : '예기치 않은 오류가 발생했습니다'}
        </p>
        <p className="text-xs font-mono" style={{ color: 'var(--text-muted)' }}>
          {(error as Error)?.message ?? '알 수 없는 오류'}
        </p>
      </div>
      <div className="flex gap-2">
        <button
          onClick={resetErrorBoundary}
          className="px-3 py-1.5 text-xs rounded transition-colors text-white"
          style={{ backgroundColor: 'var(--accent)' }}
        >
          새로고침
        </button>
        <button
          onClick={() => window.location.reload()}
          className="px-3 py-1.5 text-xs rounded transition-colors border"
          style={{ color: 'var(--text-secondary)', borderColor: 'var(--border)' }}
        >
          앱 재시작
        </button>
      </div>
    </div>
  );
}
