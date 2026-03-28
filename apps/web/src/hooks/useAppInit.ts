'use client';

import { useEffect, useRef } from 'react';
import { useWorkspaceStore } from '@/store/workspaceStore';
import { useSessionStore } from '@/store/sessionStore';
import { useAgentStore } from '@/store/agentStore';
import { useUiStore } from '@/store/uiStore';
import { onSessionOutput, onSessionStatus, appStateLoad, appStateSave } from '@/lib/tauri';
import type { SessionStatus } from '@maestro/shared-types';

// Terminal output buffer: sessionId → callbacks
const outputHandlers = new Map<string, ((data: string) => void)[]>();

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
  const { loadAll: loadWorkspaces, setActiveWorkspace } = useWorkspaceStore();
  const { loadAll: loadSessions, setActiveSession, updateStatus } = useSessionStore();
  const { loadAll: loadAgents } = useAgentStore();
  const { setSidebarWidth, setRightSidebarWidth } = useUiStore();

  useEffect(() => {
    let unlistenOutput: (() => void) | null = null;
    let unlistenStatus: (() => void) | null = null;

    async function init() {
      await Promise.all([loadWorkspaces(), loadSessions(), loadAgents()]);

      try {
        const savedState = await appStateLoad();
        if (savedState.activeWorkspaceId) setActiveWorkspace(savedState.activeWorkspaceId);
        if (savedState.activeSessionId) setActiveSession(savedState.activeSessionId);
        if (savedState.sidebarWidth) setSidebarWidth(savedState.sidebarWidth);
        if (savedState.rightSidebarWidth) setRightSidebarWidth(savedState.rightSidebarWidth);
      } catch {
        // No saved state yet
      }

      unlistenOutput = await onSessionOutput((payload) => {
        const handlers = outputHandlers.get(payload.sessionId) ?? [];
        handlers.forEach((h) => h(payload.data));
      });

      unlistenStatus = await onSessionStatus((payload) => {
        updateStatus(payload.sessionId, payload.status as SessionStatus);
      });
    }

    init();

    return () => {
      unlistenOutput?.();
      unlistenStatus?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}

/** Debounced auto-save hook — call in AppShell to persist UI state on change */
export function useAutoSaveState() {
  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const activeSessionId = useSessionStore((s) => s.activeSessionId);
  const sidebarWidth = useUiStore((s) => s.sidebarWidth);
  const rightSidebarWidth = useUiStore((s) => s.rightSidebarWidth);

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      appStateSave({
        activeWorkspaceId: activeWorkspaceId ?? undefined,
        activeSessionId: activeSessionId ?? undefined,
        sidebarWidth,
        rightSidebarWidth,
      }).catch(() => {
        // Ignore — running in browser without Tauri
      });
    }, 500);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [activeWorkspaceId, activeSessionId, sidebarWidth, rightSidebarWidth]);
}
