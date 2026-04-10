/**
 * tRPC Router — Electron Main Process
 *
 * 기존 ipcMain.handle 핸들러들을 tRPC procedure로 포팅한 구현체.
 * packages/shared-types/src/trpc.ts 의 타입 정의와 1:1 대응.
 */

import { initTRPC } from '@trpc/server';
import { observable } from '@trpc/server/observable';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import * as path from 'path';
import * as net from 'net';
import { exec as execCb, execSync } from 'child_process';
import { promisify } from 'util';
import { dialog, shell, BrowserWindow } from 'electron';
import { getDatabaseManager } from '../db/database';
import { getGitService } from '../services/git';
import { getGitWatcher } from '../services/git-watcher';
import { getPtyManager } from '../services/pty-manager';
import { getListeningPorts } from '../services/port-scanner';
import { getMainWindow } from '../main';
import { getServerPort, getAuthToken } from '../services/http-server';
import { createWrapper } from '../services/wrappers';
import type { WrapperHookConfig } from '../services/agent-wrapper';
import type { Workspace, Agent, Repository, EnvVar, AppState } from '@maestro/shared-types';
import { simpleGit } from 'simple-git';

const execAsync = promisify(execCb);

// ── tRPC instance ─────────────────────────────────────────────────────────────

const t = initTRPC.create();
export const router = t.router;
export const publicProcedure = t.procedure;

// ── Row mappers ───────────────────────────────────────────────────────────────

function rowToWorkspace(row: Record<string, unknown>): Workspace {
  return {
    id: row.id as string,
    name: row.name as string,
    repositoryId: row.repository_id as string,
    branch: row.branch as string,
    worktreePath: row.worktree_path as string,
    createdAt: row.created_at as string,
  };
}

interface SessionRow {
  id: string;
  name: string;
  workspace_id: string;
  agent_id: string;
  status: string;
  pid: number | null;
  created_at: string;
}

function rowToSession(row: SessionRow) {
  return {
    id: row.id,
    name: row.name,
    workspaceId: row.workspace_id,
    agentId: row.agent_id,
    status: row.status as 'running' | 'stopped' | 'error' | 'pending',
    pid: row.pid,
    createdAt: row.created_at,
  };
}

function rowToAgent(row: Record<string, unknown>): Agent {
  return {
    id: row.id as string,
    name: row.name as string,
    command: row.command as string,
    args: JSON.parse(row.args as string) as string[],
    env: JSON.parse(row.env as string) as Record<string, string>,
    isBuiltIn: Boolean(row.is_built_in),
  };
}

function rowToRepo(row: Record<string, unknown>): Repository {
  return {
    id: row.id as string,
    name: row.name as string,
    path: row.path as string,
    color: row.color as string,
    branchPrefix: row.branch_prefix as string,
    baseBranch: row.base_branch as string,
    worktreeBasePath: row.worktree_base_path as string,
    setupScript: row.setup_script as string,
    teardownScript: row.teardown_script as string,
    createdAt: row.created_at as string,
  };
}

function rowToEnvVar(row: Record<string, unknown>): EnvVar {
  return {
    id: row.id as string,
    repositoryId: row.repository_id as string,
    key: row.key as string,
    value: row.value as string,
  };
}

interface McpServerRow {
  id: string;
  name: string;
  url: string;
  enabled: number;
  status: string;
  error_msg: string | null;
  created_at: string;
}

function rowToMcpServer(row: McpServerRow) {
  return {
    id: row.id,
    name: row.name,
    url: row.url,
    enabled: Boolean(row.enabled),
    status: row.status as 'connected' | 'offline' | 'error',
    errorMsg: row.error_msg,
    createdAt: row.created_at,
  };
}

function checkSocketConnection(host: string, port: number, timeout = 3000): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(timeout);
    socket.on('connect', () => { socket.destroy(); resolve(true); });
    socket.on('error', () => { socket.destroy(); resolve(false); });
    socket.on('timeout', () => { socket.destroy(); resolve(false); });
    socket.connect(port, host);
  });
}

// ── workspaceRouter ───────────────────────────────────────────────────────────

