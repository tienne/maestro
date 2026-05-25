import { useEffect } from 'react';
import { trpc } from '../lib/trpc';
import { useTaskStore } from '../store/taskStore';
import type { ProjectTask } from '@maestro/shared-types';

interface SubagentTaskCreatedPayload {
  taskId: string;
  parentTaskId: string;
  projectId: string;
  title: string;
}

/**
 * 메인 프로세스에서 전송하는 'subagent-task-created' IPC 이벤트를 수신한다.
 *
 * 서브에이전트 spawn이 감지될 때마다:
 * 1. taskStore에 낙관적으로 자식 태스크를 추가한다 (즉각 UI 반영).
 * 2. trpc.projectTask.listChildren 쿼리를 무효화해 서버 데이터와 동기화한다.
 *
 * 이 훅은 앱 루트(useAppInit과 같은 위치)에서 한 번만 마운트한다.
 */
export function useSubagentEvents(): void {
  const utils = trpc.useUtils();
  const { addTask } = useTaskStore();

  useEffect(() => {
    if (!window.electronAPI) return;

    const unlisten = window.electronAPI.onEvent(
      'subagent-task-created',
      (payload: unknown) => {
        const { taskId, parentTaskId, projectId, title } =
          payload as SubagentTaskCreatedPayload;

        const now = Date.now();

        // 낙관적 추가 — DB 왕복 없이 즉각 UI에 자식 태스크 표시
        const optimisticTask: ProjectTask = {
          id: taskId,
          projectId,
          parentTaskId,
          title,
          status: 'pending',
          createdBy: 'agent',
          priority: 'medium',
          createdAt: now,
          updatedAt: now,
        };
        addTask(optimisticTask);

        // listChildren 캐시 무효화 — 부모 태스크의 자식 목록 재조회
        utils.projectTask.listChildren
          .invalidate({ parentTaskId })
          .catch(() => { /* 무시 */ });

        // list 캐시도 무효화 — 프로젝트 전체 태스크 목록 갱신
        utils.projectTask.list
          .invalidate({ projectId })
          .catch(() => { /* 무시 */ });
      },
    );

    return unlisten;
  }, [addTask, utils]);
}
