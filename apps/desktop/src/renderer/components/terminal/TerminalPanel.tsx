import { useCallback, useEffect, useState } from 'react';
import { useSessionStore } from '../../store/sessionStore';
import { useUiStore } from '../../store/uiStore';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { useMcpStore } from '../../store/mcpStore';
import { TerminalTab } from './TerminalTab';
import { XTerminal } from './XTerminal';
import { PromptInput } from './PromptInput';
import { CreateSessionModal } from '../modals/CreateSessionModal';
import { trpc } from '../../lib/trpc';
import { sendToTerminal } from '../../hooks/useAppInit';
import { toast } from '../../lib/toast';
import type { Session } from '@maestro/shared-types';

export function TerminalPanel() {
  const { sessions, activeSessionId, setActiveSession, removeSession, updateSession } = useSessionStore();
  const { splitLayout, setSplitLayout, panes, setPaneSession, activePaneIndex, setActivePaneIndex } = useUiStore();
  const { servers, setServers } = useMcpStore();
  const { workspaces } = useWorkspaceStore();
  const [showCreateSession, setShowCreateSession] = useState(false);

  // 현재 활성 세션의 워크스페이스 (없으면 첫 번째 워크스페이스 사용)
  const activeSession = sessions.find((s) => s.id === activeSessionId);
  const activeWorkspace =
    workspaces.find((w) => w.id === activeSession?.workspaceId) ?? workspaces[0] ?? null;

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

  return (
    <div className="flex flex-col h-full" style={{ backgroundColor: 'var(--bg-primary)' }}>
      {/* Tab Bar */}
      <div
        className="flex items-center border-b overflow-x-auto"
        style={{ backgroundColor: 'var(--bg-panel)', borderColor: 'var(--border)', minHeight: '44px' }}
      >
        <div className="flex items-center flex-1 gap-0 overflow-x-auto">
          {sessions.map((session) => (
            <TerminalTab
              key={session.id}
              session={session}
              isActive={activeSessionId === session.id}
              onClick={() => handleTabClick(session.id)}
              onClose={() => handleTabClose(session.id)}
            />
          ))}
          {/* 탭바 내 세션 추가 버튼 */}
          {activeWorkspace && (
            <button
              onClick={() => setShowCreateSession(true)}
              className="flex items-center justify-center w-8 h-full flex-shrink-0 text-lg leading-none transition-colors"
              style={{ color: 'var(--text-muted)' }}
              onMouseEnter={(e) => {
                e.currentTarget.style.color = 'var(--text-primary)';
                e.currentTarget.style.backgroundColor = 'var(--bg-hover)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.color = 'var(--text-muted)';
                e.currentTarget.style.backgroundColor = 'transparent';
              }}
              title={`New Session (${activeWorkspace.name})`}
            >
              +
            </button>
          )}
        </div>

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
        {splitLayout === 'single' ? (
          // Keep all session terminals mounted — only show the active one.
          // This preserves xterm.js state (scrollback, output) across tab switches.
          <div
            className="flex-1 overflow-hidden relative"
            onClick={() => setActivePaneIndex(0)}
          >
            {sessions.length === 0 ? (
              <EmptyTerminal />
            ) : (
              sessions.map((session) => (
                <div
                  key={session.id}
                  className="absolute inset-0"
                  style={{ display: session.id === activeSessionId ? 'block' : 'none' }}
                >
                  <XTerminal
                    sessionId={session.id}
                    isActive={session.id === activeSessionId}
                    sessionStatus={session.status}
                    onReady={session.status === 'pending' ? makeOnReady(session.id) : undefined}
                  />
                </div>
              ))
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
        <PromptInput sessionId={activeSessionId} />
      </div>

      {showCreateSession && activeWorkspace && (
        <CreateSessionModal
          workspace={activeWorkspace}
          onClose={() => setShowCreateSession(false)}
        />
      )}
    </div>
  );
}

function EmptyTerminal() {
  return (
    <div
      className="h-full flex items-center justify-center text-sm"
      style={{ color: 'var(--text-muted)' }}
    >
      Select a session to view terminal output
    </div>
  );
}
