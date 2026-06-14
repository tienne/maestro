import { create } from 'zustand';
import type { Session } from '@supabase/supabase-js';
import type { AuthUser } from '@maestro/shared-types';
import { supabase, isSupabaseConfigured } from '../lib/supabase';

// ---------------------------------------------------------------------------
// Zustand 스토어
// ---------------------------------------------------------------------------

interface AuthStore {
  user: AuthUser | null;
  session: Session | null;
  isLoading: boolean;
  initialize: () => Promise<void>;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
}

export const useAuthStore = create<AuthStore>((set) => ({
  user: null,
  session: null,
  isLoading: true,

  initialize: async () => {
    if (!isSupabaseConfigured || !supabase) {
      set({ isLoading: false });
      return;
    }

    const { data } = await supabase.auth.getSession();
    const session = data.session;
    const user = session?.user
      ? {
          id: session.user.id,
          email: session.user.email ?? '',
          user_metadata: session.user.user_metadata,
        }
      : null;

    set({ user, session, isLoading: false });

    supabase.auth.onAuthStateChange((_event, newSession) => {
      const newUser = newSession?.user
        ? {
            id: newSession.user.id,
            email: newSession.user.email ?? '',
            user_metadata: newSession.user.user_metadata,
          }
        : null;
      set({ user: newUser, session: newSession, isLoading: false });
    });
  },

  signIn: async (email, password) => {
    if (!supabase) throw new Error('Supabase가 설정되지 않았습니다');
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    const session = data.session;
    const user = session?.user
      ? {
          id: session.user.id,
          email: session.user.email ?? '',
          user_metadata: session.user.user_metadata,
        }
      : null;
    set({ user, session });
  },

  signOut: async () => {
    if (!supabase) return;
    await supabase.auth.signOut();
    set({ user: null, session: null });
  },
}));
