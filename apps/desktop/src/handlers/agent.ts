import { ipcMain } from 'electron';
import { v4 as uuidv4 } from 'uuid';
import type { DatabaseManager } from '../db/database';
import type { Agent } from '@maestro/shared-types';

function rowToAgent(row: Record<string, unknown>): Agent {
  return {
    id: row.id as string,
    name: row.name as string,
    command: row.command as string,
    args: JSON.parse(row.args as string) as string[],
    env: JSON.parse(row.env as string) as Record<string, string>,
    isBuiltIn: Boolean(row.is_built_in),
  };
}

export function registerAgentHandlers(db: DatabaseManager): void {
  const database = db.getDb();

  ipcMain.handle('agent:list', () => {
    return database.prepare('SELECT * FROM agents ORDER BY is_built_in DESC, name').all().map((r) => rowToAgent(r as Record<string, unknown>));
  });

  ipcMain.handle(
    'agent:create',
    (
      _event,
      args: { name: string; command: string; args: string[]; env: Record<string, string> }
    ) => {
      const id = uuidv4();
      database
        .prepare(
          `INSERT INTO agents (id, name, command, args, env, is_built_in) VALUES (?, ?, ?, ?, ?, 0)`
        )
        .run(id, args.name, args.command, JSON.stringify(args.args), JSON.stringify(args.env));

      return rowToAgent(database.prepare('SELECT * FROM agents WHERE id = ?').get(id) as Record<string, unknown>);
    }
  );

  ipcMain.handle(
    'agent:update',
    (
      _event,
      args: { id: string; name: string; command: string; args: string[]; env: Record<string, string> }
    ) => {
      const agent = database
        .prepare('SELECT is_built_in FROM agents WHERE id = ?')
        .get(args.id) as { is_built_in: number } | undefined;

      if (!agent) throw new Error(`Agent ${args.id} not found`);
      if (agent.is_built_in) throw new Error('Cannot modify built-in agents');

      database
        .prepare(
          `UPDATE agents SET name = ?, command = ?, args = ?, env = ? WHERE id = ?`
        )
        .run(args.name, args.command, JSON.stringify(args.args), JSON.stringify(args.env), args.id);

      return rowToAgent(database.prepare('SELECT * FROM agents WHERE id = ?').get(args.id) as Record<string, unknown>);
    }
  );

  ipcMain.handle('agent:delete', (_event, args: { id: string }) => {
    const agent = database
      .prepare('SELECT is_built_in FROM agents WHERE id = ?')
      .get(args.id) as { is_built_in: number } | undefined;

    if (!agent) throw new Error(`Agent ${args.id} not found`);
    if (agent.is_built_in) throw new Error('Cannot delete built-in agents');

    database.prepare('DELETE FROM agents WHERE id = ?').run(args.id);
  });
}
