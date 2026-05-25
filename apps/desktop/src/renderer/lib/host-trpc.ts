import { createTRPCClient, httpBatchLink } from '@trpc/client';
import superjson from 'superjson';
import type { AppRouter } from '../../main/host-service/router';

/**
 * host-trpc — host-service child process의 HTTP tRPC 서버에 연결하는 vanilla 클라이언트.
 *
 * host-service는 동적 포트에서 실행되므로 Electron main process에 IPC로 포트를 조회한다.
 * lazy 초기화: 첫 getHostServiceClient() 호출 시 포트를 조회하고 클라이언트를 생성.
 *
 * 기존 IPC tRPC(trpc-client.ts)와 별개로 동작 — host-service의 AI 채팅 전용.
 */

async function getHostServiceUrl(): Promise<string> {
  const port = (await window.electronAPI?.invoke('host-service:getPort')) as number;
  if (!port) {
    throw new Error('[host-trpc] host-service port not available — IPC returned falsy');
  }
  return `http://127.0.0.1:${port}/trpc`;
}

let clientPromise: Promise<ReturnType<typeof createTRPCClient<AppRouter>>> | null = null;

/**
 * getHostServiceClient — host-service HTTP tRPC 클라이언트를 반환한다.
 * 첫 호출 시 IPC로 포트를 조회 후 클라이언트를 초기화, 이후 캐시된 Promise를 반환.
 *
 * @example
 * const client = await getHostServiceClient();
 * const result = await client.session.listMessages.query({ sessionId });
 */
export function getHostServiceClient(): Promise<ReturnType<typeof createTRPCClient<AppRouter>>> {
  if (!clientPromise) {
    clientPromise = getHostServiceUrl().then((url) =>
      createTRPCClient<AppRouter>({
        links: [
          httpBatchLink({
            url,
            transformer: superjson,
          }),
        ],
      })
    );
  }
  return clientPromise;
}

/**
 * resetHostServiceClient — 포트가 변경된 경우(재시작 등) 클라이언트 캐시를 초기화한다.
 * 다음 getHostServiceClient() 호출 시 포트를 재조회한다.
 */
export function resetHostServiceClient(): void {
  clientPromise = null;
}
