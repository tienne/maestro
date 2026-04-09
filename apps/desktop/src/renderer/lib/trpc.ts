import { createTRPCReact } from '@trpc/react-query';
import type { AppRouter } from '@maestro/shared-types';

/**
 * trpc — React Query 연동 tRPC 클라이언트 훅 생성기.
 * 컴포넌트에서 trpc.<router>.<procedure>.useQuery() 형태로 사용.
 */
export const trpc = createTRPCReact<AppRouter>();
