import { ipcMain } from 'electron';
import { v4 as uuidv4 } from 'uuid';
import * as net from 'net';
import { eq, asc } from 'drizzle-orm';
import type { DatabaseManager } from '../db/database';
import * as schema from '../db/schema';

function rowToMcpServer(row: schema.McpServer) {
  return {
    id: row.id,
    name: row.name,
    url: row.url,
    enabled: Boolean(row.enabled),
    status: row.status as 'connected' | 'offline' | 'error',
    errorMsg: row.errorMsg,
    createdAt: row.createdAt,
  };
}

function checkSocketConnection(host: string, port: number, timeout = 3000): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(timeout);
    socket.on('connect', () => { socket.destroy(); resolve(true); });
    socket.on('error', () => { socket.destroy(); resolve(false); });
    socket.on('timeout', () => { socket.destroy(); resolve(false); });
    socket.connect(port, host);
  });
}

export function registerMcpHandlers(db: DatabaseManager): void {
  const drizzle = db.drizzle;

  ipcMain.handle('mcp:list', () => {
    return drizzle
      .select()
      .from(schema.mcpServers)
      .orderBy(asc(schema.mcpServers.createdAt))
      .all()
      .map(rowToMcpServer);
  });

  ipcMain.handle('mcp:add', (_event, args: { name: string; url: string }) => {
    const id = uuidv4();
    drizzle.insert(schema.mcpServers).values({
      id,
      name: args.name,
      url: args.url,
    }).run();

    const [inserted] = drizzle
      .select()
      .from(schema.mcpServers)
      .where(eq(schema.mcpServers.id, id))
      .all();
    return rowToMcpServer(inserted);
  });

  ipcMain.handle('mcp:delete', (_event, args: { id: string }) => {
    drizzle.delete(schema.mcpServers).where(eq(schema.mcpServers.id, args.id)).run();
  });

  ipcMain.handle('mcp:toggle', (_event, args: { id: string; enabled: boolean }) => {
    drizzle.update(schema.mcpServers)
      .set({ enabled: args.enabled })
      .where(eq(schema.mcpServers.id, args.id))
      .run();

    const [updated] = drizzle
      .select()
      .from(schema.mcpServers)
      .where(eq(schema.mcpServers.id, args.id))
      .all();
    return rowToMcpServer(updated);
  });

  ipcMain.handle(
    'mcp:update-status',
    (_event, args: { id: string; status: string; errorMsg: string | null }) => {
      drizzle.update(schema.mcpServers)
        .set({ status: args.status, errorMsg: args.errorMsg })
        .where(eq(schema.mcpServers.id, args.id))
        .run();

      const [updated] = drizzle
        .select()
        .from(schema.mcpServers)
        .where(eq(schema.mcpServers.id, args.id))
        .all();
      return rowToMcpServer(updated);
    }
  );

  ipcMain.handle('mcp:check-servers', async () => {
    const servers = drizzle
      .select()
      .from(schema.mcpServers)
      .where(eq(schema.mcpServers.enabled, true))
      .all();

    const results = await Promise.all(
      servers.map(async (server) => {
        try {
          const url = new URL(server.url);
          const host = url.hostname;
          const port = parseInt(url.port || '80', 10);
          const connected = await checkSocketConnection(host, port);
          const status = connected ? 'connected' : 'offline';
          drizzle.update(schema.mcpServers)
            .set({ status, errorMsg: null })
            .where(eq(schema.mcpServers.id, server.id))
            .run();
        } catch (err) {
          drizzle.update(schema.mcpServers)
            .set({ status: 'error', errorMsg: String(err) })
            .where(eq(schema.mcpServers.id, server.id))
            .run();
        }

        const [updated] = drizzle
          .select()
          .from(schema.mcpServers)
          .where(eq(schema.mcpServers.id, server.id))
          .all();
        return rowToMcpServer(updated);
      })
    );

    return results;
  });
}
