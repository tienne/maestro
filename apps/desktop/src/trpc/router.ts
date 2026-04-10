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
import * as fs from 'fs';
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
import { getSessionIntelligence } from '../services/session-intelligence';
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
  is_favorite?: number;
  depends_on_session_id?: string | null;
  context_source_session_id?: string | null;
  last_exit_code?: number | null;
}

function rowToSession(row: SessionRow) {
  return {
    id: row.id,
    name: row.name,
    workspaceId: row.workspace_id,
    agentId: row.agent_id,
    status: row.status as 'running' | 'stopped' | 'error' | 'pending' | 'blocked',
    pid: row.pid,
    createdAt: row.created_at,
    isFavorite: Boolean(row.is_favorite),
    dependsOnSessionId: row.depends_on_session_id ?? null,
    contextSourceSessionId: row.context_source_session_id ?? null,
    lastExitCode: row.last_exit_code ?? null,
  };
}

interface PresetRow {
  id: string;
  name: string;
  agent_id: string;
  workspace_id: string;
  initial_command: string;
  env_vars: string;
  created_at: string;
}

function rowToPreset(row: PresetRow) {
  return {
    id: row.id,
    name: row.name,
    agentId: row.agent_id,
    workspaceId: row.workspace_id,
    initialCommand: row.initial_command,
    envVars: JSON.parse(row.env_vars) as Record<string, string>,
    createdAt: row.created_at,
  };
}

interface LabelRow {
  session_id: string;
  label_name: string;
  label_color: string;
}

