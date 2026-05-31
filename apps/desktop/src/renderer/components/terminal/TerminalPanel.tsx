import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSessionStore } from '../../store/sessionStore';
import { useSettingsStore } from '../../store/settingsStore';
import { useUiStore } from '../../store/uiStore';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { useMcpStore } from '../../store/mcpStore';
import { TerminalTab } from './TerminalTab';
import { XTerminal } from './XTerminal';
import { CreateSessionModal } from '../modals/CreateSessionModal';
import { CompletionCard } from '../shared/CompletionCard';
import { EmptyState } from '../shared/EmptyState';
import { Tooltip } from '../shared/Tooltip';
import { trpc } from '../../lib/trpc';
import { sendToTerminal } from '../../hooks/useAppInit';
import { toast } from '../../lib/toast';
import { FileEditorPanel } from '../editor/FileEditorPanel';
import { WorkspaceChat } from '../chat/WorkspaceChat';
import type { Session, SessionLabel } from '@maestro/shared-types';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  horizontalListSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

interface TerminalPanelProps {
  /**
   * AI Agent Editor에서 선택된 태스크의 워크스페이스 ID.
   * 설정되면 해당 워크스페이스의 세션만 탭으로 표시한다.
   * undefined/null이면 기존 동작(전체 세션 표시)을 유지한다.
   */
  taskWorkspaceId?: string | null;
  /**
   * AI Agent Editor에서 선택된 태스크 ID.
   * 세션이 없을 때 [실행] 버튼에서 projectTask.run을 호출하는 데 사용한다.
   */
  taskId?: string | null;
}

