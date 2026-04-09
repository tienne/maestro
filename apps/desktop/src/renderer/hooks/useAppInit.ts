import { useEffect, useRef } from 'react';
import { useWorkspaceStore } from '../store/workspaceStore';
import { useSessionStore } from '../store/sessionStore';
import { useAgentStore } from '../store/agentStore';
import { useRepositoryStore } from '../store/repositoryStore';
import { useMcpStore, type McpServer } from '../store/mcpStore';
import { useUiStore } from '../store/uiStore';
import { useLayoutStore } from '../store/layoutStore';
import { trpc } from '../lib/trpc';
import type {
  Repository,
  Workspace,
  Agent,
  Session,
  SessionStatus,
  AppState,
} from '@maestro/shared-types';

// Terminal output buffer: sessionId → callbacks
const outputHandlers = new Map<string, ((data: string) => void)[]>();

/** 특정 세션의 터미널에 직접 데이터를 쓴다 (에러 표시 등 용도) */
export function sendToTerminal(sessionId: string, data: string) {
  const handlers = outputHandlers.get(sessionId) ?? [];
  handlers.forEach((h) => h(data));
}

export function registerOutputHandler(sessionId: string, handler: (data: string) => void) {
  const handlers = outputHandlers.get(sessionId) ?? [];
  handlers.push(handler);
  outputHandlers.set(sessionId, handlers);
  return () => {
    const updated = outputHandlers.get(sessionId)?.filter((h) => h !== handler) ?? [];
    outputHandlers.set(sessionId, updated);
  };
}

