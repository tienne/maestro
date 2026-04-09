import { create } from 'zustand';
import type { Session, SessionStatus } from '@maestro/shared-types';

interface SessionStore {
  sessions: Session[];
  activeSessionId: string | null;

  setSessions: (sessions: Session[]) => void;
  addSession: (session: Session) => void;
  removeSession: (id: string) => void;
  updateSession: (session: Session) => void;
  updateStatus: (sessionId: string, status: SessionStatus) => void;
  setActiveSession: (id: string | null) => void;
}

export const useSessionStore = create<SessionStore>((set) => ({
  sessions: [],
  activeSessionId: null,

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
}));