export function TerminalPanel({ taskWorkspaceId, taskId }: TerminalPanelProps = {}) {
  const { sessions, activeSessionId, setActiveSession, removeSession, updateSession, addSession } = useSessionStore();
  const { splitLayout, setSplitLayout, panes, setPaneSession, activePaneIndex, setActivePaneIndex, pinnedTabs, tabOrder, setTabOrder, openFileTabs, activeFileTabPath, setActiveFileTabPath, closeFileTab } = useUiStore();
  const { servers, setServers } = useMcpStore();
  const { workspaces, activeWorkspaceId } = useWorkspaceStore();
  const [showCreateSession, setShowCreateSession] = useState(false);
  const [chatTabActive, setChatTabActive] = useState(false);
  const [addMenuPos, setAddMenuPos] = useState<{ x: number; y: number } | null>(null);
  const addButtonRef = useRef<HTMLButtonElement>(null);
  const addMenuRef = useRef<HTMLDivElement>(null);
  // M4-05: 라벨 필터
  const [labelFilter, setLabelFilter] = useState<string | null>(null);

  // F-M2-04: DnD 센서
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  // 현재 활성 세션의 워크스페이스 (없으면 첫 번째 워크스페이스 사용)
  const activeSession = sessions.find((s) => s.id === activeSessionId);
  const activeWorkspace =
    workspaces.find((w) => w.id === activeSession?.workspaceId) ?? workspaces[0] ?? null;

  // F-M2-04 / F-M2-06: 핀된 탭을 좌측, 즐겨찾기 우선 → 나머지 순서
  const sortedSessions = useMemo(() => {
    const pinned = sessions.filter((s) => pinnedTabs.includes(s.id));
    const unpinned = sessions.filter((s) => !pinnedTabs.includes(s.id));

    // tabOrder가 있으면 unpinned를 해당 순서로 정렬
    if (tabOrder.length > 0) {
      unpinned.sort((a, b) => {
        const ai = tabOrder.indexOf(a.id);
        const bi = tabOrder.indexOf(b.id);
        // tabOrder에 없는 항목은 뒤로
        if (ai === -1 && bi === -1) return 0;
        if (ai === -1) return 1;
        if (bi === -1) return -1;
        return ai - bi;
      });
    }

    // 즐겨찾기 세션은 각 그룹 내에서 앞으로
    const sortByFav = (arr: Session[]) =>
      [...arr].sort((a, b) => {
        const af = a.isFavorite ? 1 : 0;
        const bf = b.isFavorite ? 1 : 0;
        return bf - af;
      });

    return [...sortByFav(pinned), ...sortByFav(unpinned)];
  }, [sessions, pinnedTabs, tabOrder]);

  // AI Agent Editor 모드: 선택된 태스크의 워크스페이스 세션만 탭에 표시
  // xterm.js 인스턴스는 모두 마운트 유지 (visibility:hidden) — 탭 표시만 필터링
  const visibleSessions = taskWorkspaceId
    ? sortedSessions.filter((s) => s.workspaceId === taskWorkspaceId)
    : sortedSessions;

  // 태스크 모드에서 세션이 없을 때 사용할 run mutation
  const utils = trpc.useUtils();
  const runTaskMutation = trpc.projectTask.run.useMutation({
    onSuccess: ({ workspace, session }) => {
      // 워크스페이스를 store에 반영 (workspaceStore는 여기서 import 하지 않고
      // invalidate로 처리해 store 동기화는 기존 훅에 위임)
      utils.workspace.list.invalidate();
      // 새 세션을 sessionStore에 추가해 탭이 즉시 나타나게 한다
      addSession(session as Session);
    },
    onError: (err) => {
      toast.error('태스크 실행 실패', err.message);
    },
  });

  // DnD 끝: 순서 저장
  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    // 핀된 탭은 드래그 대상에서 제외 (고정)
    if (pinnedTabs.includes(active.id as string)) return;

    const unpinned = sortedSessions.filter((s) => !pinnedTabs.includes(s.id));
    const ids = unpinned.map((s) => s.id);
    const oldIndex = ids.indexOf(active.id as string);
    const newIndex = ids.indexOf(over.id as string);
    if (oldIndex === -1 || newIndex === -1) return;

    const newOrder = [...ids];
    newOrder.splice(oldIndex, 1);
    newOrder.splice(newIndex, 0, active.id as string);
    setTabOrder(newOrder);
  }, [sortedSessions, pinnedTabs, setTabOrder]);


  const checkServersMutation = trpc.mcp.checkServers.useMutation({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    onSuccess: (updated: any[]) => setServers(updated.map((s) => ({ ...s, errorMsg: s.errorMsg ?? undefined }))),
  });

  // 30초마다 MCP 서버 연결 상태 자동 점검
  useEffect(() => {
    checkServersMutation.mutate();
    const id = setInterval(() => checkServersMutation.mutate(), 30_000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!addMenuPos) return;
    const handler = (e: MouseEvent) => {
      if (
        addMenuRef.current && !addMenuRef.current.contains(e.target as Node) &&
        addButtonRef.current && !addButtonRef.current.contains(e.target as Node)
      ) {
        setAddMenuPos(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [addMenuPos]);

  const handleSplitLayoutChange = (layout: typeof splitLayout) => {
    setSplitLayout(layout);
    if (layout !== 'single') {
      // 스플릿 전환 시 pane 0 = 현재 활성 세션, pane 1 = 비워서 동일 세션 중복 방지
      setPaneSession(0, activeSessionId ?? null);
      setPaneSession(1, null);
      setActivePaneIndex(0);
    }
  };

  const launchMutation = trpc.session.launch.useMutation({
    onSuccess: (session) => {
      updateSession(session as Session);
      toast.success('세션 시작됨', (session as Session).name);
    },
    onError: (err, vars) => {
      const msg = `\r\n\x1b[31m[Launch Error] ${err.message}\x1b[0m\r\n`;
      sendToTerminal(vars.sessionId, msg);
      toast.error('세션 시작 실패', err.message);
    },
  });

  const deleteMutation = trpc.session.delete.useMutation({
    onSuccess: (_, vars) => {
      removeSession(vars.sessionId);
      toast.info('세션 종료됨');
    },
  });

  const makeOnReady = useCallback(
    (sessionId: string) => (cols: number, rows: number) => {
      launchMutation.mutate({ sessionId, cols, rows });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  const leftPaneSessionId = panes[0].sessionId;
  // 같은 세션이 두 pane에 중복 표시되는 것을 방지: right pane은 left와 다를 때만 유효
  const rightPaneSessionId = panes[1].sessionId !== panes[0].sessionId ? panes[1].sessionId : null;

  const handleTabClick = (sessionId: string) => {
    setChatTabActive(false);
    setActiveFileTabPath(null);
    setActiveSession(sessionId);
    setPaneSession(activePaneIndex, sessionId);
  };

  const handleTabClose = (sessionId: string) => {
    deleteMutation.mutate({ sessionId });
    // Clear panes that were showing this session
    panes.forEach((pane, idx) => {
      if (pane.sessionId === sessionId) {
        setPaneSession(idx as 0 | 1, null);
      }
    });
  };

  // M7-01: 메모리 경고 — 세션 수 x scrollback이 임계값 초과 시 배너 표시
  const scrollbackLines = useSettingsStore((s) => s.scrollbackLines);
  const scrollbackWarningThreshold = 50_000_000; // 5000만 chars 기준
  const totalScrollbackChars = sessions.length * scrollbackLines * 80; // 세션수 x 라인수 x 평균80자
  const showScrollbackWarning = totalScrollbackChars > scrollbackWarningThreshold;

  return (
    <div className="flex flex-col h-full" style={{ backgroundColor: 'var(--bg-primary)' }}>
      {/* M7-01: 메모리 경고 배너 */}
      {showScrollbackWarning && (
        <div
          className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium"
          style={{ backgroundColor: 'rgba(249,115,22,0.15)', color: '#f97316', borderBottom: '1px solid rgba(249,115,22,0.3)' }}
        >
          <span>Memory Warning:</span>
          <span>{sessions.length} sessions x {scrollbackLines.toLocaleString()} scrollback lines.</span>
          <span>Consider reducing scrollback in Settings &gt; Terminal.</span>
        </div>
      )}
      {/* M4-05: 라벨 필터 칩 */}
      <LabelFilterBar labelFilter={labelFilter} setLabelFilter={setLabelFilter} />
      {/* Tab Bar */}
      <div
        className="flex items-center border-b overflow-x-auto"
        style={{
          backgroundColor: 'var(--bg-panel)',
          borderColor: 'var(--border)',
          minHeight: '44px',
        }}
      >
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
          <SortableContext items={visibleSessions.map((s) => s.id)} strategy={horizontalListSortingStrategy}>
            <div className="flex items-center flex-1 gap-0 overflow-x-auto" role="tablist" aria-label="세션 탭">
              {visibleSessions.map((session) => (
                <SortableTab
                  key={session.id}
                  session={session}
                  isActive={activeSessionId === session.id}
                  isPinned={pinnedTabs.includes(session.id)}
                  isFavorite={Boolean(session.isFavorite)}
                  onClick={() => handleTabClick(session.id)}
                  onClose={() => handleTabClose(session.id)}
                />
              ))}
              {/* 파일 에디터 탭 */}
              {openFileTabs.map((ft) => {
                const fileName = ft.path.split('/').pop() ?? ft.path;
                const isActive = activeFileTabPath === ft.path;
                return (
                  <div
                    key={ft.path}
                    className={`group flex items-center gap-1.5 px-3 border-r transition-colors whitespace-nowrap ${
                      isActive ? 'font-bold border-b-2 border-b-[var(--accent)]' : 'border-b-2 border-b-transparent'
                    }`}
                    style={{
                      minHeight: '44px',
                      backgroundColor: isActive ? 'var(--tab-active-bg)' : 'var(--tab-inactive-bg)',
                      color: isActive ? 'var(--tab-active-text)' : 'var(--tab-inactive-text)',
                      borderRightColor: 'var(--border)',
                      cursor: 'pointer',
                      userSelect: 'none',
                    }}
                    onClick={() => setActiveFileTabPath(ft.path)}
                  >
                    <span className="text-[10px] opacity-60">📄</span>
                    <span className="max-w-[120px] truncate text-sm">{fileName}</span>
                    {ft.isDirty && (
                      <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: 'var(--accent)' }} title="저장되지 않은 변경사항" />
                    )}
                    <span
                      role="button"
                      onClick={(e) => { e.stopPropagation(); closeFileTab(ft.path); }}
                      className="opacity-0 group-hover:opacity-100 ml-0.5 w-4 h-4 flex items-center justify-center rounded transition-all cursor-pointer flex-shrink-0 hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
                      title="닫기"
                    >
                      x
                    </span>
                  </div>
                );
              })}

              {/* + 탭 추가 버튼 */}
              {activeWorkspace && (
                <button
                  ref={addButtonRef}
                  onClick={() => {
                    if (addMenuPos) {
                      setAddMenuPos(null);
                    } else {
                      const rect = addButtonRef.current?.getBoundingClientRect();
                      if (rect) setAddMenuPos({ x: rect.left, y: rect.bottom + 4 });
                    }
                  }}
                  className="flex items-center justify-center w-8 h-full flex-shrink-0 text-lg leading-none transition-colors"
                  style={{ color: 'var(--text-muted)', minHeight: '44px' }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.color = 'var(--text-primary)';
                    e.currentTarget.style.backgroundColor = 'var(--bg-hover)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.color = 'var(--text-muted)';
                    e.currentTarget.style.backgroundColor = 'transparent';
                  }}
                  aria-label="탭 추가"
                >
                  +
                </button>
              )}
            </div>
          </SortableContext>
        </DndContext>


        {/* MCP 연결 상태 칩 */}
        {servers.length > 0 && (() => {
          const connectedCount = servers.filter((s) => s.enabled && s.status === 'connected').length;
          const enabledTotal = servers.filter((s) => s.enabled).length;
          const allConnected = connectedCount === enabledTotal && enabledTotal > 0;
          const anyConnected = connectedCount > 0;
          return (
            <div
              className="flex items-center gap-1 px-2 text-[10px] rounded mx-1 flex-shrink-0"
              style={{
                backgroundColor: allConnected ? 'rgba(34,197,94,0.12)' : anyConnected ? 'rgba(234,179,8,0.12)' : 'rgba(107,114,128,0.12)',
                color: allConnected ? '#22c55e' : anyConnected ? '#eab308' : 'var(--text-muted)',
              }}
              title={`MCP: ${connectedCount}/${enabledTotal} connected`}
            >
              <span
                className="w-1.5 h-1.5 rounded-full"
                style={{ backgroundColor: allConnected ? '#22c55e' : anyConnected ? '#eab308' : '#6b7280' }}
              />
              MCP {connectedCount}/{enabledTotal}
            </div>
          );
        })()}

        {/* Split controls */}
        <div className="flex items-center gap-1 px-2 flex-shrink-0">
          {(['single', 'vertical', 'horizontal'] as const).map((layout, i) => (
            <button
              key={layout}
              onClick={() => handleSplitLayoutChange(layout)}
              className="p-1 rounded text-xs transition-colors"
              style={{
                backgroundColor: splitLayout === layout ? 'var(--bg-active)' : 'transparent',
                color: splitLayout === layout ? 'var(--text-primary)' : 'var(--text-secondary)',
              }}
              title={layout === 'single' ? 'Single view' : layout === 'vertical' ? 'Vertical split' : 'Horizontal split'}
            >
              {['▭', '◫', '⊟'][i]}
            </button>
          ))}
        </div>
      </div>

      {/* Terminal Area + Prompt */}
      <div className="flex-1 overflow-hidden flex flex-col min-h-0">
        {/* 채팅 모드 */}
        {chatTabActive ? (
          <WorkspaceChat workspaceId={activeWorkspaceId ?? ''} />
        ) : /* 파일 에디터 모드 */
        activeFileTabPath ? (
          <FileEditorPanel filePath={activeFileTabPath} />
        ) : splitLayout === 'single' ? (
          // Keep all session terminals mounted — only show the active one.
          // This preserves xterm.js state (scrollback, output) across tab switches.
          <div
            className="flex-1 overflow-hidden relative"
            onClick={() => setActivePaneIndex(0)}
          >
            {/* 태스크 모드에서 해당 워크스페이스의 세션이 없으면 빈 상태 표시 */}
            {taskWorkspaceId && visibleSessions.length === 0 ? (
              <TaskEmptyTerminal
                taskId={taskId ?? null}
                isRunning={runTaskMutation.isPending}
                onRun={() => taskId && runTaskMutation.mutate({ taskId })}
              />
            ) : sessions.length === 0 ? (
              <EmptyTerminal />
            ) : (
              sessions.map((session) => {
                // 태스크 모드: 다른 워크스페이스 세션은 visibility:hidden으로 마운트 유지
                // (기존 xterm.js 상태 보존) + 탭에는 표시 안 됨
                const isVisibleTab = !taskWorkspaceId || session.workspaceId === taskWorkspaceId;
                const isActive = session.id === activeSessionId && isVisibleTab;
                return (
                  <div
                    key={session.id}
                    className="absolute inset-0 flex flex-col"
                    style={{
                      // display:none 대신 visibility:hidden 사용.
                      // display:none은 컨테이너 치수를 0으로 만들어 ResizeObserver가
                      // fitAddon.fit()을 cols=0으로 호출 → 터미널 버퍼 오염.
                      // visibility:hidden은 치수를 유지하므로 이 문제가 없다.
                      visibility: isActive ? 'visible' : 'hidden',
                      pointerEvents: isActive ? 'auto' : 'none',
                    }}
                  >
                    <EnvReloadBanner sessionId={session.id} />
                    <div className="flex-1 relative">
                      <XTerminal
                        sessionId={session.id}
                        isActive={isActive}
                        sessionStatus={session.status}
                        onReady={session.status === 'pending' ? makeOnReady(session.id) : undefined}
                      />
                    </div>
                  </div>
                );
              })
            )}
          </div>
        ) : splitLayout === 'vertical' ? (
          <div className="flex-1 flex overflow-hidden">
            <div
              className={`flex-1 overflow-hidden relative border-r ${activePaneIndex === 0 ? 'ring-1 ring-inset ring-[var(--accent)]' : ''}`}
              style={{ borderColor: 'var(--border)' }}
              onClick={() => setActivePaneIndex(0)}
            >
              {leftPaneSessionId ? (
                <XTerminal
                  sessionId={leftPaneSessionId}
                  isActive={activePaneIndex === 0}
                  sessionStatus={sessions.find((s) => s.id === leftPaneSessionId)?.status}
                  onReady={
                    sessions.find((s) => s.id === leftPaneSessionId)?.status === 'pending'
                      ? makeOnReady(leftPaneSessionId)
                      : undefined
                  }
                />
              ) : (
                <EmptyTerminal />
              )}
            </div>
            <div
              className={`flex-1 overflow-hidden relative ${activePaneIndex === 1 ? 'ring-1 ring-inset ring-[var(--accent)]' : ''}`}
              onClick={() => setActivePaneIndex(1)}
            >
              {rightPaneSessionId ? (
                <XTerminal
                  sessionId={rightPaneSessionId}
                  isActive={activePaneIndex === 1}
                  sessionStatus={sessions.find((s) => s.id === rightPaneSessionId)?.status}
                  onReady={
                    sessions.find((s) => s.id === rightPaneSessionId)?.status === 'pending'
                      ? makeOnReady(rightPaneSessionId)
                      : undefined
                  }
                />
              ) : (
                <EmptyTerminal />
              )}
            </div>
          </div>
        ) : (
          <div className="flex-1 flex flex-col overflow-hidden">
            <div
              className={`flex-1 overflow-hidden relative border-b ${activePaneIndex === 0 ? 'ring-1 ring-inset ring-[var(--accent)]' : ''}`}
              style={{ borderColor: 'var(--border)' }}
              onClick={() => setActivePaneIndex(0)}
            >
              {leftPaneSessionId ? (
                <XTerminal
                  sessionId={leftPaneSessionId}
                  isActive={activePaneIndex === 0}
                  sessionStatus={sessions.find((s) => s.id === leftPaneSessionId)?.status}
                  onReady={
                    sessions.find((s) => s.id === leftPaneSessionId)?.status === 'pending'
                      ? makeOnReady(leftPaneSessionId)
                      : undefined
                  }
                />
              ) : (
                <EmptyTerminal />
              )}
            </div>
            <div
              className={`flex-1 overflow-hidden relative ${activePaneIndex === 1 ? 'ring-1 ring-inset ring-[var(--accent)]' : ''}`}
              onClick={() => setActivePaneIndex(1)}
            >
              {rightPaneSessionId ? (
                <XTerminal
                  sessionId={rightPaneSessionId}
                  isActive={activePaneIndex === 1}
                  sessionStatus={sessions.find((s) => s.id === rightPaneSessionId)?.status}
                  onReady={
                    sessions.find((s) => s.id === rightPaneSessionId)?.status === 'pending'
                      ? makeOnReady(rightPaneSessionId)
                      : undefined
                  }
                />
              ) : (
                <EmptyTerminal />
              )}
            </div>
          </div>
        )}
        {/* M3-05: 완료 카드 — 파일 에디터 모드에서는 숨김 */}
        {!chatTabActive && !activeFileTabPath && activeSessionId && (
          <CompletionCard sessionId={activeSessionId} />
        )}
      </div>

      {/* 플로팅 탭 추가 메뉴 */}
      {addMenuPos && (
        <div
          ref={addMenuRef}
          className="py-1 rounded-lg shadow-xl"
          style={{
            position: 'fixed',
            top: addMenuPos.y,
            left: addMenuPos.x,
            zIndex: 9999,
            minWidth: 120,
            backgroundColor: 'var(--bg-elevated)',
            border: '1px solid var(--border)',
          }}
        >
          <button
            className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-left transition-colors"
            style={{ color: 'var(--text-primary)' }}
            onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--bg-hover)')}
            onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
            onClick={() => { setAddMenuPos(null); setShowCreateSession(true); }}
          >
            <span style={{ fontSize: 13 }}>⌨️</span> 터미널
          </button>
          <button
            className="w-full flex items-center gap-2.5 px-3 py-2 text-xs text-left transition-colors"
            style={{ color: 'var(--text-primary)' }}
            onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--bg-hover)')}
            onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
            onClick={() => { setAddMenuPos(null); setChatTabActive(true); setActiveFileTabPath(null); }}
          >
            <span style={{ fontSize: 13 }}>💬</span> 채팅
          </button>
        </div>
      )}

      {showCreateSession && activeWorkspace && (
        <CreateSessionModal
          workspace={activeWorkspace}
          onClose={() => setShowCreateSession(false)}
        />
      )}
    </div>
  );
}

