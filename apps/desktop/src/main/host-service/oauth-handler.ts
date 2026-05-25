import { ipcMain, BrowserWindow } from 'electron';
import { saveAnthropicCredentialToAuthStorage } from './credential';
import log from 'electron-log';

// ── Anthropic OAuth 설정 ──────────────────────────────────────────────────────

const ANTHROPIC_OAUTH_URL = 'https://claude.ai/oauth/authorize';
const REDIRECT_URI = 'maestro://oauth/callback';
const CLIENT_ID = 'maestro-desktop'; // TODO: 실제 client_id로 교체

// ── IPC 핸들러 등록 ───────────────────────────────────────────────────────────

export function registerAnthropicOAuthHandlers(): void {
  ipcMain.handle('anthropic:openOAuth', async () => {
    return openAnthropicOAuthWindow();
  });
}

// ── OAuth 창 ──────────────────────────────────────────────────────────────────

async function openAnthropicOAuthWindow(): Promise<{ success: boolean; error?: string }> {
  return new Promise((resolve) => {
    let resolved = false;

    const settle = (result: { success: boolean; error?: string }) => {
      if (!resolved) {
        resolved = true;
        resolve(result);
      }
    };

    const authUrl = buildAuthUrl();

    const win = new BrowserWindow({
      width: 800,
      height: 700,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
      },
      title: 'Anthropic 인증',
      modal: false,
    });

    // redirect_uri 인터셉트 — maestro:// 또는 localhost 콜백 모두 처리
    win.webContents.on('will-redirect', (event, url) => {
      if (url.startsWith(REDIRECT_URI) || url.startsWith('http://localhost')) {
        event.preventDefault();
        void handleOAuthCallback(url, win, settle);
      }
    });

    // 창이 닫히면 취소 처리 (사용자가 직접 닫은 경우)
    win.on('closed', () => {
      settle({ success: false, error: 'cancelled' });
    });

    win.loadURL(authUrl).catch((err) => {
      log.error('[oauth] failed to load auth URL:', err);
      if (!win.isDestroyed()) win.close();
      settle({ success: false, error: 'load_failed' });
    });
  });
}

// ── URL 빌더 ──────────────────────────────────────────────────────────────────

function buildAuthUrl(): string {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI,
    scope: 'openid email',
  });
  return `${ANTHROPIC_OAUTH_URL}?${params.toString()}`;
}

// ── 콜백 처리 ─────────────────────────────────────────────────────────────────

async function handleOAuthCallback(
  callbackUrl: string,
  win: BrowserWindow,
  settle: (result: { success: boolean; error?: string }) => void,
): Promise<void> {
  try {
    const url = new URL(callbackUrl);
    const code = url.searchParams.get('code');
    const error = url.searchParams.get('error');

    if (error || !code) {
      if (!win.isDestroyed()) win.close();
      settle({ success: false, error: error ?? 'no_code' });
      return;
    }

    // authorization_code → access_token 교환
    const tokenRes = await fetch('https://api.anthropic.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        grant_type: 'authorization_code',
        code,
        redirect_uri: REDIRECT_URI,
        client_id: CLIENT_ID,
      }),
    });

    if (!tokenRes.ok) {
      log.error('[oauth] token exchange failed:', tokenRes.status, tokenRes.statusText);
      if (!win.isDestroyed()) win.close();
      settle({ success: false, error: 'token_exchange_failed' });
      return;
    }

    const tokenData = (await tokenRes.json()) as {
      access_token: string;
      refresh_token?: string;
      expires_in?: number;
    };

    saveAnthropicCredentialToAuthStorage({
      type: 'oauth',
      access: tokenData.access_token,
      refresh: tokenData.refresh_token,
      expires: tokenData.expires_in != null ? Date.now() + tokenData.expires_in * 1000 : undefined,
    });

    log.info('[oauth] Anthropic OAuth completed successfully');
    if (!win.isDestroyed()) win.close();
    settle({ success: true });
  } catch (err) {
    log.error('[oauth] callback handling failed:', err);
    if (!win.isDestroyed()) win.close();
    settle({ success: false, error: 'unexpected_error' });
  }
}
