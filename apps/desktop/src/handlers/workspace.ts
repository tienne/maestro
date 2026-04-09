import { ipcMain } from 'electron';
import { v4 as uuidv4 } from 'uuid';
import * as path from 'path';
import { execSync } from 'child_process';
import type { DatabaseManager } from '../db/database';
import type { GitService } from '../services/git';
import type { Workspace } from '@maestro/shared-types';

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

export function registerWorkspaceHandlers(db: DatabaseManager, git: GitService): void {
  const database = db.getDb();

  ipcMain.handle('workspace:list', () => {
    return database.prepare('SELECT * FROM workspaces ORDER BY created_at').all().map((r) => rowToWorkspace(r as Record<string, unknown>));
  });

  ipcMain.handle('workspace:create', (_event, args: { name: string; repositoryId: string }) => {
    const { name, repositoryId } = args;
    const repo = database.prepare('SELECT * FROM repositories WHERE id = ?').get(repositoryId) as Record<string, unknown>;
    if (!repo) throw new Error(`Repository ${repositoryId} not found`);

    const repoPath = repo.path as string;
    const branchPrefix = (repo.branch_prefix as string) || '';
    const worktreeBase = (repo.worktree_base_path as string) || path.join(repoPath, '..', 'worktrees');
    const branch = `${branchPrefix}${name.toLowerCase().replace(/\s+/g, '-')}`;
    const worktreePath = path.join(worktreeBase, name);
    const id = uuidv4();

    git.addWorktree(repoPath, worktreePath, branch);

    const setupScript = repo.setup_script as string;
    if (setupScript?.trim()) {
      execSync(setupScript, { cwd: worktreePath, stdio: 'ignore' });
    }

    database
      .prepare(
        `INSERT INTO workspaces (id, name, repository_id, branch, worktree_path) VALUES (?, ?, ?, ?, ?)`
      )
      .run(id, name, repositoryId, branch, worktreePath);

    return rowToWorkspace(database.prepare('SELECT * FROM workspaces WHERE id = ?').get(id) as Record<string, unknown>);
  });

  ipcMain.handle('workspace:delete', (_event, args: { id: string }) => {
    const workspace = database
      .prepare('SELECT * FROM workspaces WHERE id = ?')
      .get(args.id) as Record<string, unknown> | undefined;

    if (!workspace) throw new Error(`Workspace ${args.id} not found`);

    const repo = database
      .prepare('SELECT * FROM repositories WHERE id = ?')
      .get(workspace.repository_id) as Record<string, unknown>;

    const teardownScript = repo?.teardown_script as string;
    if (teardownScript?.trim()) {
      try {
        execSync(teardownScript, { cwd: workspace.worktree_path as string, stdio: 'ignore' });
      } catch {
        // teardown 실패 무시
      }
    }

    git.removeWorktree(repo.path as string, workspace.worktree_path as string);
    database.prepare('DELETE FROM workspaces WHERE id = ?').run(args.id);
  });
}
