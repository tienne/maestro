export type RelayStatus = 'connecting' | 'connected' | 'disconnected';

export type RelayMessageType =
  | 'session:list'
  | 'session:input'
  | 'session:output'
  | 'ping'
  | 'pong';

export interface RelayMessage {
  type: RelayMessageType;
  sessionId?: string;
  data?: string;
}

export interface Session {
  id: string;
  name: string;
  createdAt: string;
}

type MessageHandler = (msg: RelayMessage) => void;

class RelaySocket {
  private ws: WebSocket | null = null;
  private _status: RelayStatus = 'disconnected';
  private messageHandlers: Set<MessageHandler> = new Set();

  get status(): RelayStatus {
    return this._status;
  }

  connect(jwt: string, serverUrl: string): void {
    if (this.ws && (this.ws.readyState === WebSocket.CONNECTING || this.ws.readyState === WebSocket.OPEN)) {
      return;
    }

    this._status = 'connecting';

    try {
      // React Native WebSocket supports the protocols/options 3rd argument
      // We pass Authorization via URL query param as RN WebSocket doesn't support custom headers directly
      const url = new URL(serverUrl);
      url.searchParams.set('role', 'mobile');
      url.searchParams.set('token', jwt);

      this.ws = new WebSocket(url.toString());
    } catch (err) {
      console.error('[relaySocket] Failed to create WebSocket:', err);
      this._status = 'disconnected';
      return;
    }

    this.ws.onopen = () => {
      console.log('[relaySocket] connected');
      this._status = 'connected';
    };

    this.ws.onmessage = (event) => {
      try {
        const msg: RelayMessage = JSON.parse(event.data as string);
        this.messageHandlers.forEach((handler) => handler(msg));
      } catch {
        // 파싱 실패 무시
      }
    };

    this.ws.onerror = (err) => {
      console.error('[relaySocket] error:', err);
    };

    this.ws.onclose = () => {
      console.log('[relaySocket] disconnected');
      this.ws = null;
      this._status = 'disconnected';
    };
  }

  disconnect(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this._status = 'disconnected';
  }

  sendInput(sessionId: string, data: string): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
      console.warn('[relaySocket] Cannot send — not connected');
      return;
    }
    const msg: RelayMessage = { type: 'session:input', sessionId, data };
    this.ws.send(JSON.stringify(msg));
  }

  addMessageHandler(handler: MessageHandler): () => void {
    this.messageHandlers.add(handler);
    return () => this.messageHandlers.delete(handler);
  }
}

export const relaySocket = new RelaySocket();
