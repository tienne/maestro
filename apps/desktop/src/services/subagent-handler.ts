/**
 * SubagentHandler — TeamsWatcher spawn 감지 시 자식 Task 자동 생성
 *
 * session.launch 이후 호출하여, 해당 세션의 PTY 출력에서
 * 서브에이전트 spawn이 감지될 때마다 tasks 테이블에 자식 태스크를 INSERT하고
 * 렌더러에 'subagent-task-created' 이벤트를 전송한다.
 */

import { v4 as uuidv4 } from 'uuid';
import log from 'electron-log';
import { teamsWatcher } from './teams-watcher';
import { getDatabaseManager } from '../db/database';
import * as schema from '../db/schema';
import { getMainWindow } from '../main';

export interface SubagentTaskCreatedPayload {
  taskId: string;
  parentTaskId: string;
  projectId: string;
  title: string;
}

/**
 * 세션에 서브에이전트 핸들러를 연결한다.
 *
 * @param sessionId    - PTY 세션 ID
 * @param parentTaskId - 이 세션을 실행한 부모 태스크 ID
 * @param projectId    - 부모 태스크가 속한 프로젝트 ID
 *
 * 세션 종료 시에는 teams-watcher 자체가 `detachFromSession`을 호출하므로
 * (router.ts의 ptyManager.onExit 핸들러에서 이미 처리됨) 별도 해제 불필요.
 */
export function attachSubagentHandler(
  sessionId: string,
  parentTaskId: string,
  projectId: string,
): void {
  teamsWatcher.attachToSession(sessionId, (sid, info) => {
    try {
      const drizzle = getDatabaseManager().drizzle;
      const now = Date.now();
      const childTaskId = uuidv4();
      const title = info.taskDescription || 'Sub-task';

      drizzle.insert(schema.tasks).values({
        id: childTaskId,
        projectId,
        parentTaskId,
        title,
        status: 'pending',
        createdBy: 'agent',
        priority: 'medium',
        createdAt: now,
        updatedAt: now,
      }).run();

      log.info(`[SubagentHandler] Child task created: ${childTaskId} (parent: ${parentTaskId})`);

      const win = getMainWindow();
      if (win && !win.isDestroyed()) {
        const payload: SubagentTaskCreatedPayload = {
          taskId: childTaskId,
          parentTaskId,
          projectId,
          title,
        };
        win.webContents.send('subagent-task-created', payload);
      }
    } catch (err) {
      log.error('[SubagentHandler] Failed to create child task:', err);
    }
  });
}
