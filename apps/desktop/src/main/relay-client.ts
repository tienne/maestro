/**
 * RelayClient — Electron 메인 프로세스 WebSocket 릴레이 클라이언트
 *
 * 릴레이 서버에 desktop role로 연결하여 모바일 앱과 세션을 중계한다.
 * Node.js 22+ 빌트인 WebSocket 사용.
 */

import { BrowserWindow } from 'electron';
import log from 'electron-log';

export type RelayStatus = 'connected' | 'disconnected' | 'connecting';

function broadcastRelayStatus(status: RelayStatus): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send('relay-status', { status });
    }
  }
}

interface RelayMessage {
  type: 'session:list' | 'session:output' | 'session:input' | 'ping' | 'pong';
  sessionId?: string;
  data?: string;
}

const MAX_RETRIES = 5;

class RelayClient {
  private ws: WebSocket | null = null;
  private _status: RelayStatus = 'disconnected';
  private retryCount = 0;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private _token: string | null = null;
  private _url: string | null = null;
  private _destroyed = false;

  /** 메시지 수신 핸들러 (router.ts에서 주입) */
  onInputMessage: ((sessionId: string, data: string) => void) | null = null;

  get status(): RelayStatus {
    return this._status;
  }

  /** 릴레이 서버에 연결한다. token = Supabase JWT */
  connect(token: string, serverUrl: string): void {
    if (this._destroyed) return;
    if (this.ws && (this.ws.readyState === WebSocket.CONNECTING || this.ws.readyState === WebSocket.OPEN)) {
      return;
    }

    this._token = token;
    this._url = serverUrl;
    this._doConnect();
  }

  private _doConnect(): void {
    if (this._destroyed || !this._token || !this._url) return;

    this._status = 'connecting';
    log.info(`[relay-client] connecting to ${this._url} (attempt ${this.retryCount + 1})`);

    try {
      const url = new URL(`${this._url}?role=desktop`);
      this.ws = new WebSocket(url.toString(), {
        headers: {
          Authorization: `Bearer ${this._token}`,
        },
      } as unknown as string[]);
    } catch (err) {
      log.error('[relay-client] failed to create WebSocket:', err);
      this._scheduleRetry();
      return;
    }

    this.ws.onopen = () => {
      log.info('[relay-client] connected');
      this._status = 'connected';
      this.retryCount = 0;
      broadcastRelayStatus('connected');
    };

    this.ws.onmessage = (event) => {
      try {
        const msg: RelayMessage = JSON.parse(event.data as string);
        if (msg.type === 'session:input' && msg.sessionId && msg.data) {
          this.onInputMessage?.(msg.sessionId, msg.data);
        }
      } catch {
        // 파싱 실패는 무시
      }
    };

    this.ws.onerror = (err) => {
      log.error('[relay-client] WebSocket error:', err);
    };

    this.ws.onclose = () => {
      log.info('[relay-client] connection closed');
      this.ws = null;
      if (!this._destroyed) {
        this._scheduleRetry();
      } else {
        this._status = 'disconnected';
        broadcastRelayStatus('disconnected');
      }
    };
  }

  private _scheduleRetry(): void {
    if (this._destroyed) return;

    if (this.retryCount >= MAX_RETRIES) {
      log.warn(`[relay-client] max retries (${MAX_RETRIES}) reached — staying disconnected`);
      this._status = 'disconnected';
      broadcastRelayStatus('disconnected');
      return;
    }

    const delayMs = Math.pow(2, this.retryCount) * 1000;
    this.retryCount++;
    this._status = 'connecting';
    broadcastRelayStatus('connecting');
    log.info(`[relay-client] retry in ${delayMs}ms (attempt ${this.retryCount}/${MAX_RETRIES})`);

    this.retryTimer = setTimeout(() => {
      this._doConnect();
    }, delayMs);
  }

  /** 세션 목록을 모바일 클라이언트에 브로드캐스트 */
  broadcastSessions(sessions: { id: string; name: string; createdAt: string }[]): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const msg: RelayMessage = { type: 'session:list', data: JSON.stringify(sessions) };
    this.ws.send(JSON.stringify(msg));
  }

  /** 연결을 수동으로 닫는다 (재시도 없음) */
  disconnect(): void {
    this._clearRetryTimer();
    this._status = 'disconnected';
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  /** 앱 종료 시 완전 정리 */
  destroy(): void {
    this._destroyed = true;
    this.disconnect();
  }

  private _clearRetryTimer(): void {
    if (this.retryTimer) {
      clearTimeout(this.retryTimer);
      this.retryTimer = null;
    }
  }
}

export const relayClient = new RelayClient();
