import React, { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { trpc } from '../lib/trpc';
import { trpcClient } from '../lib/trpc-client';

interface TRPCProviderProps {
  children: React.ReactNode;
}

/**
 * TRPCProvider — tRPC React Query 연동 Provider.
 * QueryClient + tRPC Client를 생성하고 하위 컴포넌트에 주입.
 *
 * 사용법:
 *   <TRPCProvider>
 *     <App />
 *   </TRPCProvider>
 */
export function TRPCProvider({ children }: TRPCProviderProps): React.ReactElement {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // 창 포커스 복귀 시 자동 재요청 비활성화 (Electron 환경 최적화)
            refetchOnWindowFocus: false,
            // 네트워크 재연결 시 재요청 비활성화 (IPC는 항상 연결 상태)
            refetchOnReconnect: false,
            retry: 1,
            staleTime: 30_000,
          },
        },
      }),
  );

  const [client] = useState(() => trpcClient);

  return (
    <trpc.Provider client={client} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </trpc.Provider>
  );
}
