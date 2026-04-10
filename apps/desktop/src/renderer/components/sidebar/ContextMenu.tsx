import { useEffect, useRef } from 'react';

export interface ContextMenuItem {
  label: string;
  danger?: boolean;
  disabled?: boolean;
  separator?: false;
  onClick: () => void;
}

export interface ContextMenuSeparator {
  separator: true;
}

export type ContextMenuEntry = ContextMenuItem | ContextMenuSeparator;

interface Props {
  x: number;
  y: number;
  items: ContextMenuEntry[];
  onClose: () => void;
}

export function ContextMenu({ x, y, items, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const handleKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', handleDown);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleDown);
      document.removeEventListener('keydown', handleKey);
    };
  }, [onClose]);

  // viewport clamp — 메뉴가 화면 밖으로 나가지 않도록
  const style: React.CSSProperties = {
    position: 'fixed',
    top: y,
    left: x,
    zIndex: 9999,
    minWidth: 180,
    backgroundColor: 'var(--bg-panel)',
    border: '1px solid var(--border)',
    borderRadius: 8,
    boxShadow: '0 8px 24px rgba(0,0,0,0.35)',
    padding: '4px 0',
  };

  return (
    <div ref={ref} style={style}>
      {items.map((item, i) => {
        if ('separator' in item && item.separator) {
          return (
            <div
              key={i}
              style={{ height: 1, backgroundColor: 'var(--border)', margin: '4px 0' }}
            />
          );
        }
        const menuItem = item as ContextMenuItem;
        return (
          <button
            key={i}
            disabled={menuItem.disabled}
            onClick={() => { menuItem.onClick(); onClose(); }}
            className="w-full text-left px-3 py-1.5 text-xs transition-colors disabled:opacity-40"
            style={{ color: menuItem.danger ? '#f87171' : 'var(--text-primary)', display: 'block' }}
            onMouseEnter={(e) => {
              if (!menuItem.disabled)
                e.currentTarget.style.backgroundColor = menuItem.danger
                  ? 'rgba(239,68,68,0.12)'
                  : 'var(--bg-hover)';
            }}
            onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; }}
          >
            {menuItem.label}
          </button>
        );
      })}
    </div>
  );
}