export function useAppInit() {
  const { setRepositories } = useRepositoryStore();
  const { setWorkspaces } = useWorkspaceStore();
  const { setSessions, updateStatus } = useSessionStore();
  const { setAgents } = useAgentStore();
  const { setServers } = useMcpStore();
  const { setSidebarWidth, setRightSidebarWidth, setPendingResumeSession } = useUiStore();

  const utils = trpc.useUtils();

  // 초기 데이터 로드 — tRPC queries (react-query v5: onSuccess is not in queryOptions)
  const repoQuery = trpc.repository.list.useQuery();
  const wsQuery = trpc.workspace.list.useQuery();
  const sessionQuery = trpc.session.listAll.useQuery();
  const agentQuery = trpc.agent.list.useQuery();
  const mcpQuery = trpc.mcp.list.useQuery();
  const appStateQuery = trpc.ui.loadState.useQuery();
  const lastSessionQuery = trpc.session.getLast.useQuery();

  // react-query v5: data를 useEffect로 처리
  // tRPC 라우터의 placeholder 구현으로 인해 data 타입이 never → unknown으로 캐스팅
  useEffect(() => {
    const d = repoQuery.data as unknown;
    if (d) setRepositories(d as Repository[]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [repoQuery.data]);

  useEffect(() => {
    const d = wsQuery.data as unknown;
    if (d) setWorkspaces(d as Workspace[]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wsQuery.data]);

  useEffect(() => {
    const d = sessionQuery.data as unknown;
    if (d) setSessions(d as Session[]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionQuery.data]);

  useEffect(() => {
    const d = agentQuery.data as unknown;
    if (d) setAgents(d as Agent[]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentQuery.data]);

  useEffect(() => {
    const d = mcpQuery.data as unknown;
    if (d) setServers(d as McpServer[]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mcpQuery.data]);

  useEffect(() => {
    const d = appStateQuery.data as unknown;
    if (!d) return;
    const state = d as AppState | null;
    if (!state) return;
    if (state.activeWorkspaceId) {
      useWorkspaceStore.getState().setActiveWorkspace(state.activeWorkspaceId);
    }
    if (state.sidebarWidth) setSidebarWidth(state.sidebarWidth);
    if (state.rightSidebarWidth) setRightSidebarWidth(state.rightSidebarWidth);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appStateQuery.data]);

  useEffect(() => {
    const d = lastSessionQuery.data as unknown;
    if (d) {
      setPendingResumeSession(d as Session);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastSessionQuery.data]);

  // MCP 상태 폴링 — 30초마다 checkServers mutation 호출
  const checkServersMutation = trpc.mcp.checkServers.useMutation({
    onSuccess: (data) => setServers(data as McpServer[]),
  });

  useEffect(() => {
    checkServersMutation.mutate();

    const interval = setInterval(() => {
      checkServersMutation.mutate();
    }, 30_000);

    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Electron IPC 이벤트 리스너 — session output/status
  useEffect(() => {
    if (!window.electronAPI) return;

    const unlistenOutput = window.electronAPI.onEvent(
      'session-output',
      (payload: unknown) => {
        const { sessionId, data } = payload as { sessionId: string; data: string };
        const handlers = outputHandlers.get(sessionId) ?? [];
        handlers.forEach((h) => h(data));
      },
    );

    const unlistenStatus = window.electronAPI.onEvent(
      'session-status',
      (payload: unknown) => {
        const { sessionId, status } = payload as { sessionId: string; status: SessionStatus };
        updateStatus(sessionId, status);
        utils.session.listAll.invalidate();
      },
    );

    // ui.focus — 특정 UI 요소에 포커스 (원격 제어용)
    const unlistenFocus = window.electronAPI.onEvent(
      'ui-focus',
      (payload: unknown) => {
        const { target } = payload as { target: string };
        if (target === 'terminal') {
          document.querySelector<HTMLElement>('.xterm-helper-textarea')?.focus();
        }
      },
    );

    // ui.sidebar — 사이드바 열기/닫기 (원격 제어용)
    const unlistenSidebar = window.electronAPI.onEvent(
      'ui-sidebar',
      (_payload: unknown) => {
        // TODO: sidebar 토글 구현 (uiStore 연동)
      },
    );

    // ui.tabs — 탭 전환 (원격 제어용)
    const unlistenTabs = window.electronAPI.onEvent(
      'ui-tabs',
      (_payload: unknown) => {
        // TODO: 탭 전환 구현 (uiStore 연동)
      },
    );

    return () => {
      unlistenOutput();
      unlistenStatus();
      unlistenFocus();
      unlistenSidebar();
      unlistenTabs();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

/** Debounced auto-save hook — AppShell에서 호출해 UI 상태를 지속적으로 저장 */
export function useAutoSaveState() {
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const activeSessionId = useSessionStore((s) => s.activeSessionId);
  const sidebarWidth = useUiStore((s) => s.sidebarWidth);
  const rightSidebarWidth = useUiStore((s) => s.rightSidebarWidth);

  const saveStateMutation = trpc.ui.saveState.useMutation();
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      saveStateMutation.mutate({
        activeWorkspaceId: activeWorkspaceId ?? undefined,
        activeSessionId: activeSessionId ?? undefined,
        sidebarWidth,
        rightSidebarWidth,
      });
    }, 500);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeWorkspaceId, activeSessionId, sidebarWidth, rightSidebarWidth]);
}

/** mosaicState를 tiled_layouts 테이블에 500ms 디바운스로 자동저장하고, 앱 시작 시 복원 */
export function useAutoSaveLayout() {
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const { mosaicState, setMosaicState } = useLayoutStore();

  const saveLayoutMutation = trpc.layout.save.useMutation();
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 워크스페이스 전환 시 해당 workspace 레이아웃 복원
  const layoutQuery = trpc.layout.get.useQuery(
    { workspaceId: activeWorkspaceId ?? '' },
    { enabled: !!activeWorkspaceId },
  );

  useEffect(() => {
    const data = layoutQuery.data as unknown;
    if (!data) return;
    const layout = data as { mosaicState: unknown } | null;
    if (layout?.mosaicState !== undefined) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      setMosaicState(layout.mosaicState as any);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layoutQuery.data]);

  // mosaicState 변경 시 500ms 디바운스 자동저장
  useEffect(() => {
    if (!activeWorkspaceId) return;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      saveLayoutMutation.mutate({
        workspaceId: activeWorkspaceId,
        mosaicState,
      });
    }, 500);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeWorkspaceId, mosaicState]);
}

// Electron IPC 타입 확장
declare global {
  interface Window {
    electronAPI?: {
      invoke: (channel: string, args?: Record<string, unknown>) => Promise<unknown>;
      onEvent: (channel: string, handler: (payload: unknown) => void) => () => void;
      offEvent: (channel: string) => void;
    };
  }
}
