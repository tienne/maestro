import { ipcMain, BrowserWindow } from 'electron';
import { resolveAnthropicCredential } from './credential';
import log from 'electron-log';

export interface AnthropicAuthStatus {
  isAuthenticated: boolean;
  source?: 'claude-config' | 'keychain' | 'mastracode';
  expiresAt?: number;
  isExpired?: boolean;
}

export function registerAnthropicAuthStatusHandlers(): void {
  // renderer → main: 인증 상태 조회
  ipcMain.handle('anthropic:getAuthStatus', async (): Promise<AnthropicAuthStatus> => {
    try {
      const credential = await resolveAnthropicCredential();
      if (!credential) {
        return { isAuthenticated: false };
      }

      const isExpired = credential.expires != null && Date.now() >= credential.expires;

      return {
        isAuthenticated: !isExpired,
        source: credential.source,
        expiresAt: credential.expires,
        isExpired,
      };
    } catch (err) {
      log.error('[auth-status] getAuthStatus failed:', err);
      return { isAuthenticated: false };
    }
  });
}

// main → renderer: 재인증 필요 이벤트 브로드캐스트
// host-service child process에서 REAUTH_REQUIRED stdout 메시지를 수신했을 때 호출한다
export function broadcastReauthRequired(): void {
  const windows = BrowserWindow.getAllWindows();
  for (const win of windows) {
    if (!win.isDestroyed()) {
      win.webContents.send('anthropic:reauth-required');
    }
  }
}
