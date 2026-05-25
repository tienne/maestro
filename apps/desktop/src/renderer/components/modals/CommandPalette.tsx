import { useEffect, useMemo, useRef, useState } from 'react';
import { Command } from 'cmdk';
import Fuse from 'fuse.js';
import { useSessionStore } from '../../store/sessionStore';
import { useWorkspaceStore } from '../../store/workspaceStore';
// useSessionStore also used in allCommands for setActiveSession
import { useAgentStore } from '../../store/agentStore';
import { useRepositoryStore } from '../../store/repositoryStore';
import { useUiStore } from '../../store/uiStore';
import { trpc } from '../../lib/trpc';
import type { AgentPreset, Session } from '@maestro/shared-types';

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
 * fuse.js 퍼지 검색으로 세션/워크스페이스/저장소/에이전트/Git 액션/레이아웃 명령을 실행한다.
 */
export function CommandPalette({ open, onClose }: Props) {
  const [search, setSearch] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  const sessions = useSessionStore((s) => s.sessions);
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const agents = useAgentStore((s) => s.agents);
  const repositories = useRepositoryStore((s) => s.repositories);
  const { setSplitLayout, setRightPanelTab, setSidebarWidth, sidebarWidth } = useUiStore();

  // M4-04: 프리셋 목록
  const { data: presets } = trpc.preset.list.useQuery(undefined, { enabled: open });
  const presetLaunchMutation = trpc.preset.launch.useMutation({
    onSuccess: (session) => {
      const sess = session as Session;
      useSessionStore.getState().addSession(sess);
      useUiStore.getState().setPaneSession(0, sess.id);
      useUiStore.getState().setCurrentView('terminal');
      onClose();
    },
  });

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

  // F-M2-06: 즐겨찾기/최근 세션 우선 표시
  const favoriteSessions = sessions.filter((s) => s.isFavorite);
  const recentSessions = sessions.filter((s) => !s.isFavorite).slice(0, 5);

  const presetList = (presets as AgentPreset[] | undefined) ?? [];

  const allCommands: CommandItem[] = useMemo(() => [
    // M4-04: Preset Launch (최상단 우선 노출)
    ...presetList.map((p) => ({
      id: `preset-launch-${p.id}`,
      label: `Launch: ${p.name}`,
      group: 'Presets',
      action: () => {
        presetLaunchMutation.mutate({ presetId: p.id, cols: 120, rows: 40 });
      },
    })),
    // F-M2-06: Favorite Sessions (최상단)
    ...favoriteSessions.map((s) => ({
      id: `fav-session-${s.id}`,
      label: `★ ${s.name ?? s.id}`,
      group: 'Favorite Sessions',
      action: () => {
        useSessionStore.getState().setActiveSession(s.id);
        useUiStore.getState().setPaneSession(0, s.id);
        onClose();
      },
    })),
    // F-M2-06: Recent Sessions
    ...recentSessions.map((s) => ({
      id: `recent-session-${s.id}`,
      label: `${s.name ?? s.id}`,
      group: 'Recent Sessions',
      action: () => {
        useSessionStore.getState().setActiveSession(s.id);
        useUiStore.getState().setPaneSession(0, s.id);
        onClose();
      },
    })),
    // Sessions (all)
    ...sessions.map((s) => ({
      id: `session-${s.id}`,
      label: `세션 전환: ${s.name ?? s.id}`,
      group: 'Sessions',
      action: () => {
        useSessionStore.getState().setActiveSession(s.id);
        useUiStore.getState().setPaneSession(0, s.id);
        onClose();
      },
    })),
    // Workspaces
    ...workspaces.map((ws) => ({
      id: `ws-${ws.id}`,
      label: `워크스페이스: ${ws.name}`,
      group: 'Workspaces',
      action: () => { onClose(); },
    })),
    // Repositories
    ...repositories.map((r) => ({
      id: `repo-${r.id}`,
      label: `저장소: ${r.name}`,
      group: 'Repositories',
      action: () => { onClose(); },
    })),
    // Agents
    ...agents.map((a) => ({
      id: `agent-${a.id}`,
      label: `에이전트: ${a.name}`,
      group: 'Agents',
      action: () => { onClose(); },
    })),
    // Git actions
    { id: 'git-panel', label: 'Git 패널 열기', group: 'Git', action: () => { setRightPanelTab('git'); onClose(); } },
    { id: 'git-commit', label: 'Git 커밋 패널', group: 'Git', action: () => { setRightPanelTab('git'); onClose(); } },
    // M9-04: Archive Search
    { id: 'search-past-sessions', label: 'Search Past Sessions', group: 'Sessions', action: () => {
      // 아카이브 검색 모드로 전환 — 검색어를 CommandPalette 상태로 전달
      setSearch('archive:');
      // 검색은 기존 fuse 퍼지 검색에서 처리
    }},
    // Layout
    { id: 'layout-split-v', label: '터미널 세로 분할', group: 'Layout', action: () => { setSplitLayout('vertical'); onClose(); } },
    { id: 'layout-split-h', label: '터미널 가로 분할', group: 'Layout', action: () => { setSplitLayout('horizontal'); onClose(); } },
    { id: 'layout-single', label: '단일 터미널 뷰', group: 'Layout', action: () => { setSplitLayout('single'); onClose(); } },
    {
      id: 'sidebar-toggle',
      label: sidebarWidth > 0 ? '사이드바 숨기기' : '사이드바 표시',
      group: 'Layout',
      action: () => { setSidebarWidth(sidebarWidth > 0 ? 0 : 280); onClose(); },
    },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [sessions, favoriteSessions, recentSessions, workspaces, repositories, agents, presetList, setSplitLayout, setRightPanelTab, setSidebarWidth, sidebarWidth, onClose]);

  // fuse.js 퍼지 검색
  const fuse = useMemo(() => new Fuse(allCommands, { keys: ['label'], threshold: 0.4, includeScore: true }), [allCommands]);

  const commands = useMemo(() => {
    if (!search.trim()) return allCommands;
    return fuse.search(search).map((r) => r.item);
  }, [search, allCommands, fuse]);

  const groups = useMemo(() => {
    const map = new Map<string, CommandItem[]>();
    for (const cmd of commands) {
      if (!map.has(cmd.group)) map.set(cmd.group, []);
      map.get(cmd.group)!.push(cmd);
    }
    return map;
  }, [commands]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-24"
      style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="명령 팔레트"
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

            {Array.from(groups.entries()).map(([group, items]) => (
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
            ))}
          </Command.List>
        </Command>
      </div>
    </div>
  );
}
