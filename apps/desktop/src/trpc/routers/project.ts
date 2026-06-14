/**
 * projectRouter, projectTaskRouter — 원본 router.ts lines 3766-4146
 */

import { router, publicProcedure, execAsync, validateScript } from '../trpc';
import { z } from 'zod';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { getDatabaseManager } from '../../db/database';
import * as schema from '../../db/schema';
import { eq, asc, desc } from 'drizzle-orm';
import { getGitService } from '../../services/git';
import { selectAgentForTask } from '../../services/orchestrator';
import { rowToSession, type SessionRow } from './_shared';
import type { Project, ProjectTask } from '@maestro/shared-types';
import log from 'electron-log';

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
    .query(({ input }): Project | null => {
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
    .mutation(({ input }): Project => {
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
    .mutation(({ input }): Project => {
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
    .mutation(({ input }): void => {
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
    .query(({ input }): ProjectTask[] => {
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
    .query(({ input }): ProjectTask[] => {
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
    .query(({ input }): ProjectTask | null => {
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
    .mutation(({ input }): ProjectTask => {
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
    .mutation(({ input }): ProjectTask => {
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
    .mutation(({ input }): void => {
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
    .mutation(async ({ input }) => {
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
          validateScript(repo.setupScript, 'setupScript');
          log.info('[workspace] Executing setupScript:', repo.setupScript.slice(0, 100));
          try {
            await execAsync(repo.setupScript, { cwd: worktreePath, timeout: 30000 });
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
