import { useEffect, useRef, useState } from 'react';
import { Command } from 'cmdk';
import { useSessionStore } from '../../store/sessionStore';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { useUiStore } from '../../store/uiStore';

interface Props {
  open: boolean;
  onClose: () => void;
}

interface CommandItem {
  id: string;
  label: string;
  group: string;
  action: () => void;
}

/**
 * ⌘K 커맨드 팔레트.
 * 세션/워크스페이스/Git 액션/설정 그룹으로 명령을 퍼지 검색하여 실행한다.
 */
export function CommandPalette({ open, onClose }: Props) {
  const [search, setSearch] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const sessions = useSessionStore((s) => s.sessions);
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const { setSplitLayout, setRightPanelTab, setSidebarWidth, sidebarWidth } = useUiStore();

  useEffect(() => {
    if (open) {
      setSearch('');
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    if (open) document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open, onClose]);

  const commands: CommandItem[] = [
    // Sessions
    ...sessions.map((s) => ({
      id: `session-${s.id}`,
      label: `세션 전환: ${s.name ?? s.id}`,
      group: 'Sessions',
      action: () => {
        useUiStore.getState().setPaneSession(0, s.id);
        onClose();
      },
    })),
    // Workspaces
    ...workspaces.map((ws) => ({
      id: `ws-${ws.id}`,
      label: `워크스페이스: ${ws.name}`,
      group: 'Workspaces',
      action: () => {
        onClose();
      },
    })),
    // Git actions
    {
      id: 'git-panel',
      label: 'Git 패널 열기',
      group: 'Git',
      action: () => {
        setRightPanelTab('git');
        onClose();
      },
    },
    {
      id: 'git-commit',
      label: 'Git 커밋 패널',
      group: 'Git',
      action: () => {
        setRightPanelTab('commit');
        onClose();
      },
    },
    // Layout
    {
      id: 'layout-split-v',
      label: '터미널 세로 분할',
      group: 'Layout',
      action: () => {
        setSplitLayout('vertical');
        onClose();
      },
    },
    {
      id: 'layout-split-h',
      label: '터미널 가로 분할',
      group: 'Layout',
      action: () => {
        setSplitLayout('horizontal');
        onClose();
      },
    },
    {
      id: 'layout-single',
      label: '단일 터미널 뷰',
      group: 'Layout',
      action: () => {
        setSplitLayout('single');
        onClose();
      },
    },
    {
      id: 'sidebar-toggle',
      label: sidebarWidth > 0 ? '사이드바 숨기기' : '사이드바 표시',
      group: 'Layout',
      action: () => {
        setSidebarWidth(sidebarWidth > 0 ? 0 : 280);
        onClose();
      },
    },
  ];

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-24"
      style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl rounded-xl shadow-2xl overflow-hidden"
        style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border)' }}
        onClick={(e) => e.stopPropagation()}
      >
        <Command>
          <div
            className="flex items-center px-4 py-3 gap-2 border-b"
            style={{ borderColor: 'var(--border)' }}
          >
            <span style={{ color: 'var(--text-muted)' }}>⌘</span>
            <Command.Input
              ref={inputRef}
              value={search}
              onValueChange={setSearch}
              placeholder="명령 검색..."
              className="flex-1 bg-transparent outline-none text-sm"
              style={{ color: 'var(--text-primary)' }}
            />
            <kbd
              className="text-xs px-1.5 py-0.5 rounded"
              style={{
                backgroundColor: 'var(--bg-primary)',
                color: 'var(--text-muted)',
                border: '1px solid var(--border)',
              }}
            >
              esc
            </kbd>
          </div>

          <Command.List className="max-h-80 overflow-y-auto py-2">
            <Command.Empty
              className="py-8 text-center text-sm"
              style={{ color: 'var(--text-muted)' }}
            >
              결과 없음
            </Command.Empty>

            {['Sessions', 'Workspaces', 'Git', 'Layout'].map((group) => {
              const items = commands.filter((c) => c.group === group);
              if (items.length === 0) return null;
              return (
                <Command.Group
                  key={group}
                  heading={group}
                  className="[&_[cmdk-group-heading]]:px-4 [&_[cmdk-group-heading]]:py-1 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-semibold"
                  style={{ '--tw-text-opacity': '1' } as React.CSSProperties}
                >
                  {items.map((item) => (
                    <Command.Item
                      key={item.id}
                      value={item.label}
                      onSelect={item.action}
                      className="px-4 py-2 text-sm cursor-pointer flex items-center gap-2 aria-selected:bg-[var(--accent)] aria-selected:bg-opacity-20"
                      style={{ color: 'var(--text-primary)' }}
                    >
                      {item.label}
                    </Command.Item>
                  ))}
                </Command.Group>
              );
            })}
          </Command.List>
        </Command>
      </div>
    </div>
  );
}
