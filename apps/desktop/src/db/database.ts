import Database from 'better-sqlite3';
import * as path from 'path';
import { app } from 'electron';
import log from 'electron-log';
import { drizzle } from 'drizzle-orm/better-sqlite3';
import { migrate as drizzleMigrate } from 'drizzle-orm/better-sqlite3/migrator';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';
import * as schema from './schema';

export class DatabaseManager {
  private db: Database.Database;
  /** drizzle-orm 인스턴스 — 타입 안전 쿼리에 사용 */
  public drizzle: BetterSQLite3Database<typeof schema>;

  constructor(dbPath?: string) {
    const resolvedPath = dbPath ?? path.join(app.getPath('userData'), 'maestro.db');
    this.db = new Database(resolvedPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('foreign_keys = ON');
    this.drizzle = drizzle(this.db, { schema });
    this.initialize();
    log.info(`Database initialized at ${resolvedPath}`);
  }

  /**
   * drizzle-kit 마이그레이션을 실행한다.
   * `drizzle/` 폴더의 SQL 파일을 순서대로 적용하며, 이미 적용된 파일은 건너뛴다.
   */
  migrate(migrationsFolder: string): void {
    drizzleMigrate(this.drizzle, { migrationsFolder });
    log.info(`Drizzle migrations applied from ${migrationsFolder}`);
  }

  private initialize(): void {
    // drizzle migrate로 테이블 생성 — schema.ts 기준 전체 DDL 적용
    // 개발: out/main/ → out/drizzle/  (빌드 후 copyDrizzleMigrationsPlugin이 복사)
    // 소스: src/db/ → ../../drizzle/ (vite dev 모드에서는 ts-node 경로)
    const migrationsFolder = path.join(__dirname, '..', 'drizzle');
    this.migrate(migrationsFolder);

    // 앱 재시작 시 PTY 프로세스는 모두 사라지므로 running/pending → stopped 리셋
    this.db.exec(`UPDATE sessions SET status = 'stopped', pid = NULL WHERE status IN ('running', 'pending')`);

    this.seedBuiltInAgents();
    this.migrateSessionsFavorite();
    this.migrateSessionCosts();
    this.migrateM4Pipeline();
    this.migrateM4Presets();
    this.migrateM4Labels();
    this.migrateM5WorkspaceAutomation();
    this.migrateM6RemoteControl();
    this.migrateM7Performance();
    this.migrateM9Sharing();
    this.migrateM10Plugins();
    this.migrateM11AgentEditor();
  }

  /** M2-06: sessions 테이블에 is_favorite 컬럼 추가 (기존 DB 마이그레이션) */
  private migrateSessionsFavorite(): void {
    const cols = this.db
      .prepare(`PRAGMA table_info(sessions)`)
      .all() as Array<{ name: string }>;
    if (!cols.some((c) => c.name === 'is_favorite')) {
      this.db.exec(`ALTER TABLE sessions ADD COLUMN is_favorite INTEGER NOT NULL DEFAULT 0`);
    }
  }

  /** M3-01: session_costs 테이블 추가 (기존 DB 마이그레이션) */
  private migrateSessionCosts(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS session_costs (
        id            TEXT PRIMARY KEY,
        session_id    TEXT NOT NULL,
        input_tokens  INTEGER NOT NULL DEFAULT 0,
        output_tokens INTEGER NOT NULL DEFAULT 0,
        cost_usd      REAL NOT NULL DEFAULT 0,
        created_at    TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_session_costs_session ON session_costs(session_id);
    `);
  }

  /** M4-01/02: sessions 테이블에 depends_on_session_id, context_source_session_id 컬럼 추가 */
  private migrateM4Pipeline(): void {
    const cols = this.db
      .prepare(`PRAGMA table_info(sessions)`)
      .all() as Array<{ name: string }>;
    if (!cols.some((c) => c.name === 'depends_on_session_id')) {
      this.db.exec(`ALTER TABLE sessions ADD COLUMN depends_on_session_id TEXT`);
    }
    if (!cols.some((c) => c.name === 'context_source_session_id')) {
      this.db.exec(`ALTER TABLE sessions ADD COLUMN context_source_session_id TEXT`);
    }
  }

  /** M4-04: agent_presets 테이블 추가 */
  private migrateM4Presets(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS agent_presets (
        id              TEXT PRIMARY KEY,
        name            TEXT NOT NULL,
        agent_id        TEXT NOT NULL,
        workspace_id    TEXT NOT NULL,
        initial_command TEXT NOT NULL DEFAULT '',
        env_vars        TEXT NOT NULL DEFAULT '{}',
        created_at      TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
  }

  /** M4-05: session_labels 테이블 추가 */
  private migrateM4Labels(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS session_labels (
        session_id  TEXT NOT NULL,
        label_name  TEXT NOT NULL,
        label_color TEXT NOT NULL DEFAULT '#6366f1',
        PRIMARY KEY (session_id, label_name)
      );
    `);
  }

  /** M5: 워크스페이스 자동화 — 테이블 생성 + 컬럼 추가 */
  private migrateM5WorkspaceAutomation(): void {
    // F-M5-01: workspace_templates 테이블
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS workspace_templates (
        id              TEXT PRIMARY KEY,
        name            TEXT NOT NULL,
        description     TEXT NOT NULL DEFAULT '',
        agent_type      TEXT NOT NULL DEFAULT '',
        env_vars        TEXT NOT NULL DEFAULT '{}',
        setup_script    TEXT NOT NULL DEFAULT '',
        teardown_script TEXT NOT NULL DEFAULT '',
        branch_pattern  TEXT NOT NULL DEFAULT '',
        created_at      TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);

    // F-M5-02: workspace_snapshots 테이블
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS workspace_snapshots (
        id            TEXT PRIMARY KEY,
        workspace_id  TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
        env_vars      TEXT NOT NULL DEFAULT '{}',
        git_head      TEXT NOT NULL DEFAULT '',
        setup_script  TEXT NOT NULL DEFAULT '',
        created_at    TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_workspace_snapshots_ws ON workspace_snapshots(workspace_id, created_at DESC);
    `);

    // F-M5-03: workspaces 테이블에 lifecycle hook 컬럼 추가
    const cols = this.db
      .prepare(`PRAGMA table_info(workspaces)`)
      .all() as Array<{ name: string }>;
    if (!cols.some((c) => c.name === 'hook_on_session_start')) {
      this.db.exec(`ALTER TABLE workspaces ADD COLUMN hook_on_session_start TEXT NOT NULL DEFAULT ''`);
    }
    if (!cols.some((c) => c.name === 'hook_on_agent_complete')) {
      this.db.exec(`ALTER TABLE workspaces ADD COLUMN hook_on_agent_complete TEXT NOT NULL DEFAULT ''`);
    }
    if (!cols.some((c) => c.name === 'hook_on_error')) {
      this.db.exec(`ALTER TABLE workspaces ADD COLUMN hook_on_error TEXT NOT NULL DEFAULT ''`);
    }

    // 기본 제공 템플릿 3종 seed
    this.seedBuiltInTemplates();
  }

  /** M6: 원격 제어 — webhooks, webhook_logs, api_keys 테이블 생성 */
  private migrateM6RemoteControl(): void {
    // F-M6-02: webhooks 테이블
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS webhooks (
        id          TEXT PRIMARY KEY,
        url         TEXT NOT NULL,
        events      TEXT NOT NULL DEFAULT '[]',
        secret      TEXT NOT NULL DEFAULT '',
        enabled     INTEGER NOT NULL DEFAULT 1,
        created_at  TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);

    // F-M6-02: webhook_logs 테이블
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS webhook_logs (
        id            TEXT PRIMARY KEY,
        webhook_id    TEXT NOT NULL,
        event         TEXT NOT NULL,
        status_code   INTEGER,
        response_body TEXT NOT NULL DEFAULT '',
        created_at    TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_webhook_logs_webhook ON webhook_logs(webhook_id, created_at DESC);
    `);

    // F-M6-03: api_keys 테이블
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS api_keys (
        id          TEXT PRIMARY KEY,
        key         TEXT NOT NULL UNIQUE,
        name        TEXT NOT NULL DEFAULT 'Default',
        created_at  TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
  }

  /** M7-04: sessions 테이블에 last_exit_code 컬럼 추가 */
  private migrateM7Performance(): void {
    const cols = this.db
      .prepare(`PRAGMA table_info(sessions)`)
      .all() as Array<{ name: string }>;
    if (!cols.some((c) => c.name === 'last_exit_code')) {
      this.db.exec(`ALTER TABLE sessions ADD COLUMN last_exit_code INTEGER`);
    }
  }

  private seedBuiltInTemplates(): void {
    const insert = this.db.prepare(
      `INSERT OR IGNORE INTO workspace_templates (id, name, description, agent_type, env_vars, setup_script, teardown_script, branch_pattern)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    );

    const builtIns = [
      {
        id: 'builtin-tpl-claude',
        name: 'Claude Code Starter',
        description: 'Claude Code agent with default settings',
        agentType: 'claude-code',
        envVars: {},
        setupScript: '',
        teardownScript: '',
        branchPattern: 'feat/',
      },
      {
        id: 'builtin-tpl-codex',
        name: 'Codex Starter',
        description: 'OpenAI Codex agent with default settings',
        agentType: 'codex',
        envVars: {},
        setupScript: '',
        teardownScript: '',
        branchPattern: 'feat/',
      },
      {
        id: 'builtin-tpl-gemini',
        name: 'Gemini Starter',
        description: 'Google Gemini agent with default settings',
        agentType: 'gemini',
        envVars: {},
        setupScript: '',
        teardownScript: '',
        branchPattern: 'feat/',
      },
    ];

    for (const tpl of builtIns) {
      insert.run(
        tpl.id,
        tpl.name,
        tpl.description,
        tpl.agentType,
        JSON.stringify(tpl.envVars),
        tpl.setupScript,
        tpl.teardownScript,
        tpl.branchPattern,
      );
    }
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

  /** M9: 세션 아카이브 설정 + 내보내기 지원 */
  private migrateM9Sharing(): void {
    // session_archives: 세션 종료 시 아카이브 로그 경로 저장
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS session_archives (
        session_id   TEXT PRIMARY KEY,
        session_name TEXT NOT NULL DEFAULT '',
        log_path     TEXT NOT NULL,
        archived_at  TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE INDEX IF NOT EXISTS idx_session_archives_date ON session_archives(archived_at DESC);
    `);
  }

  /** M10: 플러그인 & 에이전트 스크립트 지원 */
  private migrateM10Plugins(): void {
    // plugins 테이블
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS plugins (
        id         TEXT PRIMARY KEY,
        name       TEXT NOT NULL,
        version    TEXT NOT NULL DEFAULT '0.0.0',
        path       TEXT NOT NULL UNIQUE,
        enabled    INTEGER NOT NULL DEFAULT 1,
        loaded_at  TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);

    // agents 테이블에 script_path, script_content 컬럼 추가 (커스텀 에이전트 스크립트용)
    const cols = this.db
      .prepare(`PRAGMA table_info(agents)`)
      .all() as Array<{ name: string }>;
    if (!cols.some((c) => c.name === 'script_path')) {
      this.db.exec(`ALTER TABLE agents ADD COLUMN script_path TEXT`);
    }
    if (!cols.some((c) => c.name === 'script_content')) {
      this.db.exec(`ALTER TABLE agents ADD COLUMN script_content TEXT`);
    }
  }

  /** M11: AI Agent Editor — projects, tasks 테이블 생성 + workspaces.task_id 컬럼 추가 */
  private migrateM11AgentEditor(): void {
    // projects 테이블
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS projects (
        id            TEXT PRIMARY KEY,
        name          TEXT NOT NULL,
        description   TEXT,
        repository_id TEXT REFERENCES repositories(id) ON DELETE SET NULL,
        created_at    INTEGER NOT NULL,
        updated_at    INTEGER NOT NULL
      );
    `);

    // tasks 테이블
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS tasks (
        id                  TEXT PRIMARY KEY,
        project_id          TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
        parent_task_id      TEXT REFERENCES tasks(id) ON DELETE SET NULL,
        title               TEXT NOT NULL,
        prd                 TEXT,
        spec                TEXT,
        reference_files     TEXT,
        acceptance_criteria TEXT,
        priority            TEXT NOT NULL DEFAULT 'medium',
        assigned_agent_id   TEXT,
        status              TEXT NOT NULL DEFAULT 'pending',
        created_by          TEXT NOT NULL DEFAULT 'human',
        workspace_id        TEXT,
        created_at          INTEGER NOT NULL,
        updated_at          INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_tasks_project ON tasks(project_id);
      CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(project_id, status);
    `);

    // workspaces 테이블에 task_id 컬럼 추가
    const wsCols = this.db
      .prepare(`PRAGMA table_info(workspaces)`)
      .all() as Array<{ name: string }>;
    if (!wsCols.some((c) => c.name === 'task_id')) {
      this.db.exec(`ALTER TABLE workspaces ADD COLUMN task_id TEXT REFERENCES tasks(id) ON DELETE SET NULL`);
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
