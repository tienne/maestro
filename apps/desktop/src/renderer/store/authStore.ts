import { atom, getDefaultStore } from 'jotai';
import { useAtom, useSetAtom } from 'jotai';
import type { Session } from '@supabase/supabase-js';
import type { AuthUser } from '@maestro/shared-types';
import { supabase, isSupabaseConfigured } from '../lib/supabase';

// ---------------------------------------------------------------------------
// Base atoms
// ---------------------------------------------------------------------------

export const authUserAtom = atom<AuthUser | null>(null);
export const authSessionAtom = atom<Session | null>(null);
export const authIsLoadingAtom = atom<boolean>(true);

// ---------------------------------------------------------------------------
// Derived atoms
// ---------------------------------------------------------------------------

export const isLoggedInAtom = atom((get) => get(authUserAtom) !== null);

// ---------------------------------------------------------------------------
// Action atoms
// ---------------------------------------------------------------------------

export const initializeAuthAtom = atom(null, async (_get, set) => {
  if (!isSupabaseConfigured || !supabase) {
    set(authIsLoadingAtom, false);
    return;
  }

  const { data } = await supabase.auth.getSession();
  const session = data.session;
  const user = session?.user
    ? { id: session.user.id, email: session.user.email ?? '', user_metadata: session.user.user_metadata }
    : null;

  set(authUserAtom, user);
  set(authSessionAtom, session);
  set(authIsLoadingAtom, false);

  supabase.auth.onAuthStateChange((_event, newSession) => {
    const newUser = newSession?.user
      ? { id: newSession.user.id, email: newSession.user.email ?? '', user_metadata: newSession.user.user_metadata }
      : null;
    set(authUserAtom, newUser);
    set(authSessionAtom, newSession);
    set(authIsLoadingAtom, false);
  });
});

export const signInAtom = atom(
  null,
  async (_get, set, { email, password }: { email: string; password: string }) => {
    if (!supabase) throw new Error('Supabase가 설정되지 않았습니다');
    const { data, error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw error;
    const session = data.session;
    const user = session?.user
      ? { id: session.user.id, email: session.user.email ?? '', user_metadata: session.user.user_metadata }
      : null;
    set(authUserAtom, user);
    set(authSessionAtom, session);
  }
);

export const signOutAtom = atom(null, async (_get, set) => {
  if (!supabase) return;
  await supabase.auth.signOut();
  set(authUserAtom, null);
  set(authSessionAtom, null);
});

// ---------------------------------------------------------------------------
// Jotai store instance — Zustand .getState() 호환용
// ---------------------------------------------------------------------------

const jotaiStore = getDefaultStore();

// ---------------------------------------------------------------------------
// Zustand 호환 훅 (기존 컴포넌트 인터페이스 유지)
// ---------------------------------------------------------------------------

interface AuthStoreSnapshot {
  user: AuthUser | null;
  session: Session | null;
  isLoading: boolean;
  initialize: () => Promise<void>;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
}

/** 기존 `useAuthStore((s) => s.field)` selector 패턴 호환 */
export function useAuthStore(): AuthStoreSnapshot;
export function useAuthStore<T>(selector: (state: AuthStoreSnapshot) => T): T;
export function useAuthStore<T>(selector?: (state: AuthStoreSnapshot) => T): AuthStoreSnapshot | T {
  const [user] = useAtom(authUserAtom);
  const [session] = useAtom(authSessionAtom);
  const [isLoading] = useAtom(authIsLoadingAtom);
  const setInitialize = useSetAtom(initializeAuthAtom);
  const setSignIn = useSetAtom(signInAtom);
  const setSignOut = useSetAtom(signOutAtom);

  const state: AuthStoreSnapshot = {
    user,
    session,
    isLoading,
    initialize: () => setInitialize(),
    signIn: (email, password) => setSignIn({ email, password }),
    signOut: () => setSignOut(),
  };

  if (selector) return selector(state);
  return state;
}

/** 기존 `useAuthStore.getState()` 패턴 호환 */
useAuthStore.getState = (): AuthStoreSnapshot => ({
  user: jotaiStore.get(authUserAtom),
  session: jotaiStore.get(authSessionAtom),
  isLoading: jotaiStore.get(authIsLoadingAtom),
  initialize: () => jotaiStore.set(initializeAuthAtom),
  signIn: (email, password) => jotaiStore.set(signInAtom, { email, password }),
  signOut: () => jotaiStore.set(signOutAtom),
});