export const workspaceRouter = router({
  list: publicProcedure.query(() => {
    const db = getDatabaseManager().getDb();
    return db
      .prepare('SELECT * FROM workspaces ORDER BY created_at')
      .all()
      .map((r) => rowToWorkspace(r as Record<string, unknown>));
  }),

  create: publicProcedure
    .input(z.object({ name: z.string().min(1), repositoryId: z.string() }))
    .mutation(async ({ input }) => {
      const db = getDatabaseManager().getDb();
      const git = getGitService();
      const { name, repositoryId } = input;

      const repo = db
        .prepare('SELECT * FROM repositories WHERE id = ?')
        .get(repositoryId) as Record<string, unknown>;
      if (!repo) throw new Error(`Repository ${repositoryId} not found`);

      const repoPath = repo.path as string;
      const branchPrefix = (repo.branch_prefix as string) || '';
      const worktreeBase =
        (repo.worktree_base_path as string) || path.join(repoPath, '..', 'worktrees');
      const branch = `${branchPrefix}${name.toLowerCase().replace(/\s+/g, '-')}`;
      const worktreePath = path.join(worktreeBase, name);
      const id = uuidv4();

      // worktree 생성 (브랜치 존재 여부 자동 감지, 실패 시 내부 cleanup 포함)
      await git.addWorktree(repoPath, worktreePath, branch);

      // setup_script 실행 — worktreePath 기준 async
      const setupScript = repo.setup_script as string;
      if (setupScript?.trim()) {
        try {
          await execAsync(setupScript, { cwd: worktreePath });
        } catch (err) {
          // setup 실패 시 worktree 정리 후 에러 전파
          await git.removeWorktree(repoPath, worktreePath);
          throw new Error(`Setup script failed: ${String(err)}`);
        }
      }

      // DB INSERT
      db.prepare(
        `INSERT INTO workspaces (id, name, repository_id, branch, worktree_path) VALUES (?, ?, ?, ?, ?)`
      ).run(id, name, repositoryId, branch, worktreePath);

      // INSERT 성공 여부 검증 — 실패 시 worktree 롤백
      const inserted = db
        .prepare('SELECT * FROM workspaces WHERE id = ?')
        .get(id) as Record<string, unknown> | undefined;

      if (!inserted) {
        await git.removeWorktree(repoPath, worktreePath);
        throw new Error('Failed to insert workspace record');
      }

      return rowToWorkspace(inserted);
    }),

  delete: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input }) => {
      const db = getDatabaseManager().getDb();
      const git = getGitService();
      const ptyManager = getPtyManager();

      const workspace = db
        .prepare('SELECT * FROM workspaces WHERE id = ?')
        .get(input.id) as Record<string, unknown> | undefined;
      if (!workspace) throw new Error(`Workspace ${input.id} not found`);

      const repo = db
        .prepare('SELECT * FROM repositories WHERE id = ?')
        .get(workspace.repository_id) as Record<string, unknown> | undefined;

      // 1. 활성 세션 PTY 강제 종료
      const sessions = db
        .prepare('SELECT * FROM sessions WHERE workspace_id = ?')
        .all(input.id) as SessionRow[];
      for (const session of sessions) {
        try {
          if (ptyManager.isAlive(session.id)) {
            ptyManager.kill(session.id);
          }
        } catch (err) {
          console.warn(`Failed to kill PTY for session ${session.id}:`, err);
        }
      }

      // 2. teardown_script 실행 (있으면)
      const teardownScript = repo?.teardown_script as string | undefined;
      if (teardownScript?.trim()) {
        try {
          execSync(teardownScript, { cwd: workspace.worktree_path as string, stdio: 'ignore' });
        } catch (err) {
          console.warn('teardown_script failed (ignored):', err);
        }
      }

      // 3. git worktree remove (async, prune 포함)
      if (repo?.path) {
        try {
          await git.removeWorktree(repo.path as string, workspace.worktree_path as string);
        } catch (err) {
          console.warn('removeWorktree failed (ignored):', err);
        }
      }

      // 4. DB 레코드 삭제 (sessions는 CASCADE로 같이 삭제)
      db.prepare('DELETE FROM workspaces WHERE id = ?').run(input.id);
    }),

  openInIde: publicProcedure
    .input(z.object({
      workspaceId: z.string(),
      ide: z.enum(['vscode', 'cursor', 'webstorm', 'zed']),
    }))
    .mutation(async ({ input }): Promise<{ success: boolean; message: string }> => {
      const db = getDatabaseManager().getDb();
      const workspace = db
        .prepare('SELECT * FROM workspaces WHERE id = ?')
        .get(input.workspaceId) as Record<string, unknown> | undefined;

      if (!workspace) {
        throw new Error(`Workspace ${input.workspaceId} not found`);
      }

      const worktreePath = workspace.worktree_path as string;
      const isMac = process.platform === 'darwin';
      const isWin = process.platform === 'win32';

      // IDE별 실행 커맨드 맵
      const ideCommands: Record<string, { mac: string; win: string; linux: string }> = {
        vscode: {
          mac: `open -a "Visual Studio Code" "${worktreePath}"`,
          win: `code "${worktreePath}"`,
          linux: `code "${worktreePath}"`,
        },
        cursor: {
          mac: `open -a "Cursor" "${worktreePath}"`,
          win: `cursor "${worktreePath}"`,
          linux: `cursor "${worktreePath}"`,
        },
        webstorm: {
          mac: `open -a "WebStorm" "${worktreePath}"`,
          win: `webstorm "${worktreePath}"`,
          linux: `webstorm "${worktreePath}"`,
        },
        zed: {
          mac: `open -a "Zed" "${worktreePath}"`,
          win: `zed "${worktreePath}"`,
          linux: `zed "${worktreePath}"`,
        },
      };

      const commands = ideCommands[input.ide];
      const command = isMac ? commands.mac : isWin ? commands.win : commands.linux;

      try {
        await execAsync(command);
        return { success: true, message: `Opened in ${input.ide}` };
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        throw new Error(`Failed to open ${input.ide}: ${errMsg}`);
      }
    }),
});

// ── sessionRouter ─────────────────────────────────────────────────────────────

