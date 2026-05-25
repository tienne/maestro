/**
 * tRPC Router — Electron Main Process
 *
 * 기존 ipcMain.handle 핸들러들을 tRPC procedure로 포팅한 구현체.
 * packages/shared-types/src/trpc.ts 의 타입 정의와 1:1 대응.
 */

import { initTRPC } from '@trpc/server';
import { observable } from '@trpc/server/observable';
import { z } from 'zod';
import superjson from 'superjson';
import { v4 as uuidv4 } from 'uuid';
import * as fs from 'fs';
import * as path from 'path';
import * as net from 'net';
import { exec as execCb, execSync } from 'child_process';
import { promisify } from 'util';
import { dialog, shell, BrowserWindow } from 'electron';
import { getDatabaseManager } from '../db/database';
import * as schema from '../db/schema';
import { eq, asc, desc, and, inArray, sql as drizzleSql } from 'drizzle-orm';
import { getGitService } from '../services/git';
import { getGitWatcher } from '../services/git-watcher';
import { getPtyManager } from '../services/pty-manager';
import { getListeningPorts } from '../services/port-scanner';
import { getSessionIntelligence } from '../services/session-intelligence';
import { getMainWindow } from '../main';
import { getServerPort, getAuthToken } from '../services/http-server';
import { createWrapper } from '../services/wrappers';
import type { WrapperHookConfig } from '../services/agent-wrapper';
import { selectAgentForTask } from '../services/orchestrator';
import { teamsWatcher } from '../services/teams-watcher';
import { attachSubagentHandler } from '../services/subagent-handler';
import { AppStateService } from '../services/app-state-service';
import type { AppState as LocalAppState } from '../services/app-state-service';
import type { Workspace, Agent, Repository, EnvVar, AppState, Project, ProjectTask } from '@maestro/shared-types';
import { simpleGit } from 'simple-git';

const execAsync = promisify(execCb);

// ── tRPC instance ─────────────────────────────────────────────────────────────

const t = initTRPC.create({ transformer: superjson });
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
  // drizzle ORM camelCase aliases
  workspaceId?: string;
  agentId?: string;
  createdAt?: string;
  isFavorite?: boolean | number;
  dependsOnSessionId?: string | null;
  contextSourceSessionId?: string | null;
  lastExitCode?: number | null;
}

