import { ipcMain } from 'electron';
import { v4 as uuidv4 } from 'uuid';
import * as net from 'net';
import type { DatabaseManager } from '../db/database';

interface McpServerRow {
  id: string;
  name: string;
  url: string;
  enabled: number;
  status: string;
  error_msg: string | null;
  created_at: string;
}

function rowToMcpServer(row: McpServerRow) {
  return {
    id: row.id,
    name: row.name,
    url: row.url,
    enabled: Boolean(row.enabled),
    status: row.status as 'connected' | 'offline' | 'error',
    errorMsg: row.error_msg,
    createdAt: row.created_at,
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
  const database = db.getDb();

  ipcMain.handle('mcp:list', () => {
    return database.prepare('SELECT * FROM mcp_servers ORDER BY created_at').all().map((r) => rowToMcpServer(r as McpServerRow));
  });

  ipcMain.handle('mcp:add', (_event, args: { name: string; url: string }) => {
    const id = uuidv4();
    database
      .prepare(`INSERT INTO mcp_servers (id, name, url) VALUES (?, ?, ?)`)
      .run(id, args.name, args.url);

    return rowToMcpServer(database.prepare('SELECT * FROM mcp_servers WHERE id = ?').get(id) as McpServerRow);
  });

  ipcMain.handle('mcp:delete', (_event, args: { id: string }) => {
    database.prepare('DELETE FROM mcp_servers WHERE id = ?').run(args.id);
  });

  ipcMain.handle('mcp:toggle', (_event, args: { id: string; enabled: boolean }) => {
    database
      .prepare(`UPDATE mcp_servers SET enabled = ? WHERE id = ?`)
      .run(args.enabled ? 1 : 0, args.id);

    return rowToMcpServer(database.prepare('SELECT * FROM mcp_servers WHERE id = ?').get(args.id) as McpServerRow);
  });

  ipcMain.handle(
    'mcp:update-status',
    (_event, args: { id: string; status: string; errorMsg: string | null }) => {
      database
        .prepare(`UPDATE mcp_servers SET status = ?, error_msg = ? WHERE id = ?`)
        .run(args.status, args.errorMsg, args.id);

      return rowToMcpServer(database.prepare('SELECT * FROM mcp_servers WHERE id = ?').get(args.id) as McpServerRow);
    }
  );

  ipcMain.handle('mcp:check-servers', async () => {
    const servers = database
      .prepare('SELECT * FROM mcp_servers WHERE enabled = 1')
      .all() as McpServerRow[];

    const results = await Promise.all(
      servers.map(async (server) => {
        try {
          const url = new URL(server.url);
          const host = url.hostname;
          const port = parseInt(url.port || '80', 10);
          const connected = await checkSocketConnection(host, port);
          const status = connected ? 'connected' : 'offline';
          database
            .prepare(`UPDATE mcp_servers SET status = ?, error_msg = NULL WHERE id = ?`)
            .run(status, server.id);
        } catch (err) {
          database
            .prepare(`UPDATE mcp_servers SET status = 'error', error_msg = ? WHERE id = ?`)
            .run(String(err), server.id);
        }
        return rowToMcpServer(database.prepare('SELECT * FROM mcp_servers WHERE id = ?').get(server.id) as McpServerRow);
      })
    );

    return results;
  });
}
