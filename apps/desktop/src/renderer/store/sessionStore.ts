import { create } from 'zustand';
import type { Session, SessionStatus, SessionLabel } from '@maestro/shared-types';

interface SessionStore {
  sessions: Session[];
  activeSessionId: string | null;
  /** M4-05: 세션 라벨 캐시 (sessionId -> labels) */
  labelMap: Record<string, SessionLabel[]>;
  /** M4-03: 상태 필터 */
  statusFilter: SessionStatus | 'all' | 'blocked';
  /** M5-04: 세션별 env reload 필요 플래그 */
  envReloadNeeded: Record<string, boolean>;

  setSessions: (sessions: Session[]) => void;
  addSession: (session: Session) => void;
  removeSession: (id: string) => void;
  updateSession: (session: Session) => void;
  updateStatus: (sessionId: string, status: SessionStatus) => void;
  setActiveSession: (id: string | null) => void;
  setLabels: (sessionId: string, labels: SessionLabel[]) => void;
  setStatusFilter: (filter: SessionStatus | 'all' | 'blocked') => void;
  setEnvReloadNeeded: (sessionId: string, needed: boolean) => void;
}

export const useSessionStore = create<SessionStore>((set) => ({
  sessions: [],
  activeSessionId: null,
  labelMap: {},
  statusFilter: 'all',
  envReloadNeeded: {},

  setSessions: (sessions) => set({ sessions }),

  addSession: (session) =>
    set((s) => ({ sessions: [session, ...s.sessions], activeSessionId: session.id })),

  removeSession: (id) =>
    set((s) => ({
      sessions: s.sessions.filter((sess) => sess.id !== id),
      activeSessionId: s.activeSessionId === id ? null : s.activeSessionId,
    })),

  updateSession: (session) =>
    set((s) => ({
      sessions: s.sessions.map((sess) => (sess.id === session.id ? session : sess)),
    })),

  updateStatus: (sessionId, status) =>
    set((s) => ({
      sessions: s.sessions.map((sess) =>
        sess.id === sessionId ? { ...sess, status } : sess,
      ),
    })),

  setActiveSession: (id) => set({ activeSessionId: id }),

  setLabels: (sessionId, labels) =>
    set((s) => ({ labelMap: { ...s.labelMap, [sessionId]: labels } })),

  setStatusFilter: (filter) => set({ statusFilter: filter }),

  setEnvReloadNeeded: (sessionId, needed) =>
    set((s) => ({ envReloadNeeded: { ...s.envReloadNeeded, [sessionId]: needed } })),
}));
