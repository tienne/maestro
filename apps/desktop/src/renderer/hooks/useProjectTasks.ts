import { useEffect } from 'react';
import { trpc } from '../lib/trpc';
import { useTaskStore } from '../store/taskStore';
import type { ProjectTask } from '@maestro/shared-types';

/**
 * projectTask.list 쿼리를 실행하고 결과를 taskStore에 동기화한다.
 * projectId가 없으면 쿼리를 실행하지 않는다.
 */
export function useProjectTasks(projectId: string | null) {
  const { setTasks } = useTaskStore();
  const query = trpc.projectTask.list.useQuery(
    { projectId: projectId ?? '' },
    { enabled: !!projectId },
  );

  useEffect(() => {
    const d = query.data as unknown;
    if (d) setTasks(d as ProjectTask[]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query.data]);

  return query;
}
