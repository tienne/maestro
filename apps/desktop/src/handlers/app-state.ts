import { ipcMain } from 'electron';
import { AppStateService } from '../services/app-state-service';
import type { AppState } from '../services/app-state-service';

export function registerAppStateHandlers(): void {
  ipcMain.handle('app-state:load', (): AppState => {
    return AppStateService.getInstance().get();
  });

  ipcMain.handle('app-state:save', async (_event, args: { state: Partial<AppState> }) => {
    await AppStateService.getInstance().set(args.state);
  });
}
