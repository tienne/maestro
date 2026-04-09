import { ipcMain } from 'electron';
import { v4 as uuidv4 } from 'uuid';
import type { DatabaseManager } from '../db/database';
import type { GitService } from '../services/git';
import type { Repository, EnvVar } from '@maestro/shared-types';

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

export function registerRepositoryHandlers(db: DatabaseManager, git: GitService): void {
  const database = db.getDb();

  ipcMain.handle('repository:list', () => {
    return database.prepare('SELECT * FROM repositories ORDER BY created_at').all().map((r) => rowToRepo(r as Record<string, unknown>));
  });

  ipcMain.handle('repository:add', (_event, args: { path: string }) => {
    const { path } = args;
    if (!git.isGitRepo(path)) throw new Error(`Not a git repository: ${path}`);

    const name = path.split('/').pop() ?? path;
    const branch = git.getCurrentBranch(path);
    const id = uuidv4();

    database
      .prepare(
        `INSERT INTO repositories (id, name, path, base_branch) VALUES (?, ?, ?, ?)`
      )
      .run(id, name, path, branch);

    return rowToRepo(database.prepare('SELECT * FROM repositories WHERE id = ?').get(id) as Record<string, unknown>);
  });

  ipcMain.handle('repository:clone', async (_event, args: { url: string; targetPath: string }) => {
    const { url, targetPath } = args;
    await git.cloneRepo(url, targetPath);

    const name = url.split('/').pop()?.replace('.git', '') ?? 'repo';
    const id = uuidv4();

    database
      .prepare(
        `INSERT INTO repositories (id, name, path) VALUES (?, ?, ?)`
      )
      .run(id, name, targetPath);

    return rowToRepo(database.prepare('SELECT * FROM repositories WHERE id = ?').get(id) as Record<string, unknown>);
  });

  ipcMain.handle(
    'repository:update-settings',
    (_event, args: { id: string; settings: Partial<Repository> }) => {
      const { id, settings } = args;
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
        database.prepare(`UPDATE repositories SET ${fields.join(', ')} WHERE id = ?`).run(...values, id);
      }

      return rowToRepo(database.prepare('SELECT * FROM repositories WHERE id = ?').get(id) as Record<string, unknown>);
    }
  );

  ipcMain.handle('repository:remove', (_event, args: { id: string }) => {
    database.prepare('DELETE FROM repositories WHERE id = ?').run(args.id);
  });

  // ── EnvVar ──────────────────────────────────────────────────────────────────

  ipcMain.handle('env-var:list', (_event, args: { repositoryId: string }) => {
    return database
      .prepare('SELECT * FROM env_vars WHERE repository_id = ?')
      .all(args.repositoryId)
      .map((r) => rowToEnvVar(r as Record<string, unknown>));
  });

  ipcMain.handle(
    'env-var:upsert',
    (_event, args: { repositoryId: string; key: string; value: string }) => {
      const { repositoryId, key, value } = args;
      const existing = database
        .prepare('SELECT id FROM env_vars WHERE repository_id = ? AND key = ?')
        .get(repositoryId, key) as { id: string } | undefined;

      const id = existing?.id ?? uuidv4();

      database
        .prepare(
          `INSERT INTO env_vars (id, repository_id, key, value)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(repository_id, key) DO UPDATE SET value = excluded.value`
        )
        .run(id, repositoryId, key, value);

      return rowToEnvVar(database.prepare('SELECT * FROM env_vars WHERE id = ?').get(id) as Record<string, unknown>);
    }
  );

  ipcMain.handle('env-var:delete', (_event, args: { id: string }) => {
    database.prepare('DELETE FROM env_vars WHERE id = ?').run(args.id);
  });
}
