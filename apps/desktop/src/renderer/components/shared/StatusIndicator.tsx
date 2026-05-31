import type { CSSProperties } from 'react';

export type StatusType = 'running' | 'idle' | 'success' | 'warning' | 'danger' | 'completed';

const STATUS_COLOR: Record<StatusType, string> = {
  running: 'var(--mk-status-running)',
  idle: 'var(--mk-status-idle)',
  success: 'var(--mk-status-success)',
  warning: 'var(--mk-status-warning)',
  danger: 'var(--mk-status-danger)',
  completed: 'var(--mk-status-completed)',
};

const STATUS_LABEL: Record<StatusType, string> = {
  running: 'running',
  idle: 'idle',
  success: 'success',
  warning: 'warning',
  danger: 'error',
  completed: 'completed',
};

interface Props {
  status: StatusType;
  size?: number;
  showLabel?: boolean;
  className?: string;
}

export function StatusIndicator({ status, size = 8, showLabel = false, className }: Props) {
  const color = STATUS_COLOR[status];
  const isRunning = status === 'running';

  const dotStyle: CSSProperties = {
    width: size,
    height: size,
    borderRadius: '50%',
    backgroundColor: color,
    flexShrink: 0,
    animation: isRunning ? 'mk-pulse 1.5s ease-in-out infinite' : undefined,
  };

  return (
    <span
      className={`inline-flex items-center gap-1.5 ${className ?? ''}`}
      role="status"
      aria-label={STATUS_LABEL[status]}
    >
      <style>{`
        @keyframes mk-pulse {
          0%, 100% { opacity: 1; transform: scale(1); }
          50% { opacity: 0.5; transform: scale(0.85); }
        }
      `}</style>
      <span style={dotStyle} />
      {showLabel && (
        <span style={{ color, fontSize: 11, fontWeight: 500, fontFamily: 'var(--mk-font-ui)' }}>
          {STATUS_LABEL[status]}
        </span>
      )}
    </span>
  );
}
