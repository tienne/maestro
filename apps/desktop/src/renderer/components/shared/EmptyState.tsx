/**
 * M8-02: 공통 빈 상태 UI 컴포넌트
 */

interface EmptyStateProps {
  icon: string;
  title: string;
  description?: string;
  action?: {
    label: string;
    onClick: () => void;
  };
}

export function EmptyState({ icon, title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-8 px-4 text-center">
      <span className="text-2xl" role="img" aria-hidden="true">
        {icon}
      </span>
      <div className="flex flex-col gap-1">
        <span className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
          {title}
        </span>
        {description && (
          <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
            {description}
          </span>
        )}
      </div>
      {action && (
        <button
          onClick={action.onClick}
          className="mt-1 px-3 py-1.5 text-xs font-medium rounded transition-colors text-white"
          style={{ backgroundColor: 'var(--accent)' }}
          onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--accent-hover)')}
          onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'var(--accent)')}
        >
          {action.label}
        </button>
      )}
    </div>
  );
}
