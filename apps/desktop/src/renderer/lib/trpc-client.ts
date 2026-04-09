import { createTRPCClient } from '@trpc/client';
import { ipcLink } from './ipc-link';
import type { AppRouter } from '@maestro/shared-types';

/**
 * trpcClient — 커스텀 ipcLink를 사용하는 vanilla tRPC 클라이언트.
 * electron-trpc/renderer의 ipcLink는 tRPC v10 API(r.transformer.serialize)를 사용해
 * tRPC v11과 호환되지 않으므로 ipc-link.ts의 호환 구현으로 대체.
 */
export const trpcClient = createTRPCClient<AppRouter>({
  links: [ipcLink()],
});
