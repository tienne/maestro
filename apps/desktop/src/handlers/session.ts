import { ipcMain } from 'electron';
import { v4 as uuidv4 } from 'uuid';
import type { DatabaseManager } from '../db/database';
import type { PtyManager } from '../services/pty-manager';
import { getMainWindow } from '../main';

interface SessionRow {
  id: string;
  name: string;
  workspace_id: string;
  agent_id: string;
  status: string;
  pid: number | null;
  created_at: string;
}

interface WorkspaceRow {
  id: string;
  name: string;
  repository_id: string;
  branch: string;
  worktree_path: string;
}

interface AgentRow {
  id: string;
  name: string;
  command: string;
  args: string;
  env: string;
}

interface EnvVarRow {
  key: string;
  value: string;
}

function rowToSession(row: SessionRow) {
  return {
    id: row.id,
    name: row.name,
    workspaceId: row.workspace_id,
    agentId: row.agent_id,
    status: row.status as 'running' | 'stopped' | 'error',
    pid: row.pid,
    createdAt: row.created_at,
  };
}

export function registerSessionHandlers(db: DatabaseManager, ptyManager: PtyManager): void {
  const database = db.getDb();

  ipcMain.handle('session:list', (_event, args: { workspaceId: string }) => {
    return database
      .prepare('SELECT * FROM sessions WHERE workspace_id = ? ORDER BY created_at DESC')
      .all(args.workspaceId)
      .map((r) => rowToSession(r as SessionRow));
  });

  ipcMain.handle('session:list-all', () => {
    return database
      .prepare('SELECT * FROM sessions ORDER BY created_at DESC')
      .all()
      .map((r) => rowToSession(r as SessionRow));
  });

  // session:create — PTY 없이 pending 상태 세션 레코드 생성
  // XTerminal 마운트 후 실제 크기를 측정해서 session:launch로 PTY 를 시작한다.
  ipcMain.handle(
    'session:create',
    (_event, args: { name: string; workspaceId: string; agentId: string }) => {
      const { name, workspaceId, agentId } = args;

      const workspace = database
        .prepare('SELECT * FROM workspaces WHERE id = ?')
        .get(workspaceId) as WorkspaceRow | undefined;
      if (!workspace) throw new Error(`Workspace ${workspaceId} not found`);

      const agent = database
        .prepare('SELECT * FROM agents WHERE id = ?')
        .get(agentId) as AgentRow | undefined;
      if (!agent) throw new Error(`Agent ${agentId} not found`);

      const id = uuidv4();

      database
        .prepare(
          `INSERT INTO sessions (id, name, workspace_id, agent_id, status, pid)
           VALUES (?, ?, ?, ?, 'pending', NULL)`
        )
        .run(id, name, workspaceId, agentId);

      return rowToSession(
        database.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as SessionRow
      );
    }
  );

  // session:launch — pending 세션에 실제 PTY 를 붙인다.
  // XTerminal 이 마운트되어 실제 cols/rows 를 측정한 후 호출한다.
  ipcMain.handle(
    'session:launch',
    async (_event, args: { sessionId: string; cols: number; rows: number }) => {
      const { sessionId, cols, rows } = args;

      const session = database
        .prepare('SELECT * FROM sessions WHERE id = ?')
        .get(sessionId) as SessionRow | undefined;
      if (!session) throw new Error(`Session ${sessionId} not found`);

      const workspace = database
        .prepare('SELECT * FROM workspaces WHERE id = ?')
        .get(session.workspace_id) as WorkspaceRow | undefined;
      if (!workspace) throw new Error(`Workspace ${session.workspace_id} not found`);

      const agent = database
        .prepare('SELECT * FROM agents WHERE id = ?')
        .get(session.agent_id) as AgentRow | undefined;
      if (!agent) throw new Error(`Agent ${session.agent_id} not found`);

      // Gather repo env vars
      const envVarRows = database
        .prepare(
          `SELECT ev.key, ev.value FROM env_vars ev
           JOIN repositories r ON r.id = ev.repository_id
           JOIN workspaces w ON w.repository_id = r.id
           WHERE w.id = ?`
        )
        .all(session.workspace_id) as EnvVarRow[];

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
        workspace.worktree_path,
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
        database
          .prepare('UPDATE sessions SET status = ?, pid = NULL WHERE id = ?')
          .run(status, sid);
        const win = getMainWindow();
        if (win && !win.isDestroyed()) {
          win.webContents.send('session-status', { sessionId: sid, status });
        }
      });

      database
        .prepare('UPDATE sessions SET status = ?, pid = ? WHERE id = ?')
        .run('running', ptyProcess.pid, sessionId);

      // Mark last active
      database
        .prepare(
          `INSERT INTO app_state (key, value) VALUES ('last_session_id', ?)
           ON CONFLICT(key) DO UPDATE SET value = excluded.value`
        )
        .run(JSON.stringify(sessionId));

      return rowToSession(
        database.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId) as SessionRow
      );
    }
  );

  ipcMain.handle('session:stop', (_event, args: { sessionId: string }) => {
    const { sessionId } = args;
    if (ptyManager.isAlive(sessionId)) {
      ptyManager.kill(sessionId);
    }
    database
      .prepare('UPDATE sessions SET status = ?, pid = NULL WHERE id = ?')
      .run('stopped', sessionId);
  });

  ipcMain.handle('session:delete', (_event, args: { sessionId: string }) => {
    const { sessionId } = args;
    if (ptyManager.isAlive(sessionId)) {
      ptyManager.kill(sessionId);
    }
    database.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);
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
      database
        .prepare('UPDATE sessions SET status = ? WHERE id = ?')
        .run(args.status, args.sessionId);
    }
  );

  ipcMain.handle('session:get-last', () => {
    const row = database
      .prepare(`SELECT value FROM app_state WHERE key = 'last_session_id'`)
      .get() as { value: string } | undefined;

    if (!row) return null;

    const lastId = JSON.parse(row.value) as string;
    const session = database
      .prepare('SELECT * FROM sessions WHERE id = ?')
      .get(lastId) as SessionRow | undefined;

    return session ? rowToSession(session) : null;
  });

  ipcMain.handle('session:set-last-active', (_event, args: { sessionId: string }) => {
    database
      .prepare(
        `INSERT INTO app_state (key, value) VALUES ('last_session_id', ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`
      )
      .run(JSON.stringify(args.sessionId));
  });

  ipcMain.handle('session:resume', (_event, args: { sessionId: string }) => {
    const session = database
      .prepare('SELECT * FROM sessions WHERE id = ?')
      .get(args.sessionId) as SessionRow | undefined;

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

    // Mark last active
    database
      .prepare(
        `INSERT INTO app_state (key, value) VALUES ('last_session_id', ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`
      )
      .run(JSON.stringify(args.sessionId));

    return rowToSession(session);
  });
}
