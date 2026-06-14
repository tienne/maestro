/**
 * workspaceRouter — 원본 router.ts lines 218-653
 */

import { router, publicProcedure, TRPCError, execAsync, validateScript } from '../trpc';
import { z } from 'zod';
import * as path from 'path';
import { execSync } from 'child_process';
import { v4 as uuidv4 } from 'uuid';
import { getDatabaseManager } from '../../db/database';
import * as schema from '../../db/schema';
import { eq, asc, desc } from 'drizzle-orm';
import { getGitService } from '../../services/git';
import { getPtyManager } from '../../services/pty-manager';
import { getMainWindow } from '../../main';
import { simpleGit } from 'simple-git';
import log from 'electron-log';
import { rowToWorkspace } from './_shared';

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
        validateScript(setupScript, 'setupScript');
        log.info('[workspace] Executing setupScript:', setupScript.slice(0, 100));
        try {
          await execAsync(setupScript, { cwd: worktreePath, timeout: 30000 });
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
        validateScript(teardownScript, 'teardownScript');
        log.info('[workspace] Executing teardownScript:', teardownScript.slice(0, 100));
        try {
          execSync(teardownScript, { cwd: workspace.worktreePath, stdio: 'ignore', timeout: 30000 });
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
