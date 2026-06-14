/**
 * presetRouter + templateRouter — 원본 router.ts lines 1753-2086
 */

import { router, publicProcedure } from '../trpc';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { getDatabaseManager } from '../../db/database';
import * as schema from '../../db/schema';
import { eq, desc, sql as drizzleSql } from 'drizzle-orm';
import { getPtyManager } from '../../services/pty-manager';
import { getSessionIntelligence } from '../../services/session-intelligence';
import { getMainWindow } from '../../main';
import { rowToSession, type SessionRow } from './_shared';

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
