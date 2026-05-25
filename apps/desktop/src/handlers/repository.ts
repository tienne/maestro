import { ipcMain } from 'electron';
import { v4 as uuidv4 } from 'uuid';
import { eq, asc, and } from 'drizzle-orm';
import type { DatabaseManager } from '../db/database';
import * as schema from '../db/schema';
import type { GitService } from '../services/git';
import type { Repository, EnvVar } from '@maestro/shared-types';

function rowToRepo(row: schema.Repository): Repository {
  return {
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
  };
}

function rowToEnvVar(row: schema.EnvVar): EnvVar {
  return {
    id: row.id,
    repositoryId: row.repositoryId,
    key: row.key,
    value: row.value,
  };
}

export function registerRepositoryHandlers(db: DatabaseManager, git: GitService): void {
  const drizzle = db.drizzle;

  ipcMain.handle('repository:list', () => {
    return drizzle
      .select()
      .from(schema.repositories)
      .orderBy(asc(schema.repositories.createdAt))
      .all()
      .map(rowToRepo);
  });

  ipcMain.handle('repository:add', (_event, args: { path: string }) => {
    const { path } = args;
    if (!git.isGitRepo(path)) throw new Error(`Not a git repository: ${path}`);

    const name = path.split('/').pop() ?? path;
    const branch = git.getCurrentBranch(path);
    const id = uuidv4();

    drizzle.insert(schema.repositories).values({
      id,
      name,
      path,
      baseBranch: branch,
    }).run();

    const [inserted] = drizzle
      .select()
      .from(schema.repositories)
      .where(eq(schema.repositories.id, id))
      .all();
    return rowToRepo(inserted);
  });

  ipcMain.handle('repository:clone', async (_event, args: { url: string; targetPath: string }) => {
    const { url, targetPath } = args;
    await git.cloneRepo(url, targetPath);

    const name = url.split('/').pop()?.replace('.git', '') ?? 'repo';
    const id = uuidv4();

    drizzle.insert(schema.repositories).values({
      id,
      name,
      path: targetPath,
    }).run();

    const [inserted] = drizzle
      .select()
      .from(schema.repositories)
      .where(eq(schema.repositories.id, id))
      .all();
    return rowToRepo(inserted);
  });

  ipcMain.handle(
    'repository:update-settings',
    (_event, args: { id: string; settings: Partial<Repository> }) => {
      const { id, settings } = args;

      const updates: Partial<schema.Repository> = {};
      if (settings.name !== undefined) updates.name = settings.name;
      if (settings.color !== undefined) updates.color = settings.color;
      if (settings.branchPrefix !== undefined) updates.branchPrefix = settings.branchPrefix;
      if (settings.baseBranch !== undefined) updates.baseBranch = settings.baseBranch;
      if (settings.worktreeBasePath !== undefined) updates.worktreeBasePath = settings.worktreeBasePath;
      if (settings.setupScript !== undefined) updates.setupScript = settings.setupScript;
      if (settings.teardownScript !== undefined) updates.teardownScript = settings.teardownScript;

      if (Object.keys(updates).length > 0) {
        drizzle.update(schema.repositories)
          .set(updates)
          .where(eq(schema.repositories.id, id))
          .run();
      }

      const [updated] = drizzle
        .select()
        .from(schema.repositories)
        .where(eq(schema.repositories.id, id))
        .all();
      return rowToRepo(updated);
    }
  );

  ipcMain.handle('repository:remove', (_event, args: { id: string }) => {
    drizzle.delete(schema.repositories).where(eq(schema.repositories.id, args.id)).run();
  });

  // ── EnvVar ──────────────────────────────────────────────────────────────────

  ipcMain.handle('env-var:list', (_event, args: { repositoryId: string }) => {
    return drizzle
      .select()
      .from(schema.envVars)
      .where(eq(schema.envVars.repositoryId, args.repositoryId))
      .all()
      .map(rowToEnvVar);
  });

  ipcMain.handle(
    'env-var:upsert',
    (_event, args: { repositoryId: string; key: string; value: string }) => {
      const { repositoryId, key, value } = args;

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

      const [upserted] = drizzle
        .select()
        .from(schema.envVars)
        .where(eq(schema.envVars.id, id))
        .all();
      return rowToEnvVar(upserted);
    }
  );

  ipcMain.handle('env-var:delete', (_event, args: { id: string }) => {
    drizzle.delete(schema.envVars).where(eq(schema.envVars.id, args.id)).run();
  });
}
