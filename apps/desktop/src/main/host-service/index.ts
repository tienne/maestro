// eslint-disable-next-line @typescript-eslint/ban-ts-comment
// @ts-ignore — hono is installed at runtime as an external dependency
import { Hono, type Context } from 'hono';
// @ts-ignore — @hono/node-server is installed at runtime as an external dependency
import { serve } from '@hono/node-server';
import { fetchRequestHandler } from '@trpc/server/adapters/fetch';
import { appRouter } from './router';
import { tokenManager } from './token-manager';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Server = any;

const app = new Hono();

app.get('/health', (c: Context) => {
  return c.json({ status: 'ok', pid: process.pid });
});

app.all('/trpc/*', (c: Context) => {
  return fetchRequestHandler({
    endpoint: '/trpc',
    req: c.req.raw,
    router: appRouter,
    createContext: () => ({}),
  });
});

// OAuth 토큰 만료 감지 + 자동 갱신 + 재인증 신호 전송 초기화
// 실패해도 서버 기동을 막지 않는다
tokenManager.initialize().catch((err) => {
  console.error('[host-service] tokenManager.initialize failed:', err);
});

const requestedPort = process.env['PORT'] ? parseInt(process.env['PORT'], 10) : 0;

const server: Server = serve(
  {
    fetch: app.fetch,
    hostname: '127.0.0.1',
    port: requestedPort,
  },
  (info: { port: number }) => {
    // main process가 이 출력을 파싱해 포트를 인식한다
    console.log(`HOST_SERVICE_PORT=${info.port}`);
  }
);

process.on('SIGTERM', () => {
  server.close(() => {
    process.exit(0);
  });
});