export const sessionRouter = router({
  list: publicProcedure
    .input(z.object({ workspaceId: z.string() }))
    .query(({ input }) => {
      const db = getDatabaseManager().getDb();
      return db
        .prepare('SELECT * FROM sessions WHERE workspace_id = ? ORDER BY created_at DESC')
        .all(input.workspaceId)
        .map((r) => rowToSession(r as SessionRow));
    }),

  listAll: publicProcedure.query(() => {
    const db = getDatabaseManager().getDb();
    return db
      .prepare('SELECT * FROM sessions ORDER BY created_at DESC')
      .all()
      .map((r) => rowToSession(r as SessionRow));
  }),

  create: publicProcedure
    .input(
      z.object({
        name: z.string().min(1),
        workspaceId: z.string(),
        agentId: z.string(),
      })
    )
    .mutation(({ input }) => {
      const db = getDatabaseManager().getDb();
      const { name, workspaceId, agentId } = input;

      const workspace = db
        .prepare('SELECT * FROM workspaces WHERE id = ?')
        .get(workspaceId) as Record<string, unknown> | undefined;
      if (!workspace) throw new Error(`Workspace ${workspaceId} not found`);

      const agent = db
        .prepare('SELECT * FROM agents WHERE id = ?')
        .get(agentId) as Record<string, unknown> | undefined;
      if (!agent) throw new Error(`Agent ${agentId} not found`);

      const id = uuidv4();
      db.prepare(
        `INSERT INTO sessions (id, name, workspace_id, agent_id, status, pid)
         VALUES (?, ?, ?, ?, 'pending', NULL)`
      ).run(id, name, workspaceId, agentId);

      return rowToSession(
        db.prepare('SELECT * FROM sessions WHERE id = ?').get(id) as SessionRow
      );
    }),

  launch: publicProcedure
    .input(
      z.object({
        sessionId: z.string(),
        cols: z.number().int().positive(),
        rows: z.number().int().positive(),
      })
    )
    .mutation(async ({ input }) => {
      const db = getDatabaseManager().getDb();
      const ptyManager = getPtyManager();
      const { sessionId, cols, rows } = input;

      const session = db
        .prepare('SELECT * FROM sessions WHERE id = ?')
        .get(sessionId) as SessionRow | undefined;
      if (!session) throw new Error(`Session ${sessionId} not found`);

      // 이미 launch된 세션에 중복 요청이 오면 무시 (Strict Mode 이중 호출 방어)
      if (session.status !== 'pending') {
        return rowToSession(session);
      }

      const workspace = db
        .prepare('SELECT * FROM workspaces WHERE id = ?')
        .get(session.workspace_id) as Record<string, unknown> | undefined;
      if (!workspace) throw new Error(`Workspace ${session.workspace_id} not found`);

      const agent = db
        .prepare('SELECT * FROM agents WHERE id = ?')
        .get(session.agent_id) as Record<string, unknown> | undefined;
      if (!agent) throw new Error(`Agent ${session.agent_id} not found`);

      interface EnvVarRow { key: string; value: string; }
      const envVarRows = db
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

      const agentArgs: string[] = JSON.parse(agent.args as string);
      const agentEnv: Record<string, string> = JSON.parse(agent.env as string);
      const mergedEnv = { ...repoEnv, ...agentEnv };

      // 에이전트 타입을 agent.name 기준으로 결정 (built-in 에이전트의 경우)
      const agentName = (agent.name as string).toLowerCase();
      const agentType = agentName.includes('claude')
        ? 'claude-code'
        : agentName.includes('gemini')
          ? 'gemini'
          : agentName.includes('codex')
            ? 'codex'
            : agentName.includes('opencode')
              ? 'opencode'
              : null;

      const port = getServerPort();
      let wrapperInjected = false;

      if (agentType && port > 0) {
        try {
          const wrapperConfig: WrapperHookConfig = {
            eventEndpoint: `http://127.0.0.1:${port}/api/events`,
            port,
            authToken: getAuthToken(),
            sessionId,
            agentType,
          };
          const wrapper = createWrapper(agentType, wrapperConfig);
          await wrapper.injectHook();
          wrapperInjected = true;
        } catch (err) {
          // 훅 주입 실패는 세션 시작을 막지 않음 (non-fatal)
          console.error('[Router] Failed to inject wrapper hook:', err);
        }
      }

      const ptyProcess = ptyManager.create(
        sessionId,
        agent.command as string,
        agentArgs,
        mergedEnv,
        workspace.worktree_path as string,
        cols,
        rows
      );

      ptyManager.onOutput(sessionId, (sid, data) => {
        const win = getMainWindow();
        if (win && !win.isDestroyed()) {
          win.webContents.send('session-output', { sessionId: sid, data });
        }
      });

      ptyManager.onExit(sessionId, (sid, exitCode) => {
        ptyManager.removeOutput(sid);
        ptyManager.removeExit(sid);
        const status = exitCode === 0 ? 'stopped' : 'error';
        db.prepare('UPDATE sessions SET status = ?, pid = NULL WHERE id = ?').run(status, sid);

        // 스크롤백 버퍼 DB 저장 (세션 재개 시 복원)
        const scrollback = ptyManager.getScrollback(sid);
        if (scrollback) {
          db.prepare(`
            INSERT INTO session_scrollbacks (session_id, data, updated_at)
            VALUES (?, ?, datetime('now'))
            ON CONFLICT(session_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at
          `).run(sid, scrollback);
        }

        const win = getMainWindow();
        if (win && !win.isDestroyed()) {
          win.webContents.send('session-status', { sessionId: sid, status });
        }

        // PTY 종료 시 wrapper 훅 제거
        if (wrapperInjected && agentType && port > 0) {
          const wrapperConfig: WrapperHookConfig = {
            eventEndpoint: `http://127.0.0.1:${port}/api/events`,
            port,
            authToken: getAuthToken(),
            sessionId: sid,
            agentType,
          };
          createWrapper(agentType, wrapperConfig)
            .removeHook()
            .catch((err: unknown) => {
              console.error('[Router] Failed to remove wrapper hook on exit:', err);
            });
        }
      });

      db.prepare('UPDATE sessions SET status = ?, pid = ? WHERE id = ?').run(
        'running',
        ptyProcess.pid,
        sessionId
      );

      db.prepare(
        `INSERT INTO app_state (key, value) VALUES ('last_session_id', ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`
      ).run(JSON.stringify(sessionId));

      return rowToSession(
        db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId) as SessionRow
      );
    }),

  stop: publicProcedure
    .input(z.object({ sessionId: z.string() }))
    .mutation(async ({ input }) => {
      const db = getDatabaseManager().getDb();
      const ptyManager = getPtyManager();
      const { sessionId } = input;

      // 세션에 연결된 에이전트 정보 조회 (wrapper 훅 제거용)
      const session = db
        .prepare('SELECT * FROM sessions WHERE id = ?')
        .get(sessionId) as SessionRow | undefined;

      if (ptyManager.isAlive(sessionId)) {
        ptyManager.kill(sessionId);
      }
      db.prepare('UPDATE sessions SET status = ?, pid = NULL WHERE id = ?').run(
        'stopped',
        sessionId
      );

      // wrapper 훅 제거 (세션 정보가 있을 때만)
      if (session) {
        const agent = db
          .prepare('SELECT * FROM agents WHERE id = ?')
          .get(session.agent_id) as Record<string, unknown> | undefined;

        if (agent) {
          const agentName = (agent.name as string).toLowerCase();
          const agentType = agentName.includes('claude')
            ? 'claude-code'
            : agentName.includes('gemini')
              ? 'gemini'
              : agentName.includes('codex')
                ? 'codex'
                : agentName.includes('opencode')
                  ? 'opencode'
                  : null;

          const port = getServerPort();
          if (agentType && port > 0) {
            try {
              const wrapperConfig: WrapperHookConfig = {
                eventEndpoint: `http://127.0.0.1:${port}/api/events`,
                port,
                authToken: getAuthToken(),
                sessionId,
                agentType,
              };
              await createWrapper(agentType, wrapperConfig).removeHook();
            } catch (err) {
              console.error('[Router] Failed to remove wrapper hook on stop:', err);
            }
          }
        }
      }
    }),

  delete: publicProcedure
    .input(z.object({ sessionId: z.string() }))
    .mutation(({ input }) => {
      const db = getDatabaseManager().getDb();
      const ptyManager = getPtyManager();
      const { sessionId } = input;
      if (ptyManager.isAlive(sessionId)) {
        ptyManager.kill(sessionId);
      }
      db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);
    }),

  sendInput: publicProcedure
    .input(z.object({ sessionId: z.string(), text: z.string() }))
    .mutation(({ input }) => {
      getPtyManager().write(input.sessionId, input.text);
    }),

  resize: publicProcedure
    .input(
      z.object({
        sessionId: z.string(),
        cols: z.number().int().positive(),
        rows: z.number().int().positive(),
      })
    )
    .mutation(({ input }) => {
      getPtyManager().resize(input.sessionId, input.cols, input.rows);
    }),

  getLast: publicProcedure.query(() => {
    const db = getDatabaseManager().getDb();
    const row = db
      .prepare(`SELECT value FROM app_state WHERE key = 'last_session_id'`)
      .get() as { value: string } | undefined;

    if (!row) return null;

    const lastId = JSON.parse(row.value) as string;
    const session = db
      .prepare('SELECT * FROM sessions WHERE id = ?')
      .get(lastId) as SessionRow | undefined;

    return session ? rowToSession(session) : null;
  }),

  setLastActive: publicProcedure
    .input(z.object({ sessionId: z.string() }))
    .mutation(({ input }) => {
      const db = getDatabaseManager().getDb();
      db.prepare(
        `INSERT INTO app_state (key, value) VALUES ('last_session_id', ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`
      ).run(JSON.stringify(input.sessionId));
    }),

  resume: publicProcedure
    .input(z.object({ sessionId: z.string() }))
    .mutation(({ input }) => {
      const db = getDatabaseManager().getDb();
      const ptyManager = getPtyManager();
      const { sessionId } = input;

      const session = db
        .prepare('SELECT * FROM sessions WHERE id = ?')
        .get(sessionId) as SessionRow | undefined;
      if (!session) throw new Error(`Session ${sessionId} not found`);

      if (ptyManager.isAlive(sessionId)) {
        ptyManager.onOutput(sessionId, (sid, data) => {
          const win = getMainWindow();
          if (win && !win.isDestroyed()) {
            win.webContents.send('session-output', { sessionId: sid, data });
          }
        });
      }

      db.prepare(
        `INSERT INTO app_state (key, value) VALUES ('last_session_id', ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`
      ).run(JSON.stringify(sessionId));

      return rowToSession(session);
    }),

  updateStatus: publicProcedure
    .input(z.object({ sessionId: z.string(), status: z.string() }))
    .mutation(({ input }) => {
      const db = getDatabaseManager().getDb();
      db.prepare('UPDATE sessions SET status = ? WHERE id = ?').run(
        input.status,
        input.sessionId
      );
    }),

  getPorts: publicProcedure
    .input(z.object({ sessionId: z.string() }))
    .query(async ({ input }) => {
      const db = getDatabaseManager().getDb();
      const session = db
        .prepare('SELECT * FROM sessions WHERE id = ?')
        .get(input.sessionId) as SessionRow | undefined;

      if (!session || !session.pid || session.status !== 'running') {
        return [];
      }

      return getListeningPorts(session.pid);
    }),

  openPort: publicProcedure
    .input(z.object({ port: z.number().int().min(1).max(65535) }))
    .mutation(async ({ input }) => {
      await shell.openExternal(`http://localhost:${input.port}`);
    }),

  getScrollback: publicProcedure
    .input(z.object({ sessionId: z.string() }))
    .query(({ input }) => {
      const db = getDatabaseManager().getDb();
      // 먼저 메모리 버퍼에서 확인 (현재 세션이 실행 중이면 최신 버퍼 반환)
      const live = getPtyManager().getScrollback(input.sessionId);
      if (live) return live;

      // 메모리에 없으면 DB에서 조회 (이전에 종료된 세션)
      const row = db
        .prepare('SELECT data FROM session_scrollbacks WHERE session_id = ?')
        .get(input.sessionId) as { data: string } | undefined;
      return row?.data ?? '';
    }),

  broadcast: publicProcedure
    .input(z.object({
      sessionIds: z.array(z.string()).min(1),
      text: z.string().min(1),
    }))
    .mutation(({ input }) => {
      const ptyManager = getPtyManager();
      const errors: string[] = [];
      for (const sid of input.sessionIds) {
        try {
          ptyManager.write(sid, input.text + '\r');
        } catch (err) {
          errors.push(`${sid}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      if (errors.length > 0) {
        throw new Error(`Broadcast partial failure: ${errors.join(', ')}`);
      }
    }),

  savePrompt: publicProcedure
    .input(z.object({ sessionId: z.string(), text: z.string().min(1) }))
    .mutation(({ input }) => {
      const db = getDatabaseManager().getDb();
      const id = uuidv4();
      db.prepare(
        `INSERT INTO prompt_history (id, session_id, text) VALUES (?, ?, ?)`
      ).run(id, input.sessionId, input.text);
    }),

  getPromptHistory: publicProcedure
    .input(z.object({ sessionId: z.string(), limit: z.number().int().positive().max(100).default(50) }))
    .query(({ input }) => {
      const db = getDatabaseManager().getDb();
      return (db
        .prepare(
          `SELECT id, text, created_at FROM prompt_history
           WHERE session_id = ? ORDER BY created_at DESC LIMIT ?`
        )
        .all(input.sessionId, input.limit) as Array<{ id: string; text: string; created_at: string }>)
        .reverse(); // 오래된 것이 앞에 오도록
    }),
});

// ── agentRouter ───────────────────────────────────────────────────────────────

export const agentRouter = router({
  list: publicProcedure.query(() => {
    const db = getDatabaseManager().getDb();
    return db
      .prepare('SELECT * FROM agents ORDER BY is_built_in DESC, name')
      .all()
      .map((r) => rowToAgent(r as Record<string, unknown>));
  }),

  create: publicProcedure
    .input(
      z.object({
        name: z.string().min(1),
        command: z.string().min(1),
        args: z.array(z.string()),
        env: z.record(z.string(), z.string()),
      })
    )
    .mutation(({ input }) => {
      const db = getDatabaseManager().getDb();
      const id = uuidv4();
      db.prepare(
        `INSERT INTO agents (id, name, command, args, env, is_built_in) VALUES (?, ?, ?, ?, ?, 0)`
      ).run(
        id,
        input.name,
        input.command,
        JSON.stringify(input.args),
        JSON.stringify(input.env)
      );
      return rowToAgent(
        db.prepare('SELECT * FROM agents WHERE id = ?').get(id) as Record<string, unknown>
      );
    }),

  update: publicProcedure
    .input(
      z.object({
        id: z.string(),
        name: z.string().min(1),
        command: z.string().min(1),
        args: z.array(z.string()),
        env: z.record(z.string(), z.string()),
      })
    )
    .mutation(({ input }) => {
      const db = getDatabaseManager().getDb();
      const agent = db
        .prepare('SELECT is_built_in FROM agents WHERE id = ?')
        .get(input.id) as { is_built_in: number } | undefined;

      if (!agent) throw new Error(`Agent ${input.id} not found`);
      if (agent.is_built_in) throw new Error('Cannot modify built-in agents');

      db.prepare(
        `UPDATE agents SET name = ?, command = ?, args = ?, env = ? WHERE id = ?`
      ).run(
        input.name,
        input.command,
        JSON.stringify(input.args),
        JSON.stringify(input.env),
        input.id
      );

      return rowToAgent(
        db.prepare('SELECT * FROM agents WHERE id = ?').get(input.id) as Record<string, unknown>
      );
    }),

  delete: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(({ input }) => {
      const db = getDatabaseManager().getDb();
      const agent = db
        .prepare('SELECT is_built_in FROM agents WHERE id = ?')
        .get(input.id) as { is_built_in: number } | undefined;

      if (!agent) throw new Error(`Agent ${input.id} not found`);
      if (agent.is_built_in) throw new Error('Cannot delete built-in agents');

      db.prepare('DELETE FROM agents WHERE id = ?').run(input.id);
    }),
});

// ── repositoryRouter ──────────────────────────────────────────────────────────

export const repositoryRouter = router({
  list: publicProcedure.query(() => {
    const db = getDatabaseManager().getDb();
    return db
      .prepare('SELECT * FROM repositories ORDER BY created_at')
      .all()
      .map((r) => rowToRepo(r as Record<string, unknown>));
  }),

  add: publicProcedure
    .input(z.object({ path: z.string().min(1) }))
    .mutation(({ input }) => {
      const db = getDatabaseManager().getDb();
      const git = getGitService();
      const { path: repoPath } = input;

      if (!git.isGitRepo(repoPath)) throw new Error(`Not a git repository: ${repoPath}`);

      const name = repoPath.split('/').pop() ?? repoPath;
      const branch = git.getCurrentBranch(repoPath);
      const id = uuidv4();

      db.prepare(
        `INSERT INTO repositories (id, name, path, base_branch) VALUES (?, ?, ?, ?)`
      ).run(id, name, repoPath, branch);

      return rowToRepo(
        db.prepare('SELECT * FROM repositories WHERE id = ?').get(id) as Record<string, unknown>
      );
    }),

  clone: publicProcedure
    .input(z.object({ url: z.string().url(), targetPath: z.string().min(1) }))
    .mutation(async ({ input }) => {
      const db = getDatabaseManager().getDb();
      const git = getGitService();
      const { url, targetPath } = input;

      await git.cloneRepo(url, targetPath);

      const name = url.split('/').pop()?.replace('.git', '') ?? 'repo';
      const id = uuidv4();

      db.prepare(`INSERT INTO repositories (id, name, path) VALUES (?, ?, ?)`).run(
        id,
        name,
        targetPath
      );

      return rowToRepo(
        db.prepare('SELECT * FROM repositories WHERE id = ?').get(id) as Record<string, unknown>
      );
    }),

  update: publicProcedure
    .input(
      z.object({
        id: z.string(),
        settings: z.object({
          name: z.string().optional(),
          color: z.string().optional(),
          branchPrefix: z.string().optional(),
          baseBranch: z.string().optional(),
          worktreeBasePath: z.string().optional(),
          setupScript: z.string().optional(),
          teardownScript: z.string().optional(),
        }),
      })
    )
    .mutation(({ input }) => {
      const db = getDatabaseManager().getDb();
      const { id, settings } = input;
      const fields: string[] = [];
      const values: unknown[] = [];

      if (settings.name !== undefined) { fields.push('name = ?'); values.push(settings.name); }
      if (settings.color !== undefined) { fields.push('color = ?'); values.push(settings.color); }
      if (settings.branchPrefix !== undefined) { fields.push('branch_prefix = ?'); values.push(settings.branchPrefix); }
      if (settings.baseBranch !== undefined) { fields.push('base_branch = ?'); values.push(settings.baseBranch); }
      if (settings.worktreeBasePath !== undefined) { fields.push('worktree_base_path = ?'); values.push(settings.worktreeBasePath); }
      if (settings.setupScript !== undefined) { fields.push('setup_script = ?'); values.push(settings.setupScript); }
      if (settings.teardownScript !== undefined) { fields.push('teardown_script = ?'); values.push(settings.teardownScript); }

      if (fields.length > 0) {
        db.prepare(`UPDATE repositories SET ${fields.join(', ')} WHERE id = ?`).run(...values, id);
      }

      return rowToRepo(
        db.prepare('SELECT * FROM repositories WHERE id = ?').get(id) as Record<string, unknown>
      );
    }),

  delete: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(({ input }) => {
      const db = getDatabaseManager().getDb();
      db.prepare('DELETE FROM repositories WHERE id = ?').run(input.id);
    }),

  envVar: router({
    list: publicProcedure
      .input(z.object({ repositoryId: z.string() }))
      .query(({ input }) => {
        const db = getDatabaseManager().getDb();
        return db
          .prepare('SELECT * FROM env_vars WHERE repository_id = ?')
          .all(input.repositoryId)
          .map((r) => rowToEnvVar(r as Record<string, unknown>));
      }),

    upsert: publicProcedure
      .input(
        z.object({
          repositoryId: z.string(),
          key: z.string().min(1),
          value: z.string(),
        })
      )
      .mutation(({ input }) => {
        const db = getDatabaseManager().getDb();
        const { repositoryId, key, value } = input;
        const existing = db
          .prepare('SELECT id FROM env_vars WHERE repository_id = ? AND key = ?')
          .get(repositoryId, key) as { id: string } | undefined;

        const id = existing?.id ?? uuidv4();
        db.prepare(
          `INSERT INTO env_vars (id, repository_id, key, value)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(repository_id, key) DO UPDATE SET value = excluded.value`
        ).run(id, repositoryId, key, value);

        return rowToEnvVar(
          db.prepare('SELECT * FROM env_vars WHERE id = ?').get(id) as Record<string, unknown>
        );
      }),

    delete: publicProcedure
      .input(z.object({ id: z.string() }))
      .mutation(({ input }) => {
        const db = getDatabaseManager().getDb();
        db.prepare('DELETE FROM env_vars WHERE id = ?').run(input.id);
      }),
  }),
});

// ── Git diff parser ───────────────────────────────────────────────────────────

function parseUnifiedDiff(raw: string): Array<{ header: string; lines: Array<{ type: 'added' | 'removed' | 'context'; content: string }> }> {
  const hunks: Array<{ header: string; lines: Array<{ type: 'added' | 'removed' | 'context'; content: string }> }> = [];
  let current: (typeof hunks)[0] | null = null;

  for (const line of raw.split('\n')) {
    if (line.startsWith('@@ ')) {
      if (current) hunks.push(current);
      current = { header: line, lines: [] };
    } else if (current) {
      if (line.startsWith('+') && !line.startsWith('+++')) {
        current.lines.push({ type: 'added', content: line.slice(1) });
      } else if (line.startsWith('-') && !line.startsWith('---')) {
        current.lines.push({ type: 'removed', content: line.slice(1) });
      } else if (line.startsWith(' ')) {
        current.lines.push({ type: 'context', content: line.slice(1) });
      }
    }
  }
  if (current) hunks.push(current);
  return hunks;
}

// ── gitRouter ─────────────────────────────────────────────────────────────────

export const gitRouter = router({
  // 실시간 Git 상태 구독 (chokidar 기반)
  watchStatus: publicProcedure
    .input(z.object({ repoPath: z.string().min(1) }))
    .subscription(({ input }) => {
      return observable<Awaited<ReturnType<typeof getGitWatcher['prototype']['getStatus']>>>((emit) => {
        const unwatch = getGitWatcher().watch(input.repoPath, (status) => {
          emit.next(status);
        });
        return () => unwatch();
      });
    }),

  // 단일 파일 stage
  stage: publicProcedure
    .input(z.object({ repoPath: z.string().min(1), filePath: z.string().min(1) }))
    .mutation(async ({ input }) => {
      const git = simpleGit(input.repoPath);
      await git.add(input.filePath);
    }),

  // 단일 파일 unstage
  unstage: publicProcedure
    .input(z.object({ repoPath: z.string().min(1), filePath: z.string().min(1) }))
    .mutation(async ({ input }) => {
      const git = simpleGit(input.repoPath);
      await git.reset(['HEAD', '--', input.filePath]);
    }),

  // 전체 stage
  stageAll: publicProcedure
    .input(z.object({ repoPath: z.string().min(1) }))
    .mutation(async ({ input }) => {
      const git = simpleGit(input.repoPath);
      await git.add('-A');
    }),

  // 전체 unstage
  unstageAll: publicProcedure
    .input(z.object({ repoPath: z.string().min(1) }))
    .mutation(async ({ input }) => {
      const git = simpleGit(input.repoPath);
      await git.reset(['HEAD']);
    }),

  // 현재 상태 스냅샷 조회 (단순 쿼리, 구독 없이)
  status: publicProcedure
    .input(z.object({ repoPath: z.string().min(1) }))
    .query(async ({ input }) => {
      return getGitWatcher().getStatus(input.repoPath);
    }),

  // ─── 기존 호환 유지 ───────────────────────────────────────────────────────

  diff: publicProcedure
    .input(
      z.object({
        workspacePath: z.string().min(1),
        filePath: z.string().min(1),
        staged: z.boolean(),
      })
    )
    .query(({ input }) => {
      return getGitService().diff(input.workspacePath, input.filePath, input.staged);
    }),

  getDiff: publicProcedure
    .input(z.object({ workspacePath: z.string().min(1) }))
    .query(({ input }) => {
      return getGitService().getStructuredDiff(input.workspacePath);
    }),

  commit: publicProcedure
    .input(z.object({ repoPath: z.string().min(1), message: z.string().min(1) }))
    .mutation(async ({ input }) => {
      const git = simpleGit(input.repoPath);
      const result = await git.commit(input.message);
      return { hash: result.commit, summary: result.summary };
    }),

  // push to remote
  push: publicProcedure
    .input(z.object({
      repoPath: z.string().min(1),
      remote: z.string().default('origin'),
      branch: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const git = simpleGit(input.repoPath);
      const pushResult = await git.push(input.remote, input.branch);
      return { pushed: pushResult.pushed };
    }),

  // pull from remote
  pull: publicProcedure
    .input(z.object({
      repoPath: z.string().min(1),
      remote: z.string().default('origin'),
      branch: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const git = simpleGit(input.repoPath);
      const pullResult = await git.pull(input.remote, input.branch);
      return { summary: pullResult.summary };
    }),

  // branch list
  branches: publicProcedure
    .input(z.object({ repoPath: z.string().min(1) }))
    .query(async ({ input }) => {
      const git = simpleGit(input.repoPath);
      const local = await git.branchLocal();
      return {
        current: local.current,
        branches: Object.values(local.branches).map((b) => ({
          name: b.name,
          commit: b.commit,
          label: b.label,
        })),
      };
    }),

  // branch checkout
  checkout: publicProcedure
    .input(z.object({ repoPath: z.string().min(1), branch: z.string().min(1) }))
    .mutation(async ({ input }) => {
      const git = simpleGit(input.repoPath);
      await git.checkout(input.branch);
      return { branch: input.branch };
    }),

  // file diff (unified format, parsed into hunks)
  fileDiff: publicProcedure
    .input(z.object({
      repoPath: z.string().min(1),
      filePath: z.string().min(1),
      staged: z.boolean().default(false),
    }))
    .query(async ({ input }) => {
      const git = simpleGit(input.repoPath);
      const args = input.staged
        ? ['--cached', '--', input.filePath]
        : ['--', input.filePath];
      let raw = '';
      try {
        raw = await git.diff(args);
        if (!raw) {
          // new file staged — compare against /dev/null
          raw = await git.diff(['--cached', '--', input.filePath]);
        }
      } catch {
        raw = '';
      }
      return { raw, hunks: parseUnifiedDiff(raw) };
    }),

  readDir: publicProcedure
    .input(z.object({ dirPath: z.string().min(1) }))
    .query(({ input }) => {
      return getGitService().readDir(input.dirPath);
    }),

  // worktree branch → base branch 병합
  merge: publicProcedure
    .input(z.object({
      workspaceId: z.string().uuid(),
      strategy: z.enum(['squash', 'rebase', 'merge']),
    }))
    .mutation(async ({ input }): Promise<{ success: boolean; message: string }> => {
      const db = getDatabaseManager().getDb();

      // 1. workspace 조회
      const wsRow = db.prepare('SELECT * FROM workspaces WHERE id = ?').get(input.workspaceId) as Record<string, unknown> | undefined;
      if (!wsRow) {
        return { success: false, message: 'Workspace not found' };
      }
      const workspace = rowToWorkspace(wsRow);

      // 2. repository 조회 → baseBranch 확인
      const repoRow = db.prepare('SELECT * FROM repositories WHERE id = ?').get(workspace.repositoryId) as Record<string, unknown> | undefined;
      if (!repoRow) {
        return { success: false, message: 'Repository not found' };
      }
      const repo = rowToRepo(repoRow);
      const baseBranch = repo.baseBranch || 'main';

      // 3. worktree 경로에서 simple-git 인스턴스 생성
      const git = simpleGit(workspace.worktreePath);

      // 4. uncommitted changes 확인
      const statusResult = await git.status();
      const hasUncommitted = statusResult.modified.length > 0
        || statusResult.not_added.length > 0
        || statusResult.staged.length > 0
        || statusResult.deleted.length > 0
        || statusResult.created.length > 0;

      if (hasUncommitted) {
        return { success: false, message: 'Uncommitted changes detected. Please commit or stash changes before merging.' };
      }

      // 5. 현재 브랜치 확인
      const currentBranch = workspace.branch;
      if (currentBranch === baseBranch) {
        return { success: false, message: `Already on base branch (${baseBranch}). Nothing to merge.` };
      }

      try {
        // 6. 메인 저장소 경로에서 병합 수행
        const mainGit = simpleGit(repo.path);

        // base branch로 checkout
        await mainGit.checkout(baseBranch);

        // 7. strategy에 따른 병합
        switch (input.strategy) {
          case 'squash': {
            await mainGit.merge([currentBranch, '--squash']);
            // squash merge 후 자동 커밋
            await mainGit.commit(`Squash merge branch '${currentBranch}' into ${baseBranch}`);
            break;
          }
          case 'rebase': {
            // rebase: worktree 브랜치의 커밋들을 base 위에 리베이스
            await mainGit.rebase([currentBranch]);
            break;
          }
          case 'merge': {
            await mainGit.merge([currentBranch, '--no-ff']);
            break;
          }
        }

        return {
          success: true,
          message: `Successfully merged '${currentBranch}' into '${baseBranch}' using ${input.strategy} strategy.`,
        };
      } catch (error) {
        const errMsg = error instanceof Error ? error.message : String(error);

        // 충돌 발생 시 merge 중단
        try {
          const mainGit = simpleGit(repo.path);
          await mainGit.merge(['--abort']).catch(() => {});
          await mainGit.rebase(['--abort']).catch(() => {});
        } catch {
          // abort 실패는 무시
        }

        return { success: false, message: `Merge failed: ${errMsg}` };
      }
    }),
});

// ── mcpRouter ─────────────────────────────────────────────────────────────────

export const mcpRouter = router({
  list: publicProcedure.query(() => {
    const db = getDatabaseManager().getDb();
    return db
      .prepare('SELECT * FROM mcp_servers ORDER BY created_at')
      .all()
      .map((r) => rowToMcpServer(r as McpServerRow));
  }),

  add: publicProcedure
    .input(z.object({ name: z.string().min(1), url: z.string().url() }))
    .mutation(({ input }) => {
      const db = getDatabaseManager().getDb();
      const id = uuidv4();
      db.prepare(`INSERT INTO mcp_servers (id, name, url) VALUES (?, ?, ?)`).run(
        id,
        input.name,
        input.url
      );
      return rowToMcpServer(
        db.prepare('SELECT * FROM mcp_servers WHERE id = ?').get(id) as McpServerRow
      );
    }),

  delete: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(({ input }) => {
      const db = getDatabaseManager().getDb();
      db.prepare('DELETE FROM mcp_servers WHERE id = ?').run(input.id);
    }),

  toggle: publicProcedure
    .input(z.object({ id: z.string(), enabled: z.boolean() }))
    .mutation(({ input }) => {
      const db = getDatabaseManager().getDb();
      db.prepare(`UPDATE mcp_servers SET enabled = ? WHERE id = ?`).run(
        input.enabled ? 1 : 0,
        input.id
      );
      return rowToMcpServer(
        db.prepare('SELECT * FROM mcp_servers WHERE id = ?').get(input.id) as McpServerRow
      );
    }),

  updateStatus: publicProcedure
    .input(
      z.object({
        id: z.string(),
        status: z.enum(['connected', 'offline', 'error']),
        errorMsg: z.string().nullable(),
      })
    )
    .mutation(({ input }) => {
      const db = getDatabaseManager().getDb();
      db.prepare(`UPDATE mcp_servers SET status = ?, error_msg = ? WHERE id = ?`).run(
        input.status,
        input.errorMsg,
        input.id
      );
      return rowToMcpServer(
        db.prepare('SELECT * FROM mcp_servers WHERE id = ?').get(input.id) as McpServerRow
      );
    }),

  checkServers: publicProcedure.mutation(async () => {
    const db = getDatabaseManager().getDb();
    const servers = db
      .prepare('SELECT * FROM mcp_servers WHERE enabled = 1')
      .all() as McpServerRow[];

    const results = await Promise.all(
      servers.map(async (server) => {
        try {
          const url = new URL(server.url);
          const host = url.hostname;
          const port = parseInt(url.port || '80', 10);
          const connected = await checkSocketConnection(host, port);
          const status = connected ? 'connected' : 'offline';
          db.prepare(`UPDATE mcp_servers SET status = ?, error_msg = NULL WHERE id = ?`).run(
            status,
            server.id
          );
        } catch (err) {
          db.prepare(
            `UPDATE mcp_servers SET status = 'error', error_msg = ? WHERE id = ?`
          ).run(String(err), server.id);
        }
        return rowToMcpServer(
          db.prepare('SELECT * FROM mcp_servers WHERE id = ?').get(server.id) as McpServerRow
        );
      })
    );

    return results;
  }),
});

// ── appStateRouter ────────────────────────────────────────────────────────────

export const appStateRouter = router({
  load: publicProcedure.query((): AppState => {
    const db = getDatabaseManager().getDb();
    const row = db
      .prepare(`SELECT value FROM app_state WHERE key = 'ui_state'`)
      .get() as { value: string } | undefined;

    if (!row) {
      return { sidebarWidth: 240, rightSidebarWidth: 320 };
    }

    return JSON.parse(row.value) as AppState;
  }),

  save: publicProcedure
    .input(z.object({ state: z.record(z.string(), z.unknown()) }))
    .mutation(({ input }) => {
      const db = getDatabaseManager().getDb();
      db.prepare(
        `INSERT INTO app_state (key, value) VALUES ('ui_state', ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`
      ).run(JSON.stringify(input.state));
    }),
});

// ── uiRouter ──────────────────────────────────────────────────────────────────

export const uiRouter = router({
  loadState: publicProcedure.query((): AppState => {
    const db = getDatabaseManager().getDb();
    const row = db
      .prepare(`SELECT value FROM app_state WHERE key = 'ui_state'`)
      .get() as { value: string } | undefined;

    if (!row) {
      return { sidebarWidth: 240, rightSidebarWidth: 320 };
    }

    return JSON.parse(row.value) as AppState;
  }),

  saveState: publicProcedure
    .input(z.record(z.string(), z.unknown()))
    .mutation(({ input }) => {
      const db = getDatabaseManager().getDb();
      db.prepare(
        `INSERT INTO app_state (key, value) VALUES ('ui_state', ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`
      ).run(JSON.stringify(input));
    }),

  focus: publicProcedure
    .input(z.object({ target: z.string() }))
    .mutation(({ input }) => {
      const win = getMainWindow();
      if (win && !win.isDestroyed()) {
        win.webContents.send('ui-focus', { target: input.target });
      }
    }),

  sidebar: publicProcedure
    .input(z.object({ open: z.boolean(), side: z.enum(['left', 'right']).optional() }))
    .mutation(({ input }) => {
      const win = getMainWindow();
      if (win && !win.isDestroyed()) {
        win.webContents.send('ui-sidebar', input);
      }
    }),

  tabs: publicProcedure
    .input(
      z.object({
        activeTab: z.string(),
        panel: z.enum(['terminal', 'git', 'mcp']).optional(),
      })
    )
    .mutation(({ input }) => {
      const win = getMainWindow();
      if (win && !win.isDestroyed()) {
        win.webContents.send('ui-tabs', input);
      }
    }),
});

// ── panesRouter ───────────────────────────────────────────────────────────────

export const panesRouter = router({
  terminalSend: publicProcedure
    .input(z.object({ sessionId: z.string(), text: z.string() }))
    .mutation(({ input }) => {
      getPtyManager().write(input.sessionId, input.text);
    }),

  terminalRead: publicProcedure
    .input(z.object({ sessionId: z.string() }))
    .query(({ input }) => {
      // PTY 출력은 push 방식이므로 실시간 read는 IPC event로 처리.
      // 여기서는 세션 생존 여부만 반환한다.
      return { alive: getPtyManager().isAlive(input.sessionId) };
    }),
});

// ── layoutRouter ──────────────────────────────────────────────────────────────

export const layoutRouter = router({
  get: publicProcedure
    .input(z.object({ workspaceId: z.string() }))
    .query(({ input }) => {
      const db = getDatabaseManager();
      const layout = db.getTiledLayout(input.workspaceId);
      if (!layout) return null;
      return {
        id: layout.id,
        workspaceId: layout.workspaceId,
        mosaicState: JSON.parse(layout.mosaicState),
        updatedAt: layout.updatedAt,
      };
    }),

  save: publicProcedure
    .input(z.object({ workspaceId: z.string(), mosaicState: z.any() }))
    .mutation(({ input }) => {
      const db = getDatabaseManager();
      return db.saveTiledLayout(input.workspaceId, JSON.stringify(input.mosaicState));
    }),
});

// ── dialogRouter ──────────────────────────────────────────────────────────────

export const dialogRouter = router({
  openDirectory: publicProcedure.mutation(async () => {
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
    const opts = { properties: ['openDirectory', 'createDirectory'] as Electron.OpenDialogOptions['properties'] };
    const result = win
      ? await dialog.showOpenDialog(win, opts)
      : await dialog.showOpenDialog(opts);
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  }),
});

// ── shellRouter ───────────────────────────────────────────────────────────────

export const shellRouter = router({
  openPath: publicProcedure
    .input(z.object({ filePath: z.string().min(1) }))
    .mutation(async ({ input }) => {
      await shell.openPath(input.filePath);
    }),
});

// ── appRouter (root) ──────────────────────────────────────────────────────────

export const appRouter = router({
  workspace: workspaceRouter,
  session: sessionRouter,
  agent: agentRouter,
  repository: repositoryRouter,
  git: gitRouter,
  mcp: mcpRouter,
  appState: appStateRouter,
  ui: uiRouter,
  panes: panesRouter,
  layout: layoutRouter,
  dialog: dialogRouter,
  shell: shellRouter,
});

export type AppRouter = typeof appRouter;

// 테스트에서 서버 사이드 caller 생성에 사용
export const createCaller = t.createCallerFactory(appRouter);
