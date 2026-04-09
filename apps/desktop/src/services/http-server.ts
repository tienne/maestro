/**
 * Local HTTP Server — Electron Main Process
 *
 * CLI가 데스크탑 앱을 제어할 수 있도록 Express 기반 로컬 서버를 제공한다.
 * - tRPC HTTP 어댑터: /trpc/* 경로로 모든 tRPC procedure 호출 가능
 * - 이벤트 엔드포인트: /api/events 로 에이전트 이벤트 수신 후 Renderer에 브로드캐스트
 * - Bearer 토큰 인증: 앱 기동 시 랜덤 생성, config-store를 통해 파일에 저장
 */

import express, { Request, Response, NextFunction } from 'express';
import * as http from 'http';
import * as crypto from 'crypto';
import { BrowserWindow } from 'electron';
import { createExpressMiddleware } from '@trpc/server/adapters/express';
import { appRouter } from '../trpc/router';

// ── Auth Token ────────────────────────────────────────────────────────────────

export const AUTH_TOKEN = crypto.randomBytes(32).toString('hex');

// ── Server State ──────────────────────────────────────────────────────────────

let server: http.Server | null = null;
let serverPort = 0;

export function getServerPort(): number {
  return serverPort;
}

export function getAuthToken(): string {
  return AUTH_TOKEN;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * 열려있는 모든 BrowserWindow에 IPC 이벤트를 브로드캐스트한다.
 */
function broadcastToRenderer(channel: string, payload: unknown): void {
  BrowserWindow.getAllWindows().forEach((w) => w.webContents.send(channel, payload));
}

// ── Middleware ────────────────────────────────────────────────────────────────

function authMiddleware(req: Request, res: Response, next: NextFunction): void {
  const authHeader = req.headers['authorization'];
  const token = authHeader?.replace('Bearer ', '');

  if (token !== AUTH_TOKEN) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }

  next();
}

// ── Server ────────────────────────────────────────────────────────────────────

/**
 * Express HTTP 서버를 시작한다.
 * port 0 으로 바인딩해 OS가 빈 포트를 자동 배정한다.
 * @returns 실제 바인딩된 포트 번호
 */
export async function startHttpServer(): Promise<number> {
  const app = express();

  app.use(express.json());

  // tRPC HTTP 어댑터 — 인증 후 모든 tRPC procedure 처리
  app.use(
    '/trpc',
    authMiddleware,
    createExpressMiddleware({
      router: appRouter,
    }),
  );

  // 에이전트 이벤트 수신 엔드포인트
  // 에이전트 훅(hook) 또는 CLI 워퍼가 이 경로로 POST 요청을 보낸다
  app.post('/api/events', authMiddleware, (req: Request, res: Response) => {
    const { type, sessionId, agentType } = req.body as {
      type: string;
      sessionId: string;
      agentType?: string;
    };

    broadcastToRenderer('agent:event', { type, sessionId, agentType });
    res.json({ ok: true });
  });

  return new Promise((resolve, reject) => {
    server = app.listen(0, '127.0.0.1', () => {
      const address = server!.address();
      if (!address || typeof address === 'string') {
        reject(new Error('Failed to get server address'));
        return;
      }
      serverPort = address.port;
      resolve(serverPort);
    });

    server.on('error', reject);
  });
}

/**
 * HTTP 서버를 정지한다. 앱 종료 시 호출.
 */
export function stopHttpServer(): Promise<void> {
  return new Promise((resolve) => {
    if (!server) {
      resolve();
      return;
    }
    server.close(() => {
      server = null;
      serverPort = 0;
      resolve();
    });
  });
}