function rowToSession(row: SessionRow) {
  return {
    id: row.id,
    name: row.name,
    workspaceId: row.workspaceId ?? row.workspace_id,
    agentId: row.agentId ?? row.agent_id,
    status: row.status as 'running' | 'stopped' | 'error' | 'pending' | 'blocked',
    pid: row.pid,
    createdAt: row.createdAt ?? row.created_at,
    isFavorite: Boolean(row.isFavorite ?? row.is_favorite),
    dependsOnSessionId: row.dependsOnSessionId ?? row.depends_on_session_id ?? null,
    contextSourceSessionId: row.contextSourceSessionId ?? row.context_source_session_id ?? null,
    lastExitCode: row.lastExitCode ?? row.last_exit_code ?? null,
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
    const drizzle = getDatabaseManager().drizzle;
    return drizzle
      .select()
      .from(schema.workspaces)
      .orderBy(asc(schema.workspaces.createdAt))
      .all()
      .map((r) => rowToWorkspace(r as Record<string, unknown>));
  }),

  create: publicProcedure
    .input(z.object({ name: z.string().min(1), repositoryId: z.string() }))
    .mutation(async ({ input }) => {
      const drizzle = getDatabaseManager().drizzle;
      const git = getGitService();
      const { name, repositoryId } = input;

      const [repo] = drizzle
        .select()
        .from(schema.repositories)
        .where(eq(schema.repositories.id, repositoryId))
        .all();
      if (!repo) throw new Error(`Repository ${repositoryId} not found`);

      const repoPath = repo.path;
      const branchPrefix = repo.branchPrefix || '';
      const worktreeBase = repo.worktreeBasePath || path.join(repoPath, '..', 'worktrees');
      const branch = `${branchPrefix}${name.toLowerCase().replace(/\s+/g, '-')}`;
      const worktreePath = path.join(worktreeBase, name);
      const id = uuidv4();

      // worktree 생성 (브랜치 존재 여부 자동 감지, 실패 시 내부 cleanup 포함)
      await git.addWorktree(repoPath, worktreePath, branch);

      // setup_script 실행 — worktreePath 기준 async
      const setupScript = repo.setupScript;
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
      drizzle.insert(schema.workspaces).values({
        id, name, repositoryId, branch, worktreePath,
      }).run();

      // INSERT 성공 여부 검증 — 실패 시 worktree 롤백
      const [inserted] = drizzle
        .select()
        .from(schema.workspaces)
        .where(eq(schema.workspaces.id, id))
        .all();

      if (!inserted) {
        await git.removeWorktree(repoPath, worktreePath);
        throw new Error('Failed to insert workspace record');
      }

      return rowToWorkspace(inserted as Record<string, unknown>);
    }),

  delete: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input }) => {
      const drizzle = getDatabaseManager().drizzle;
      const git = getGitService();
      const ptyManager = getPtyManager();

      const [workspace] = drizzle
        .select()
        .from(schema.workspaces)
        .where(eq(schema.workspaces.id, input.id))
        .all();
      if (!workspace) throw new Error(`Workspace ${input.id} not found`);

      const [repo] = drizzle
        .select()
        .from(schema.repositories)
        .where(eq(schema.repositories.id, workspace.repositoryId))
        .all();

      // 1. 활성 세션 PTY 강제 종료
      const sessions = drizzle
        .select()
        .from(schema.sessions)
        .where(eq(schema.sessions.workspaceId, input.id))
        .all();
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
      const teardownScript = repo?.teardownScript;
      if (teardownScript?.trim()) {
        try {
          execSync(teardownScript, { cwd: workspace.worktreePath, stdio: 'ignore' });
        } catch (err) {
          console.warn('teardown_script failed (ignored):', err);
        }
      }

      // 3. git worktree remove (async, prune 포함)
      if (repo?.path) {
        try {
          await git.removeWorktree(repo.path, workspace.worktreePath);
        } catch (err) {
          console.warn('removeWorktree failed (ignored):', err);
        }
      }

      // 4. DB 레코드 삭제 (sessions는 CASCADE로 같이 삭제)
      drizzle.delete(schema.workspaces).where(eq(schema.workspaces.id, input.id)).run();
    }),

  openInIde: publicProcedure
    .input(z.object({
      workspaceId: z.string(),
      ide: z.enum(['vscode', 'cursor', 'webstorm', 'zed']),
    }))
    .mutation(async ({ input }): Promise<{ success: boolean; message: string }> => {
      const drizzle = getDatabaseManager().drizzle;
      const [workspace] = drizzle
        .select()
        .from(schema.workspaces)
        .where(eq(schema.workspaces.id, input.workspaceId))
        .all();

      if (!workspace) {
        throw new Error(`Workspace ${input.workspaceId} not found`);
      }

      const worktreePath = workspace.worktreePath;
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
      const drizzle = getDatabaseManager().drizzle;
      const rawDb = getDatabaseManager().getDb();
      const [workspace] = drizzle
        .select()
        .from(schema.workspaces)
        .where(eq(schema.workspaces.id, input.workspaceId))
        .all();
      if (!workspace) throw new Error(`Workspace ${input.workspaceId} not found`);

      // 현재 env_vars 수집 (JOIN 쿼리 — raw SQL 유지)
      const envRows = rawDb
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
        const git = simpleGit(workspace.worktreePath);
        const log = await git.log({ maxCount: 1 });
        gitHead = log.latest?.hash ?? '';
      } catch { /* 무시 */ }

      // 레포의 setup_script 가져오기
      const [repoRow] = drizzle
        .select({ setupScript: schema.repositories.setupScript })
        .from(schema.repositories)
        .where(eq(schema.repositories.id, workspace.repositoryId))
        .all();

      const id = uuidv4();
      drizzle.insert(schema.workspaceSnapshots).values({
        id,
        workspaceId: input.workspaceId,
        envVars: JSON.stringify(envVars),
        gitHead,
        setupScript: repoRow?.setupScript ?? '',
      }).run();

      // 오래된 스냅샷 정리 (최근 10개 유지 — raw SQL 유지, subquery)
      rawDb.prepare(
        `DELETE FROM workspace_snapshots WHERE workspace_id = ? AND id NOT IN (
          SELECT id FROM workspace_snapshots WHERE workspace_id = ? ORDER BY created_at DESC LIMIT 10
        )`
      ).run(input.workspaceId, input.workspaceId);

      const [row] = drizzle
        .select()
        .from(schema.workspaceSnapshots)
        .where(eq(schema.workspaceSnapshots.id, id))
        .all();
      return {
        id: row.id,
        workspaceId: row.workspaceId,
        envVars: JSON.parse(row.envVars) as Record<string, string>,
        gitHead: row.gitHead,
        setupScript: row.setupScript,
        createdAt: row.createdAt,
      };
    }),

  listSnapshots: publicProcedure
    .input(z.object({ workspaceId: z.string() }))
    .query(({ input }) => {
      const drizzle = getDatabaseManager().drizzle;
      const rows = drizzle
        .select()
        .from(schema.workspaceSnapshots)
        .where(eq(schema.workspaceSnapshots.workspaceId, input.workspaceId))
        .orderBy(desc(schema.workspaceSnapshots.createdAt))
        .limit(10)
        .all();
      return rows.map((row) => ({
        id: row.id,
        workspaceId: row.workspaceId,
        envVars: JSON.parse(row.envVars) as Record<string, string>,
        gitHead: row.gitHead,
        setupScript: row.setupScript,
        createdAt: row.createdAt,
      }));
    }),

  restoreSnapshot: publicProcedure
    .input(z.object({ snapshotId: z.string() }))
    .mutation(async ({ input }) => {
      const drizzle = getDatabaseManager().drizzle;
      const [snap] = drizzle
        .select()
        .from(schema.workspaceSnapshots)
        .where(eq(schema.workspaceSnapshots.id, input.snapshotId))
        .all();
      if (!snap) throw new Error(`Snapshot ${input.snapshotId} not found`);

      const [workspace] = drizzle
        .select()
        .from(schema.workspaces)
        .where(eq(schema.workspaces.id, snap.workspaceId))
        .all();
      if (!workspace) throw new Error(`Workspace ${snap.workspaceId} not found`);

      const repoId = workspace.repositoryId;
      const envVars = JSON.parse(snap.envVars) as Record<string, string>;

      // 기존 env_vars 삭제 후 스냅샷 것으로 교체
      drizzle.delete(schema.envVars).where(eq(schema.envVars.repositoryId, repoId)).run();
      for (const [key, value] of Object.entries(envVars)) {
        drizzle.insert(schema.envVars).values({
          id: uuidv4(),
          repositoryId: repoId,
          key,
          value,
        }).run();
      }

      // git HEAD 복원 (soft reset)
      if (snap.gitHead) {
        try {
          const git = simpleGit(workspace.worktreePath);
          await git.reset(['--soft', snap.gitHead]);
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
      const drizzle = getDatabaseManager().drizzle;
      const updates: Partial<schema.Workspace> = {};
      if (input.hookOnSessionStart !== undefined) updates.hookOnSessionStart = input.hookOnSessionStart;
      if (input.hookOnAgentComplete !== undefined) updates.hookOnAgentComplete = input.hookOnAgentComplete;
      if (input.hookOnError !== undefined) updates.hookOnError = input.hookOnError;
      if (Object.keys(updates).length > 0) {
        drizzle.update(schema.workspaces).set(updates).where(eq(schema.workspaces.id, input.workspaceId)).run();
      }
      const [row] = drizzle
        .select()
        .from(schema.workspaces)
        .where(eq(schema.workspaces.id, input.workspaceId))
        .all();
      if (!row) throw new Error(`Workspace ${input.workspaceId} not found`);
      return {
        ...rowToWorkspace(row as Record<string, unknown>),
        hookOnSessionStart: row.hookOnSessionStart ?? '',
        hookOnAgentComplete: row.hookOnAgentComplete ?? '',
        hookOnError: row.hookOnError ?? '',
      };
    }),

  getHooks: publicProcedure
    .input(z.object({ workspaceId: z.string() }))
    .query(({ input }) => {
      const drizzle = getDatabaseManager().drizzle;
      const [row] = drizzle
        .select({
          hookOnSessionStart: schema.workspaces.hookOnSessionStart,
          hookOnAgentComplete: schema.workspaces.hookOnAgentComplete,
          hookOnError: schema.workspaces.hookOnError,
        })
        .from(schema.workspaces)
        .where(eq(schema.workspaces.id, input.workspaceId))
        .all();
      if (!row) throw new Error(`Workspace ${input.workspaceId} not found`);
      return {
        hookOnSessionStart: row.hookOnSessionStart ?? '',
        hookOnAgentComplete: row.hookOnAgentComplete ?? '',
        hookOnError: row.hookOnError ?? '',
      };
    }),

  // ── M5-04: Env Sync ────────────────────────────────────────────────────

  notifyEnvChange: publicProcedure
    .input(z.object({ repositoryId: z.string() }))
    .mutation(({ input }) => {
      // JOIN 쿼리 — raw SQL 유지
      const rawDb = getDatabaseManager().getDb();
      const sessions = rawDb
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
      const drizzle = getDatabaseManager().drizzle;
      const rawDb = getDatabaseManager().getDb();
      const ptyManager = getPtyManager();

      if (!ptyManager.isAlive(input.sessionId)) {
        throw new Error(`Session ${input.sessionId} is not running`);
      }

      const [session] = drizzle
        .select()
        .from(schema.sessions)
        .where(eq(schema.sessions.id, input.sessionId))
        .all();
      if (!session) throw new Error(`Session ${input.sessionId} not found`);

      // 최신 env_vars 조회 (JOIN 쿼리 — raw SQL 유지)
      const envRows = rawDb
        .prepare(
          `SELECT ev.key, ev.value FROM env_vars ev
           JOIN workspaces w ON w.repository_id = ev.repository_id
           WHERE w.id = ?`
        )
        .all(session.workspaceId) as Array<{ key: string; value: string }>;

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
      const drizzle = getDatabaseManager().drizzle;
      return drizzle
        .select()
        .from(schema.sessions)
        .where(eq(schema.sessions.workspaceId, input.workspaceId))
        .orderBy(desc(schema.sessions.createdAt))
        .all()
        .map((r) => rowToSession(r as unknown as SessionRow));
    }),

  listAll: publicProcedure.query(() => {
    const drizzle = getDatabaseManager().drizzle;
    return drizzle
      .select()
      .from(schema.sessions)
      .orderBy(desc(schema.sessions.createdAt))
      .all()
      .map((r) => rowToSession(r as unknown as SessionRow));
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
      const drizzle = getDatabaseManager().drizzle;
      const { name, workspaceId, agentId } = input;

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
      // M4-01: 의존성이 있고 선행 세션이 아직 완료되지 않았으면 'pending' 대신 'blocked'
      const hasDeps = Boolean(input.dependsOnSessionId);
      let initialStatus: 'pending' | 'blocked' = 'pending';
      if (hasDeps) {
        const [dep] = drizzle
          .select({ status: schema.sessions.status })
          .from(schema.sessions)
          .where(eq(schema.sessions.id, input.dependsOnSessionId!))
          .all();
        if (dep && dep.status !== 'stopped') {
          initialStatus = 'blocked';
        }
      }

      drizzle.insert(schema.sessions).values({
        id,
        name,
        workspaceId,
        agentId,
        status: initialStatus,
        pid: null,
        dependsOnSessionId: input.dependsOnSessionId ?? null,
        contextSourceSessionId: input.contextSourceSessionId ?? null,
      }).run();

      const [inserted] = drizzle
        .select()
        .from(schema.sessions)
        .where(eq(schema.sessions.id, id))
        .all();
      return rowToSession(inserted as unknown as SessionRow);
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
      const drizzle = getDatabaseManager().drizzle;
      const rawDb = getDatabaseManager().getDb();
      const ptyManager = getPtyManager();
      const { sessionId, cols, rows } = input;

      const [session] = drizzle
        .select()
        .from(schema.sessions)
        .where(eq(schema.sessions.id, sessionId))
        .all();
      if (!session) throw new Error(`Session ${sessionId} not found`);

      // 이미 launch된 세션에 중복 요청이 오면 무시 (Strict Mode 이중 호출 방어)
      if (session.status !== 'pending') {
        return rowToSession(session as unknown as SessionRow);
      }

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

      // JOIN 쿼리 — raw SQL 유지
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

      // 에이전트 타입을 agent.name 기준으로 결정 (built-in 에이전트의 경우)
      const agentName = agent.name.toLowerCase();
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
      const [wsHooksRow] = drizzle
        .select({
          hookOnSessionStart: schema.workspaces.hookOnSessionStart,
          hookOnAgentComplete: schema.workspaces.hookOnAgentComplete,
          hookOnError: schema.workspaces.hookOnError,
        })
        .from(schema.workspaces)
        .where(eq(schema.workspaces.id, session.workspaceId))
        .all();
      const wsHooks = wsHooksRow ? {
        hook_on_session_start: wsHooksRow.hookOnSessionStart,
        hook_on_agent_complete: wsHooksRow.hookOnAgentComplete,
        hook_on_error: wsHooksRow.hookOnError,
      } : undefined;

      const ptyProcess = ptyManager.create(
        sessionId,
        agent.command,
        agentArgs,
        mergedEnv,
        workspace.worktreePath,
        cols,
        rows
      );

      // M5-03: onSessionStart 훅 실행
      if (wsHooks?.hook_on_session_start?.trim()) {
        execAsync(wsHooks.hook_on_session_start, { cwd: workspace.worktreePath })
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

      // M11: Task 기반 세션인 경우 서브에이전트 spawn 핸들러 연결
      if (workspace.taskId) {
        const [taskRow] = drizzle
          .select({ projectId: schema.tasks.projectId })
          .from(schema.tasks)
          .where(eq(schema.tasks.id, workspace.taskId))
          .all();
        if (taskRow) {
          attachSubagentHandler(sessionId, workspace.taskId, taskRow.projectId);
        }
      }

      ptyManager.onOutput(sessionId, (sid, data) => {
        // Teams: 서브에이전트 spawn 감지
        teamsWatcher.processOutput(sid, data);

        // M3: PTY 출력을 인텔리전스 매니저에 전달
        intelligence.feedData(sid, data);

        // M5-03: onError 훅 — 에러 패턴 감지 시 실행
        if (wsHooks?.hook_on_error?.trim()) {
          const errorPatterns = ['Error:', 'error:', 'FATAL', 'panic:', 'Traceback'];
          if (errorPatterns.some((p) => data.includes(p))) {
            execAsync(wsHooks.hook_on_error, { cwd: workspace.worktreePath })
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

        // Teams: 세션 종료 시 감지 해제
        teamsWatcher.detachFromSession(sid);

        // M3: 완료 감지
        intelligence.handleExit(sid, exitCode);
        const status = exitCode === 0 ? 'stopped' : 'error';
        // M7-04: exit code를 DB에 저장
        drizzle.update(schema.sessions)
          .set({ status, pid: null, lastExitCode: exitCode ?? null })
          .where(eq(schema.sessions.id, sid))
          .run();

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
          execAsync(wsHooks.hook_on_agent_complete, { cwd: workspace.worktreePath })
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
          drizzle.insert(schema.sessionScrollbacks)
            .values({ sessionId: sid, data: scrollback })
            .onConflictDoUpdate({
              target: schema.sessionScrollbacks.sessionId,
              set: { data: scrollback },
            })
            .run();
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
        const dependents = drizzle
          .select()
          .from(schema.sessions)
          .where(eq(schema.sessions.dependsOnSessionId, sid))
          .all();
        for (const dep of dependents) {
          if (exitCode === 0) {
            // 선행 세션 성공 → 의존 세션을 pending으로 변경 (XTerminal onReady → launch 흐름)
            drizzle.update(schema.sessions).set({ status: 'pending' }).where(eq(schema.sessions.id, dep.id)).run();
            if (win && !win.isDestroyed()) {
              win.webContents.send('session-status', { sessionId: dep.id, status: 'pending' });
            }
          } else {
            // 선행 세션 실패 → blocked
            drizzle.update(schema.sessions).set({ status: 'blocked' }).where(eq(schema.sessions.id, dep.id)).run();
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

      drizzle.update(schema.sessions)
        .set({ status: 'running', pid: ptyProcess.pid as number })
        .where(eq(schema.sessions.id, sessionId))
        .run();

      // M6-02: 세션 시작 웹훅 이벤트 발송
      emitWebhookEvent('session.started', { sessionId });

      // M4-02: 컨텍스트 소스 세션이 있으면 출력을 stdin에 주입
      if (session.contextSourceSessionId) {
        const srcScrollback = ptyManager.getScrollback(session.contextSourceSessionId);
        let contextData = srcScrollback;
        if (!contextData) {
          const [srcRow] = drizzle
            .select({ data: schema.sessionScrollbacks.data })
            .from(schema.sessionScrollbacks)
            .where(eq(schema.sessionScrollbacks.sessionId, session.contextSourceSessionId))
            .all();
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

      void AppStateService.getInstance().set({ lastSessionId: sessionId });

      const [finalSession] = drizzle
        .select()
        .from(schema.sessions)
        .where(eq(schema.sessions.id, sessionId))
        .all();
      return rowToSession(finalSession as unknown as SessionRow);
    }),

  stop: publicProcedure
    .input(z.object({ sessionId: z.string() }))
    .mutation(async ({ input }) => {
      const drizzle = getDatabaseManager().drizzle;
      const ptyManager = getPtyManager();
      const { sessionId } = input;

      // 세션에 연결된 에이전트 정보 조회 (wrapper 훅 제거용)
      const [session] = drizzle
        .select()
        .from(schema.sessions)
        .where(eq(schema.sessions.id, sessionId))
        .all();

      if (ptyManager.isAlive(sessionId)) {
        ptyManager.kill(sessionId);
      }
      drizzle.update(schema.sessions)
        .set({ status: 'stopped', pid: null })
        .where(eq(schema.sessions.id, sessionId))
        .run();

      // wrapper 훅 제거 (세션 정보가 있을 때만)
      if (session) {
        const [agent] = drizzle
          .select()
          .from(schema.agents)
          .where(eq(schema.agents.id, session.agentId))
          .all();

        if (agent) {
          const agentName = agent.name.toLowerCase();
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
      const drizzle = getDatabaseManager().drizzle;
      const ptyManager = getPtyManager();
      const { sessionId } = input;
      if (ptyManager.isAlive(sessionId)) {
        ptyManager.kill(sessionId);
      }
      drizzle.delete(schema.sessions).where(eq(schema.sessions.id, sessionId)).run();
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
    const lastId = AppStateService.getInstance().get().lastSessionId;
    if (!lastId) return null;

    const drizzle = getDatabaseManager().drizzle;
    const [session] = drizzle
      .select()
      .from(schema.sessions)
      .where(eq(schema.sessions.id, lastId))
      .all();

    return session ? rowToSession(session as unknown as SessionRow) : null;
  }),

  setLastActive: publicProcedure
    .input(z.object({ sessionId: z.string() }))
    .mutation(async ({ input }) => {
      await AppStateService.getInstance().set({ lastSessionId: input.sessionId });
    }),

  resume: publicProcedure
    .input(z.object({ sessionId: z.string(), restart: z.boolean().optional() }))
    .mutation(({ input }) => {
      const drizzle = getDatabaseManager().drizzle;
      const ptyManager = getPtyManager();
      const { sessionId, restart } = input;

      const [session] = drizzle
        .select()
        .from(schema.sessions)
        .where(eq(schema.sessions.id, sessionId))
        .all();
      if (!session) throw new Error(`Session ${sessionId} not found`);

      if (ptyManager.isAlive(sessionId)) {
        ptyManager.onOutput(sessionId, (sid, data) => {
          // Teams: 서브에이전트 spawn 감지 (resume 시에도 유지)
          teamsWatcher.processOutput(sid, data);

          const win = getMainWindow();
          if (win && !win.isDestroyed()) {
            win.webContents.send('session-output', { sessionId: sid, data });
          }
        });
      }

      // restart=true: PTY가 없는 상태에서 재시작 — 'pending'으로 리셋해
      // XTerminal의 onReady → session.launch 흐름을 다시 타게 한다.
      if (restart && !ptyManager.isAlive(sessionId)) {
        drizzle.update(schema.sessions)
          .set({ status: 'pending', pid: null })
          .where(eq(schema.sessions.id, sessionId))
          .run();
      }

      void AppStateService.getInstance().set({ lastSessionId: sessionId });

      const [updated] = drizzle
        .select()
        .from(schema.sessions)
        .where(eq(schema.sessions.id, sessionId))
        .all();
      return rowToSession(updated as unknown as SessionRow);
    }),

  updateStatus: publicProcedure
    .input(z.object({ sessionId: z.string(), status: z.string() }))
    .mutation(({ input }) => {
      const drizzle = getDatabaseManager().drizzle;
      drizzle.update(schema.sessions)
        .set({ status: input.status })
        .where(eq(schema.sessions.id, input.sessionId))
        .run();
    }),

  getPorts: publicProcedure
    .input(z.object({ sessionId: z.string() }))
    .query(async ({ input }) => {
      const drizzle = getDatabaseManager().drizzle;
      const [session] = drizzle
        .select()
        .from(schema.sessions)
        .where(eq(schema.sessions.id, input.sessionId))
        .all();

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
      const drizzle = getDatabaseManager().drizzle;
      // 먼저 메모리 버퍼에서 확인 (현재 세션이 실행 중이면 최신 버퍼 반환)
      const live = getPtyManager().getScrollback(input.sessionId);
      if (live) return live;

      // 메모리에 없으면 DB에서 조회 (이전에 종료된 세션)
      const [row] = drizzle
        .select({ data: schema.sessionScrollbacks.data })
        .from(schema.sessionScrollbacks)
        .where(eq(schema.sessionScrollbacks.sessionId, input.sessionId))
        .all();
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
      const drizzle = getDatabaseManager().drizzle;
      drizzle.insert(schema.promptHistory).values({
        id: uuidv4(),
        sessionId: input.sessionId,
        text: input.text,
      }).run();
    }),

  getPromptHistory: publicProcedure
    .input(z.object({ sessionId: z.string(), limit: z.number().int().positive().max(100).default(50) }))
    .query(({ input }) => {
      const drizzle = getDatabaseManager().drizzle;
      const rows = drizzle
        .select({ id: schema.promptHistory.id, text: schema.promptHistory.text, createdAt: schema.promptHistory.createdAt })
        .from(schema.promptHistory)
        .where(eq(schema.promptHistory.sessionId, input.sessionId))
        .orderBy(desc(schema.promptHistory.createdAt))
        .limit(input.limit)
        .all();
      return rows.reverse(); // 오래된 것이 앞에 오도록
    }),

  // ── M2-03: 세션 이름 변경 ──────────────────────────────────────────────
  rename: publicProcedure
    .input(z.object({ sessionId: z.string(), name: z.string().min(1).max(30) }))
    .mutation(({ input }) => {
      const drizzle = getDatabaseManager().drizzle;
      drizzle.update(schema.sessions)
        .set({ name: input.name })
        .where(eq(schema.sessions.id, input.sessionId))
        .run();
      const [row] = drizzle.select().from(schema.sessions).where(eq(schema.sessions.id, input.sessionId)).all();
      if (!row) throw new Error(`Session ${input.sessionId} not found`);
      return rowToSession(row as unknown as SessionRow);
    }),

  // ── M2-06: 즐겨찾기 토글 ──────────────────────────────────────────────
  setFavorite: publicProcedure
    .input(z.object({ sessionId: z.string(), favorite: z.boolean() }))
    .mutation(({ input }) => {
      const drizzle = getDatabaseManager().drizzle;
      drizzle.update(schema.sessions)
        .set({ isFavorite: input.favorite })
        .where(eq(schema.sessions.id, input.sessionId))
        .run();
      const [row] = drizzle.select().from(schema.sessions).where(eq(schema.sessions.id, input.sessionId)).all();
      if (!row) throw new Error(`Session ${input.sessionId} not found`);
      return rowToSession(row as unknown as SessionRow);
    }),

  // ── M3-01: 세션 비용 조회 ─────────────────────────────────────────────
  getCost: publicProcedure
    .input(z.object({ sessionId: z.string() }))
    .query(({ input }) => {
      const intelligence = getSessionIntelligence();
      const state = intelligence.getState(input.sessionId);
      if (state) return state.costs;

      // 인메모리에 없으면 DB에서 합산
      const drizzle = getDatabaseManager().drizzle;
      const [row] = drizzle
        .select({
          inputTokens: drizzleSql<number>`COALESCE(SUM(${schema.sessionCosts.inputTokens}), 0)`,
          outputTokens: drizzleSql<number>`COALESCE(SUM(${schema.sessionCosts.outputTokens}), 0)`,
          costUsd: drizzleSql<number>`COALESCE(SUM(${schema.sessionCosts.costUsd}), 0)`,
        })
        .from(schema.sessionCosts)
        .where(eq(schema.sessionCosts.sessionId, input.sessionId))
        .all();

      return {
        sessionId: input.sessionId,
        totalInputTokens: row?.inputTokens ?? 0,
        totalOutputTokens: row?.outputTokens ?? 0,
        totalCostUsd: row?.costUsd ?? 0,
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
      const drizzle = getDatabaseManager().drizzle;
      drizzle.update(schema.sessions)
        .set({ dependsOnSessionId: input.dependsOnSessionId })
        .where(eq(schema.sessions.id, input.sessionId))
        .run();
      const [row] = drizzle.select().from(schema.sessions).where(eq(schema.sessions.id, input.sessionId)).all();
      if (!row) throw new Error(`Session ${input.sessionId} not found`);
      return rowToSession(row as unknown as SessionRow);
    }),

  // ── M4-02: 컨텍스트 소스 설정 ────────────────────────────────────────
  setContextSource: publicProcedure
    .input(z.object({ sessionId: z.string(), contextSourceSessionId: z.string().nullable() }))
    .mutation(({ input }) => {
      const drizzle = getDatabaseManager().drizzle;
      drizzle.update(schema.sessions)
        .set({ contextSourceSessionId: input.contextSourceSessionId })
        .where(eq(schema.sessions.id, input.sessionId))
        .run();
      const [row] = drizzle.select().from(schema.sessions).where(eq(schema.sessions.id, input.sessionId)).all();
      if (!row) throw new Error(`Session ${input.sessionId} not found`);
      return rowToSession(row as unknown as SessionRow);
    }),

  getContextOutput: publicProcedure
    .input(z.object({ sessionId: z.string(), lines: z.number().int().positive().max(200).default(100) }))
    .query(({ input }) => {
      const ptyManager = getPtyManager();
      const scrollback = ptyManager.getScrollback(input.sessionId);
      if (!scrollback) {
        const drizzle = getDatabaseManager().drizzle;
        const [row] = drizzle
          .select({ data: schema.sessionScrollbacks.data })
          .from(schema.sessionScrollbacks)
          .where(eq(schema.sessionScrollbacks.sessionId, input.sessionId))
          .all();
        const data = row?.data ?? '';
        const lines = data.split('\n').slice(-input.lines).join('\n');
        return lines.slice(0, 4000);
      }
      const lines = scrollback.split('\n').slice(-input.lines).join('\n');
      return lines.slice(0, 4000);
    }),

  // ── M4-03: 일괄 제어 ────────────────────────────────────────────────
  stopAll: publicProcedure.mutation(() => {
    const drizzle = getDatabaseManager().drizzle;
    const ptyManager = getPtyManager();
    const running = drizzle
      .select()
      .from(schema.sessions)
      .where(eq(schema.sessions.status, 'running'))
      .all();
    let stopped = 0;
    for (const row of running) {
      try {
        if (ptyManager.isAlive(row.id)) {
          ptyManager.kill(row.id);
        }
        drizzle.update(schema.sessions)
          .set({ status: 'stopped', pid: null })
          .where(eq(schema.sessions.id, row.id))
          .run();
        stopped++;
      } catch {
        // 개별 실패 무시
      }
    }
    return { stopped };
  }),

  restartAllErrors: publicProcedure.mutation(() => {
    const drizzle = getDatabaseManager().drizzle;
    const errored = drizzle
      .select()
      .from(schema.sessions)
      .where(eq(schema.sessions.status, 'error'))
      .all();
    let restarted = 0;
    for (const row of errored) {
      drizzle.update(schema.sessions)
        .set({ status: 'pending', pid: null })
        .where(eq(schema.sessions.id, row.id))
        .run();
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
      const drizzle = getDatabaseManager().drizzle;
      drizzle.insert(schema.sessionLabels)
        .values({ sessionId: input.sessionId, labelName: input.labelName, labelColor: input.labelColor })
        .onConflictDoUpdate({
          target: [schema.sessionLabels.sessionId, schema.sessionLabels.labelName],
          set: { labelColor: input.labelColor },
        })
        .run();
      return { sessionId: input.sessionId, labelName: input.labelName, labelColor: input.labelColor };
    }),

  removeLabel: publicProcedure
    .input(z.object({ sessionId: z.string(), labelName: z.string() }))
    .mutation(({ input }) => {
      const drizzle = getDatabaseManager().drizzle;
      drizzle.delete(schema.sessionLabels)
        .where(and(eq(schema.sessionLabels.sessionId, input.sessionId), eq(schema.sessionLabels.labelName, input.labelName)))
        .run();
    }),

  getLabels: publicProcedure
    .input(z.object({ sessionId: z.string() }))
    .query(({ input }) => {
      const drizzle = getDatabaseManager().drizzle;
      return drizzle
        .select()
        .from(schema.sessionLabels)
        .where(eq(schema.sessionLabels.sessionId, input.sessionId))
        .all()
        .map((row) => ({ sessionId: row.sessionId, labelName: row.labelName, labelColor: row.labelColor }));
    }),

  listByLabel: publicProcedure
    .input(z.object({ labelName: z.string() }))
    .query(({ input }) => {
      // JOIN 쿼리 — raw SQL 유지
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
      // datetime 비교는 raw SQL 유지 (drizzle의 sqlite datetime 함수 미지원)
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
        const drizzle = getDatabaseManager().drizzle;
        drizzle.update(schema.sessions)
          .set({ status: 'archived' })
          .where(inArray(schema.sessions.id, ids))
          .run();
      }
      return { archivedCount: ids.length, archivedIds: ids };
    }),

  archive: publicProcedure
    .input(z.object({ sessionId: z.string() }))
    .mutation(({ input }) => {
      const drizzle = getDatabaseManager().drizzle;
      drizzle.update(schema.sessions)
        .set({ status: 'archived' })
        .where(eq(schema.sessions.id, input.sessionId))
        .run();
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
      const drizzle = getDatabaseManager().drizzle;
      const [sessionRow] = drizzle.select().from(schema.sessions).where(eq(schema.sessions.id, input.sessionId)).all();
      if (!sessionRow) throw new Error(`Session ${input.sessionId} not found`);
      const session = sessionRow as unknown as SessionRow;

      // scrollback 데이터 추출
      const [scrollbackRow] = drizzle
        .select({ data: schema.sessionScrollbacks.data })
        .from(schema.sessionScrollbacks)
        .where(eq(schema.sessionScrollbacks.sessionId, input.sessionId))
        .all();
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
            const drizzle = getDatabaseManager().drizzle;
            const [sessionNameRow] = drizzle
              .select({ name: schema.sessions.name })
              .from(schema.sessions)
              .where(eq(schema.sessions.id, sessionId))
              .all();

            results.push({
              sessionId,
              sessionName: sessionNameRow?.name ?? sessionId,
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
    const drizzle = getDatabaseManager().drizzle;
    return drizzle
      .select()
      .from(schema.agentPresets)
      .orderBy(desc(schema.agentPresets.createdAt))
      .all()
      .map((row) => ({
        id: row.id,
        name: row.name,
        agentId: row.agentId,
        workspaceId: row.workspaceId,
        initialCommand: row.initialCommand,
        envVars: JSON.parse(row.envVars) as Record<string, string>,
        createdAt: row.createdAt,
      }));
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
      const drizzle = getDatabaseManager().drizzle;
      const id = uuidv4();
      drizzle.insert(schema.agentPresets).values({
        id,
        name: input.name,
        agentId: input.agentId,
        workspaceId: input.workspaceId,
        initialCommand: input.initialCommand,
        envVars: JSON.stringify(input.envVars),
      }).run();
      const [row] = drizzle.select().from(schema.agentPresets).where(eq(schema.agentPresets.id, id)).all();
      return {
        id: row.id,
        name: row.name,
        agentId: row.agentId,
        workspaceId: row.workspaceId,
        initialCommand: row.initialCommand,
        envVars: JSON.parse(row.envVars) as Record<string, string>,
        createdAt: row.createdAt,
      };
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
      const drizzle = getDatabaseManager().drizzle;
      const updateFields: Partial<typeof schema.agentPresets.$inferInsert> = {};
      if (input.name !== undefined) updateFields.name = input.name;
      if (input.agentId !== undefined) updateFields.agentId = input.agentId;
      if (input.workspaceId !== undefined) updateFields.workspaceId = input.workspaceId;
      if (input.initialCommand !== undefined) updateFields.initialCommand = input.initialCommand;
      if (input.envVars !== undefined) updateFields.envVars = JSON.stringify(input.envVars);
      if (Object.keys(updateFields).length > 0) {
        drizzle.update(schema.agentPresets).set(updateFields).where(eq(schema.agentPresets.id, input.id)).run();
      }
      const [row] = drizzle.select().from(schema.agentPresets).where(eq(schema.agentPresets.id, input.id)).all();
      return {
        id: row.id,
        name: row.name,
        agentId: row.agentId,
        workspaceId: row.workspaceId,
        initialCommand: row.initialCommand,
        envVars: JSON.parse(row.envVars) as Record<string, string>,
        createdAt: row.createdAt,
      };
    }),

  delete: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(({ input }) => {
      const drizzle = getDatabaseManager().drizzle;
      drizzle.delete(schema.agentPresets).where(eq(schema.agentPresets.id, input.id)).run();
    }),

  launch: publicProcedure
    .input(z.object({
      presetId: z.string(),
      cols: z.number().int().positive(),
      rows: z.number().int().positive(),
    }))
    .mutation(async ({ input }) => {
      const drizzle = getDatabaseManager().drizzle;
      const ptyManager = getPtyManager();
      const [presetRow] = drizzle.select().from(schema.agentPresets).where(eq(schema.agentPresets.id, input.presetId)).all();
      if (!presetRow) throw new Error(`Preset ${input.presetId} not found`);

      const [workspaceRow] = drizzle.select().from(schema.workspaces).where(eq(schema.workspaces.id, presetRow.workspaceId)).all();
      if (!workspaceRow) throw new Error(`Workspace ${presetRow.workspaceId} not found`);

      const [agentRow] = drizzle.select().from(schema.agents).where(eq(schema.agents.id, presetRow.agentId)).all();
      if (!agentRow) throw new Error(`Agent ${presetRow.agentId} not found`);

      // 세션 생성
      const sessionId = uuidv4();
      drizzle.insert(schema.sessions).values({
        id: sessionId,
        name: presetRow.name,
        workspaceId: presetRow.workspaceId,
        agentId: presetRow.agentId,
        status: 'pending',
        pid: null,
      }).run();

      // 환경변수 병합 — JOIN 쿼리는 raw SQL 유지
      interface EnvVarRow { key: string; value: string; }
      const envVarRows = getDatabaseManager().getDb()
        .prepare(
          `SELECT ev.key, ev.value FROM env_vars ev
           JOIN repositories r ON r.id = ev.repository_id
           JOIN workspaces w ON w.repository_id = r.id
           WHERE w.id = ?`
        )
        .all(presetRow.workspaceId) as EnvVarRow[];
      const repoEnv: Record<string, string> = {};
      for (const row of envVarRows) repoEnv[row.key] = row.value;

      const agentArgs: string[] = JSON.parse(agentRow.args);
      const agentEnv: Record<string, string> = JSON.parse(agentRow.env);
      const presetEnv: Record<string, string> = JSON.parse(presetRow.envVars);
      const mergedEnv = { ...repoEnv, ...agentEnv, ...presetEnv };

      const intelligence = getSessionIntelligence();
      intelligence.startSession(sessionId);

      const ptyProcess = ptyManager.create(
        sessionId,
        agentRow.command,
        agentArgs,
        mergedEnv,
        workspaceRow.worktreePath,
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
        drizzle.update(schema.sessions)
          .set({ status, pid: null, lastExitCode: exitCode ?? null })
          .where(eq(schema.sessions.id, sid))
          .run();
        const scrollback = ptyManager.getScrollback(sid);
        if (scrollback) {
          drizzle.insert(schema.sessionScrollbacks)
            .values({ sessionId: sid, data: scrollback })
            .onConflictDoUpdate({
              target: schema.sessionScrollbacks.sessionId,
              set: { data: scrollback, updatedAt: drizzleSql`datetime('now')` },
            })
            .run();
        }
        const win = getMainWindow();
        if (win && !win.isDestroyed()) {
          win.webContents.send('session-status', { sessionId: sid, status });
        }
      });

      drizzle.update(schema.sessions)
        .set({ status: 'running', pid: ptyProcess.pid })
        .where(eq(schema.sessions.id, sessionId))
        .run();

      // 초기 커맨드가 있으면 전송
      if (presetRow.initialCommand.trim()) {
        setTimeout(() => {
          try {
            ptyManager.write(sessionId, presetRow.initialCommand + '\r');
          } catch { /* 무시 */ }
        }, 500);
      }

      const [sessionFinal] = drizzle.select().from(schema.sessions).where(eq(schema.sessions.id, sessionId)).all();
      return rowToSession(sessionFinal as unknown as SessionRow);
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
    const drizzle = getDatabaseManager().drizzle;
    return drizzle
      .select()
      .from(schema.workspaceTemplates)
      .orderBy(desc(schema.workspaceTemplates.createdAt))
      .all()
      .map((row) => ({
        id: row.id,
        name: row.name,
        description: row.description,
        agentType: row.agentType,
        envVars: JSON.parse(row.envVars) as Record<string, string>,
        setupScript: row.setupScript,
        teardownScript: row.teardownScript,
        branchPattern: row.branchPattern,
        createdAt: row.createdAt,
      }));
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
      const drizzle = getDatabaseManager().drizzle;
      const id = uuidv4();
      drizzle.insert(schema.workspaceTemplates).values({
        id,
        name: input.name,
        description: input.description,
        agentType: input.agentType,
        envVars: JSON.stringify(input.envVars),
        setupScript: input.setupScript,
        teardownScript: input.teardownScript,
        branchPattern: input.branchPattern,
      }).run();
      const [row] = drizzle.select().from(schema.workspaceTemplates).where(eq(schema.workspaceTemplates.id, id)).all();
      return {
        id: row.id,
        name: row.name,
        description: row.description,
        agentType: row.agentType,
        envVars: JSON.parse(row.envVars) as Record<string, string>,
        setupScript: row.setupScript,
        teardownScript: row.teardownScript,
        branchPattern: row.branchPattern,
        createdAt: row.createdAt,
      };
    }),

  delete: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(({ input }) => {
      const drizzle = getDatabaseManager().drizzle;
      drizzle.delete(schema.workspaceTemplates).where(eq(schema.workspaceTemplates.id, input.id)).run();
    }),

  applyToWorkspace: publicProcedure
    .input(z.object({ templateId: z.string(), workspaceId: z.string() }))
    .mutation(({ input }) => {
      const drizzle = getDatabaseManager().drizzle;
      const [tpl] = drizzle.select().from(schema.workspaceTemplates).where(eq(schema.workspaceTemplates.id, input.templateId)).all();
      if (!tpl) throw new Error(`Template ${input.templateId} not found`);

      const [workspace] = drizzle.select().from(schema.workspaces).where(eq(schema.workspaces.id, input.workspaceId)).all();
      if (!workspace) throw new Error(`Workspace ${input.workspaceId} not found`);

      const repoId = workspace.repositoryId;

      // 템플릿 env_vars를 repo의 env_vars에 병합
      const tplEnvVars = JSON.parse(tpl.envVars) as Record<string, string>;
      for (const [key, value] of Object.entries(tplEnvVars)) {
        drizzle.insert(schema.envVars)
          .values({ id: uuidv4(), repositoryId: repoId, key, value })
          .onConflictDoUpdate({
            target: [schema.envVars.repositoryId, schema.envVars.key],
            set: { value },
          })
          .run();
      }

      // 템플릿의 setup/teardown script를 repo에 적용 (비어있지 않으면)
      if (tpl.setupScript) {
        drizzle.update(schema.repositories).set({ setupScript: tpl.setupScript }).where(eq(schema.repositories.id, repoId)).run();
      }
      if (tpl.teardownScript) {
        drizzle.update(schema.repositories).set({ teardownScript: tpl.teardownScript }).where(eq(schema.repositories.id, repoId)).run();
      }

      // 템플릿의 branch_pattern을 repo의 branch_prefix에 적용
      if (tpl.branchPattern) {
        drizzle.update(schema.repositories).set({ branchPrefix: tpl.branchPattern }).where(eq(schema.repositories.id, repoId)).run();
      }

      return { success: true };
    }),
});

// ── agentRouter ───────────────────────────────────────────────────────────────

export const agentRouter = router({
  list: publicProcedure.query(() => {
    const drizzle = getDatabaseManager().drizzle;
    return drizzle
      .select()
      .from(schema.agents)
      .orderBy(desc(schema.agents.isBuiltIn), asc(schema.agents.name))
      .all()
      .map((row) => ({
        id: row.id,
        name: row.name,
        command: row.command,
        args: JSON.parse(row.args) as string[],
        env: JSON.parse(row.env) as Record<string, string>,
        isBuiltIn: row.isBuiltIn,
        scriptPath: row.scriptPath ?? null,
        scriptContent: row.scriptContent ?? null,
      }));
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
      const drizzle = getDatabaseManager().drizzle;
      const id = uuidv4();
      drizzle.insert(schema.agents).values({
        id,
        name: input.name,
        command: input.command,
        args: JSON.stringify(input.args),
        env: JSON.stringify(input.env),
        isBuiltIn: false,
        scriptPath: input.scriptPath ?? null,
        scriptContent: input.scriptContent ?? null,
      }).run();
      const [row] = drizzle.select().from(schema.agents).where(eq(schema.agents.id, id)).all();
      return {
        id: row.id,
        name: row.name,
        command: row.command,
        args: JSON.parse(row.args) as string[],
        env: JSON.parse(row.env) as Record<string, string>,
        isBuiltIn: row.isBuiltIn,
        scriptPath: row.scriptPath ?? null,
        scriptContent: row.scriptContent ?? null,
      };
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
      const drizzle = getDatabaseManager().drizzle;
      const [agent] = drizzle
        .select({ isBuiltIn: schema.agents.isBuiltIn })
        .from(schema.agents)
        .where(eq(schema.agents.id, input.id))
        .all();

      if (!agent) throw new Error(`Agent ${input.id} not found`);
      if (agent.isBuiltIn) throw new Error('Cannot modify built-in agents');

      drizzle.update(schema.agents)
        .set({
          name: input.name,
          command: input.command,
          args: JSON.stringify(input.args),
          env: JSON.stringify(input.env),
          scriptPath: input.scriptPath ?? null,
          scriptContent: input.scriptContent ?? null,
        })
        .where(eq(schema.agents.id, input.id))
        .run();

      const [row] = drizzle.select().from(schema.agents).where(eq(schema.agents.id, input.id)).all();
      return {
        id: row.id,
        name: row.name,
        command: row.command,
        args: JSON.parse(row.args) as string[],
        env: JSON.parse(row.env) as Record<string, string>,
        isBuiltIn: row.isBuiltIn,
        scriptPath: row.scriptPath ?? null,
        scriptContent: row.scriptContent ?? null,
      };
    }),

  delete: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(({ input }) => {
      const drizzle = getDatabaseManager().drizzle;
      const [agent] = drizzle
        .select({ isBuiltIn: schema.agents.isBuiltIn })
        .from(schema.agents)
        .where(eq(schema.agents.id, input.id))
        .all();

      if (!agent) throw new Error(`Agent ${input.id} not found`);
      if (agent.isBuiltIn) throw new Error('Cannot delete built-in agents');

      drizzle.delete(schema.agents).where(eq(schema.agents.id, input.id)).run();
    }),
});

// ── repositoryRouter ──────────────────────────────────────────────────────────

export const repositoryRouter = router({
  list: publicProcedure.query(() => {
    const drizzle = getDatabaseManager().drizzle;
    return drizzle
      .select()
      .from(schema.repositories)
      .orderBy(asc(schema.repositories.createdAt))
      .all()
      .map((row) => ({
        id: row.id,
        name: row.name,
        path: row.path,
        color: row.color,
        branchPrefix: row.branchPrefix,
        baseBranch: row.baseBranch,
        worktreeBasePath: row.worktreeBasePath,
        setupScript: row.setupScript,
        teardownScript: row.teardownScript,
        createdAt: row.createdAt,
      }));
  }),

  add: publicProcedure
    .input(z.object({ path: z.string().min(1) }))
    .mutation(({ input }) => {
      const drizzle = getDatabaseManager().drizzle;
      const git = getGitService();
      const { path: repoPath } = input;

      if (!git.isGitRepo(repoPath)) throw new Error(`Not a git repository: ${repoPath}`);

      const name = repoPath.split('/').pop() ?? repoPath;
      const branch = git.getCurrentBranch(repoPath);
      const id = uuidv4();

      drizzle.insert(schema.repositories).values({ id, name, path: repoPath, baseBranch: branch }).run();

      const [row] = drizzle.select().from(schema.repositories).where(eq(schema.repositories.id, id)).all();
      return {
        id: row.id, name: row.name, path: row.path, color: row.color,
        branchPrefix: row.branchPrefix, baseBranch: row.baseBranch,
        worktreeBasePath: row.worktreeBasePath, setupScript: row.setupScript,
        teardownScript: row.teardownScript, createdAt: row.createdAt,
      };
    }),

  clone: publicProcedure
    .input(z.object({ url: z.string().url(), targetPath: z.string().min(1) }))
    .mutation(async ({ input }) => {
      const drizzle = getDatabaseManager().drizzle;
      const git = getGitService();
      const { url, targetPath } = input;

      await git.cloneRepo(url, targetPath);

      const name = url.split('/').pop()?.replace('.git', '') ?? 'repo';
      const id = uuidv4();

      drizzle.insert(schema.repositories).values({ id, name, path: targetPath }).run();

      const [row] = drizzle.select().from(schema.repositories).where(eq(schema.repositories.id, id)).all();
      return {
        id: row.id, name: row.name, path: row.path, color: row.color,
        branchPrefix: row.branchPrefix, baseBranch: row.baseBranch,
        worktreeBasePath: row.worktreeBasePath, setupScript: row.setupScript,
        teardownScript: row.teardownScript, createdAt: row.createdAt,
      };
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
      const drizzle = getDatabaseManager().drizzle;
      const { id, settings } = input;
      const updateFields: Partial<typeof schema.repositories.$inferInsert> = {};
      if (settings.name !== undefined) updateFields.name = settings.name;
      if (settings.color !== undefined) updateFields.color = settings.color;
      if (settings.branchPrefix !== undefined) updateFields.branchPrefix = settings.branchPrefix;
      if (settings.baseBranch !== undefined) updateFields.baseBranch = settings.baseBranch;
      if (settings.worktreeBasePath !== undefined) updateFields.worktreeBasePath = settings.worktreeBasePath;
      if (settings.setupScript !== undefined) updateFields.setupScript = settings.setupScript;
      if (settings.teardownScript !== undefined) updateFields.teardownScript = settings.teardownScript;

      if (Object.keys(updateFields).length > 0) {
        drizzle.update(schema.repositories).set(updateFields).where(eq(schema.repositories.id, id)).run();
      }

      const [row] = drizzle.select().from(schema.repositories).where(eq(schema.repositories.id, id)).all();
      return {
        id: row.id, name: row.name, path: row.path, color: row.color,
        branchPrefix: row.branchPrefix, baseBranch: row.baseBranch,
        worktreeBasePath: row.worktreeBasePath, setupScript: row.setupScript,
        teardownScript: row.teardownScript, createdAt: row.createdAt,
      };
    }),

  delete: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(({ input }) => {
      const drizzle = getDatabaseManager().drizzle;
      drizzle.delete(schema.repositories).where(eq(schema.repositories.id, input.id)).run();
    }),

  envVar: router({
    list: publicProcedure
      .input(z.object({ repositoryId: z.string() }))
      .query(({ input }) => {
        const drizzle = getDatabaseManager().drizzle;
        return drizzle
          .select()
          .from(schema.envVars)
          .where(eq(schema.envVars.repositoryId, input.repositoryId))
          .all()
          .map((row) => ({ id: row.id, repositoryId: row.repositoryId, key: row.key, value: row.value }));
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
        const drizzle = getDatabaseManager().drizzle;
        const { repositoryId, key, value } = input;
        const [existing] = drizzle
          .select({ id: schema.envVars.id })
          .from(schema.envVars)
          .where(and(eq(schema.envVars.repositoryId, repositoryId), eq(schema.envVars.key, key)))
          .all();

        const id = existing?.id ?? uuidv4();
        drizzle.insert(schema.envVars)
          .values({ id, repositoryId, key, value })
          .onConflictDoUpdate({
            target: [schema.envVars.repositoryId, schema.envVars.key],
            set: { value },
          })
          .run();

        const [row] = drizzle.select().from(schema.envVars).where(eq(schema.envVars.id, id)).all();
        return { id: row.id, repositoryId: row.repositoryId, key: row.key, value: row.value };
      }),

    delete: publicProcedure
      .input(z.object({ id: z.string() }))
      .mutation(({ input }) => {
        const drizzle = getDatabaseManager().drizzle;
        drizzle.delete(schema.envVars).where(eq(schema.envVars.id, input.id)).run();
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
      const drizzle = getDatabaseManager().drizzle;

      // 1. workspace 조회
      const [wsRow] = drizzle.select().from(schema.workspaces).where(eq(schema.workspaces.id, input.workspaceId)).all();
      if (!wsRow) {
        return { success: false, message: 'Workspace not found' };
      }
      const workspace = { id: wsRow.id, name: wsRow.name, repositoryId: wsRow.repositoryId, branch: wsRow.branch, worktreePath: wsRow.worktreePath, createdAt: wsRow.createdAt };

      // 2. repository 조회 → baseBranch 확인
      const [repoRow] = drizzle.select().from(schema.repositories).where(eq(schema.repositories.id, workspace.repositoryId)).all();
      if (!repoRow) {
        return { success: false, message: 'Repository not found' };
      }
      const repo = { id: repoRow.id, name: repoRow.name, path: repoRow.path, color: repoRow.color, branchPrefix: repoRow.branchPrefix, baseBranch: repoRow.baseBranch, worktreeBasePath: repoRow.worktreeBasePath, setupScript: repoRow.setupScript, teardownScript: repoRow.teardownScript, createdAt: repoRow.createdAt };
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
    const drizzle = getDatabaseManager().drizzle;
    return drizzle
      .select()
      .from(schema.mcpServers)
      .orderBy(asc(schema.mcpServers.createdAt))
      .all()
      .map((row) => ({
        id: row.id, name: row.name, url: row.url,
        enabled: row.enabled, status: row.status as 'connected' | 'offline' | 'error',
        errorMsg: row.errorMsg, createdAt: row.createdAt,
      }));
  }),

  add: publicProcedure
    .input(z.object({ name: z.string().min(1), url: z.string().url() }))
    .mutation(({ input }) => {
      const drizzle = getDatabaseManager().drizzle;
      const id = uuidv4();
      drizzle.insert(schema.mcpServers).values({ id, name: input.name, url: input.url }).run();
      const [row] = drizzle.select().from(schema.mcpServers).where(eq(schema.mcpServers.id, id)).all();
      return {
        id: row.id, name: row.name, url: row.url,
        enabled: row.enabled, status: row.status as 'connected' | 'offline' | 'error',
        errorMsg: row.errorMsg, createdAt: row.createdAt,
      };
    }),

  delete: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(({ input }) => {
      const drizzle = getDatabaseManager().drizzle;
      drizzle.delete(schema.mcpServers).where(eq(schema.mcpServers.id, input.id)).run();
    }),

  toggle: publicProcedure
    .input(z.object({ id: z.string(), enabled: z.boolean() }))
    .mutation(({ input }) => {
      const drizzle = getDatabaseManager().drizzle;
      drizzle.update(schema.mcpServers)
        .set({ enabled: input.enabled })
        .where(eq(schema.mcpServers.id, input.id))
        .run();
      const [row] = drizzle.select().from(schema.mcpServers).where(eq(schema.mcpServers.id, input.id)).all();
      return {
        id: row.id, name: row.name, url: row.url,
        enabled: row.enabled, status: row.status as 'connected' | 'offline' | 'error',
        errorMsg: row.errorMsg, createdAt: row.createdAt,
      };
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
      const drizzle = getDatabaseManager().drizzle;
      drizzle.update(schema.mcpServers)
        .set({ status: input.status, errorMsg: input.errorMsg })
        .where(eq(schema.mcpServers.id, input.id))
        .run();
      const [row] = drizzle.select().from(schema.mcpServers).where(eq(schema.mcpServers.id, input.id)).all();
      return {
        id: row.id, name: row.name, url: row.url,
        enabled: row.enabled, status: row.status as 'connected' | 'offline' | 'error',
        errorMsg: row.errorMsg, createdAt: row.createdAt,
      };
    }),

  checkServers: publicProcedure.mutation(async () => {
    const drizzle = getDatabaseManager().drizzle;
    const servers = drizzle
      .select()
      .from(schema.mcpServers)
      .where(eq(schema.mcpServers.enabled, true))
      .all();

    const results = await Promise.all(
      servers.map(async (server) => {
        try {
          const url = new URL(server.url);
          const host = url.hostname;
          const port = parseInt(url.port || '80', 10);
          const connected = await checkSocketConnection(host, port);
          const status = connected ? 'connected' : 'offline';
          drizzle.update(schema.mcpServers)
            .set({ status, errorMsg: null })
            .where(eq(schema.mcpServers.id, server.id))
            .run();
        } catch (err) {
          drizzle.update(schema.mcpServers)
            .set({ status: 'error', errorMsg: String(err) })
            .where(eq(schema.mcpServers.id, server.id))
            .run();
        }
        const [row] = drizzle.select().from(schema.mcpServers).where(eq(schema.mcpServers.id, server.id)).all();
        return {
          id: row.id, name: row.name, url: row.url,
          enabled: row.enabled, status: row.status as 'connected' | 'offline' | 'error',
          errorMsg: row.errorMsg, createdAt: row.createdAt,
        };
      })
    );

    return results;
  }),
});

// ── appStateRouter ────────────────────────────────────────────────────────────

export const appStateRouter = router({
  load: publicProcedure.query((): AppState => {
    const state = AppStateService.getInstance().get();
    return {
      sidebarWidth: state.sidebarWidth,
      rightSidebarWidth: state.rightSidebarWidth,
    } as AppState;
  }),

  save: publicProcedure
    .input(z.object({ state: z.record(z.string(), z.unknown()) }))
    .mutation(async ({ input }) => {
      await AppStateService.getInstance().set(input.state as Partial<LocalAppState>);
    }),
});

// ── uiRouter ──────────────────────────────────────────────────────────────────

export const uiRouter = router({
  loadState: publicProcedure.query((): AppState => {
    const state = AppStateService.getInstance().get();
    return {
      sidebarWidth: state.sidebarWidth,
      rightSidebarWidth: state.rightSidebarWidth,
      activeWorkspaceId: state.activeWorkspaceId,
    } as AppState;
  }),

  saveState: publicProcedure
    .input(z.record(z.string(), z.unknown()))
    .mutation(async ({ input }) => {
      await AppStateService.getInstance().set(input as Partial<LocalAppState>);
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

  writeFile: publicProcedure
    .input(z.object({ filePath: z.string().min(1), content: z.string() }))
    .mutation(({ input }) => {
      fs.writeFileSync(input.filePath, input.content, 'utf-8');
      return { success: true };
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
  const drizzle = getDatabaseManager().drizzle;
  const body = JSON.stringify({ event, ...payload, timestamp: new Date().toISOString() });

  const delays = [1000, 2000, 4000]; // 지수 백오프
  let statusCode: number | null = null;
  let responseBody = '';

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
      if (res.ok) { break; }
    } catch (err) {
      responseBody = String(err);
    }

    if (attempt < delays.length) {
      await new Promise((r) => setTimeout(r, delays[attempt]));
    }
  }

  // 로그 기록
  drizzle.insert(schema.webhookLogs).values({
    id: uuidv4(),
    webhookId,
    event,
    statusCode,
    responseBody: responseBody.slice(0, 2000),
  }).run();
}

/** 등록된 모든 웹훅에 이벤트 발송 */
export function emitWebhookEvent(event: string, payload: Record<string, unknown>): void {
  try {
    const drizzle = getDatabaseManager().drizzle;
    const webhooks = drizzle
      .select()
      .from(schema.webhooks)
      .where(eq(schema.webhooks.enabled, true))
      .all();

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
    const drizzle = getDatabaseManager().drizzle;
    return drizzle
      .select()
      .from(schema.webhooks)
      .orderBy(desc(schema.webhooks.createdAt))
      .all()
      .map((row) => ({
        id: row.id, url: row.url,
        events: JSON.parse(row.events) as string[],
        secret: row.secret, enabled: row.enabled, createdAt: row.createdAt,
      }));
  }),

  create: publicProcedure
    .input(z.object({
      url: z.string().url(),
      events: z.array(z.enum(['session.completed', 'session.error', 'agent.task_done', 'session.started'])),
      secret: z.string().default(''),
    }))
    .mutation(({ input }) => {
      const drizzle = getDatabaseManager().drizzle;
      const id = uuidv4();
      drizzle.insert(schema.webhooks).values({
        id,
        url: input.url,
        events: JSON.stringify(input.events),
        secret: input.secret,
      }).run();
      const [row] = drizzle.select().from(schema.webhooks).where(eq(schema.webhooks.id, id)).all();
      return { id: row.id, url: row.url, events: JSON.parse(row.events) as string[], secret: row.secret, enabled: row.enabled, createdAt: row.createdAt };
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
      const drizzle = getDatabaseManager().drizzle;
      const updateFields: Partial<typeof schema.webhooks.$inferInsert> = {};
      if (input.url !== undefined) updateFields.url = input.url;
      if (input.events !== undefined) updateFields.events = JSON.stringify(input.events);
      if (input.secret !== undefined) updateFields.secret = input.secret;
      if (input.enabled !== undefined) updateFields.enabled = input.enabled;
      if (Object.keys(updateFields).length > 0) {
        drizzle.update(schema.webhooks).set(updateFields).where(eq(schema.webhooks.id, input.id)).run();
      }
      const [row] = drizzle.select().from(schema.webhooks).where(eq(schema.webhooks.id, input.id)).all();
      if (!row) throw new Error(`Webhook ${input.id} not found`);
      return { id: row.id, url: row.url, events: JSON.parse(row.events) as string[], secret: row.secret, enabled: row.enabled, createdAt: row.createdAt };
    }),

  delete: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(({ input }) => {
      const drizzle = getDatabaseManager().drizzle;
      drizzle.delete(schema.webhookLogs).where(eq(schema.webhookLogs.webhookId, input.id)).run();
      drizzle.delete(schema.webhooks).where(eq(schema.webhooks.id, input.id)).run();
    }),

  test: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input }) => {
      const drizzle = getDatabaseManager().drizzle;
      const [wh] = drizzle.select().from(schema.webhooks).where(eq(schema.webhooks.id, input.id)).all();
      if (!wh) throw new Error(`Webhook ${input.id} not found`);

      const body = JSON.stringify({ event: 'test', message: 'Webhook test from Maestro', timestamp: new Date().toISOString() });
      try {
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (wh.secret) {
          const hmac = require('crypto').createHmac('sha256', wh.secret).update(body).digest('hex');
          headers['X-Maestro-Signature'] = hmac;
        }
        const res = await fetch(wh.url, { method: 'POST', headers, body, signal: AbortSignal.timeout(10000) });
        const resBody = await res.text().catch(() => '');
        drizzle.insert(schema.webhookLogs).values({
          id: uuidv4(), webhookId: wh.id, event: 'test', statusCode: res.status, responseBody: resBody.slice(0, 2000),
        }).run();
        return { success: res.ok, statusCode: res.status };
      } catch (err) {
        drizzle.insert(schema.webhookLogs).values({
          id: uuidv4(), webhookId: wh.id, event: 'test', statusCode: null, responseBody: String(err).slice(0, 2000),
        }).run();
        return { success: false, statusCode: null };
      }
    }),

  getLogs: publicProcedure
    .input(z.object({ webhookId: z.string(), limit: z.number().int().positive().max(100).default(20) }))
    .query(({ input }) => {
      const drizzle = getDatabaseManager().drizzle;
      return drizzle
        .select()
        .from(schema.webhookLogs)
        .where(eq(schema.webhookLogs.webhookId, input.webhookId))
        .orderBy(desc(schema.webhookLogs.createdAt))
        .limit(input.limit)
        .all()
        .map((row) => ({
          id: row.id, webhookId: row.webhookId, event: row.event,
          statusCode: row.statusCode, responseBody: row.responseBody, createdAt: row.createdAt,
        }));
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
    const drizzle = getDatabaseManager().drizzle;
    const [row] = drizzle
      .select()
      .from(schema.apiKeys)
      .orderBy(desc(schema.apiKeys.createdAt))
      .limit(1)
      .all();
    return row ? { id: row.id, key: row.key, name: row.name, createdAt: row.createdAt } : null;
  }),

  generate: publicProcedure
    .input(z.object({ name: z.string().default('Default') }))
    .mutation(({ input }) => {
      const drizzle = getDatabaseManager().drizzle;
      const id = uuidv4();
      const key = uuidv4();
      drizzle.delete(schema.apiKeys).run(); // 기존 키 모두 제거 (단일 키 정책)
      drizzle.insert(schema.apiKeys).values({ id, key, name: input.name }).run();
      const [row] = drizzle.select().from(schema.apiKeys).where(eq(schema.apiKeys.id, id)).all();
      return { id: row.id, key: row.key, name: row.name, createdAt: row.createdAt };
    }),

  revoke: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(({ input }) => {
      const drizzle = getDatabaseManager().drizzle;
      drizzle.delete(schema.apiKeys).where(eq(schema.apiKeys.id, input.id)).run();
    }),
});

// ── M6-05 / M11-03: relayRouter ──────────────────────────────────────────────

import { relayClient } from '../main/relay-client';

// onInputMessage 핸들러: 모바일에서 받은 session:input → 로컬 PTY로 포워딩
relayClient.onInputMessage = (sessionId: string, data: string) => {
  try {
    getPtyManager().write(sessionId, data);
  } catch {
    // 존재하지 않는 세션 ID는 무시
  }
};

export const relayRouter = router({
  getStatus: publicProcedure.query(() => {
    return { status: relayClient.status, latencyMs: null };
  }),

  getSessions: publicProcedure.query(() => {
    const drizzle = getDatabaseManager().drizzle;
    const sessions = drizzle
      .select({ id: schema.sessions.id, name: schema.sessions.name, createdAt: schema.sessions.createdAt })
      .from(schema.sessions)
      .orderBy(desc(schema.sessions.createdAt))
      .limit(50)
      .all();
    const result = sessions.map((s) => ({ id: s.id, name: s.name, createdAt: s.createdAt }));
    // 세션 목록을 모바일 클라이언트에 브로드캐스트
    relayClient.broadcastSessions(result);
    return result;
  }),

  sendInput: publicProcedure
    .input(z.object({ sessionId: z.string().min(1), text: z.string() }))
    .mutation(({ input }) => {
      getPtyManager().write(input.sessionId, input.text);
      return { success: true };
    }),

  connect: publicProcedure
    .input(z.object({ token: z.string().min(1) }))
    .mutation(({ input }) => {
      const url = process.env['RELAY_SERVER_URL'] ?? 'ws://localhost:3001';
      relayClient.connect(input.token, url);
      return { success: true };
    }),

  disconnect: publicProcedure.mutation(() => {
    relayClient.disconnect();
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
    const drizzle = getDatabaseManager().drizzle;
    return drizzle
      .select()
      .from(schema.plugins)
      .orderBy(desc(schema.plugins.loadedAt))
      .all()
      .map((row) => ({
        id: row.id, name: row.name, version: row.version, path: row.path,
        enabled: row.enabled, loadedAt: row.loadedAt,
      }));
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

      const drizzle = getDatabaseManager().drizzle;
      const id = uuidv4();

      // 같은 경로의 플러그인이 이미 로드되어 있으면 교체
      drizzle.delete(schema.plugins).where(eq(schema.plugins.path, input.pluginPath)).run();

      drizzle.insert(schema.plugins).values({
        id, name: manifest.name, version: manifest.version, path: input.pluginPath, enabled: true,
      }).run();

      const [row] = drizzle.select().from(schema.plugins).where(eq(schema.plugins.id, id)).all();
      return {
        id: row.id, name: row.name, version: row.version, path: row.path,
        enabled: row.enabled, loadedAt: row.loadedAt,
      };
    }),

  unload: publicProcedure
    .input(z.object({ pluginId: z.string() }))
    .mutation(({ input }) => {
      const drizzle = getDatabaseManager().drizzle;
      drizzle.delete(schema.plugins).where(eq(schema.plugins.id, input.pluginId)).run();
    }),
});

// ── M9-03: profileRouter ───────────────────────────────────────────────────

export const profileRouter = router({
  export: publicProcedure.mutation(async () => {
    const drizzle = getDatabaseManager().drizzle;

    // 에이전트 목록
    const agents = drizzle
      .select()
      .from(schema.agents)
      .where(eq(schema.agents.isBuiltIn, false))
      .all()
      .map((row) => ({
        id: row.id, name: row.name, command: row.command,
        args: JSON.parse(row.args) as string[],
        env: JSON.parse(row.env) as Record<string, string>,
        isBuiltIn: false, scriptPath: row.scriptPath ?? null, scriptContent: row.scriptContent ?? null,
      }));

    // MCP 서버 목록
    const mcpServers = drizzle
      .select()
      .from(schema.mcpServers)
      .all()
      .map((row) => ({ name: row.name, url: row.url, enabled: row.enabled }));

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
      const drizzle = getDatabaseManager().drizzle;

      if (input.mode === 'overwrite') {
        // 기존 커스텀 에이전트 제거
        drizzle.delete(schema.agents).where(eq(schema.agents.isBuiltIn, false)).run();
        drizzle.delete(schema.mcpServers).run();
      }

      // 에이전트 가져오기
      if (Array.isArray(profile.agents)) {
        for (const agent of profile.agents) {
          drizzle.insert(schema.agents)
            .values({
              id: agent.id ?? uuidv4(),
              name: agent.name,
              command: agent.command,
              args: JSON.stringify(agent.args ?? []),
              env: JSON.stringify(agent.env ?? {}),
              isBuiltIn: false,
            })
            .onConflictDoNothing()
            .run();
        }
      }

      // MCP 서버 가져오기
      if (Array.isArray(profile.mcpServers)) {
        for (const server of profile.mcpServers) {
          drizzle.insert(schema.mcpServers)
            .values({ id: uuidv4(), name: server.name, url: server.url, enabled: Boolean(server.enabled) })
            .onConflictDoNothing()
            .run();
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

// ── AI Agent Editor: projectRouter ────────────────────────────────────────────

export const projectRouter = router({
  list: publicProcedure.query((): Project[] => {
    const drizzle = getDatabaseManager().drizzle;
    return drizzle
      .select()
      .from(schema.projects)
      .orderBy(desc(schema.projects.createdAt))
      .all()
      .map((r) => ({
        id: r.id,
        name: r.name,
        description: r.description ?? undefined,
        repositoryId: r.repositoryId ?? undefined,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
      }));
  }),

  get: publicProcedure
    .input(z.object({ id: z.string() }))
    .query(({ input }: { input: any }): Project | null => {
      const drizzle = getDatabaseManager().drizzle;
      const [row] = drizzle.select().from(schema.projects).where(eq(schema.projects.id, input.id)).all();
      if (!row) return null;
      return {
        id: row.id,
        name: row.name,
        description: row.description ?? undefined,
        repositoryId: row.repositoryId ?? undefined,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      };
    }),

  create: publicProcedure
    .input(z.object({
      name: z.string().min(1),
      description: z.string().optional(),
      repositoryId: z.string().optional(),
    }))
    .mutation(({ input }: { input: any }): Project => {
      const drizzle = getDatabaseManager().drizzle;
      const id = uuidv4();
      const now = Date.now();
      drizzle.insert(schema.projects).values({
        id,
        name: input.name,
        description: input.description ?? null,
        repositoryId: input.repositoryId ?? null,
        createdAt: now,
        updatedAt: now,
      }).run();
      return {
        id,
        name: input.name,
        description: input.description,
        repositoryId: input.repositoryId,
        createdAt: now,
        updatedAt: now,
      };
    }),

  update: publicProcedure
    .input(z.object({
      id: z.string(),
      data: z.object({
        name: z.string().min(1).optional(),
        description: z.string().optional(),
        repositoryId: z.string().optional(),
      }),
    }))
    .mutation(({ input }: { input: any }): Project => {
      const drizzle = getDatabaseManager().drizzle;
      const now = Date.now();

      const [existing] = drizzle.select({ id: schema.projects.id }).from(schema.projects).where(eq(schema.projects.id, input.id)).all();
      if (!existing) throw new Error(`Project not found: ${input.id}`);

      const updateFields: Partial<typeof schema.projects.$inferInsert> = { updatedAt: now };
      if (input.data.name !== undefined) updateFields.name = input.data.name;
      if (input.data.description !== undefined) updateFields.description = input.data.description;
      if (input.data.repositoryId !== undefined) updateFields.repositoryId = input.data.repositoryId;

      drizzle.update(schema.projects).set(updateFields).where(eq(schema.projects.id, input.id)).run();

      const [updated] = drizzle.select().from(schema.projects).where(eq(schema.projects.id, input.id)).all();
      return {
        id: updated.id,
        name: updated.name,
        description: updated.description ?? undefined,
        repositoryId: updated.repositoryId ?? undefined,
        createdAt: updated.createdAt,
        updatedAt: updated.updatedAt,
      };
    }),

  delete: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(({ input }: { input: any }): void => {
      const drizzle = getDatabaseManager().drizzle;
      drizzle.delete(schema.projects).where(eq(schema.projects.id, input.id)).run();
    }),
});

// ── AI Agent Editor: projectTaskRouter ────────────────────────────────────────

// helper to map a drizzle task row to ProjectTask
function drizzleTaskToProjectTask(r: typeof schema.tasks.$inferSelect): ProjectTask {
  return {
    id: r.id,
    projectId: r.projectId,
    parentTaskId: r.parentTaskId ?? undefined,
    title: r.title,
    prd: r.prd ?? undefined,
    spec: r.spec ?? undefined,
    referenceFiles: r.referenceFiles ? (JSON.parse(r.referenceFiles) as string[]) : undefined,
    acceptanceCriteria: r.acceptanceCriteria ?? undefined,
    priority: r.priority as ProjectTask['priority'],
    assignedAgentId: r.assignedAgentId ?? undefined,
    status: r.status as ProjectTask['status'],
    createdBy: r.createdBy as ProjectTask['createdBy'],
    workspaceId: r.workspaceId ?? undefined,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
  };
}

export const projectTaskRouter = router({
  list: publicProcedure
    .input(z.object({ projectId: z.string() }))
    .query(({ input }: { input: any }): ProjectTask[] => {
      const drizzle = getDatabaseManager().drizzle;
      return drizzle
        .select()
        .from(schema.tasks)
        .where(eq(schema.tasks.projectId, input.projectId))
        .orderBy(asc(schema.tasks.createdAt))
        .all()
        .map(drizzleTaskToProjectTask);
    }),

  listChildren: publicProcedure
    .input(z.object({ parentTaskId: z.string() }))
    .query(({ input }: { input: any }): ProjectTask[] => {
      const drizzle = getDatabaseManager().drizzle;
      return drizzle
        .select()
        .from(schema.tasks)
        .where(eq(schema.tasks.parentTaskId, input.parentTaskId))
        .orderBy(asc(schema.tasks.createdAt))
        .all()
        .map(drizzleTaskToProjectTask);
    }),

  get: publicProcedure
    .input(z.object({ id: z.string() }))
    .query(({ input }: { input: any }): ProjectTask | null => {
      const drizzle = getDatabaseManager().drizzle;
      const [r] = drizzle.select().from(schema.tasks).where(eq(schema.tasks.id, input.id)).all();
      if (!r) return null;
      return drizzleTaskToProjectTask(r);
    }),

  create: publicProcedure
    .input(z.object({
      projectId: z.string(),
      parentTaskId: z.string().optional(),
      title: z.string().min(1),
      prd: z.string().optional(),
      spec: z.string().optional(),
      referenceFiles: z.array(z.string()).optional(),
      acceptanceCriteria: z.string().optional(),
      priority: z.enum(['critical', 'high', 'medium', 'low']).default('medium'),
      assignedAgentId: z.string().optional(),
      createdBy: z.enum(['human', 'agent']).default('human'),
    }))
    .mutation(({ input }: { input: any }): ProjectTask => {
      const drizzle = getDatabaseManager().drizzle;
      const id = uuidv4();
      const now = Date.now();
      drizzle.insert(schema.tasks).values({
        id,
        projectId: input.projectId,
        parentTaskId: input.parentTaskId ?? null,
        title: input.title,
        prd: input.prd ?? null,
        spec: input.spec ?? null,
        referenceFiles: input.referenceFiles ? JSON.stringify(input.referenceFiles) : null,
        acceptanceCriteria: input.acceptanceCriteria ?? null,
        priority: input.priority,
        assignedAgentId: input.assignedAgentId ?? null,
        status: 'pending',
        createdBy: input.createdBy,
        createdAt: now,
        updatedAt: now,
      }).run();
      return {
        id, projectId: input.projectId, parentTaskId: input.parentTaskId,
        title: input.title, prd: input.prd, spec: input.spec,
        referenceFiles: input.referenceFiles, acceptanceCriteria: input.acceptanceCriteria,
        priority: input.priority, assignedAgentId: input.assignedAgentId,
        status: 'pending', createdBy: input.createdBy, createdAt: now, updatedAt: now,
      };
    }),

  update: publicProcedure
    .input(z.object({
      id: z.string(),
      data: z.object({
        title: z.string().min(1).optional(),
        prd: z.string().optional(),
        spec: z.string().optional(),
        referenceFiles: z.array(z.string()).optional(),
        acceptanceCriteria: z.string().optional(),
        priority: z.enum(['critical', 'high', 'medium', 'low']).optional(),
        assignedAgentId: z.string().optional(),
        status: z.enum(['pending', 'in_progress', 'completed', 'cancelled']).optional(),
        workspaceId: z.string().optional(),
      }),
    }))
    .mutation(({ input }: { input: any }): ProjectTask => {
      const drizzle = getDatabaseManager().drizzle;
      const now = Date.now();

      const [existing] = drizzle.select({ id: schema.tasks.id }).from(schema.tasks).where(eq(schema.tasks.id, input.id)).all();
      if (!existing) throw new Error(`Task not found: ${input.id}`);

      const updateFields: Partial<typeof schema.tasks.$inferInsert> = { updatedAt: now };
      if (input.data.title !== undefined) updateFields.title = input.data.title;
      if (input.data.prd !== undefined) updateFields.prd = input.data.prd;
      if (input.data.spec !== undefined) updateFields.spec = input.data.spec;
      if (input.data.referenceFiles !== undefined) updateFields.referenceFiles = JSON.stringify(input.data.referenceFiles);
      if (input.data.acceptanceCriteria !== undefined) updateFields.acceptanceCriteria = input.data.acceptanceCriteria;
      if (input.data.priority !== undefined) updateFields.priority = input.data.priority;
      if (input.data.assignedAgentId !== undefined) updateFields.assignedAgentId = input.data.assignedAgentId;
      if (input.data.status !== undefined) updateFields.status = input.data.status;
      if (input.data.workspaceId !== undefined) updateFields.workspaceId = input.data.workspaceId;

      drizzle.update(schema.tasks).set(updateFields).where(eq(schema.tasks.id, input.id)).run();

      const [updated] = drizzle.select().from(schema.tasks).where(eq(schema.tasks.id, input.id)).all();
      return drizzleTaskToProjectTask(updated);
    }),

  delete: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(({ input }: { input: any }): void => {
      const drizzle = getDatabaseManager().drizzle;
      drizzle.delete(schema.tasks).where(eq(schema.tasks.id, input.id)).run();
    }),

  // Task 실행: workspace 자동 생성 + PTY 세션 생성
  run: publicProcedure
    .input(z.object({
      taskId: z.string(),
      agentId: z.string().optional(),
      cols: z.number().int().positive().default(220),
      rows: z.number().int().positive().default(50),
    }))
    .mutation(async ({ input }: { input: any }) => {
      const drizzle = getDatabaseManager().drizzle;
      const git = getGitService();
      const { taskId } = input;

      // 1. 태스크 조회
      const [task] = drizzle.select().from(schema.tasks).where(eq(schema.tasks.id, taskId)).all();
      if (!task) throw new Error(`Task not found: ${taskId}`);

      let workspaceRow: typeof schema.workspaces.$inferSelect;

      // 2. task.workspaceId가 있으면 기존 워크스페이스 사용
      if (task.workspaceId) {
        const [existing] = drizzle.select().from(schema.workspaces).where(eq(schema.workspaces.id, task.workspaceId)).all();
        if (!existing) throw new Error(`Workspace ${task.workspaceId} not found`);
        workspaceRow = existing;
      } else {
        // 3. 새 워크스페이스 생성 — project의 repositoryId로 레포 조회
        const [project] = drizzle.select().from(schema.projects).where(eq(schema.projects.id, task.projectId)).all();
        if (!project) throw new Error(`Project not found: ${task.projectId}`);
        if (!project.repositoryId) throw new Error(`Project has no repository linked: ${task.projectId}`);

        const [repo] = drizzle.select().from(schema.repositories).where(eq(schema.repositories.id, project.repositoryId)).all();
        if (!repo) throw new Error(`Repository ${project.repositoryId} not found`);

        const repoPath = repo.path;
        const branchPrefix = repo.branchPrefix || '';
        const worktreeBase = repo.worktreeBasePath || path.join(repoPath, '..', 'worktrees');
        const workspaceName = `task-${taskId.slice(0, 8)}`;
        const branch = `${branchPrefix}${workspaceName}`;
        const worktreePath = path.join(worktreeBase, workspaceName);
        const workspaceId = uuidv4();

        // git worktree 생성 (기존 workspace.create 패턴 재활용)
        await git.addWorktree(repoPath, worktreePath, branch);

        // setup_script 실행
        if (repo.setupScript?.trim()) {
          try {
            await execAsync(repo.setupScript, { cwd: worktreePath });
          } catch (err) {
            await git.removeWorktree(repoPath, worktreePath);
            throw new Error(`Setup script failed: ${String(err)}`);
          }
        }

        // DB INSERT — workspaces 테이블
        drizzle.insert(schema.workspaces).values({
          id: workspaceId,
          name: workspaceName,
          repositoryId: project.repositoryId,
          branch,
          worktreePath,
          taskId,
        }).run();

        const [inserted] = drizzle.select().from(schema.workspaces).where(eq(schema.workspaces.id, workspaceId)).all();
        if (!inserted) {
          await git.removeWorktree(repoPath, worktreePath);
          throw new Error('Failed to insert workspace record');
        }

        // tasks 테이블에 workspaceId 연결
        drizzle.update(schema.tasks)
          .set({ workspaceId: workspaceId, updatedAt: Date.now() })
          .where(eq(schema.tasks.id, taskId))
          .run();

        workspaceRow = inserted;
      }

      // 4. 에이전트 결정: input.agentId > task.assignedAgentId > 첫 번째 에이전트
      const resolvedAgentId = selectAgentForTask(
        getDatabaseManager().getDb(),
        {
          assignedAgentId: task.assignedAgentId ?? null,
          title: task.title,
          prd: task.prd ?? null,
        },
        input.agentId,
      );
      if (!resolvedAgentId) throw new Error('No agents configured. Please add an agent first.');
      const agentId = resolvedAgentId;

      const [agentRow] = drizzle.select().from(schema.agents).where(eq(schema.agents.id, agentId)).all();
      if (!agentRow) throw new Error(`Agent ${agentId} not found`);

      // 5. PTY 세션 생성 (기존 session.create 패턴 재활용)
      const sessionId = uuidv4();
      const sessionName = `${task.title} — run`;
      drizzle.insert(schema.sessions).values({
        id: sessionId,
        name: sessionName,
        workspaceId: workspaceRow.id,
        agentId,
        status: 'pending',
        pid: null,
        dependsOnSessionId: null,
        contextSourceSessionId: null,
      }).run();

      const [sessionFinal] = drizzle.select().from(schema.sessions).where(eq(schema.sessions.id, sessionId)).all();

      // tasks 상태를 in_progress로 업데이트
      drizzle.update(schema.tasks)
        .set({ status: 'in_progress', updatedAt: Date.now() })
        .where(eq(schema.tasks.id, taskId))
        .run();

      const workspaceOut = {
        id: workspaceRow.id, name: workspaceRow.name, repositoryId: workspaceRow.repositoryId,
        branch: workspaceRow.branch, worktreePath: workspaceRow.worktreePath, createdAt: workspaceRow.createdAt,
      };

      return {
        workspace: workspaceOut,
        session: rowToSession(sessionFinal as unknown as SessionRow),
      };
    }),
});

// ── claudeRouter ─────────────────────────────────────────────────────────────

import Anthropic from '@anthropic-ai/sdk';
import { TRPCError } from '@trpc/server';
import { execFile } from 'child_process';

const execFileAsync = promisify(execFile);

type ChatMessage = { role: 'user' | 'assistant'; content: string };

async function callViaCLI(messages: ChatMessage[], systemPrompt: string): Promise<string> {
  // 시스템 프롬프트 + 이전 대화 기록을 단일 프롬프트로 조합
  const parts: string[] = [`<system>\n${systemPrompt}\n</system>`];

  if (messages.length > 1) {
    parts.push('\n<conversation_history>');
    for (const m of messages.slice(0, -1)) {
      parts.push(`${m.role === 'user' ? 'Human' : 'Assistant'}: ${m.content}`);
    }
    parts.push('</conversation_history>');
  }

  const last = messages[messages.length - 1];
  if (last) parts.push(`\n${last.content}`);

  const prompt = parts.join('\n');

  const { stdout } = await execFileAsync(
    'claude',
    ['--print', '--model', 'claude-sonnet-4-6', prompt],
    { timeout: 120_000, maxBuffer: 10 * 1024 * 1024 },
  );
  return stdout.trim();
}

const claudeRouter = router({
  chat: publicProcedure
    .input(
      z.object({
        messages: z.array(
          z.object({
            role: z.enum(['user', 'assistant']),
            content: z.string(),
          })
        ),
        systemPrompt: z.string(),
      })
    )
    .mutation(async ({ input }) => {
      const apiKey = process.env.ANTHROPIC_API_KEY;

      // API 키 있으면 SDK 직접 호출, 없으면 Claude Code CLI로 폴백
      if (apiKey) {
        const client = new Anthropic({ apiKey });
        try {
          const response = await client.messages.create({
            model: 'claude-sonnet-4-6',
            max_tokens: 8096,
            system: input.systemPrompt,
            messages: input.messages,
          });
          const textBlock = response.content.find((block) => block.type === 'text');
          return { content: textBlock ? textBlock.text : '' };
        } catch (err) {
          if (err instanceof Anthropic.APIError) {
            throw new TRPCError({
              code: 'INTERNAL_SERVER_ERROR',
              message: `Anthropic API 오류: ${err.message}`,
              cause: err,
            });
          }
          throw new TRPCError({
            code: 'INTERNAL_SERVER_ERROR',
            message: 'Claude API 호출 중 오류가 발생했습니다',
            cause: err,
          });
        }
      }

      // Claude Code CLI 폴백
      try {
        const content = await callViaCLI(input.messages, input.systemPrompt);
        return { content };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const isNotFound = msg.includes('ENOENT') || msg.includes('not found');
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: isNotFound
            ? 'Claude Code CLI를 찾을 수 없습니다. ANTHROPIC_API_KEY를 설정하거나 Claude Code를 설치해주세요.'
            : `Claude CLI 호출 오류: ${msg}`,
          cause: err,
        });
      }
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
  project: projectRouter,
  projectTask: projectTaskRouter,
  claude: claudeRouter,
});

export type AppRouter = typeof appRouter;

// 테스트에서 서버 사이드 caller 생성에 사용
export const createCaller = t.createCallerFactory(appRouter);