/** M4-05: 라벨 필터 칩 바 — 전체 세션에서 고유 라벨 수집 */
function LabelFilterBar({ labelFilter, setLabelFilter }: { labelFilter: string | null; setLabelFilter: (v: string | null) => void }) {
  const sessions = useSessionStore((s) => s.sessions);
  const labelMap = useSessionStore((s) => s.labelMap);

  // 전체 세션의 라벨에서 고유 라벨 추출
  const allLabels: SessionLabel[] = [];
  const seen = new Set<string>();
  for (const s of sessions) {
    const labels = labelMap[s.id] ?? [];
    for (const l of labels) {
      if (!seen.has(l.labelName)) {
        seen.add(l.labelName);
        allLabels.push(l);
      }
    }
  }

  if (allLabels.length === 0) return null;

  return (
    <div
      className="flex items-center gap-1 px-3 py-1 border-b overflow-x-auto"
      style={{ borderColor: 'var(--border)', backgroundColor: 'var(--bg-panel)' }}
    >
      <button
        className="text-[10px] px-2 py-0.5 rounded-full"
        style={{
          backgroundColor: labelFilter === null ? 'var(--accent)' : 'transparent',
          color: labelFilter === null ? 'white' : 'var(--text-muted)',
        }}
        onClick={() => setLabelFilter(null)}
      >
        All
      </button>
      {allLabels.map((l) => (
        <button
          key={l.labelName}
          className="text-[10px] px-2 py-0.5 rounded-full font-medium"
          style={{
            backgroundColor: labelFilter === l.labelName ? `${l.labelColor}40` : 'transparent',
            color: l.labelColor,
            border: `1px solid ${labelFilter === l.labelName ? l.labelColor : 'transparent'}`,
          }}
          onClick={() => setLabelFilter(labelFilter === l.labelName ? null : l.labelName)}
        >
          {l.labelName}
        </button>
      ))}
    </div>
  );
}

