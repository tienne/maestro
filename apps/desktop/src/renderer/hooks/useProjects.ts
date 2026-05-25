import { useEffect } from 'react';
import { trpc } from '../lib/trpc';
import { useProjectStore } from '../store/projectStore';
import type { Project } from '@maestro/shared-types';

/**
 * project.list 쿼리를 실행하고 결과를 projectStore에 동기화한다.
 * 컴포넌트에서 직접 trpc 훅을 쓰는 대신 이 훅을 사용하면
 * 스토어 상태와 React Query 캐시가 자동으로 맞춰진다.
 */
export function useProjects() {
  const { setProjects } = useProjectStore();
  const query = trpc.project.list.useQuery();

  useEffect(() => {
    const d = query.data as unknown;
    if (d) setProjects(d as Project[]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query.data]);

  return query;
}
