/**
 * M8-03: 공통 툴팁 컴포넌트
 *
 * hover 시 지연(300ms) 후 표시, 단축키 힌트 지원.
 */

import { useState, useRef, useCallback, type ReactNode } from 'react';

interface TooltipProps {
  content: string;
  /** 단축키 힌트 (ex: "Cmd+N") */
  shortcut?: string;
  /** 위치 */
  position?: 'top' | 'bottom' | 'left' | 'right';
  children: ReactNode;
}

export function Tooltip({ content, shortcut, position = 'top', children }: TooltipProps) {
  const [visible, setVisible] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = useCallback(() => {
    timerRef.current = setTimeout(() => setVisible(true), 300);
  }, []);

  const hide = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    setVisible(false);
  }, []);

  const positionClasses: Record<string, string> = {
    top: 'bottom-full left-1/2 -translate-x-1/2 mb-1.5',
    bottom: 'top-full left-1/2 -translate-x-1/2 mt-1.5',
    left: 'right-full top-1/2 -translate-y-1/2 mr-1.5',
    right: 'left-full top-1/2 -translate-y-1/2 ml-1.5',
  };

  return (
    <div
      className="relative inline-flex"
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
    >
      {children}
      {visible && (
        <div
          className={`absolute z-50 px-2 py-1 rounded shadow-lg whitespace-nowrap pointer-events-none ${positionClasses[position]}`}
          style={{
            backgroundColor: 'var(--bg-panel)',
            border: '1px solid var(--border)',
            color: 'var(--text-primary)',
          }}
          role="tooltip"
        >
          <span className="text-[11px]">{content}</span>
          {shortcut && (
            <span
              className="ml-2 text-[10px] font-mono px-1 py-0.5 rounded"
              style={{ backgroundColor: 'var(--bg-hover)', color: 'var(--text-muted)' }}
            >
              {shortcut}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