function EmptyTerminal() {
  return (
    <div className="h-full flex items-center justify-center">
      <EmptyState
        icon="▶"
        title="에이전트 세션을 시작해보세요"
        description="워크스페이스를 선택하고 새 세션을 생성하세요"
      />
    </div>
  );
}

/**
 * TaskEmptyTerminal — AI Agent Editor 모드에서 태스크에 세션이 없을 때 표시하는 빈 상태.
 * [실행] 버튼을 누르면 projectTask.run을 호출해 워크스페이스 + 세션을 자동 생성한다.
 */
function TaskEmptyTerminal({
  taskId,
  isRunning,
  onRun,
}: {
  taskId: string | null;
  isRunning: boolean;
  onRun: () => void;
}) {
  return (
    <div className="h-full flex flex-col items-center justify-center gap-4">
      <EmptyState
        icon="⚡"
        title="실행 중인 세션이 없습니다"
        description="이 태스크에 연결된 에이전트 세션이 없습니다"
      />
      {taskId && (
        <button
          onClick={onRun}
          disabled={isRunning}
          className="flex items-center gap-2 px-4 py-2 rounded text-sm font-medium transition-colors disabled:opacity-50"
          style={{
            backgroundColor: isRunning ? 'var(--bg-hover)' : 'rgba(129,140,248,0.2)',
            color: isRunning ? 'var(--text-muted)' : '#818cf8',
            border: `1px solid ${isRunning ? 'var(--border)' : 'rgba(129,140,248,0.4)'}`,
          }}
        >
          <span>{isRunning ? '실행 중...' : '▶ 실행'}</span>
        </button>
      )}
    </div>
  );
}

