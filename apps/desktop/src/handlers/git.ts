import { ipcMain } from 'electron';
import type { GitService } from '../services/git';

export function registerGitHandlers(git: GitService): void {
  ipcMain.handle('git:status', (_event, args: { workspacePath: string }) => {
    return git.status(args.workspacePath);
  });

  ipcMain.handle(
    'git:diff',
    (_event, args: { workspacePath: string; filePath: string; staged: boolean }) => {
      return git.diff(args.workspacePath, args.filePath, args.staged);
    }
  );

  ipcMain.handle('git:get-diff', (_event, args: { workspacePath: string }) => {
    return git.getStructuredDiff(args.workspacePath);
  });

  ipcMain.handle('git:stage-all', (_event, args: { workspacePath: string }) => {
    return git.stageAll(args.workspacePath);
  });

  ipcMain.handle('git:commit', (_event, args: { workspacePath: string; message: string }) => {
    return git.commit(args.workspacePath, args.message);
  });

  ipcMain.handle('git:fs-read-dir', (_event, args: { dirPath: string }) => {
    return git.readDir(args.dirPath);
  });
}
