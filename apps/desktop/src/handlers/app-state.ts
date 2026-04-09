import { ipcMain } from 'electron';
import type { DatabaseManager } from '../db/database';
import type { AppState } from '@maestro/shared-types';

export function registerAppStateHandlers(db: DatabaseManager): void {
  const database = db.getDb();

  ipcMain.handle('app-state:load', (): AppState => {
    const row = database
      .prepare(`SELECT value FROM app_state WHERE key = 'ui_state'`)
      .get() as { value: string } | undefined;

    if (!row) {
      return { sidebarWidth: 240, rightSidebarWidth: 320 };
    }

    return JSON.parse(row.value) as AppState;
  });

  ipcMain.handle('app-state:save', (_event, args: { state: AppState }) => {
    database
      .prepare(
        `INSERT INTO app_state (key, value) VALUES ('ui_state', ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value`
      )
      .run(JSON.stringify(args.state));
  });
}