/** F-M2-04: DnD 래퍼 — useSortable 훅으로 드래그 가능한 TerminalTab */
function SortableTab({
  session,
  isActive,
  isPinned,
  isFavorite,
  onClick,
  onClose,
}: {
  session: Session;
  isActive: boolean;
  isPinned: boolean;
  isFavorite: boolean;
  onClick: () => void;
  onClose: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: session.id,
    disabled: isPinned, // 핀된 탭은 드래그 불가
  });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 10 : undefined,
  };

  return (
    <div ref={setNodeRef} style={style} {...attributes} {...listeners}>
      <TerminalTab
        session={session}
        isActive={isActive}
        isPinned={isPinned}
        isFavorite={isFavorite}
        onClick={onClick}
        onClose={onClose}
      />
    </div>
  );
}

/* ─── M5-04: Env Reload Banner ─── */

function EnvReloadBanner({ sessionId }: { sessionId: string }) {
  const needed = useSessionStore((s) => s.envReloadNeeded[sessionId]);
  const setEnvReloadNeeded = useSessionStore((s) => s.setEnvReloadNeeded);
  const reloadEnvMutation = trpc.workspace.reloadEnv.useMutation({
    onSuccess: () => {
      setEnvReloadNeeded(sessionId, false);
      toast.success('ENV Reloaded', 'Environment variables updated in session');
    },
    onError: (e) => {
      toast.error('Reload failed', e.message);
    },
  });

  if (!needed) return null;

  return (
    <div
      className="flex items-center gap-2 px-3 py-1.5 text-xs flex-shrink-0"
      style={{ backgroundColor: 'var(--bg-hover)', borderBottom: '1px solid var(--border)' }}
    >
      <span style={{ color: 'var(--text-secondary)' }}>
        Environment variables changed.
      </span>
      <button
        onClick={() => reloadEnvMutation.mutate({ sessionId })}
        disabled={reloadEnvMutation.isPending}
        className="px-2 py-0.5 text-[10px] rounded text-white disabled:opacity-50"
        style={{ backgroundColor: 'var(--accent)' }}
      >
        {reloadEnvMutation.isPending ? 'Reloading...' : 'Reload ENV'}
      </button>
      <button
        onClick={() => setEnvReloadNeeded(sessionId, false)}
        className="text-[10px] transition-colors"
        style={{ color: 'var(--text-muted)' }}
      >
        Dismiss
      </button>
    </div>
  );
}
