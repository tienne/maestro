import { create } from 'zustand';
import type { Session, SessionStatus } from '@maestro/shared-types';
import * as tauri from '@/lib/tauri';

interface SessionStore {
  sessions: Session[];
  activeSessionId: string | null;

  loadAll: () => Promise<void>;
  startSession: (name: string, workspaceId: string, agentId: string) => Promise<Session>;
  stopSession: (id: string) => Promise<void>;
  sendInput: (sessionId: string, text: string) => Promise<void>;
  updateStatus: (sessionId: string, status: SessionStatus) => void;
  setActiveSession: (id: string | null) => void;
}

export const useSessionStore = create<SessionStore>((set, get) => ({
  sessions: [],
  activeSessionId: null,

  loadAll: async () => {
    const sessions = await tauri.sessionListAll();
    set({ sessions });
  },

  startSession: async (name, workspaceId, agentId) => {
    const session = await tauri.sessionStart(name, workspaceId, agentId);
    set((s) => ({ sessions: [session, ...s.sessions], activeSessionId: session.id }));
    return session;
  },

  stopSession: async (id) => {
    await tauri.sessionStop(id);
    set((s) => ({
      sessions: s.sessions.map((sess) =>
        sess.id === id ? { ...sess, status: 'stopped' as SessionStatus } : sess
      ),
    }));
  },

  sendInput: async (sessionId, text) => {
    await tauri.sessionSendInput(sessionId, text);
  },

  updateStatus: (sessionId, status) => {
    set((s) => ({
      sessions: s.sessions.map((sess) =>
        sess.id === sessionId ? { ...sess, status } : sess
      ),
    }));
    // Persist to DB
    tauri.sessionUpdateStatus(sessionId, status);
  },

  setActiveSession: (id) => set({ activeSessionId: id }),
}));
