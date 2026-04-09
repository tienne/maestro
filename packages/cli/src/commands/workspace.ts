import { Command } from 'commander';
import { createClient } from '../client';

export function createWorkspaceCommand(): Command {
  const workspace = new Command('workspace').description('Workspace management');

  workspace
    .command('list')
    .description('List all workspaces')
    .action(async () => {
      const client = createClient();
      const workspaces = await client.workspace.list.query();
      workspaces.forEach(w => {
        console.log(`${w.id}\t${w.name}\t${w.branch}\t${w.worktreePath}`);
      });
    });

  workspace
    .command('create <name>')
    .description('Create a new workspace (git worktree)')
    .requiredOption('--repo <id>', 'Repository ID')
    .action(async (name, opts) => {
      const client = createClient();
      const ws = await client.workspace.create.mutate({
        name,
        repositoryId: opts.repo,
      });
      console.log(`Workspace created: ${ws.id} at ${ws.worktreePath}`);
    });

  workspace
    .command('delete <id>')
    .description('Delete a workspace (removes git worktree)')
    .action(async (id) => {
      const client = createClient();
      await client.workspace.delete.mutate({ id });
      console.log(`Workspace ${id} deleted`);
    });

  return workspace;
}
