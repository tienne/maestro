/**
 * repositoryRouter — 원본 router.ts lines 2214-2380
 */

import { router, publicProcedure } from '../trpc';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { getDatabaseManager } from '../../db/database';
import * as schema from '../../db/schema';
import { eq, asc, and } from 'drizzle-orm';
import { getGitService } from '../../services/git';

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
