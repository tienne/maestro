import http from 'http';
import { WebSocket, WebSocketServer } from 'ws';
import { IncomingMessage } from 'http';
import { verifySupabaseJWT } from './auth';
import { roomManager } from './room-manager';

interface ClientMeta {
  userId: string;
  role: 'desktop' | 'mobile';
  lastPong: number;
}

const clientMeta = new WeakMap<WebSocket, ClientMeta>();

export function createServer(): http.Server {
  const httpServer = http.createServer((_req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', rooms: roomManager.getRoomCount() }));
  });

  const wss = new WebSocketServer({ noServer: true });

  // HTTP Upgrade → WebSocket 핸드셰이크 시 JWT 인증
  httpServer.on('upgrade', (req: IncomingMessage, socket, head) => {
    // Authorization 헤더 또는 ?token= 쿼리 파라미터 모두 지원
    // (React Native WebSocket은 커스텀 헤더 미지원 → URL 쿼리 파라미터 사용)
    const url = new URL(req.url ?? '/', `http://${req.headers.host}`);
    const authHeader = req.headers['authorization'] ?? '';
    const headerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    const queryToken = url.searchParams.get('token');
    const token = headerToken ?? queryToken;

    if (!token) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    let userId: string;
    try {
      userId = verifySupabaseJWT(token);
    } catch {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }

    // role 쿼리 파라미터로 desktop/mobile 구분
    const role = url.searchParams.get('role') === 'desktop' ? 'desktop' : 'mobile';

    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req, userId, role);
    });
  });

  wss.on('connection', (ws: WebSocket, _req: IncomingMessage, userId: string, role: 'desktop' | 'mobile') => {
    // Room 등록
    if (role === 'desktop') {
      roomManager.addDesktop(userId, ws);
    } else {
      roomManager.addMobile(userId, ws);
    }

    clientMeta.set(ws, { userId, role, lastPong: Date.now() });

    // 메시지 라우팅
    ws.on('message', (data: Buffer) => {
      let msg: { type: string; [key: string]: unknown };
      try {
        msg = JSON.parse(data.toString()) as { type: string; [key: string]: unknown };
      } catch {
        return;
      }

      // type 필드 검증
      if (typeof msg.type !== 'string') return;

      const meta = clientMeta.get(ws);
      if (!meta) return;

      if (msg.type === 'pong') {
        meta.lastPong = Date.now();
        return;
      }

      if (meta.role === 'desktop') {
        // 데스크탑 → 모바일 브로드캐스트
        if (msg.type === 'session:list' || msg.type === 'session:output') {
          roomManager.broadcastToMobiles(meta.userId, JSON.stringify(msg));
        }
      } else {
        // 모바일 → 데스크탑 전달
        if (msg.type === 'session:input') {
          if (typeof msg.sessionId !== 'string' || msg.sessionId.length > 128) return;
          if (typeof msg.data !== 'string' || msg.data.length > 65536) return; // 64KB 제한
          roomManager.sendToDesktop(meta.userId, JSON.stringify(msg));
        }
      }
    });

    ws.on('close', () => {
      const meta = clientMeta.get(ws);
      if (meta) {
        roomManager.removeConnection(meta.userId, ws);
        clientMeta.delete(ws);
      }
    });

    ws.on('error', (err) => {
      console.error(`[relay] WebSocket error: ${err.message}`);
    });
  });

  // Heartbeat: 30초 ping, 60초 미응답 시 terminate
  const PING_INTERVAL = 30_000;
  const PONG_TIMEOUT = 60_000;

  const heartbeatTimer = setInterval(() => {
    wss.clients.forEach((ws) => {
      const meta = clientMeta.get(ws);
      if (!meta) return;

      if (Date.now() - meta.lastPong > PONG_TIMEOUT) {
        ws.terminate();
        return;
      }

      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'ping' }));
      }
    });
  }, PING_INTERVAL);

  httpServer.on('close', () => {
    clearInterval(heartbeatTimer);
  });

  return httpServer;
}
