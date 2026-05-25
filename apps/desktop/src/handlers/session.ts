import { ipcMain } from 'electron';
import { v4 as uuidv4 } from 'uuid';
import { eq, desc } from 'drizzle-orm';
import type { DatabaseManager } from '../db/database';
import * as schema from '../db/schema';
import type { PtyManager } from '../services/pty-manager';
import { getMainWindow } from '../main';

function rowToSession(row: schema.Session) {
  return {
    id: row.id,
    name: row.name,
    workspaceId: row.workspaceId,
    agentId: row.agentId,
    status: row.status as 'running' | 'stopped' | 'error',
    pid: row.pid,
    createdAt: row.createdAt,
  };
}

export function registerSessionHandlers(db: DatabaseManager, ptyManager: PtyManager): void {
  const drizzle = db.drizzle;
  // app_state 쿼리는 raw DB 사용 (task-13에서 별도 처리)
  const rawDb = db.getDb();

  // Fire-and-forget PTY 입력 — tRPC 왕복 없이 직접 PTY에 쓴다.
  // 레이턴시 민감 경로이므로 ipcMain.on (응답 없음) 사용.
  ipcMain.on('pty:write', (_event, args: { sessionId: string; text: string }) => {
    try {
      ptyManager.write(args.sessionId, args.text);
    } catch {
      // PTY가 이미 종료된 경우 조용히 무시
    }
  });

  ipcMain.handle('session:list', (_event, args: { workspaceId: string }) => {
    return drizzle
      .select()
      .from(schema.sessions)
      .where(eq(schema.sessions.workspaceId, args.workspaceId))
      .orderBy(desc(schema.sessions.createdAt))
      .all()
      .map(rowToSession);
  });

  ipcMain.handle('session:list-all', () => {
    return drizzle
      .select()
      .from(schema.sessions)
      .orderBy(desc(schema.sessions.createdAt))
      .all()
      .map(rowToSession);
  });

  // session:create — PTY 없이 pending 상태 세션 레코드 생성
  // XTerminal 마운트 후 실제 크기를 측정해서 session:launch로 PTY 를 시작한다.
  ipcMain.handle(
    'session:create',
    (_event, args: { name: string; workspaceId: string; agentId: string }) => {
      const { name, workspaceId, agentId } = args;

      const [workspace] = drizzle
        .select()
        .from(schema.workspaces)
        .where(eq(schema.workspaces.id, workspaceId))
        .all();
      if (!workspace) throw new Error(`Workspace ${workspaceId} not found`);

      const [agent] = drizzle
        .select()
        .from(schema.agents)
        .where(eq(schema.agents.id, agentId))
        .all();
      if (!agent) throw new Error(`Agent ${agentId} not found`);

      const id = uuidv4();
      drizzle.insert(schema.sessions).values({
        id,
        name,
        workspaceId,
        agentId,
        status: 'pending',
        pid: null,
      }).run();

      const [inserted] = drizzle
        .select()
        .from(schema.sessions)
        .where(eq(schema.sessions.id, id))
        .all();
      return rowToSession(inserted);
    }
  );

  // session:launch — pending 세션에 실제 PTY 를 붙인다.
  // XTerminal 이 마운트되어 실제 cols/rows 를 측정한 후 호출한다.
  ipcMain.handle(
    'session:launch',
    async (_event, args: { sessionId: string; cols: number; rows: number }) => {
      const { sessionId, cols, rows } = args;

      const [session] = drizzle
        .select()
        .from(schema.sessions)
        .where(eq(schema.sessions.id, sessionId))
        .all();
      if (!session) throw new Error(`Session ${sessionId} not found`);

      const [workspace] = drizzle
        .select()
        .from(schema.workspaces)
        .where(eq(schema.workspaces.id, session.workspaceId))
        .all();
      if (!workspace) throw new Error(`Workspace ${session.workspaceId} not found`);

      const [agent] = drizzle
        .select()
        .from(schema.agents)
        .where(eq(schema.agents.id, session.agentId))
        .all();
      if (!agent) throw new Error(`Agent ${session.agentId} not found`);

      // Gather repo env vars (JOIN 쿼리 — raw SQL 유지, drizzle join은 복잡도 증가)
      interface EnvVarRow { key: string; value: string; }
      const envVarRows = rawDb
        .prepare(
          `SELECT ev.key, ev.value FROM env_vars ev
           JOIN repositories r ON r.id = ev.repository_id
           JOIN workspaces w ON w.repository_id = r.id
           WHERE w.id = ?`
        )
        .all(session.workspaceId) as EnvVarRow[];

      const repoEnv: Record<string, string> = {};
      for (const row of envVarRows) {
        repoEnv[row.key] = row.value;
      }

      const agentArgs: string[] = JSON.parse(agent.args);
      const agentEnv: Record<string, string> = JSON.parse(agent.env);
      const mergedEnv = { ...repoEnv, ...agentEnv };

      // 실제 cols/rows 로 PTY 생성
      const ptyProcess = ptyManager.create(
        sessionId,
        agent.command,
        agentArgs,
        mergedEnv,
        workspace.worktreePath,
        cols,
        rows
      );

      // Stream output to renderer
      ptyManager.onOutput(sessionId, (sid, data) => {
        const win = getMainWindow();
        if (win && !win.isDestroyed()) {
          win.webContents.send('session-output', { sessionId: sid, data });
        }
      });

      // Handle PTY exit — clean up handlers to prevent memory leak
      ptyManager.onExit(sessionId, (sid, exitCode) => {
        ptyManager.removeOutput(sid);
        ptyManager.removeExit(sid);
        const status = exitCode === 0 ? 'stopped' : 'error';
        drizzle.update(schema.sessions)
          .set({ status, pid: null })
          .where(eq(schema.sessions.id, sid))
          .run();
        const win = getMainWindow();
        if (win && !win.isDestroyed()) {
          win.webContents.send('session-status', { sessionId: sid, status });
        }
      });

      drizzle.update(schema.sessions)
        .set({ status: 'running', pid: ptyProcess.pid ?? null })
        .where(eq(schema.sessions.id, sessionId))
        .run();

      // Mark last active (app_state — raw SQL 유지)
      rawDb
        .prepare(
          `INSERT INTO app_state (key, value) VALUES ('last_session_id', ?)
           ON CONFLICT(key) DO UPDATE SET value = excluded.value`
        )
        .run(JSON.stringify(sessionId));

      const [updated] = drizzle
        .select()
        .from(schema.sessions)
        .where(eq(schema.sessions.id, sessionId))
        .all();
      return rowToSession(updated);
    }
  );

  ipcMain.handle('session:stop', (_event, args: { sessionId: string }) => {
    const { sessionId } = args;
    if (ptyManager.isAlive(sessionId)) {
      ptyManager.kill(sessionId);
    }
    drizzle.update(schema.sessions)
      .set({ status: 'stopped', pid: null })
      .where(eq(schema.sessions.id, sessionId))
      .run();
  });

  ipcMain.handle('session:delete', (_event, args: { sessionId: string }) => {
    const { sessionId } = args;
    if (ptyManager.isAlive(sessionId)) {
      ptyManager.kill(sessionId);
    }
    drizzle.delete(schema.sessions).where(eq(schema.sessions.id, sessionId)).run();
  });

  ipcMain.handle('session:send-input', (_event, args: { sessionId: string; text: string }) => {
    ptyManager.write(args.sessionId, args.text);
  });

  ipcMain.handle(
    'session:resize',
    (_event, args: { sessionId: string; rows: number; cols: number }) => {
      ptyManager.resize(args.sessionId, args.cols, args.rows);
    }
  );

  ipcMain.handle(
    'session:update-status',
    (_event, args: { sessionId: string; status: string }) => {
      drizzle.update(schema.sessions)
        .set({ status: args.status })
        .where(eq(schema.sessions.id, args.sessionId))
        .run();
    }
  );

  ipcMain.handle('session:get-last', () => {
    // app_state — raw SQL 유지
    const row = rawDb
      .prepare(`SELECT value FROM app_state WHERE key = 'last_session_id'`)
      .get() as { value: string } | undefined;

    if (!row) return null;

    const lastId = JSON.parse(row.value) as string;
    const [session] = drizzle
      .select()
      .from(schema.sessions)
      .where(eq(schema.sessions.id, lastId))
      .all();

    return session ? rowToSession(session) : null;
  });

  ipcMain.handle('session:set-last-active', (_event, args: { sessionId: string }) => {
    // app_state — raw SQL 유지
    rawDb
      .prepare(
        `INSERT INTO app_state (key, value) VALUES ('last_session_id', ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`
      )
      .run(JSON.stringify(args.sessionId));
  });

  ipcMain.handle('session:resume', (_event, args: { sessionId: string }) => {
    const [session] = drizzle
      .select()
      .from(schema.sessions)
      .where(eq(schema.sessions.id, args.sessionId))
      .all();

    if (!session) throw new Error(`Session ${args.sessionId} not found`);

    // Re-attach output listener if PTY is still alive
    if (ptyManager.isAlive(args.sessionId)) {
      ptyManager.onOutput(args.sessionId, (sessionId, data) => {
        const win = getMainWindow();
        if (win && !win.isDestroyed()) {
          win.webContents.send('session-output', { sessionId, data });
        }
      });
    }

    // Mark last active (app_state — raw SQL 유지)
    rawDb
      .prepare(
        `INSERT INTO app_state (key, value) VALUES ('last_session_id', ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`
      )
      .run(JSON.stringify(args.sessionId));

    return rowToSession(session);
  });
}
