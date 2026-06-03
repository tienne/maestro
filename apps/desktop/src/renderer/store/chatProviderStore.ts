import { atom, getDefaultStore } from 'jotai';
import type { ChatProvider, ChatProviderStatus } from '@maestro/shared-types';

// ---------------------------------------------------------------------------
// Base atoms — 프로바이더별 연결 상태
// ---------------------------------------------------------------------------

export const openaiStatusAtom = atom<ChatProviderStatus>('disconnected');
export const openaiEmailAtom = atom<string | undefined>(undefined);

export const googleStatusAtom = atom<ChatProviderStatus>('disconnected');
export const googleEmailAtom = atom<string | undefined>(undefined);

// ---------------------------------------------------------------------------
// Jotai store instance
// ---------------------------------------------------------------------------

const jotaiStore = getDefaultStore();

// ---------------------------------------------------------------------------
// 초기화 — 앱 시작 시 현재 연결 상태 확인
// ---------------------------------------------------------------------------

export async function initChatProviders() {
  const providers: ChatProvider[] = ['openai', 'google'];
  for (const provider of providers) {
    try {
      const result = await window.electronAPI?.invoke('chat:oauth:getStatus', { provider });
      if ((result as { connected?: boolean } | undefined)?.connected) {
        if (provider === 'openai') jotaiStore.set(openaiStatusAtom, 'connected');
        if (provider === 'google') jotaiStore.set(googleStatusAtom, 'connected');
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
  if (provider === 'openai') jotaiStore.set(openaiStatusAtom, 'connecting');
  if (provider === 'google') jotaiStore.set(googleStatusAtom, 'connecting');
  await window.electronAPI?.invoke('chat:oauth:start', { provider });
}

// ---------------------------------------------------------------------------
// OAuth 결과 처리 (IPC 이벤트 수신 후 호출)
// ---------------------------------------------------------------------------

export function handleOAuthResult(provider: ChatProvider, success: boolean) {
  if (provider === 'openai') {
    jotaiStore.set(openaiStatusAtom, success ? 'connected' : 'disconnected');
  }
  if (provider === 'google') {
    jotaiStore.set(googleStatusAtom, success ? 'connected' : 'disconnected');
  }
}

// ---------------------------------------------------------------------------
// 연결 해제
// ---------------------------------------------------------------------------

export async function disconnectProvider(provider: ChatProvider) {
  await window.electronAPI?.invoke('chat:oauth:disconnect', { provider });
  if (provider === 'openai') jotaiStore.set(openaiStatusAtom, 'disconnected');
  if (provider === 'google') jotaiStore.set(googleStatusAtom, 'disconnected');
}

// ---------------------------------------------------------------------------
// 액세스 토큰 가져오기
// ---------------------------------------------------------------------------

export async function getAccessToken(provider: ChatProvider): Promise<string | null> {
  const result = await window.electronAPI?.invoke('chat:oauth:getToken', { provider });
  return (result as { accessToken?: string } | undefined)?.accessToken ?? null;
}
