// tRPC vanilla client
import { createTRPCClient, httpBatchLink } from '@trpc/client';
import type { AppRouter } from '@maestro/shared-types';
import { readServerConfig } from './config';

export function createClient() {
  const config = readServerConfig();
  return createTRPCClient<AppRouter>({
    links: [
      httpBatchLink({
        url: `http://127.0.0.1:${config.port}/trpc`,
        headers: { Authorization: `Bearer ${config.token}` },
      }),
    ],
  });
}
