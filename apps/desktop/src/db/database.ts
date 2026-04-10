import Database from 'better-sqlite3';
import * as path from 'path';
import { app } from 'electron';
import log from 'electron-log';

export class DatabaseManager {
  private db: Database.Database;

  constructor(dbPath?: string) {
    const resolvedPath = dbPath ?? path.join(app.getPath('userData'), 'maestro.db');
    this.db = new Database(resolvedPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.initialize();
    log.info(`Database initialized at ${resolvedPath}`);
  }

  private initialize(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS repositories (
        id          TEXT PRIMARY KEY,
        name        TEXT NOT NULL,
        path        TEXT NOT NULL UNIQUE,
        color       TEXT NOT NULL DEFAULT '#6366f1',
        branch_prefix    TEXT NOT NULL DEFAULT '',
        base_branch      TEXT NOT NULL DEFAULT 'main',
        worktree_base_path TEXT NOT NULL DEFAULT '',
        setup_script     TEXT NOT NULL DEFAULT '',
        teardown_script  TEXT NOT NULL DEFAULT '',
        created_at  TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS env_vars (
        id              TEXT PRIMARY KEY,
        repository_id   TEXT NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
        key             TEXT NOT NULL,
        value           TEXT NOT NULL,
        UNIQUE(repository_id, key)
      );

      CREATE TABLE IF NOT EXISTS workspaces (
        id              TEXT PRIMARY KEY,
        name            TEXT NOT NULL,
        repository_id   TEXT NOT NULL REFERENCES repositories(id) ON DELETE CASCADE,
        branch          TEXT NOT NULL,
        worktree_path   TEXT NOT NULL,
        created_at      TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS agents (
        id          TEXT PRIMARY KEY,
        name        TEXT NOT NULL,
        command     TEXT NOT NULL,
        args        TEXT NOT NULL DEFAULT '[]',
        env         TEXT NOT NULL DEFAULT '{}',
        is_built_in INTEGER NOT NULL DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS sessions (
        id            TEXT PRIMARY KEY,
        name          TEXT NOT NULL,
        workspace_id  TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        agent_id      TEXT NOT NULL REFERENCES agents(id),
        status        TEXT NOT NULL DEFAULT 'stopped',
        pid           INTEGER,
        created_at    TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS mcp_servers (
        id          TEXT PRIMARY KEY,
        name        TEXT NOT NULL,
        url         TEXT NOT NULL UNIQUE,
        enabled     INTEGER NOT NULL DEFAULT 1,
        status      TEXT NOT NULL DEFAULT 'offline',
        error_msg   TEXT,
        created_at  TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS app_state (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS session_scrollbacks (
        session_id  TEXT PRIMARY KEY,
        data        TEXT NOT NULL DEFAULT '',
        updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS prompt_history (
        id          TEXT PRIMARY KEY,
        session_id  TEXT NOT NULL,
        text        TEXT NOT NULL,
        created_at  TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_prompt_history_session ON prompt_history(session_id, created_at DESC);

      CREATE TABLE IF NOT EXISTS tiled_layouts (
        id           TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        mosaic_state TEXT NOT NULL DEFAULT '{}',
        updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS panes (
        id         TEXT PRIMARY KEY,
        layout_id  TEXT NOT NULL REFERENCES tiled_layouts(id) ON DELETE CASCADE,
        type       TEXT NOT NULL DEFAULT 'terminal',
        session_id TEXT REFERENCES sessions(id) ON DELETE SET NULL,
        position   TEXT NOT NULL DEFAULT '{}'
      );
    `);

    this.seedBuiltInAgents();
  }

  private seedBuiltInAgents(): void {
    const insert = this.db.prepare(
      `INSERT OR IGNORE INTO agents (id, name, command, args, env, is_built_in) VALUES (?, ?, ?, ?, ?, 1)`
    );

    const builtIns = [
      { id: 'builtin-claude',    name: 'Claude Code', command: 'claude',    args: [] },
      { id: 'builtin-gemini',    name: 'Gemini',      command: 'gemini',    args: [] },

      { id: 'builtin-opencode',  name: 'OpenCode',    command: 'opencode',  args: [] },
      { id: 'builtin-codex',     name: 'Codex',       command: 'codex',     args: [] },
    ];

    for (const agent of builtIns) {
      insert.run(agent.id, agent.name, agent.command, JSON.stringify(agent.args), '{}');
    }
  }

  // ── tiled_layouts ──────────────────────────────────────────────────────────

  getTiledLayout(workspaceId: string): { id: string; workspaceId: string; mosaicState: string; updatedAt: string } | null {
    const row = this.db
      .prepare('SELECT id, workspace_id, mosaic_state, updated_at FROM tiled_layouts WHERE workspace_id = ?')
      .get(workspaceId) as { id: string; workspace_id: string; mosaic_state: string; updated_at: string } | undefined;

    if (!row) return null;

    return {
      id: row.id,
      workspaceId: row.workspace_id,
      mosaicState: row.mosaic_state,
      updatedAt: row.updated_at,
    };
  }

  saveTiledLayout(workspaceId: string, mosaicState: string): { id: string; workspaceId: string; mosaicState: string; updatedAt: string } {
    const existing = this.getTiledLayout(workspaceId);

    if (existing) {
      this.db
        .prepare(`UPDATE tiled_layouts SET mosaic_state = ?, updated_at = datetime('now') WHERE workspace_id = ?`)
        .run(mosaicState, workspaceId);
      return { ...existing, mosaicState, updatedAt: new Date().toISOString() };
    }

    const id = crypto.randomUUID();
    this.db
      .prepare(`INSERT INTO tiled_layouts (id, workspace_id, mosaic_state) VALUES (?, ?, ?)`)
      .run(id, workspaceId, mosaicState);

    return { id, workspaceId, mosaicState, updatedAt: new Date().toISOString() };
  }

  // ── panes ───────────────────────────────────────────────────────────────────

  getPanesByLayout(layoutId: string): { id: string; layoutId: string; type: string; sessionId: string | null; position: string }[] {
    const rows = this.db
      .prepare('SELECT id, layout_id, type, session_id, position FROM panes WHERE layout_id = ?')
      .all(layoutId) as { id: string; layout_id: string; type: string; session_id: string | null; position: string }[];

    return rows.map((row) => ({
      id: row.id,
      layoutId: row.layout_id,
      type: row.type,
      sessionId: row.session_id,
      position: row.position,
    }));
  }

  upsertPane(pane: { id: string; layoutId: string; type?: string; sessionId?: string | null; position?: string }): void {
    this.db
      .prepare(`
        INSERT INTO panes (id, layout_id, type, session_id, position)
        VALUES (@id, @layoutId, @type, @sessionId, @position)
        ON CONFLICT(id) DO UPDATE SET
          layout_id  = excluded.layout_id,
          type       = excluded.type,
          session_id = excluded.session_id,
          position   = excluded.position
      `)
      .run({
        id: pane.id,
        layoutId: pane.layoutId,
        type: pane.type ?? 'terminal',
        sessionId: pane.sessionId ?? null,
        position: pane.position ?? '{}',
      });
  }

  deletePane(paneId: string): void {
    this.db.prepare('DELETE FROM panes WHERE id = ?').run(paneId);
  }

  // ───────────────────────────────────────────────────────────────────────────

  getDb(): Database.Database {
    return this.db;
  }

  close(): void {
    this.db.close();
  }
}

let instance: DatabaseManager | null = null;

export function getDatabaseManager(): DatabaseManager {
  if (!instance) {
    instance = new DatabaseManager();
  }
  return instance;
}

export function closeDatabaseManager(): void {
  instance?.close();
  instance = null;
}