function rowToLabel(row: LabelRow) {
  return {
    sessionId: row.session_id,
    labelName: row.label_name,
    labelColor: row.label_color,
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
    scriptPath: (row.script_path as string) ?? null,
    scriptContent: (row.script_content as string) ?? null,
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

  // ── M5-02: Snapshot ─────────────────────────────────────────────────────

  createSnapshot: publicProcedure
    .input(z.object({ workspaceId: z.string() }))
    .mutation(async ({ input }) => {
      const db = getDatabaseManager().getDb();
      const workspace = db
        .prepare('SELECT * FROM workspaces WHERE id = ?')
        .get(input.workspaceId) as Record<string, unknown> | undefined;
      if (!workspace) throw new Error(`Workspace ${input.workspaceId} not found`);

      // 현재 env_vars 수집 (repository 기준)
      const envRows = db
        .prepare(
          `SELECT ev.key, ev.value FROM env_vars ev
           JOIN workspaces w ON w.repository_id = ev.repository_id
           WHERE w.id = ?`
        )
        .all(input.workspaceId) as Array<{ key: string; value: string }>;
      const envVars: Record<string, string> = {};
      for (const row of envRows) envVars[row.key] = row.value;

      // git HEAD 조회
      let gitHead = '';
      try {
        const git = simpleGit(workspace.worktree_path as string);
        const log = await git.log({ maxCount: 1 });
        gitHead = log.latest?.hash ?? '';
      } catch { /* 무시 */ }

      // 레포의 setup_script 가져오기
      const repo = db
        .prepare('SELECT setup_script FROM repositories WHERE id = ?')
        .get(workspace.repository_id) as { setup_script: string } | undefined;

      const id = uuidv4();
      db.prepare(
        `INSERT INTO workspace_snapshots (id, workspace_id, env_vars, git_head, setup_script)
         VALUES (?, ?, ?, ?, ?)`
      ).run(id, input.workspaceId, JSON.stringify(envVars), gitHead, repo?.setup_script ?? '');

      // 오래된 스냅샷 정리 (최근 10개 유지)
      db.prepare(
        `DELETE FROM workspace_snapshots WHERE workspace_id = ? AND id NOT IN (
          SELECT id FROM workspace_snapshots WHERE workspace_id = ? ORDER BY created_at DESC LIMIT 10
        )`
      ).run(input.workspaceId, input.workspaceId);

      const row = db.prepare('SELECT * FROM workspace_snapshots WHERE id = ?').get(id) as Record<string, unknown>;
      return {
        id: row.id as string,
        workspaceId: row.workspace_id as string,
        envVars: JSON.parse(row.env_vars as string) as Record<string, string>,
        gitHead: row.git_head as string,
        setupScript: row.setup_script as string,
        createdAt: row.created_at as string,
      };
    }),

  listSnapshots: publicProcedure
    .input(z.object({ workspaceId: z.string() }))
    .query(({ input }) => {
      const db = getDatabaseManager().getDb();
      const rows = db
        .prepare('SELECT * FROM workspace_snapshots WHERE workspace_id = ? ORDER BY created_at DESC LIMIT 10')
        .all(input.workspaceId) as Array<Record<string, unknown>>;
      return rows.map((row) => ({
        id: row.id as string,
        workspaceId: row.workspace_id as string,
        envVars: JSON.parse(row.env_vars as string) as Record<string, string>,
        gitHead: row.git_head as string,
        setupScript: row.setup_script as string,
        createdAt: row.created_at as string,
      }));
    }),

  restoreSnapshot: publicProcedure
    .input(z.object({ snapshotId: z.string() }))
    .mutation(async ({ input }) => {
      const db = getDatabaseManager().getDb();
      const snap = db
        .prepare('SELECT * FROM workspace_snapshots WHERE id = ?')
        .get(input.snapshotId) as Record<string, unknown> | undefined;
      if (!snap) throw new Error(`Snapshot ${input.snapshotId} not found`);

      const workspaceId = snap.workspace_id as string;
      const workspace = db
        .prepare('SELECT * FROM workspaces WHERE id = ?')
        .get(workspaceId) as Record<string, unknown> | undefined;
      if (!workspace) throw new Error(`Workspace ${workspaceId} not found`);

      const repoId = workspace.repository_id as string;
      const envVars = JSON.parse(snap.env_vars as string) as Record<string, string>;

      // 기존 env_vars 삭제 후 스냅샷 것으로 교체
      db.prepare('DELETE FROM env_vars WHERE repository_id = ?').run(repoId);
      const insertEnv = db.prepare(
        `INSERT INTO env_vars (id, repository_id, key, value) VALUES (?, ?, ?, ?)`
      );
      for (const [key, value] of Object.entries(envVars)) {
        insertEnv.run(uuidv4(), repoId, key, value);
      }

      // git HEAD 복원 (soft reset)
      const gitHead = snap.git_head as string;
      if (gitHead) {
        try {
          const git = simpleGit(workspace.worktree_path as string);
          await git.reset(['--soft', gitHead]);
        } catch { /* 무시 — git reset 실패는 치명적이지 않음 */ }
      }

      return { success: true };
    }),

  // ── M5-03: Lifecycle Hooks ──────────────────────────────────────────────

  updateHooks: publicProcedure
    .input(z.object({
      workspaceId: z.string(),
      hookOnSessionStart: z.string().optional(),
      hookOnAgentComplete: z.string().optional(),
      hookOnError: z.string().optional(),
    }))
    .mutation(({ input }) => {
      const db = getDatabaseManager().getDb();
      const fields: string[] = [];
      const values: unknown[] = [];
      if (input.hookOnSessionStart !== undefined) { fields.push('hook_on_session_start = ?'); values.push(input.hookOnSessionStart); }
      if (input.hookOnAgentComplete !== undefined) { fields.push('hook_on_agent_complete = ?'); values.push(input.hookOnAgentComplete); }
      if (input.hookOnError !== undefined) { fields.push('hook_on_error = ?'); values.push(input.hookOnError); }
      if (fields.length > 0) {
        db.prepare(`UPDATE workspaces SET ${fields.join(', ')} WHERE id = ?`).run(...values, input.workspaceId);
      }
      const row = db.prepare('SELECT * FROM workspaces WHERE id = ?').get(input.workspaceId) as Record<string, unknown>;
      if (!row) throw new Error(`Workspace ${input.workspaceId} not found`);
      return {
        ...rowToWorkspace(row),
        hookOnSessionStart: (row.hook_on_session_start as string) ?? '',
        hookOnAgentComplete: (row.hook_on_agent_complete as string) ?? '',
        hookOnError: (row.hook_on_error as string) ?? '',
      };
    }),

  getHooks: publicProcedure
    .input(z.object({ workspaceId: z.string() }))
    .query(({ input }) => {
      const db = getDatabaseManager().getDb();
      const row = db.prepare('SELECT hook_on_session_start, hook_on_agent_complete, hook_on_error FROM workspaces WHERE id = ?')
        .get(input.workspaceId) as Record<string, unknown> | undefined;
      if (!row) throw new Error(`Workspace ${input.workspaceId} not found`);
      return {
        hookOnSessionStart: (row.hook_on_session_start as string) ?? '',
        hookOnAgentComplete: (row.hook_on_agent_complete as string) ?? '',
        hookOnError: (row.hook_on_error as string) ?? '',
      };
    }),

  // ── M5-04: Env Sync ────────────────────────────────────────────────────

  notifyEnvChange: publicProcedure
    .input(z.object({ repositoryId: z.string() }))
    .mutation(({ input }) => {
      const db = getDatabaseManager().getDb();
      // 해당 repo에 속한 모든 워크스페이스의 활성 세션 찾기
      const sessions = db
        .prepare(
          `SELECT s.id FROM sessions s
           JOIN workspaces w ON s.workspace_id = w.id
           WHERE w.repository_id = ? AND s.status = 'running'`
        )
        .all(input.repositoryId) as Array<{ id: string }>;

      // 렌더러에 알림 전송
      const win = getMainWindow();
      if (win && !win.isDestroyed()) {
        for (const session of sessions) {
          win.webContents.send('env-reload-needed', { sessionId: session.id });
        }
      }

      return { notified: sessions.length };
    }),

  reloadEnv: publicProcedure
    .input(z.object({ sessionId: z.string() }))
    .mutation(({ input }) => {
      const db = getDatabaseManager().getDb();
      const ptyManager = getPtyManager();

      if (!ptyManager.isAlive(input.sessionId)) {
        throw new Error(`Session ${input.sessionId} is not running`);
      }

      const session = db
        .prepare('SELECT * FROM sessions WHERE id = ?')
        .get(input.sessionId) as SessionRow | undefined;
      if (!session) throw new Error(`Session ${input.sessionId} not found`);

      // 최신 env_vars 조회
      const envRows = db
        .prepare(
          `SELECT ev.key, ev.value FROM env_vars ev
           JOIN workspaces w ON w.repository_id = ev.repository_id
           WHERE w.id = ?`
        )
        .all(session.workspace_id) as Array<{ key: string; value: string }>;

      // export 명령어를 PTY에 순서대로 전송
      for (const row of envRows) {
        ptyManager.write(input.sessionId, `export ${row.key}=${JSON.stringify(row.value)}\r`);
      }

      return { success: true };
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
        dependsOnSessionId: z.string().nullable().optional(),
        contextSourceSessionId: z.string().nullable().optional(),
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
      // M4-01: 의존성이 있고 선행 세션이 아직 완료되지 않았으면 'pending' 대신 'blocked'
      const hasDeps = Boolean(input.dependsOnSessionId);
      let initialStatus: 'pending' | 'blocked' = 'pending';
      if (hasDeps) {
        const dep = db.prepare('SELECT status FROM sessions WHERE id = ?').get(input.dependsOnSessionId!) as { status: string } | undefined;
        if (dep && dep.status !== 'stopped') {
          initialStatus = 'blocked';
        }
      }

      db.prepare(
        `INSERT INTO sessions (id, name, workspace_id, agent_id, status, pid, depends_on_session_id, context_source_session_id)
         VALUES (?, ?, ?, ?, ?, NULL, ?, ?)`
      ).run(id, name, workspaceId, agentId, initialStatus, input.dependsOnSessionId ?? null, input.contextSourceSessionId ?? null);

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

      // M3: 세션 인텔리전스 시작
      const intelligence = getSessionIntelligence();
      intelligence.startSession(sessionId);

      // M5-03: lifecycle hook 조회
      const wsHooks = db
        .prepare('SELECT hook_on_session_start, hook_on_agent_complete, hook_on_error FROM workspaces WHERE id = ?')
        .get(session.workspace_id) as { hook_on_session_start: string; hook_on_agent_complete: string; hook_on_error: string } | undefined;

      const ptyProcess = ptyManager.create(
        sessionId,
        agent.command as string,
        agentArgs,
        mergedEnv,
        workspace.worktree_path as string,
        cols,
        rows
      );

      // M5-03: onSessionStart 훅 실행
      if (wsHooks?.hook_on_session_start?.trim()) {
        execAsync(wsHooks.hook_on_session_start, { cwd: workspace.worktree_path as string })
          .then(() => {
            const win = getMainWindow();
            if (win && !win.isDestroyed()) {
              win.webContents.send('hook-result', { sessionId, hook: 'onSessionStart', success: true });
            }
          })
          .catch((err: unknown) => {
            const win = getMainWindow();
            if (win && !win.isDestroyed()) {
              win.webContents.send('hook-result', { sessionId, hook: 'onSessionStart', success: false, error: String(err) });
            }
          });
      }

      ptyManager.onOutput(sessionId, (sid, data) => {
        // M3: PTY 출력을 인텔리전스 매니저에 전달
        intelligence.feedData(sid, data);

        // M5-03: onError 훅 — 에러 패턴 감지 시 실행
        if (wsHooks?.hook_on_error?.trim()) {
          const errorPatterns = ['Error:', 'error:', 'FATAL', 'panic:', 'Traceback'];
          if (errorPatterns.some((p) => data.includes(p))) {
            execAsync(wsHooks.hook_on_error, { cwd: workspace.worktree_path as string })
              .then(() => {
                const win = getMainWindow();
                if (win && !win.isDestroyed()) {
                  win.webContents.send('hook-result', { sessionId: sid, hook: 'onError', success: true });
                }
              })
              .catch(() => { /* 무시 */ });
          }
        }

        const win = getMainWindow();
        if (win && !win.isDestroyed()) {
          win.webContents.send('session-output', { sessionId: sid, data });
        }
      });

      ptyManager.onExit(sessionId, (sid, exitCode) => {
        ptyManager.removeOutput(sid);
        ptyManager.removeExit(sid);

        // M3: 완료 감지
        intelligence.handleExit(sid, exitCode);
        const status = exitCode === 0 ? 'stopped' : 'error';
        // M7-04: exit code를 DB에 저장
        db.prepare('UPDATE sessions SET status = ?, pid = NULL, last_exit_code = ? WHERE id = ?').run(status, exitCode ?? null, sid);

        // M7-04: 비정상 종료 시 에러 로그 기록
        if (exitCode !== 0 && exitCode !== undefined) {
          import('../services/error-logger').then(({ writeErrorLog }) => {
            writeErrorLog('pty-exit', `Session ${sid} exited with code ${exitCode}`);
          }).catch(() => { /* 무시 */ });
        }

        // M6-02: 웹훅 이벤트 발송
        const webhookEvent = exitCode === 0 ? 'session.completed' : 'session.error';
        emitWebhookEvent(webhookEvent, { sessionId: sid, exitCode });

        // M5-03: onAgentComplete 훅 (exit 0일 때만 실행)
        if (exitCode === 0 && wsHooks?.hook_on_agent_complete?.trim()) {
          execAsync(wsHooks.hook_on_agent_complete, { cwd: workspace.worktree_path as string })
            .then(() => {
              const hWin = getMainWindow();
              if (hWin && !hWin.isDestroyed()) {
                hWin.webContents.send('hook-result', { sessionId: sid, hook: 'onAgentComplete', success: true });
              }
            })
            .catch((err: unknown) => {
              const hWin = getMainWindow();
              if (hWin && !hWin.isDestroyed()) {
                hWin.webContents.send('hook-result', { sessionId: sid, hook: 'onAgentComplete', success: false, error: String(err) });
              }
            });
        }

        // 스크롤백 버퍼 DB 저장 (세션 재개 시 복원)
        const scrollback = ptyManager.getScrollback(sid);
        if (scrollback) {
          db.prepare(`
            INSERT INTO session_scrollbacks (session_id, data, updated_at)
            VALUES (?, ?, datetime('now'))
            ON CONFLICT(session_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at
          `).run(sid, scrollback);
        }

        // M9-04: 세션 아카이브 자동 저장
        import('../services/session-archiver').then(({ archiveSession }) => {
          archiveSession(sid);
        }).catch(() => { /* 무시 */ });

        const win = getMainWindow();
        if (win && !win.isDestroyed()) {
          win.webContents.send('session-status', { sessionId: sid, status });
        }

        // M4-01: 의존성 체인 — 후속 세션 자동 시작/블록
        const dependents = db
          .prepare(`SELECT * FROM sessions WHERE depends_on_session_id = ?`)
          .all(sid) as SessionRow[];
        for (const dep of dependents) {
          if (exitCode === 0) {
            // 선행 세션 성공 → 의존 세션을 pending으로 변경 (XTerminal onReady → launch 흐름)
            db.prepare('UPDATE sessions SET status = ? WHERE id = ?').run('pending', dep.id);
            if (win && !win.isDestroyed()) {
              win.webContents.send('session-status', { sessionId: dep.id, status: 'pending' });
            }
          } else {
            // 선행 세션 실패 → blocked
            db.prepare('UPDATE sessions SET status = ? WHERE id = ?').run('blocked', dep.id);
            if (win && !win.isDestroyed()) {
              win.webContents.send('session-status', { sessionId: dep.id, status: 'blocked' });
            }
          }
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
        ptyProcess.pid as number,
        sessionId
      );

      // M6-02: 세션 시작 웹훅 이벤트 발송
      emitWebhookEvent('session.started', { sessionId });

      // M4-02: 컨텍스트 소스 세션이 있으면 출력을 stdin에 주입
      if (session.context_source_session_id) {
        const srcScrollback = ptyManager.getScrollback(session.context_source_session_id);
        let contextData = srcScrollback;
        if (!contextData) {
          const srcRow = db
            .prepare('SELECT data FROM session_scrollbacks WHERE session_id = ?')
            .get(session.context_source_session_id) as { data: string } | undefined;
          contextData = srcRow?.data ?? '';
        }
        if (contextData) {
          const lines = contextData.split('\n').slice(-100).join('\n').slice(0, 4000);
          if (lines.trim()) {
            setTimeout(() => {
              try {
                ptyManager.write(sessionId, lines + '\r');
              } catch { /* 무시 */ }
            }, 300);
          }
        }
      }

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
    .input(z.object({ sessionId: z.string(), restart: z.boolean().optional() }))
    .mutation(({ input }) => {
      const db = getDatabaseManager().getDb();
      const ptyManager = getPtyManager();
      const { sessionId, restart } = input;

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

      // restart=true: PTY가 없는 상태에서 재시작 — 'pending'으로 리셋해
      // XTerminal의 onReady → session.launch 흐름을 다시 타게 한다.
      if (restart && !ptyManager.isAlive(sessionId)) {
        db.prepare('UPDATE sessions SET status = ?, pid = NULL WHERE id = ?').run('pending', sessionId);
      }

      db.prepare(
        `INSERT INTO app_state (key, value) VALUES ('last_session_id', ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`
      ).run(JSON.stringify(sessionId));

      return rowToSession(
        db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId) as SessionRow
      );
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

  // ── M2-03: 세션 이름 변경 ──────────────────────────────────────────────
  rename: publicProcedure
    .input(z.object({ sessionId: z.string(), name: z.string().min(1).max(30) }))
    .mutation(({ input }) => {
      const db = getDatabaseManager().getDb();
      db.prepare('UPDATE sessions SET name = ? WHERE id = ?').run(input.name, input.sessionId);
      const row = db.prepare('SELECT * FROM sessions WHERE id = ?').get(input.sessionId) as SessionRow | undefined;
      if (!row) throw new Error(`Session ${input.sessionId} not found`);
      return rowToSession(row);
    }),

  // ── M2-06: 즐겨찾기 토글 ──────────────────────────────────────────────
  setFavorite: publicProcedure
    .input(z.object({ sessionId: z.string(), favorite: z.boolean() }))
    .mutation(({ input }) => {
      const db = getDatabaseManager().getDb();
      db.prepare('UPDATE sessions SET is_favorite = ? WHERE id = ?').run(input.favorite ? 1 : 0, input.sessionId);
      const row = db.prepare('SELECT * FROM sessions WHERE id = ?').get(input.sessionId) as SessionRow | undefined;
      if (!row) throw new Error(`Session ${input.sessionId} not found`);
      return rowToSession(row);
    }),

  // ── M3-01: 세션 비용 조회 ─────────────────────────────────────────────
  getCost: publicProcedure
    .input(z.object({ sessionId: z.string() }))
    .query(({ input }) => {
      const intelligence = getSessionIntelligence();
      const state = intelligence.getState(input.sessionId);
      if (state) return state.costs;

      // 인메모리에 없으면 DB에서 합산
      const db = getDatabaseManager().getDb();
      const row = db
        .prepare(
          `SELECT COALESCE(SUM(input_tokens), 0) as input_tokens,
                  COALESCE(SUM(output_tokens), 0) as output_tokens,
                  COALESCE(SUM(cost_usd), 0) as cost_usd
           FROM session_costs WHERE session_id = ?`,
        )
        .get(input.sessionId) as { input_tokens: number; output_tokens: number; cost_usd: number };

      return {
        sessionId: input.sessionId,
        totalInputTokens: row.input_tokens,
        totalOutputTokens: row.output_tokens,
        totalCostUsd: row.cost_usd,
      };
    }),

  // ── M3-02: 작업 진행률 조회 ───────────────────────────────────────────
  getTasks: publicProcedure
    .input(z.object({ sessionId: z.string() }))
    .query(({ input }) => {
      const intelligence = getSessionIntelligence();
      const state = intelligence.getState(input.sessionId);
      return state?.tasks ?? [];
    }),

  // ── M3-04: 에러 정보 조회 ────────────────────────────────────────────
  getLastError: publicProcedure
    .input(z.object({ sessionId: z.string() }))
    .query(({ input }) => {
      const intelligence = getSessionIntelligence();
      const state = intelligence.getState(input.sessionId);
      return state?.lastError ?? null;
    }),

  // ── M3: 세션 인텔리전스 전체 조회 ────────────────────────────────────
  getIntelligence: publicProcedure
    .input(z.object({ sessionId: z.string() }))
    .query(({ input }) => {
      const intelligence = getSessionIntelligence();
      return intelligence.getState(input.sessionId);
    }),

  // ── M3: 인텔리전스 실시간 구독 ───────────────────────────────────────
  subscribeIntelligence: publicProcedure
    .input(z.object({ sessionId: z.string() }))
    .subscription(({ input }) => {
      const intelligence = getSessionIntelligence();
      return observable<ReturnType<typeof intelligence.getState>>((emit) => {
        // 초기값 전송
        emit.next(intelligence.getState(input.sessionId));

        const unsub = intelligence.onChange((changedSessionId) => {
          if (changedSessionId === input.sessionId) {
            emit.next(intelligence.getState(input.sessionId));
          }
        });
        return unsub;
      });
    }),

  // ── M4-01: 파이프라인 의존성 설정 ────────────────────────────────────
  setPipeline: publicProcedure
    .input(z.object({ sessionId: z.string(), dependsOnSessionId: z.string().nullable() }))
    .mutation(({ input }) => {
      const db = getDatabaseManager().getDb();
      db.prepare('UPDATE sessions SET depends_on_session_id = ? WHERE id = ?')
        .run(input.dependsOnSessionId, input.sessionId);
      const row = db.prepare('SELECT * FROM sessions WHERE id = ?').get(input.sessionId) as SessionRow | undefined;
      if (!row) throw new Error(`Session ${input.sessionId} not found`);
      return rowToSession(row);
    }),

  // ── M4-02: 컨텍스트 소스 설정 ────────────────────────────────────────
  setContextSource: publicProcedure
    .input(z.object({ sessionId: z.string(), contextSourceSessionId: z.string().nullable() }))
    .mutation(({ input }) => {
      const db = getDatabaseManager().getDb();
      db.prepare('UPDATE sessions SET context_source_session_id = ? WHERE id = ?')
        .run(input.contextSourceSessionId, input.sessionId);
      const row = db.prepare('SELECT * FROM sessions WHERE id = ?').get(input.sessionId) as SessionRow | undefined;
      if (!row) throw new Error(`Session ${input.sessionId} not found`);
      return rowToSession(row);
    }),

  getContextOutput: publicProcedure
    .input(z.object({ sessionId: z.string(), lines: z.number().int().positive().max(200).default(100) }))
    .query(({ input }) => {
      const ptyManager = getPtyManager();
      const scrollback = ptyManager.getScrollback(input.sessionId);
      if (!scrollback) {
        const db = getDatabaseManager().getDb();
        const row = db
          .prepare('SELECT data FROM session_scrollbacks WHERE session_id = ?')
          .get(input.sessionId) as { data: string } | undefined;
        const data = row?.data ?? '';
        const lines = data.split('\n').slice(-input.lines).join('\n');
        return lines.slice(0, 4000);
      }
      const lines = scrollback.split('\n').slice(-input.lines).join('\n');
      return lines.slice(0, 4000);
    }),

  // ── M4-03: 일괄 제어 ────────────────────────────────────────────────
  stopAll: publicProcedure.mutation(() => {
    const db = getDatabaseManager().getDb();
    const ptyManager = getPtyManager();
    const running = db
      .prepare(`SELECT * FROM sessions WHERE status = 'running'`)
      .all() as SessionRow[];
    let stopped = 0;
    for (const row of running) {
      try {
        if (ptyManager.isAlive(row.id)) {
          ptyManager.kill(row.id);
        }
        db.prepare('UPDATE sessions SET status = ?, pid = NULL WHERE id = ?').run('stopped', row.id);
        stopped++;
      } catch {
        // 개별 실패 무시
      }
    }
    return { stopped };
  }),

  restartAllErrors: publicProcedure.mutation(() => {
    const db = getDatabaseManager().getDb();
    const errored = db
      .prepare(`SELECT * FROM sessions WHERE status = 'error'`)
      .all() as SessionRow[];
    let restarted = 0;
    for (const row of errored) {
      db.prepare('UPDATE sessions SET status = ?, pid = NULL WHERE id = ?').run('pending', row.id);
      restarted++;
    }
    // 상태 변경을 렌더러에 알림
    const win = getMainWindow();
    if (win && !win.isDestroyed()) {
      for (const row of errored) {
        win.webContents.send('session-status', { sessionId: row.id, status: 'pending' });
      }
    }
    return { restarted };
  }),

  // ── M4-05: 라벨 관리 ────────────────────────────────────────────────
  addLabel: publicProcedure
    .input(z.object({ sessionId: z.string(), labelName: z.string().min(1).max(20), labelColor: z.string() }))
    .mutation(({ input }) => {
      const db = getDatabaseManager().getDb();
      db.prepare(
        `INSERT OR REPLACE INTO session_labels (session_id, label_name, label_color) VALUES (?, ?, ?)`
      ).run(input.sessionId, input.labelName, input.labelColor);
      return { sessionId: input.sessionId, labelName: input.labelName, labelColor: input.labelColor };
    }),

  removeLabel: publicProcedure
    .input(z.object({ sessionId: z.string(), labelName: z.string() }))
    .mutation(({ input }) => {
      const db = getDatabaseManager().getDb();
      db.prepare('DELETE FROM session_labels WHERE session_id = ? AND label_name = ?')
        .run(input.sessionId, input.labelName);
    }),

  getLabels: publicProcedure
    .input(z.object({ sessionId: z.string() }))
    .query(({ input }) => {
      const db = getDatabaseManager().getDb();
      return (db
        .prepare('SELECT * FROM session_labels WHERE session_id = ?')
        .all(input.sessionId) as LabelRow[])
        .map(rowToLabel);
    }),

  listByLabel: publicProcedure
    .input(z.object({ labelName: z.string() }))
    .query(({ input }) => {
      const db = getDatabaseManager().getDb();
      return (db
        .prepare(
          `SELECT s.* FROM sessions s
           JOIN session_labels sl ON s.id = sl.session_id
           WHERE sl.label_name = ?
           ORDER BY s.created_at DESC`
        )
        .all(input.labelName) as SessionRow[])
        .map(rowToSession);
    }),

  // ── M7-03: 세션 자동 정리 (GC) ──────────────────────────────────────────
  gc: publicProcedure
    .input(z.object({ dryRun: z.boolean().default(true) }))
    .mutation(({ input }) => {
      const db = getDatabaseManager().getDb();
      // settingsStore의 sessionGcDays는 renderer 측이므로 기본 30일 사용.
      // 실제로는 클라이언트에서 호출 시 days를 함께 전달할 수도 있지만,
      // DB에서 N일 이전 비활성 세션(stopped/error)을 찾아 아카이브한다.
      const cutoffDays = 30;
      const rows = db
        .prepare(
          `SELECT id FROM sessions
           WHERE status IN ('stopped', 'error')
           AND created_at < datetime('now', '-' || ? || ' days')`
        )
        .all(cutoffDays) as { id: string }[];

      const ids = rows.map((r) => r.id);

      if (input.dryRun) {
        return { archivedCount: ids.length, archivedIds: ids };
      }

      // soft delete: status → 'archived'
      if (ids.length > 0) {
        const placeholders = ids.map(() => '?').join(',');
        db.prepare(`UPDATE sessions SET status = 'archived' WHERE id IN (${placeholders})`).run(...ids);
      }
      return { archivedCount: ids.length, archivedIds: ids };
    }),

  archive: publicProcedure
    .input(z.object({ sessionId: z.string() }))
    .mutation(({ input }) => {
      const db = getDatabaseManager().getDb();
      db.prepare(`UPDATE sessions SET status = 'archived' WHERE id = ?`).run(input.sessionId);
      return { success: true };
    }),

  // ── M9-02: 세션 내보내기 ──────────────────────────────────────────────────
  export: publicProcedure
    .input(z.object({
      sessionId: z.string(),
      format: z.enum(['html', 'txt', 'json']),
      includeTimestamp: z.boolean().default(true),
      includeAnsi: z.boolean().default(false),
    }))
    .mutation(async ({ input }) => {
      const db = getDatabaseManager().getDb();
      const session = db.prepare('SELECT * FROM sessions WHERE id = ?').get(input.sessionId) as SessionRow | undefined;
      if (!session) throw new Error(`Session ${input.sessionId} not found`);

      // scrollback 데이터 추출
      const scrollbackRow = db.prepare('SELECT data FROM session_scrollbacks WHERE session_id = ?').get(input.sessionId) as { data: string } | undefined;
      let content = scrollbackRow?.data ?? '';

      // ANSI 코드 제거 (txt/json 또는 includeAnsi=false 시)
      const stripAnsi = (str: string) => str.replace(/\x1B\[[0-9;]*[A-Za-z]/g, '').replace(/\x1B\][^\x07]*\x07/g, '');

      const timestamp = input.includeTimestamp ? `Exported: ${new Date().toISOString()}\nSession: ${session.name} (${session.id})\nCreated: ${session.created_at}\n\n` : '';

      let output = '';
      let ext = 'txt';

      if (input.format === 'txt') {
        output = timestamp + stripAnsi(content);
        ext = 'txt';
      } else if (input.format === 'json') {
        output = JSON.stringify({
          sessionId: session.id,
          sessionName: session.name,
          createdAt: session.created_at,
          exportedAt: new Date().toISOString(),
          content: stripAnsi(content),
        }, null, 2);
        ext = 'json';
      } else {
        // HTML format
        const body = input.includeAnsi ? content : stripAnsi(content);
        const escaped = body.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        output = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>${session.name}</title>
<style>body{background:#1e1e2e;color:#cdd6f4;font-family:monospace;white-space:pre-wrap;padding:20px;}
.header{color:#89b4fa;margin-bottom:16px;}</style></head>
<body>${input.includeTimestamp ? `<div class="header">Session: ${session.name}<br>Created: ${session.created_at}<br>Exported: ${new Date().toISOString()}</div>` : ''}${escaped}</body></html>`;
        ext = 'html';
      }

      const result = await dialog.showSaveDialog({
        title: 'Export Session',
        defaultPath: `${session.name.replace(/[^a-zA-Z0-9_-]/g, '_')}.${ext}`,
        filters: [
          { name: ext.toUpperCase(), extensions: [ext] },
          { name: 'All Files', extensions: ['*'] },
        ],
      });

      if (result.canceled || !result.filePath) {
        return { success: false, filePath: '' };
      }

      fs.writeFileSync(result.filePath, output, 'utf-8');
      return { success: true, filePath: result.filePath };
    }),

  // ── M9-04: 세션 아카이브 검색 ─────────────────────────────────────────────
  searchArchive: publicProcedure
    .input(z.object({ query: z.string().min(1) }))
    .query(({ input }) => {
      const { app: electronApp } = require('electron');
      const archiveDir = path.join(electronApp.getPath('home'), '.maestro', 'sessions');

      if (!fs.existsSync(archiveDir)) {
        return [];
      }

      const results: Array<{
        sessionId: string;
        sessionName: string;
        date: string;
        matchingLines: Array<{ lineNumber: number; content: string }>;
      }> = [];

      const files = fs.readdirSync(archiveDir).filter((f: string) => f.endsWith('.log'));
      const searchLower = input.query.toLowerCase();

      for (const file of files) {
        const filePath = path.join(archiveDir, file);
        const sessionId = file.replace('.log', '');

        try {
          const stat = fs.statSync(filePath);
          const content = fs.readFileSync(filePath, 'utf-8');
          const lines = content.split('\n');
          const matchingLines: Array<{ lineNumber: number; content: string }> = [];

          for (let i = 0; i < lines.length; i++) {
            if (lines[i].toLowerCase().includes(searchLower)) {
              matchingLines.push({ lineNumber: i + 1, content: lines[i].slice(0, 200) });
              if (matchingLines.length >= 5) break; // 파일당 최대 5개 매칭
            }
          }

          if (matchingLines.length > 0) {
            // DB에서 세션 이름 조회
            const db = getDatabaseManager().getDb();
            const session = db.prepare('SELECT name FROM sessions WHERE id = ?').get(sessionId) as { name: string } | undefined;

            results.push({
              sessionId,
              sessionName: session?.name ?? sessionId,
              date: stat.mtime.toISOString(),
              matchingLines,
            });
          }
        } catch {
          // 파일 읽기 실패 시 무시
        }
      }

      return results.slice(0, 20); // 최대 20개 결과
    }),
});

// ── presetRouter (M4-04) ─────────────────────────────────────────────────────

export const presetRouter = router({
  list: publicProcedure.query(() => {
    const db = getDatabaseManager().getDb();
    return (db
      .prepare('SELECT * FROM agent_presets ORDER BY created_at DESC')
      .all() as PresetRow[])
      .map(rowToPreset);
  }),

  create: publicProcedure
    .input(z.object({
      name: z.string().min(1),
      agentId: z.string(),
      workspaceId: z.string(),
      initialCommand: z.string().default(''),
      envVars: z.record(z.string(), z.string()).default({}),
    }))
    .mutation(({ input }) => {
      const db = getDatabaseManager().getDb();
      const id = uuidv4();
      db.prepare(
        `INSERT INTO agent_presets (id, name, agent_id, workspace_id, initial_command, env_vars) VALUES (?, ?, ?, ?, ?, ?)`
      ).run(id, input.name, input.agentId, input.workspaceId, input.initialCommand, JSON.stringify(input.envVars));
      return rowToPreset(
        db.prepare('SELECT * FROM agent_presets WHERE id = ?').get(id) as PresetRow
      );
    }),

  update: publicProcedure
    .input(z.object({
      id: z.string(),
      name: z.string().min(1).optional(),
      agentId: z.string().optional(),
      workspaceId: z.string().optional(),
      initialCommand: z.string().optional(),
      envVars: z.record(z.string(), z.string()).optional(),
    }))
    .mutation(({ input }) => {
      const db = getDatabaseManager().getDb();
      const fields: string[] = [];
      const values: unknown[] = [];
      if (input.name !== undefined) { fields.push('name = ?'); values.push(input.name); }
      if (input.agentId !== undefined) { fields.push('agent_id = ?'); values.push(input.agentId); }
      if (input.workspaceId !== undefined) { fields.push('workspace_id = ?'); values.push(input.workspaceId); }
      if (input.initialCommand !== undefined) { fields.push('initial_command = ?'); values.push(input.initialCommand); }
      if (input.envVars !== undefined) { fields.push('env_vars = ?'); values.push(JSON.stringify(input.envVars)); }
      if (fields.length > 0) {
        db.prepare(`UPDATE agent_presets SET ${fields.join(', ')} WHERE id = ?`).run(...values, input.id);
      }
      return rowToPreset(
        db.prepare('SELECT * FROM agent_presets WHERE id = ?').get(input.id) as PresetRow
      );
    }),

  delete: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(({ input }) => {
      const db = getDatabaseManager().getDb();
      db.prepare('DELETE FROM agent_presets WHERE id = ?').run(input.id);
    }),

  launch: publicProcedure
    .input(z.object({
      presetId: z.string(),
      cols: z.number().int().positive(),
      rows: z.number().int().positive(),
    }))
    .mutation(async ({ input }) => {
      const db = getDatabaseManager().getDb();
      const ptyManager = getPtyManager();
      const preset = db.prepare('SELECT * FROM agent_presets WHERE id = ?').get(input.presetId) as PresetRow | undefined;
      if (!preset) throw new Error(`Preset ${input.presetId} not found`);

      const workspace = db
        .prepare('SELECT * FROM workspaces WHERE id = ?')
        .get(preset.workspace_id) as Record<string, unknown> | undefined;
      if (!workspace) throw new Error(`Workspace ${preset.workspace_id} not found`);

      const agent = db
        .prepare('SELECT * FROM agents WHERE id = ?')
        .get(preset.agent_id) as Record<string, unknown> | undefined;
      if (!agent) throw new Error(`Agent ${preset.agent_id} not found`);

      // 세션 생성
      const sessionId = uuidv4();
      db.prepare(
        `INSERT INTO sessions (id, name, workspace_id, agent_id, status, pid) VALUES (?, ?, ?, ?, 'pending', NULL)`
      ).run(sessionId, `${preset.name}`, preset.workspace_id, preset.agent_id);

      // 환경변수 병합
      interface EnvVarRow { key: string; value: string; }
      const envVarRows = db
        .prepare(
          `SELECT ev.key, ev.value FROM env_vars ev
           JOIN repositories r ON r.id = ev.repository_id
           JOIN workspaces w ON w.repository_id = r.id
           WHERE w.id = ?`
        )
        .all(preset.workspace_id) as EnvVarRow[];
      const repoEnv: Record<string, string> = {};
      for (const row of envVarRows) repoEnv[row.key] = row.value;

      const agentArgs: string[] = JSON.parse(agent.args as string);
      const agentEnv: Record<string, string> = JSON.parse(agent.env as string);
      const presetEnv: Record<string, string> = JSON.parse(preset.env_vars);
      const mergedEnv = { ...repoEnv, ...agentEnv, ...presetEnv };

      const intelligence = getSessionIntelligence();
      intelligence.startSession(sessionId);

      const ptyProcess = ptyManager.create(
        sessionId,
        agent.command as string,
        agentArgs,
        mergedEnv,
        workspace.worktree_path as string,
        input.cols,
        input.rows,
      );

      ptyManager.onOutput(sessionId, (sid, data) => {
        intelligence.feedData(sid, data);
        const win = getMainWindow();
        if (win && !win.isDestroyed()) {
          win.webContents.send('session-output', { sessionId: sid, data });
        }
      });

      ptyManager.onExit(sessionId, (sid, exitCode) => {
        ptyManager.removeOutput(sid);
        ptyManager.removeExit(sid);
        intelligence.handleExit(sid, exitCode);
        const status = exitCode === 0 ? 'stopped' : 'error';
        // M7-04: exit code를 DB에 저장
        db.prepare('UPDATE sessions SET status = ?, pid = NULL, last_exit_code = ? WHERE id = ?').run(status, exitCode ?? null, sid);
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
      });

      db.prepare('UPDATE sessions SET status = ?, pid = ? WHERE id = ?').run('running', ptyProcess.pid, sessionId);

      // 초기 커맨드가 있으면 전송
      if (preset.initial_command.trim()) {
        setTimeout(() => {
          try {
            ptyManager.write(sessionId, preset.initial_command + '\r');
          } catch { /* 무시 */ }
        }, 500);
      }

      return rowToSession(
        db.prepare('SELECT * FROM sessions WHERE id = ?').get(sessionId) as SessionRow
      );
    }),
});

// ── templateRouter (M5-01) ──────────────────────────────────────────────────

interface TemplateRow {
  id: string;
  name: string;
  description: string;
  agent_type: string;
  env_vars: string;
  setup_script: string;
  teardown_script: string;
  branch_pattern: string;
  created_at: string;
}

function rowToTemplate(row: TemplateRow) {
  return {
    id: row.id,
    name: row.name,
    description: row.description,
    agentType: row.agent_type,
    envVars: JSON.parse(row.env_vars) as Record<string, string>,
    setupScript: row.setup_script,
    teardownScript: row.teardown_script,
    branchPattern: row.branch_pattern,
    createdAt: row.created_at,
  };
}

export const templateRouter = router({
  list: publicProcedure.query(() => {
    const db = getDatabaseManager().getDb();
    return (db
      .prepare('SELECT * FROM workspace_templates ORDER BY created_at DESC')
      .all() as TemplateRow[])
      .map(rowToTemplate);
  }),

  create: publicProcedure
    .input(z.object({
      name: z.string().min(1),
      description: z.string().default(''),
      agentType: z.string().default(''),
      envVars: z.record(z.string(), z.string()).default({}),
      setupScript: z.string().default(''),
      teardownScript: z.string().default(''),
      branchPattern: z.string().default(''),
    }))
    .mutation(({ input }) => {
      const db = getDatabaseManager().getDb();
      const id = uuidv4();
      db.prepare(
        `INSERT INTO workspace_templates (id, name, description, agent_type, env_vars, setup_script, teardown_script, branch_pattern)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(id, input.name, input.description, input.agentType, JSON.stringify(input.envVars), input.setupScript, input.teardownScript, input.branchPattern);
      return rowToTemplate(
        db.prepare('SELECT * FROM workspace_templates WHERE id = ?').get(id) as TemplateRow
      );
    }),

  delete: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(({ input }) => {
      const db = getDatabaseManager().getDb();
      db.prepare('DELETE FROM workspace_templates WHERE id = ?').run(input.id);
    }),

  applyToWorkspace: publicProcedure
    .input(z.object({ templateId: z.string(), workspaceId: z.string() }))
    .mutation(({ input }) => {
      const db = getDatabaseManager().getDb();
      const tpl = db.prepare('SELECT * FROM workspace_templates WHERE id = ?').get(input.templateId) as TemplateRow | undefined;
      if (!tpl) throw new Error(`Template ${input.templateId} not found`);

      const workspace = db
        .prepare('SELECT * FROM workspaces WHERE id = ?')
        .get(input.workspaceId) as Record<string, unknown> | undefined;
      if (!workspace) throw new Error(`Workspace ${input.workspaceId} not found`);

      const repoId = workspace.repository_id as string;

      // 템플릿 env_vars를 repo의 env_vars에 병합
      const tplEnvVars = JSON.parse(tpl.env_vars) as Record<string, string>;
      const insertEnv = db.prepare(
        `INSERT INTO env_vars (id, repository_id, key, value)
         VALUES (?, ?, ?, ?)
         ON CONFLICT(repository_id, key) DO UPDATE SET value = excluded.value`
      );
      for (const [key, value] of Object.entries(tplEnvVars)) {
        insertEnv.run(uuidv4(), repoId, key, value);
      }

      // 템플릿의 setup/teardown script를 repo에 적용 (비어있지 않으면)
      if (tpl.setup_script) {
        db.prepare('UPDATE repositories SET setup_script = ? WHERE id = ?').run(tpl.setup_script, repoId);
      }
      if (tpl.teardown_script) {
        db.prepare('UPDATE repositories SET teardown_script = ? WHERE id = ?').run(tpl.teardown_script, repoId);
      }

      // 템플릿의 branch_pattern을 repo의 branch_prefix에 적용
      if (tpl.branch_pattern) {
        db.prepare('UPDATE repositories SET branch_prefix = ? WHERE id = ?').run(tpl.branch_pattern, repoId);
      }

      return { success: true };
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
        scriptPath: z.string().nullable().optional(),
        scriptContent: z.string().nullable().optional(),
      })
    )
    .mutation(({ input }) => {
      const db = getDatabaseManager().getDb();
      const id = uuidv4();
      db.prepare(
        `INSERT INTO agents (id, name, command, args, env, is_built_in, script_path, script_content) VALUES (?, ?, ?, ?, ?, 0, ?, ?)`
      ).run(
        id,
        input.name,
        input.command,
        JSON.stringify(input.args),
        JSON.stringify(input.env),
        input.scriptPath ?? null,
        input.scriptContent ?? null,
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
        scriptPath: z.string().nullable().optional(),
        scriptContent: z.string().nullable().optional(),
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
        `UPDATE agents SET name = ?, command = ?, args = ?, env = ?, script_path = ?, script_content = ? WHERE id = ?`
      ).run(
        input.name,
        input.command,
        JSON.stringify(input.args),
        JSON.stringify(input.env),
        input.scriptPath ?? null,
        input.scriptContent ?? null,
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

  // ── F-M1-01: Commit History ─────────────────────────────────────────────────

  getHistory: publicProcedure
    .input(z.object({
      repoPath: z.string().min(1),
      limit: z.number().int().positive().max(200).default(50),
    }))
    .query(async ({ input }) => {
      return getGitService().getHistory(input.repoPath, input.limit);
    }),

  showCommit: publicProcedure
    .input(z.object({
      repoPath: z.string().min(1),
      commitHash: z.string().min(1),
    }))
    .query(async ({ input }) => {
      const raw = await getGitService().showCommit(input.repoPath, input.commitHash);
      return { raw, hunks: parseUnifiedDiff(raw) };
    }),

  // ── F-M1-02: Stash Management ──────────────────────────────────────────────

  stashList: publicProcedure
    .input(z.object({ repoPath: z.string().min(1) }))
    .query(async ({ input }) => {
      return getGitService().stashList(input.repoPath);
    }),

  stashPush: publicProcedure
    .input(z.object({
      repoPath: z.string().min(1),
      message: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      return getGitService().stashPush(input.repoPath, input.message);
    }),

  stashPop: publicProcedure
    .input(z.object({
      repoPath: z.string().min(1),
      index: z.number().int().min(0).default(0),
    }))
    .mutation(async ({ input }) => {
      return getGitService().stashPop(input.repoPath, input.index);
    }),

  stashDrop: publicProcedure
    .input(z.object({
      repoPath: z.string().min(1),
      index: z.number().int().min(0).default(0),
    }))
    .mutation(async ({ input }) => {
      return getGitService().stashDrop(input.repoPath, input.index);
    }),

  // ── F-M1-03: Fetch & Remote Branch Tracking ────────────────────────────────

  fetch: publicProcedure
    .input(z.object({ repoPath: z.string().min(1) }))
    .mutation(async ({ input }) => {
      await getGitService().fetchAll(input.repoPath);
      return { success: true };
    }),

  getBranchStatus: publicProcedure
    .input(z.object({ repoPath: z.string().min(1) }))
    .query(async ({ input }) => {
      return getGitService().getBranchStatus(input.repoPath);
    }),

  // ── F-M1-04: Git Reset & Revert ────────────────────────────────────────────

  reset: publicProcedure
    .input(z.object({
      repoPath: z.string().min(1),
      commitHash: z.string().min(1),
      mode: z.enum(['soft', 'mixed', 'hard']),
    }))
    .mutation(async ({ input }) => {
      return getGitService().reset(input.repoPath, input.commitHash, input.mode);
    }),

  revert: publicProcedure
    .input(z.object({
      repoPath: z.string().min(1),
      commitHash: z.string().min(1),
    }))
    .mutation(async ({ input }) => {
      return getGitService().revert(input.repoPath, input.commitHash);
    }),

  discardAll: publicProcedure
    .input(z.object({ repoPath: z.string().min(1) }))
    .mutation(async ({ input }) => {
      return getGitService().discardAll(input.repoPath);
    }),

  // ── F-M1-05: Blame ─────────────────────────────────────────────────────────

  blame: publicProcedure
    .input(z.object({
      repoPath: z.string().min(1),
      filePath: z.string().min(1),
    }))
    .query(async ({ input }) => {
      return getGitService().blame(input.repoPath, input.filePath);
    }),

  // ── F-M1-06: Tag Management ────────────────────────────────────────────────

  listTags: publicProcedure
    .input(z.object({ repoPath: z.string().min(1) }))
    .query(async ({ input }) => {
      return getGitService().listTags(input.repoPath);
    }),

  createTag: publicProcedure
    .input(z.object({
      repoPath: z.string().min(1),
      name: z.string().min(1),
      message: z.string().optional(),
      annotated: z.boolean().default(true),
    }))
    .mutation(async ({ input }) => {
      return getGitService().createTag(input.repoPath, input.name, input.message, input.annotated);
    }),

  deleteTag: publicProcedure
    .input(z.object({
      repoPath: z.string().min(1),
      name: z.string().min(1),
    }))
    .mutation(async ({ input }) => {
      return getGitService().deleteTag(input.repoPath, input.name);
    }),

  pushTags: publicProcedure
    .input(z.object({ repoPath: z.string().min(1) }))
    .mutation(async ({ input }) => {
      return getGitService().pushTags(input.repoPath);
    }),

  // ── F-M1-07: Cherry-pick ──────────────────────────────────────────────────

  cherryPick: publicProcedure
    .input(z.object({
      repoPath: z.string().min(1),
      commitHash: z.string().min(1),
    }))
    .mutation(async ({ input }) => {
      return getGitService().cherryPick(input.repoPath, input.commitHash);
    }),

  cherryPickAbort: publicProcedure
    .input(z.object({ repoPath: z.string().min(1) }))
    .mutation(async ({ input }) => {
      return getGitService().cherryPickAbort(input.repoPath);
    }),

  // ── F-M1-08: Squash Commits ───────────────────────────────────────────────

  getRecentCommits: publicProcedure
    .input(z.object({
      repoPath: z.string().min(1),
      count: z.number().int().positive().max(50),
    }))
    .query(async ({ input }) => {
      return getGitService().getRecentCommits(input.repoPath, input.count);
    }),

  squashCommits: publicProcedure
    .input(z.object({
      repoPath: z.string().min(1),
      count: z.number().int().positive().max(50),
      message: z.string().min(1),
    }))
    .mutation(async ({ input }) => {
      return getGitService().squashCommits(input.repoPath, input.count, input.message);
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

  readFile: publicProcedure
    .input(z.object({ filePath: z.string().min(1) }))
    .query(({ input }) => {
      try {
        return { content: fs.readFileSync(input.filePath, 'utf-8'), exists: true };
      } catch {
        return { content: '', exists: false };
      }
    }),
});

// ── systemRouter (M7-04) ─────────────────────────────────────────────────────

export const systemRouter = router({
  openLogsFolder: publicProcedure.mutation(async () => {
    const { getLogsFolder } = await import('../services/error-logger');
    const logsDir = getLogsFolder();
    await shell.openPath(logsDir);
    return { path: logsDir };
  }),
});

// ── resourceRouter ────────────────────────────────────────────────────────────

export const resourceRouter = router({
  /** 세션별 프로세스 메트릭 실시간 구독 (5초 주기) */
  subscribe: publicProcedure
    .subscription(() => {
      const { getResourceMonitor } = require('../services/resource-monitor') as typeof import('../services/resource-monitor');
      return observable<import('../services/resource-monitor').ProcessMetrics[]>((emit) => {
        const unsub = getResourceMonitor().subscribe((metrics) => emit.next(metrics));
        return unsub;
      });
    }),

  /** 세션 PID 등록/해제 */
  register: publicProcedure
    .input(z.object({ sessionId: z.string(), pid: z.number().int().positive() }))
    .mutation(({ input }) => {
      const { getResourceMonitor } = require('../services/resource-monitor') as typeof import('../services/resource-monitor');
      getResourceMonitor().register(input.sessionId, input.pid);
    }),

  unregister: publicProcedure
    .input(z.object({ sessionId: z.string() }))
    .mutation(({ input }) => {
      const { getResourceMonitor } = require('../services/resource-monitor') as typeof import('../services/resource-monitor');
      getResourceMonitor().unregister(input.sessionId);
    }),
});

// ── fileRouter (M3-03: 마크다운 파일 워쳐) ──────────────────────────────────

export const fileRouter = router({
  watchMarkdown: publicProcedure
    .input(z.object({ filePath: z.string().min(1) }))
    .subscription(({ input }) => {
      return observable<{ content: string; exists: boolean }>((emit) => {
        // 초기 내용 전송
        try {
          const content = fs.readFileSync(input.filePath, 'utf-8');
          emit.next({ content, exists: true });
        } catch {
          emit.next({ content: '', exists: false });
        }

        // fs.watch로 파일 변경 감지
        let watcher: fs.FSWatcher | null = null;
        let debounceTimer: ReturnType<typeof setTimeout> | null = null;
        try {
          watcher = fs.watch(input.filePath, () => {
            // 150ms 디바운스
            if (debounceTimer) clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => {
              try {
                const content = fs.readFileSync(input.filePath, 'utf-8');
                emit.next({ content, exists: true });
              } catch {
                emit.next({ content: '', exists: false });
              }
            }, 150);
          });
        } catch {
          // 파일이 아직 존재하지 않을 수 있음 — 무시
        }

        return () => {
          if (debounceTimer) clearTimeout(debounceTimer);
          watcher?.close();
        };
      });
    }),

  readMarkdown: publicProcedure
    .input(z.object({ filePath: z.string().min(1) }))
    .query(({ input }) => {
      try {
        return { content: fs.readFileSync(input.filePath, 'utf-8'), exists: true };
      } catch {
        return { content: '', exists: false };
      }
    }),
});

// ── M6-02: webhookRouter ─────────────────────────────────────────────────────

interface WebhookRow {
  id: string;
  url: string;
  events: string;
  secret: string;
  enabled: number;
  created_at: string;
}

function rowToWebhook(row: WebhookRow) {
  return {
    id: row.id,
    url: row.url,
    events: JSON.parse(row.events) as string[],
    secret: row.secret,
    enabled: Boolean(row.enabled),
    createdAt: row.created_at,
  };
}

interface WebhookLogRow {
  id: string;
  webhook_id: string;
  event: string;
  status_code: number | null;
  response_body: string;
  created_at: string;
}

function rowToWebhookLog(row: WebhookLogRow) {
  return {
    id: row.id,
    webhookId: row.webhook_id,
    event: row.event,
    statusCode: row.status_code,
    responseBody: row.response_body,
    createdAt: row.created_at,
  };
}

/** 웹훅 발송 (재시도 포함) — fire-and-forget 방식으로 호출 */
async function dispatchWebhook(
  webhookId: string,
  url: string,
  secret: string,
  event: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const db = getDatabaseManager().getDb();
  const body = JSON.stringify({ event, ...payload, timestamp: new Date().toISOString() });

  const delays = [1000, 2000, 4000]; // 지수 백오프
  let statusCode: number | null = null;
  let responseBody = '';
  let success = false;

  for (let attempt = 0; attempt <= delays.length; attempt++) {
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (secret) {
        const hmac = require('crypto').createHmac('sha256', secret).update(body).digest('hex');
        headers['X-Maestro-Signature'] = hmac;
      }

      const res = await fetch(url, { method: 'POST', headers, body, signal: AbortSignal.timeout(10000) });
      statusCode = res.status;
      responseBody = await res.text().catch(() => '');
      if (res.ok) { success = true; break; }
    } catch (err) {
      responseBody = String(err);
    }

    if (attempt < delays.length) {
      await new Promise((r) => setTimeout(r, delays[attempt]));
    }
  }

  // 로그 기록
  const logId = uuidv4();
  db.prepare(
    `INSERT INTO webhook_logs (id, webhook_id, event, status_code, response_body) VALUES (?, ?, ?, ?, ?)`
  ).run(logId, webhookId, event, statusCode, responseBody.slice(0, 2000));
}

/** 등록된 모든 웹훅에 이벤트 발송 */
export function emitWebhookEvent(event: string, payload: Record<string, unknown>): void {
  try {
    const db = getDatabaseManager().getDb();
    const webhooks = db
      .prepare(`SELECT * FROM webhooks WHERE enabled = 1`)
      .all() as WebhookRow[];

    for (const wh of webhooks) {
      const events = JSON.parse(wh.events) as string[];
      if (events.includes(event)) {
        dispatchWebhook(wh.id, wh.url, wh.secret, event, payload).catch(() => {});
      }
    }
  } catch { /* 무시 */ }
}

export const webhookRouter = router({
  list: publicProcedure.query(() => {
    const db = getDatabaseManager().getDb();
    return (db.prepare('SELECT * FROM webhooks ORDER BY created_at DESC').all() as WebhookRow[])
      .map(rowToWebhook);
  }),

  create: publicProcedure
    .input(z.object({
      url: z.string().url(),
      events: z.array(z.enum(['session.completed', 'session.error', 'agent.task_done', 'session.started'])),
      secret: z.string().default(''),
    }))
    .mutation(({ input }) => {
      const db = getDatabaseManager().getDb();
      const id = uuidv4();
      db.prepare(
        `INSERT INTO webhooks (id, url, events, secret) VALUES (?, ?, ?, ?)`
      ).run(id, input.url, JSON.stringify(input.events), input.secret);
      return rowToWebhook(db.prepare('SELECT * FROM webhooks WHERE id = ?').get(id) as WebhookRow);
    }),

  update: publicProcedure
    .input(z.object({
      id: z.string(),
      url: z.string().url().optional(),
      events: z.array(z.enum(['session.completed', 'session.error', 'agent.task_done', 'session.started'])).optional(),
      secret: z.string().optional(),
      enabled: z.boolean().optional(),
    }))
    .mutation(({ input }) => {
      const db = getDatabaseManager().getDb();
      const fields: string[] = [];
      const values: unknown[] = [];
      if (input.url !== undefined) { fields.push('url = ?'); values.push(input.url); }
      if (input.events !== undefined) { fields.push('events = ?'); values.push(JSON.stringify(input.events)); }
      if (input.secret !== undefined) { fields.push('secret = ?'); values.push(input.secret); }
      if (input.enabled !== undefined) { fields.push('enabled = ?'); values.push(input.enabled ? 1 : 0); }
      if (fields.length > 0) {
        db.prepare(`UPDATE webhooks SET ${fields.join(', ')} WHERE id = ?`).run(...values, input.id);
      }
      const row = db.prepare('SELECT * FROM webhooks WHERE id = ?').get(input.id) as WebhookRow | undefined;
      if (!row) throw new Error(`Webhook ${input.id} not found`);
      return rowToWebhook(row);
    }),

  delete: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(({ input }) => {
      const db = getDatabaseManager().getDb();
      db.prepare('DELETE FROM webhook_logs WHERE webhook_id = ?').run(input.id);
      db.prepare('DELETE FROM webhooks WHERE id = ?').run(input.id);
    }),

  test: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input }) => {
      const db = getDatabaseManager().getDb();
      const wh = db.prepare('SELECT * FROM webhooks WHERE id = ?').get(input.id) as WebhookRow | undefined;
      if (!wh) throw new Error(`Webhook ${input.id} not found`);

      const body = JSON.stringify({ event: 'test', message: 'Webhook test from Maestro', timestamp: new Date().toISOString() });
      try {
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (wh.secret) {
          const hmac = require('crypto').createHmac('sha256', wh.secret).update(body).digest('hex');
          headers['X-Maestro-Signature'] = hmac;
        }
        const res = await fetch(wh.url, { method: 'POST', headers, body, signal: AbortSignal.timeout(10000) });
        const logId = uuidv4();
        const resBody = await res.text().catch(() => '');
        db.prepare(
          `INSERT INTO webhook_logs (id, webhook_id, event, status_code, response_body) VALUES (?, ?, ?, ?, ?)`
        ).run(logId, wh.id, 'test', res.status, resBody.slice(0, 2000));
        return { success: res.ok, statusCode: res.status };
      } catch (err) {
        const logId = uuidv4();
        db.prepare(
          `INSERT INTO webhook_logs (id, webhook_id, event, status_code, response_body) VALUES (?, ?, ?, ?, ?)`
        ).run(logId, wh.id, 'test', null, String(err).slice(0, 2000));
        return { success: false, statusCode: null };
      }
    }),

  getLogs: publicProcedure
    .input(z.object({ webhookId: z.string(), limit: z.number().int().positive().max(100).default(20) }))
    .query(({ input }) => {
      const db = getDatabaseManager().getDb();
      return (db.prepare('SELECT * FROM webhook_logs WHERE webhook_id = ? ORDER BY created_at DESC LIMIT ?')
        .all(input.webhookId, input.limit) as WebhookLogRow[])
        .map(rowToWebhookLog);
    }),
});

// ── M6-03: apiKeyRouter ──────────────────────────────────────────────────────

interface ApiKeyRow {
  id: string;
  key: string;
  name: string;
  created_at: string;
}

function rowToApiKey(row: ApiKeyRow) {
  return { id: row.id, key: row.key, name: row.name, createdAt: row.created_at };
}

export const apiKeyRouter = router({
  get: publicProcedure.query(() => {
    const db = getDatabaseManager().getDb();
    const row = db.prepare('SELECT * FROM api_keys ORDER BY created_at DESC LIMIT 1').get() as ApiKeyRow | undefined;
    return row ? rowToApiKey(row) : null;
  }),

  generate: publicProcedure
    .input(z.object({ name: z.string().default('Default') }))
    .mutation(({ input }) => {
      const db = getDatabaseManager().getDb();
      const id = uuidv4();
      const key = uuidv4();
      db.prepare('DELETE FROM api_keys').run(); // 기존 키 모두 제거 (단일 키 정책)
      db.prepare('INSERT INTO api_keys (id, key, name) VALUES (?, ?, ?)').run(id, key, input.name);
      return rowToApiKey(db.prepare('SELECT * FROM api_keys WHERE id = ?').get(id) as ApiKeyRow);
    }),

  revoke: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(({ input }) => {
      const db = getDatabaseManager().getDb();
      db.prepare('DELETE FROM api_keys WHERE id = ?').run(input.id);
    }),
});

// ── M6-05: relayRouter ───────────────────────────────────────────────────────

/** Relay 연결 상태를 메모리에서 관리 */
let relayState: { status: 'connected' | 'connecting' | 'disconnected'; latencyMs: number | null } = {
  status: 'disconnected',
  latencyMs: null,
};

export function getRelayState() {
  return relayState;
}

export const relayRouter = router({
  getStatus: publicProcedure.query(() => {
    return { status: relayState.status, latencyMs: relayState.latencyMs };
  }),

  connect: publicProcedure.mutation(() => {
    relayState = { status: 'connecting', latencyMs: null };
    // 시뮬레이션: 실제 relay 서버 연결 시 WebSocket 기반으로 대체
    setTimeout(() => {
      relayState = { status: 'connected', latencyMs: 15 };
      const win = getMainWindow();
      if (win && !win.isDestroyed()) {
        win.webContents.send('relay-status', relayState);
      }
    }, 500);
    return { success: true };
  }),

  disconnect: publicProcedure.mutation(() => {
    relayState = { status: 'disconnected', latencyMs: null };
    const win = getMainWindow();
    if (win && !win.isDestroyed()) {
      win.webContents.send('relay-status', relayState);
    }
    return { success: true };
  }),
});

// ── M10-01: pluginRouter ────────────────────────────────────────────────────

interface PluginRow {
  id: string;
  name: string;
  version: string;
  path: string;
  enabled: number;
  loaded_at: string;
}

function rowToPlugin(row: PluginRow) {
  return {
    id: row.id,
    name: row.name,
    version: row.version,
    path: row.path,
    enabled: Boolean(row.enabled),
    loadedAt: row.loaded_at,
  };
}

export const pluginRouter = router({
  list: publicProcedure.query(() => {
    const db = getDatabaseManager().getDb();
    return (db.prepare('SELECT * FROM plugins ORDER BY loaded_at DESC').all() as PluginRow[]).map(rowToPlugin);
  }),

  load: publicProcedure
    .input(z.object({ pluginPath: z.string().min(1) }))
    .mutation(({ input }) => {
      const manifestPath = path.join(input.pluginPath, 'maestro-plugin.json');
      if (!fs.existsSync(manifestPath)) {
        throw new Error(`No maestro-plugin.json found at ${input.pluginPath}`);
      }

      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
      if (!manifest.name || !manifest.version || !manifest.entry) {
        throw new Error('Invalid manifest: name, version, and entry are required');
      }

      const entryPath = path.join(input.pluginPath, manifest.entry);
      if (!fs.existsSync(entryPath)) {
        throw new Error(`Plugin entry file not found: ${entryPath}`);
      }

      const db = getDatabaseManager().getDb();
      const id = uuidv4();

      // 같은 경로의 플러그인이 이미 로드되어 있으면 교체
      db.prepare('DELETE FROM plugins WHERE path = ?').run(input.pluginPath);

      db.prepare('INSERT INTO plugins (id, name, version, path, enabled) VALUES (?, ?, ?, ?, 1)')
        .run(id, manifest.name, manifest.version, input.pluginPath);

      const row = db.prepare('SELECT * FROM plugins WHERE id = ?').get(id) as PluginRow;
      return rowToPlugin(row);
    }),

  unload: publicProcedure
    .input(z.object({ pluginId: z.string() }))
    .mutation(({ input }) => {
      const db = getDatabaseManager().getDb();
      db.prepare('DELETE FROM plugins WHERE id = ?').run(input.pluginId);
    }),
});

// ── M9-03: profileRouter ───────────────────────────────────────────────────

export const profileRouter = router({
  export: publicProcedure.mutation(async () => {
    const db = getDatabaseManager().getDb();

    // 에이전트 목록
    const agents = (db.prepare('SELECT * FROM agents WHERE is_built_in = 0').all() as Array<Record<string, unknown>>)
      .map(rowToAgent);

    // MCP 서버 목록
    const mcpServers = (db.prepare('SELECT * FROM mcp_servers').all() as McpServerRow[])
      .map((row) => ({ name: row.name, url: row.url, enabled: Boolean(row.enabled) }));

    const profile = {
      agents,
      mcpServers,
      // 나머지 설정은 렌더러가 localStorage에서 추출하여 전달할 수 없으므로
      // 기본값으로 내보냄 — 실제 설정은 렌더러에서 JSON에 merge
      theme: 'dark',
      accentColor: '#e07850',
      terminalTheme: 'default',
      terminalFont: 'Courier New',
      appThemeName: 'default',
    };

    const result = await dialog.showSaveDialog({
      title: 'Export Profile',
      defaultPath: '.maestro-profile.json',
      filters: [
        { name: 'Maestro Profile', extensions: ['json'] },
        { name: 'All Files', extensions: ['*'] },
      ],
    });

    if (result.canceled || !result.filePath) {
      return { success: false, filePath: '' };
    }

    fs.writeFileSync(result.filePath, JSON.stringify(profile, null, 2), 'utf-8');
    return { success: true, filePath: result.filePath };
  }),

  import: publicProcedure
    .input(z.object({ mode: z.enum(['merge', 'overwrite']) }))
    .mutation(async ({ input }) => {
      const result = await dialog.showOpenDialog({
        title: 'Import Profile',
        filters: [
          { name: 'Maestro Profile', extensions: ['json'] },
          { name: 'All Files', extensions: ['*'] },
        ],
        properties: ['openFile'],
      });

      if (result.canceled || result.filePaths.length === 0) {
        return { success: false };
      }

      const content = fs.readFileSync(result.filePaths[0], 'utf-8');
      const profile = JSON.parse(content);
      const db = getDatabaseManager().getDb();

      if (input.mode === 'overwrite') {
        // 기존 커스텀 에이전트 제거
        db.prepare('DELETE FROM agents WHERE is_built_in = 0').run();
        db.prepare('DELETE FROM mcp_servers').run();
      }

      // 에이전트 가져오기
      if (Array.isArray(profile.agents)) {
        const insertAgent = db.prepare(
          'INSERT OR IGNORE INTO agents (id, name, command, args, env, is_built_in) VALUES (?, ?, ?, ?, ?, 0)'
        );
        for (const agent of profile.agents) {
          insertAgent.run(
            agent.id ?? uuidv4(),
            agent.name,
            agent.command,
            JSON.stringify(agent.args ?? []),
            JSON.stringify(agent.env ?? {}),
          );
        }
      }

      // MCP 서버 가져오기
      if (Array.isArray(profile.mcpServers)) {
        const insertMcp = db.prepare(
          'INSERT OR IGNORE INTO mcp_servers (id, name, url, enabled) VALUES (?, ?, ?, ?)'
        );
        for (const server of profile.mcpServers) {
          insertMcp.run(uuidv4(), server.name, server.url, server.enabled ? 1 : 0);
        }
      }

      return { success: true };
    }),
});

// ── M10-03: themeRouter ────────────────────────────────────────────────────

export const themeRouter = router({
  export: publicProcedure
    .input(z.object({ name: z.string().min(1), variables: z.record(z.string(), z.string()) }))
    .mutation(async ({ input }) => {
      const themeData = {
        name: input.name,
        variables: input.variables,
      };

      const result = await dialog.showSaveDialog({
        title: 'Export Theme',
        defaultPath: `${input.name.replace(/[^a-zA-Z0-9_-]/g, '_')}.maestro-theme.json`,
        filters: [
          { name: 'Maestro Theme', extensions: ['json'] },
          { name: 'All Files', extensions: ['*'] },
        ],
      });

      if (result.canceled || !result.filePath) {
        return { success: false, filePath: '' };
      }

      fs.writeFileSync(result.filePath, JSON.stringify(themeData, null, 2), 'utf-8');
      return { success: true, filePath: result.filePath };
    }),

  import: publicProcedure.mutation(async () => {
    const result = await dialog.showOpenDialog({
      title: 'Import Theme',
      filters: [
        { name: 'Maestro Theme', extensions: ['json'] },
        { name: 'All Files', extensions: ['*'] },
      ],
      properties: ['openFile'],
    });

    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }

    const content = fs.readFileSync(result.filePaths[0], 'utf-8');
    const theme = JSON.parse(content);

    if (!theme.name || !theme.variables) {
      throw new Error('Invalid theme file: name and variables are required');
    }

    return { name: theme.name as string, variables: theme.variables as Record<string, string> };
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
  system: systemRouter,
  resource: resourceRouter,
  file: fileRouter,
  preset: presetRouter,
  template: templateRouter,
  webhook: webhookRouter,
  apiKey: apiKeyRouter,
  relay: relayRouter,
  plugin: pluginRouter,
  profile: profileRouter,
  theme: themeRouter,
});

export type AppRouter = typeof appRouter;

// 테스트에서 서버 사이드 caller 생성에 사용
export const createCaller = t.createCallerFactory(appRouter);
