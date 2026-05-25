import { ipcMain } from 'electron';
import { v4 as uuidv4 } from 'uuid';
import { eq, desc, asc } from 'drizzle-orm';
import type { DatabaseManager } from '../db/database';
import * as schema from '../db/schema';
import type { Agent } from '@maestro/shared-types';

function rowToAgent(row: schema.Agent): Agent {
  return {
    id: row.id,
    name: row.name,
    command: row.command,
    args: JSON.parse(row.args) as string[],
    env: JSON.parse(row.env) as Record<string, string>,
    isBuiltIn: Boolean(row.isBuiltIn),
  };
}

export function registerAgentHandlers(db: DatabaseManager): void {
  const drizzle = db.drizzle;

  ipcMain.handle('agent:list', () => {
    return drizzle
      .select()
      .from(schema.agents)
      .orderBy(desc(schema.agents.isBuiltIn), asc(schema.agents.name))
      .all()
      .map(rowToAgent);
  });

  ipcMain.handle(
    'agent:create',
    (
      _event,
      args: { name: string; command: string; args: string[]; env: Record<string, string> }
    ) => {
      const id = uuidv4();
      drizzle.insert(schema.agents).values({
        id,
        name: args.name,
        command: args.command,
        args: JSON.stringify(args.args),
        env: JSON.stringify(args.env),
        isBuiltIn: false,
      }).run();

      const [inserted] = drizzle
        .select()
        .from(schema.agents)
        .where(eq(schema.agents.id, id))
        .all();
      return rowToAgent(inserted);
    }
  );

  ipcMain.handle(
    'agent:update',
    (
      _event,
      args: { id: string; name: string; command: string; args: string[]; env: Record<string, string> }
    ) => {
      const [agent] = drizzle
        .select({ isBuiltIn: schema.agents.isBuiltIn })
        .from(schema.agents)
        .where(eq(schema.agents.id, args.id))
        .all();

      if (!agent) throw new Error(`Agent ${args.id} not found`);
      if (agent.isBuiltIn) throw new Error('Cannot modify built-in agents');

      drizzle.update(schema.agents)
        .set({
          name: args.name,
          command: args.command,
          args: JSON.stringify(args.args),
          env: JSON.stringify(args.env),
        })
        .where(eq(schema.agents.id, args.id))
        .run();

      const [updated] = drizzle
        .select()
        .from(schema.agents)
        .where(eq(schema.agents.id, args.id))
        .all();
      return rowToAgent(updated);
    }
  );

  ipcMain.handle('agent:delete', (_event, args: { id: string }) => {
    const [agent] = drizzle
      .select({ isBuiltIn: schema.agents.isBuiltIn })
      .from(schema.agents)
      .where(eq(schema.agents.id, args.id))
      .all();

    if (!agent) throw new Error(`Agent ${args.id} not found`);
    if (agent.isBuiltIn) throw new Error('Cannot delete built-in agents');

    drizzle.delete(schema.agents).where(eq(schema.agents.id, args.id)).run();
  });
}
