import { ipcMain } from 'electron';
import { v4 as uuidv4 } from 'uuid';
import * as path from 'path';
import { execSync } from 'child_process';
import { eq, asc } from 'drizzle-orm';
import type { DatabaseManager } from '../db/database';
import * as schema from '../db/schema';
import type { GitService } from '../services/git';
import type { Workspace } from '@maestro/shared-types';

function rowToWorkspace(row: schema.Workspace): Workspace {
  return {
    id: row.id,
    name: row.name,
    repositoryId: row.repositoryId,
    branch: row.branch,
    worktreePath: row.worktreePath,
    createdAt: row.createdAt,
  };
}

export function registerWorkspaceHandlers(db: DatabaseManager, git: GitService): void {
  const drizzle = db.drizzle;

  ipcMain.handle('workspace:list', () => {
    return drizzle
      .select()
      .from(schema.workspaces)
      .orderBy(asc(schema.workspaces.createdAt))
      .all()
      .map(rowToWorkspace);
  });

  ipcMain.handle('workspace:create', (_event, args: { name: string; repositoryId: string }) => {
    const { name, repositoryId } = args;

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

    git.addWorktree(repoPath, worktreePath, branch);

    const setupScript = repo.setupScript;
    if (setupScript?.trim()) {
      execSync(setupScript, { cwd: worktreePath, stdio: 'ignore' });
    }

    drizzle.insert(schema.workspaces).values({
      id,
      name,
      repositoryId,
      branch,
      worktreePath,
    }).run();

    const [inserted] = drizzle
      .select()
      .from(schema.workspaces)
      .where(eq(schema.workspaces.id, id))
      .all();
    return rowToWorkspace(inserted);
  });

  ipcMain.handle('workspace:delete', (_event, args: { id: string }) => {
    const [workspace] = drizzle
      .select()
      .from(schema.workspaces)
      .where(eq(schema.workspaces.id, args.id))
      .all();

    if (!workspace) throw new Error(`Workspace ${args.id} not found`);

    const [repo] = drizzle
      .select()
      .from(schema.repositories)
      .where(eq(schema.repositories.id, workspace.repositoryId))
      .all();

    const teardownScript = repo?.teardownScript;
    if (teardownScript?.trim()) {
      try {
        execSync(teardownScript, { cwd: workspace.worktreePath, stdio: 'ignore' });
      } catch {
        // teardown 실패 무시
      }
    }

    if (repo) {
      git.removeWorktree(repo.path, workspace.worktreePath);
    }

    drizzle.delete(schema.workspaces).where(eq(schema.workspaces.id, args.id)).run();
  });
}
