import { getDatabaseManager, closeDatabaseManager } from '../db/database';
import { getGitService } from '../services/git';
import { getPtyManager } from '../services/pty-manager';
import { registerRepositoryHandlers } from './repository';
import { registerWorkspaceHandlers } from './workspace';
import { registerSessionHandlers } from './session';
import { registerAgentHandlers } from './agent';
import { registerGitHandlers } from './git';
import { registerMcpHandlers } from './mcp';
import { registerAppStateHandlers } from './app-state';
import { registerDialogHandlers } from './dialog';

export function registerAllHandlers(): void {
  const db = getDatabaseManager();
  const git = getGitService();
  const pty = getPtyManager();

  registerRepositoryHandlers(db, git);
  registerWorkspaceHandlers(db, git);
  registerSessionHandlers(db, pty);
  registerAgentHandlers(db);
  registerGitHandlers(git);
  registerMcpHandlers(db);
  registerAppStateHandlers(db);
  registerDialogHandlers();
}

export async function cleanupServices(): Promise<void> {
  const pty = getPtyManager();
  pty.killAll();
  closeDatabaseManager();
}
