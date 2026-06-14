import { create } from 'zustand';

// ---------------------------------------------------------------------------
// 타입 정의
// ---------------------------------------------------------------------------

type AuthSource = 'claude-config' | 'keychain' | 'mastracode';
type AuthStatus = 'checking' | 'authenticated' | 'unauthenticated' | 'expired';

// ---------------------------------------------------------------------------
// Zustand 스토어
// ---------------------------------------------------------------------------

interface AnthropicAuthStore {
  status: AuthStatus;
  isAuthenticated: boolean;
  source?: AuthSource;
  expiresAt?: number;
  isLoading: boolean;
  error?: string;
  /** 내부용: IPC 이벤트 리스너 정리 함수 */
  _cleanupFn?: () => void;
  // Actions
  _setStatus: (status: AuthStatus) => void;
  _setIsAuthenticated: (isAuthenticated: boolean) => void;
  _setSource: (source: AuthSource | undefined) => void;
  _setExpiresAt: (expiresAt: number | undefined) => void;
  _setIsLoading: (isLoading: boolean) => void;
  _setError: (error: string | undefined) => void;
  _setCleanupFn: (fn: (() => void) | undefined) => void;
  // Public actions
  checkStatus: () => Promise<void>;
  openOAuth: () => Promise<void>;
  initialize: () => void;
  cleanup: () => void;
}

export const useAnthropicAuthStore = create<AnthropicAuthStore>((set, get) => ({
  status: 'checking',
  isAuthenticated: false,
  source: undefined,
  expiresAt: undefined,
  isLoading: false,
  error: undefined,
  _cleanupFn: undefined,

  _setStatus: (status) => set({ status }),
  _setIsAuthenticated: (isAuthenticated) => set({ isAuthenticated }),
  _setSource: (source) => set({ source }),
  _setExpiresAt: (expiresAt) => set({ expiresAt }),
  _setIsLoading: (isLoading) => set({ isLoading }),
  _setError: (error) => set({ error }),
  _setCleanupFn: (_cleanupFn) => set({ _cleanupFn }),

  checkStatus: async () => {
    set({ isLoading: true });
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
        set({ isLoading: false, status: 'unauthenticated', isAuthenticated: false });
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

      set({
        isAuthenticated: result.isAuthenticated,
        status,
        source: result.source,
        expiresAt: result.expiresAt,
        isLoading: false,
        error: undefined,
      });
    } catch {
      set({ isLoading: false, status: 'unauthenticated', isAuthenticated: false });
    }
  },

  openOAuth: async () => {
    set({ isLoading: true, error: undefined });
    try {
      const result = (await window.electronAPI?.invoke('anthropic:openOAuth')) as
        | { success: boolean; error?: string }
        | undefined;

      if (result?.success) {
        await get().checkStatus();
      } else {
        set({ isLoading: false, error: result?.error ?? 'oauth_failed' });
      }
    } catch {
      set({ isLoading: false, error: 'unexpected_error' });
    }
  },

  initialize: () => {
    void get().checkStatus();

    window.electronAPI?.onEvent('anthropic:reauth-required', () => {
      set({ status: 'expired', isAuthenticated: false });
    });

    set({
      _cleanupFn: () => {
        window.electronAPI?.offEvent('anthropic:reauth-required');
      },
    });
  },

  cleanup: () => {
    const fn = get()._cleanupFn;
    if (typeof fn === 'function') fn();
  },
}));

// ---------------------------------------------------------------------------
// 하위 호환: anthropicIsAuthenticatedAtom을 읽던 코드가 없으므로 export 불필요.
// ModelSelector.tsx가 useAnthropicAuthStore를 직접 사용하도록 변경됨.
// ---------------------------------------------------------------------------
