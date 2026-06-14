import { create } from 'zustand';
import type { ChatProvider, ChatProviderStatus } from '@maestro/shared-types';

// ---------------------------------------------------------------------------
// Zustand 스토어
// ---------------------------------------------------------------------------

interface ChatProviderStore {
  openaiStatus: ChatProviderStatus;
  openaiEmail?: string;
  googleStatus: ChatProviderStatus;
  googleEmail?: string;
  setOpenaiStatus: (status: ChatProviderStatus) => void;
  setOpenaiEmail: (email: string | undefined) => void;
  setGoogleStatus: (status: ChatProviderStatus) => void;
  setGoogleEmail: (email: string | undefined) => void;
}

export const useChatProviderStore = create<ChatProviderStore>((set) => ({
  openaiStatus: 'disconnected',
  openaiEmail: undefined,
  googleStatus: 'disconnected',
  googleEmail: undefined,
  setOpenaiStatus: (openaiStatus) => set({ openaiStatus }),
  setOpenaiEmail: (openaiEmail) => set({ openaiEmail }),
  setGoogleStatus: (googleStatus) => set({ googleStatus }),
  setGoogleEmail: (googleEmail) => set({ googleEmail }),
}));

// ---------------------------------------------------------------------------
// 초기화 — 앱 시작 시 현재 연결 상태 확인
// ---------------------------------------------------------------------------

export async function initChatProviders() {
  const providers: ChatProvider[] = ['openai', 'google'];
  for (const provider of providers) {
    try {
      const result = await window.electronAPI?.invoke('chat:oauth:getStatus', { provider });
      if ((result as { connected?: boolean } | undefined)?.connected) {
        if (provider === 'openai') useChatProviderStore.getState().setOpenaiStatus('connected');
        if (provider === 'google') useChatProviderStore.getState().setGoogleStatus('connected');
      }
    } catch {
      // ignore — 미연결 상태로 유지
    }
  }
}

// ---------------------------------------------------------------------------
// OAuth 시작
// ---------------------------------------------------------------------------

export async function startOAuth(provider: ChatProvider) {
  if (provider === 'openai') useChatProviderStore.getState().setOpenaiStatus('connecting');
  if (provider === 'google') useChatProviderStore.getState().setGoogleStatus('connecting');
  await window.electronAPI?.invoke('chat:oauth:start', { provider });
}

// ---------------------------------------------------------------------------
// OAuth 결과 처리 (IPC 이벤트 수신 후 호출)
// ---------------------------------------------------------------------------

export function handleOAuthResult(provider: ChatProvider, success: boolean) {
  if (provider === 'openai') {
    useChatProviderStore.getState().setOpenaiStatus(success ? 'connected' : 'disconnected');
  }
  if (provider === 'google') {
    useChatProviderStore.getState().setGoogleStatus(success ? 'connected' : 'disconnected');
  }
}

// ---------------------------------------------------------------------------
// 연결 해제
// ---------------------------------------------------------------------------

export async function disconnectProvider(provider: ChatProvider) {
  await window.electronAPI?.invoke('chat:oauth:disconnect', { provider });
  if (provider === 'openai') useChatProviderStore.getState().setOpenaiStatus('disconnected');
  if (provider === 'google') useChatProviderStore.getState().setGoogleStatus('disconnected');
}

// ---------------------------------------------------------------------------
// 액세스 토큰 가져오기
// ---------------------------------------------------------------------------

export async function getAccessToken(provider: ChatProvider): Promise<string | null> {
  const result = await window.electronAPI?.invoke('chat:oauth:getToken', { provider });
  return (result as { accessToken?: string } | undefined)?.accessToken ?? null;
}
