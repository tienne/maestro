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
import { getDatabaseManager } from '../db/database';
import { getPtyManager } from './pty-manager';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

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

  // ── 원격 제어 API ─────────────────────────────────────────────────────────────

  /** GET /api/remote/sessions — 실행 중 세션 목록 */
  app.get('/api/remote/sessions', authMiddleware, (_req: Request, res: Response) => {
    try {
      const db = getDatabaseManager().getDb();
      const sessions = db
        .prepare(`SELECT id, name, workspace_id, agent_id, status, pid, created_at FROM sessions ORDER BY created_at DESC`)
        .all() as Array<{ id: string; name: string; workspace_id: string; agent_id: string; status: string; pid: number | null; created_at: string }>;
      res.json({ sessions });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  /** POST /api/remote/sessions/:id/input — 세션에 텍스트 전송 */
  app.post('/api/remote/sessions/:id/input', authMiddleware, (req: Request, res: Response) => {
    const id = String(req.params['id']);
    const { text } = req.body as { text?: string };
    if (!text) {
      res.status(400).json({ error: 'text is required' });
      return;
    }
    try {
      const ptyManager = getPtyManager();
      ptyManager.write(id, text);
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  /** POST /api/remote/sessions/broadcast — 모든 실행 세션에 텍스트 브로드캐스트 */
  app.post('/api/remote/sessions/broadcast', authMiddleware, (req: Request, res: Response) => {
    const { text, sessionIds } = req.body as { text?: string; sessionIds?: string[] };
    if (!text) {
      res.status(400).json({ error: 'text is required' });
      return;
    }
    try {
      const db = getDatabaseManager().getDb();
      const ptyManager = getPtyManager();

      const targets: string[] = sessionIds ?? (() => {
        const rows = db
          .prepare(`SELECT id FROM sessions WHERE status = 'running'`)
          .all() as Array<{ id: string }>;
        return rows.map((r) => r.id);
      })();

      const errors: string[] = [];
      for (const sid of targets) {
        try {
          ptyManager.write(sid, text);
        } catch (e) {
          errors.push(`${sid}: ${String(e)}`);
        }
      }
      res.json({ ok: true, sent: targets.length - errors.length, errors });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  /** GET /api/remote/info — 서버 정보 (포트, 버전) */
  app.get('/api/remote/info', authMiddleware, (_req: Request, res: Response) => {
    res.json({ port: serverPort, version: '1.0.0', ready: true });
  });

  // ── M6-03: 확장 REST API 엔드포인트 ─────────────────────────────────────────

  /** POST /api/remote/sessions — 새 세션 생성 */
  app.post('/api/remote/sessions', authMiddleware, (req: Request, res: Response) => {
    try {
      const db = getDatabaseManager().getDb();
      const { name, workspaceId, agentId } = req.body as {
        name?: string;
        workspaceId?: string;
        agentId?: string;
      };

      if (!name || !workspaceId || !agentId) {
        res.status(400).json({ error: 'name, workspaceId, agentId are required' });
        return;
      }

      const workspace = db.prepare('SELECT * FROM workspaces WHERE id = ?').get(workspaceId);
      if (!workspace) {
        res.status(404).json({ error: `Workspace ${workspaceId} not found` });
        return;
      }

      const agent = db.prepare('SELECT * FROM agents WHERE id = ?').get(agentId);
      if (!agent) {
        res.status(404).json({ error: `Agent ${agentId} not found` });
        return;
      }

      const id = crypto.randomUUID();
      db.prepare(
        `INSERT INTO sessions (id, name, workspace_id, agent_id, status) VALUES (?, ?, ?, ?, 'pending')`
      ).run(id, name, workspaceId, agentId);

      const row = db.prepare(
        'SELECT id, name, workspace_id, agent_id, status, pid, created_at FROM sessions WHERE id = ?'
      ).get(id) as Record<string, unknown>;

      res.status(201).json({ session: row });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  /** GET /api/remote/sessions/:id — 세션 상태 조회 */
  app.get('/api/remote/sessions/:id', authMiddleware, (req: Request, res: Response) => {
    try {
      const db = getDatabaseManager().getDb();
      const row = db.prepare(
        'SELECT id, name, workspace_id, agent_id, status, pid, created_at FROM sessions WHERE id = ?'
      ).get(String(req.params['id'])) as Record<string, unknown> | undefined;

      if (!row) {
        res.status(404).json({ error: 'Session not found' });
        return;
      }
      res.json({ session: row });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  /** DELETE /api/remote/sessions/:id — 세션 종료 */
  app.delete('/api/remote/sessions/:id', authMiddleware, (req: Request, res: Response) => {
    try {
      const db = getDatabaseManager().getDb();
      const ptyManager = getPtyManager();
      const sessionId = String(req.params['id']);

      const row = db.prepare('SELECT id FROM sessions WHERE id = ?').get(sessionId);
      if (!row) {
        res.status(404).json({ error: 'Session not found' });
        return;
      }

      if (ptyManager.isAlive(sessionId)) {
        ptyManager.kill(sessionId);
      }
      db.prepare('UPDATE sessions SET status = ?, pid = NULL WHERE id = ?').run('stopped', sessionId);
      res.json({ ok: true });
    } catch (err) {
      res.status(500).json({ error: String(err) });
    }
  });

  /** GET /api/docs — Swagger UI (간소화된 정적 HTML) */
  app.get('/api/docs', (_req: Request, res: Response) => {
    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Maestro API Documentation</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 900px; margin: 0 auto; padding: 2rem; background: #1a1a2e; color: #e0e0e0; }
    h1 { color: #6366f1; border-bottom: 2px solid #6366f1; padding-bottom: 0.5rem; }
    h2 { color: #818cf8; margin-top: 2rem; }
    .endpoint { background: #16213e; padding: 1rem; border-radius: 8px; margin: 0.5rem 0; border-left: 3px solid #6366f1; }
    .method { font-weight: bold; padding: 2px 8px; border-radius: 4px; font-size: 0.85em; }
    .get { background: #22c55e; color: #000; }
    .post { background: #3b82f6; color: #fff; }
    .delete { background: #ef4444; color: #fff; }
    code { background: #0f3460; padding: 2px 6px; border-radius: 4px; font-size: 0.9em; }
    pre { background: #0f3460; padding: 1rem; border-radius: 8px; overflow-x: auto; }
    .note { color: #a0a0a0; font-size: 0.9em; }
  </style>
</head>
<body>
  <h1>Maestro REST API</h1>
  <p class="note">Base URL: <code>http://127.0.0.1:${serverPort}</code> | Auth: <code>Authorization: Bearer &lt;token&gt;</code></p>

  <h2>Sessions</h2>
  <div class="endpoint"><span class="method get">GET</span> <code>/api/remote/sessions</code> — 세션 목록</div>
  <div class="endpoint"><span class="method post">POST</span> <code>/api/remote/sessions</code> — 새 세션 생성<br><code>body: { name, workspaceId, agentId }</code></div>
  <div class="endpoint"><span class="method get">GET</span> <code>/api/remote/sessions/:id</code> — 세션 상태 조회</div>
  <div class="endpoint"><span class="method delete">DELETE</span> <code>/api/remote/sessions/:id</code> — 세션 종료</div>
  <div class="endpoint"><span class="method post">POST</span> <code>/api/remote/sessions/:id/input</code> — 텍스트 전송<br><code>body: { text }</code></div>
  <div class="endpoint"><span class="method post">POST</span> <code>/api/remote/sessions/broadcast</code> — 브로드캐스트<br><code>body: { text, sessionIds? }</code></div>

  <h2>System</h2>
  <div class="endpoint"><span class="method get">GET</span> <code>/api/remote/info</code> — 서버 정보</div>
  <div class="endpoint"><span class="method post">POST</span> <code>/api/events</code> — 에이전트 이벤트 수신</div>

  <h2>tRPC</h2>
  <div class="endpoint"><span class="method post">POST</span> <code>/trpc/*</code> — 전체 tRPC procedure (batch 지원)</div>

  <h2>curl 예시</h2>
  <pre>
# 세션 목록 조회
curl -H "Authorization: Bearer &lt;token&gt;" http://127.0.0.1:${serverPort}/api/remote/sessions

# 새 세션 생성
curl -X POST -H "Authorization: Bearer &lt;token&gt;" -H "Content-Type: application/json" \\
  -d '{"name":"test","workspaceId":"...","agentId":"..."}' \\
  http://127.0.0.1:${serverPort}/api/remote/sessions

# 세션에 텍스트 전송
curl -X POST -H "Authorization: Bearer &lt;token&gt;" -H "Content-Type: application/json" \\
  -d '{"text":"hello"}' \\
  http://127.0.0.1:${serverPort}/api/remote/sessions/&lt;id&gt;/input

# 브로드캐스트
curl -X POST -H "Authorization: Bearer &lt;token&gt;" -H "Content-Type: application/json" \\
  -d '{"text":"please commit your changes"}' \\
  http://127.0.0.1:${serverPort}/api/remote/sessions/broadcast
  </pre>
</body>
</html>`;
    res.type('html').send(html);
  });

  // ── 포트 파일 저장 (CLI에서 사용) ──────────────────────────────────────────

  return new Promise((resolve, reject) => {
    server = app.listen(0, '127.0.0.1', () => {
      const address = server!.address();
      if (!address || typeof address === 'string') {
        reject(new Error('Failed to get server address'));
        return;
      }
      serverPort = address.port;

      // ~/.maestro/port 파일에 포트 번호 저장 (CLI에서 직접 읽기용)
      try {
        const portDir = path.join(os.homedir(), '.maestro');
        if (!fs.existsSync(portDir)) fs.mkdirSync(portDir, { recursive: true });
        fs.writeFileSync(path.join(portDir, 'port'), String(serverPort));
      } catch { /* 무시 */ }

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
      // port 파일 정리
      try {
        const portFile = path.join(os.homedir(), '.maestro', 'port');
        if (fs.existsSync(portFile)) fs.unlinkSync(portFile);
      } catch { /* 무시 */ }
      resolve();
    });
  });
}
