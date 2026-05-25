import { QueryClient } from '@tanstack/react-query';

/**
 * queryClient — 공유 QueryClient 인스턴스.
 *
 * TRPCProvider 내부 useState로 생성된 인스턴스가 주요 사용처이며,
 * 이 파일은 Provider 외부(예: 라우터 loader, 테스트 setup)에서
 * 동일한 defaultOptions를 가진 인스턴스가 필요할 때 참조한다.
 *
 * Electron IPC 환경 최적화:
 * - refetchOnWindowFocus/Reconnect 비활성화 (IPC는 항상 연결 상태)
 * - staleTime 5분 (데스크탑 앱 특성상 데이터 변경 빈도 낮음)
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        refetchOnWindowFocus: false,
        refetchOnReconnect: false,
        retry: 1,
        staleTime: 1000 * 60 * 5,
      },
    },
  });
}
