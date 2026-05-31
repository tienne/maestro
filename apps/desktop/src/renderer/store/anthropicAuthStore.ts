import { atom, getDefaultStore } from 'jotai';
import { useAtom } from 'jotai';

// ---------------------------------------------------------------------------
// 타입 정의
// ---------------------------------------------------------------------------

type AuthSource = 'claude-config' | 'keychain' | 'mastracode';
type AuthStatus = 'checking' | 'authenticated' | 'unauthenticated' | 'expired';

// ---------------------------------------------------------------------------
// Base atoms
// ---------------------------------------------------------------------------

export const anthropicStatusAtom = atom<AuthStatus>('checking');
export const anthropicIsAuthenticatedAtom = atom<boolean>(false);
export const anthropicSourceAtom = atom<AuthSource | undefined>(undefined);
export const anthropicExpiresAtAtom = atom<number | undefined>(undefined);
export const anthropicIsLoadingAtom = atom<boolean>(false);
export const anthropicErrorAtom = atom<string | undefined>(undefined);
/** 내부용: IPC 이벤트 리스너 정리 함수 */
const anthropicCleanupFnAtom = atom<(() => void) | undefined>(undefined);

// ---------------------------------------------------------------------------
// Jotai store instance — 액션 atom에서 직접 store 접근용
// ---------------------------------------------------------------------------

const jotaiStore = getDefaultStore();

// ---------------------------------------------------------------------------
// Action atoms
// ---------------------------------------------------------------------------

export const checkAnthropicStatusAtom = atom(null, async (_get, set) => {
  set(anthropicIsLoadingAtom, true);
  try {
    const result = (await window.electronAPI?.invoke('anthropic:getAuthStatus')) as
      | {
          isAuthenticated: boolean;
          source?: AuthSource;
          expiresAt?: number;
          isExpired?: boolean;
        }
      | undefined;

    if (!result) {
      set(anthropicIsLoadingAtom, false);
      set(anthropicStatusAtom, 'unauthenticated');
      set(anthropicIsAuthenticatedAtom, false);
      return;
    }

    let status: AuthStatus;
    if (result.isExpired) {
      status = 'expired';
    } else if (result.isAuthenticated) {
      status = 'authenticated';
    } else {
      status = 'unauthenticated';
    }

    set(anthropicIsAuthenticatedAtom, result.isAuthenticated);
    set(anthropicStatusAtom, status);
    set(anthropicSourceAtom, result.source);
    set(anthropicExpiresAtAtom, result.expiresAt);
    set(anthropicIsLoadingAtom, false);
    set(anthropicErrorAtom, undefined);
  } catch {
    set(anthropicIsLoadingAtom, false);
    set(anthropicStatusAtom, 'unauthenticated');
    set(anthropicIsAuthenticatedAtom, false);
  }
});

export const openAnthropicOAuthAtom = atom(null, async (_get, set) => {
  set(anthropicIsLoadingAtom, true);
  set(anthropicErrorAtom, undefined);
  try {
    const result = (await window.electronAPI?.invoke('anthropic:openOAuth')) as
      | { success: boolean; error?: string }
      | undefined;

    if (result?.success) {
      await jotaiStore.set(checkAnthropicStatusAtom);
    } else {
      set(anthropicIsLoadingAtom, false);
      set(anthropicErrorAtom, result?.error ?? 'oauth_failed');
    }
  } catch {
    set(anthropicIsLoadingAtom, false);
    set(anthropicErrorAtom, 'unexpected_error');
  }
});

export const initializeAnthropicAuthAtom = atom(null, (_get, set) => {
  void jotaiStore.set(checkAnthropicStatusAtom);

  // contextBridge는 함수를 반환하는 함수를 지원하지 않으므로
  // onEvent() 반환값을 직접 저장하지 않고 offEvent를 사용하는 클로저로 대체한다
  window.electronAPI?.onEvent('anthropic:reauth-required', () => {
    set(anthropicStatusAtom, 'expired');
    set(anthropicIsAuthenticatedAtom, false);
  });

  set(anthropicCleanupFnAtom, () => {
    window.electronAPI?.offEvent('anthropic:reauth-required');
  });
});

export const cleanupAnthropicAuthAtom = atom(null, (_get, _set) => {
  const fn = jotaiStore.get(anthropicCleanupFnAtom);
  if (typeof fn === 'function') fn();
});

// ---------------------------------------------------------------------------
// Zustand 호환 스토어 인터페이스
// ---------------------------------------------------------------------------

interface AnthropicAuthSnapshot {
  status: AuthStatus;
  isAuthenticated: boolean;
  source?: AuthSource;
  expiresAt?: number;
  isLoading: boolean;
  error?: string;
  checkStatus: () => Promise<void>;
  openOAuth: () => Promise<void>;
  initialize: () => void;
  cleanup: () => void;
}

function buildSnapshot(
  status: AuthStatus,
  isAuthenticated: boolean,
  source: AuthSource | undefined,
  expiresAt: number | undefined,
  isLoading: boolean,
  error: string | undefined
): AnthropicAuthSnapshot {
  return {
    status,
    isAuthenticated,
    source,
    expiresAt,
    isLoading,
    error,
    checkStatus: () => jotaiStore.set(checkAnthropicStatusAtom),
    openOAuth: () => jotaiStore.set(openAnthropicOAuthAtom),
    initialize: () => jotaiStore.set(initializeAnthropicAuthAtom),
    cleanup: () => jotaiStore.set(cleanupAnthropicAuthAtom),
  };
}

/** 기존 `useAnthropicAuthStore((s) => s.field)` selector 패턴 호환 */
export function useAnthropicAuthStore(): AnthropicAuthSnapshot;
export function useAnthropicAuthStore<T>(selector: (state: AnthropicAuthSnapshot) => T): T;
export function useAnthropicAuthStore<T>(
  selector?: (state: AnthropicAuthSnapshot) => T
): AnthropicAuthSnapshot | T {
  const [status] = useAtom(anthropicStatusAtom);
  const [isAuthenticated] = useAtom(anthropicIsAuthenticatedAtom);
  const [source] = useAtom(anthropicSourceAtom);
  const [expiresAt] = useAtom(anthropicExpiresAtAtom);
  const [isLoading] = useAtom(anthropicIsLoadingAtom);
  const [error] = useAtom(anthropicErrorAtom);

  const snapshot = buildSnapshot(status, isAuthenticated, source, expiresAt, isLoading, error);
  if (selector) return selector(snapshot);
  return snapshot;
}

/** 기존 `useAnthropicAuthStore.getState()` 패턴 호환 */
useAnthropicAuthStore.getState = (): AnthropicAuthSnapshot =>
  buildSnapshot(
    jotaiStore.get(anthropicStatusAtom),
    jotaiStore.get(anthropicIsAuthenticatedAtom),
    jotaiStore.get(anthropicSourceAtom),
    jotaiStore.get(anthropicExpiresAtAtom),
    jotaiStore.get(anthropicIsLoadingAtom),
    jotaiStore.get(anthropicErrorAtom)
  );
