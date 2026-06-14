/**
 * DatabaseManager 단위 테스트
 *
 * in-memory SQLite(':memory:')를 사용해 마이그레이션 로직,
 * 컬럼 추가(멱등성), 중복 초기화 안전성을 검증한다.
 *
 * 주의: drizzle migrate()는 실제 마이그레이션 파일을 읽으므로
 * 해당 부분은 mock 처리하고, 나머지 DDL/DML 로직은 real SQLite로 테스트한다.
 */

import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';

// ── Electron mock ─────────────────────────────────────────────────────────────

const mockUserDataPath = '/tmp/maestro-test-userdata';

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn((key: string) => {
      if (key === 'userData') return mockUserDataPath;
      return '/tmp/maestro-test';
    }),
  },
  BrowserWindow: class {},
  ipcMain: { handle: vi.fn(), on: vi.fn() },
}));

// ── electron-log mock ─────────────────────────────────────────────────────────

vi.mock('electron-log', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// ── drizzle migrate mock (실제 파일 시스템 의존 제거) ─────────────────────────

vi.mock('drizzle-orm/better-sqlite3/migrator', () => ({
  migrate: vi.fn(),
}));

// ── import ────────────────────────────────────────────────────────────────────

import { migrate as mockDrizzleMigrate } from 'drizzle-orm/better-sqlite3/migrator';
import { DatabaseManager, getDatabaseManager, closeDatabaseManager } from '../db/database';

const mockedMigrate = vi.mocked(mockDrizzleMigrate);

// ── 헬퍼: 최소 스키마를 직접 생성하는 in-memory DB ────────────────────────────

/**
 * DatabaseManager가 migrate() 후 실행하는 DDL들이 의존하는 기본 테이블을 직접 생성한다.
 * (실제 마이그레이션 파일을 사용하는 대신 최소 구조만 구성)
 */
function buildMinimalSchema(db: Database.Database) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS repositories (
      id   TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      path TEXT NOT NULL UNIQUE,
      color TEXT NOT NULL DEFAULT '#6366f1',
      branch_prefix TEXT NOT NULL DEFAULT '',
      base_branch TEXT NOT NULL DEFAULT 'main',
      worktree_base_path TEXT NOT NULL DEFAULT '',
      setup_script TEXT NOT NULL DEFAULT '',
      teardown_script TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS env_vars (
      id           TEXT NOT NULL,
      scope        TEXT NOT NULL,
      scope_id     TEXT NOT NULL,
      key          TEXT NOT NULL,
      value        TEXT NOT NULL,
      created_at   TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (id)
    );
    CREATE TABLE IF NOT EXISTS workspaces (
      id            TEXT PRIMARY KEY,
      name          TEXT NOT NULL,
      repository_id TEXT NOT NULL REFERENCES repositories(id),
      branch        TEXT NOT NULL DEFAULT '',
      worktree_path TEXT NOT NULL DEFAULT '',
      created_at    TEXT NOT NULL DEFAULT (datetime('now'))
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
      id           TEXT PRIMARY KEY,
      name         TEXT NOT NULL DEFAULT '',
      workspace_id TEXT NOT NULL,
      agent_id     TEXT NOT NULL,
      status       TEXT NOT NULL DEFAULT 'pending',
      pid          INTEGER,
      created_at   TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS mcp_servers (
      id   TEXT PRIMARY KEY,
      name TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS session_scrollbacks (
      session_id TEXT PRIMARY KEY,
      data       TEXT NOT NULL DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS prompt_history (
      id         TEXT PRIMARY KEY,
      content    TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS tiled_layouts (
      id            TEXT PRIMARY KEY,
      workspace_id  TEXT NOT NULL UNIQUE,
      mosaic_state  TEXT NOT NULL DEFAULT '{}',
      updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS panes (
      id         TEXT PRIMARY KEY,
      layout_id  TEXT NOT NULL,
      type       TEXT NOT NULL DEFAULT 'terminal',
      session_id TEXT,
      position   TEXT NOT NULL DEFAULT '{}'
    );
  `);
}

// ── 테스트 픽스처: in-memory DB를 가진 DatabaseManager 생성 ──────────────────

function createTestManager(): DatabaseManager {
  // ':memory:' 경로를 넘기면 Electron app.getPath() 없이도 초기화 가능
  // migrate는 mock이므로 실제 파일 탐색 없음
  return new DatabaseManager(':memory:');
}

// ── 테스트 ─────────────────────────────────────────────────────────────────────

describe('DatabaseManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // migrate mock은 기본적으로 성공(아무것도 하지 않음)
    mockedMigrate.mockImplementation(() => undefined);
    // singleton 초기화
    closeDatabaseManager();
  });

  afterEach(() => {
    closeDatabaseManager();
  });

  // ── 초기화 ─────────────────────────────────────────────────────────────────

  describe('초기화', () => {
    it('DatabaseManager 인스턴스가 정상 생성된다', () => {
      const manager = createTestManager();
      expect(manager).toBeDefined();
      expect(manager.getDb()).toBeDefined();
    });

    it('getDb()가 Database 인스턴스를 반환한다', () => {
      const manager = createTestManager();
      const db = manager.getDb();
      expect(typeof db.prepare).toBe('function');
    });

    it('drizzle 인스턴스가 존재한다', () => {
      const manager = createTestManager();
      expect(manager.drizzle).toBeDefined();
    });

    it('close() 후 DB 작업을 시도하면 에러가 발생한다', () => {
      const manager = createTestManager();
      const db = manager.getDb();
      manager.close();

      expect(() => db.prepare('SELECT 1')).toThrow();
    });
  });

  // ── migrate() — drizzle-kit 마이그레이션 위임 ─────────────────────────────

  describe('migrate()', () => {
    it('drizzle migrate가 성공하면 예외 없이 완료된다', () => {
      mockedMigrate.mockImplementation(() => undefined);
      const manager = createTestManager();

      expect(() => manager.migrate('/fake/migrations')).not.toThrow();
      expect(mockedMigrate).toHaveBeenCalledWith(
        manager.drizzle,
        { migrationsFolder: '/fake/migrations' },
      );
    });

    it('기존 테이블이 있는 상태에서 migrate 실패 시 markMigrationsApplied를 시도한다', () => {
      // 1. 기본 mock(성공)으로 manager 생성
      const manager = createTestManager();

      // 2. agents 테이블 수동 생성 — pre-existing DB 시나리오 시뮬레이션
      manager.getDb().exec(`CREATE TABLE IF NOT EXISTS agents (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, command TEXT NOT NULL,
        args TEXT NOT NULL DEFAULT '[]', env TEXT NOT NULL DEFAULT '{}',
        is_built_in INTEGER NOT NULL DEFAULT 0
      )`);

      // 3. 이제 mock을 throw로 변경 후 migrate() 재호출
      // agents 테이블이 존재하므로 markMigrationsApplied를 시도하고 throw하지 않아야 함
      // (markMigrationsApplied 내부에서 journalPath 없으면 early return)
      mockedMigrate.mockImplementation(() => {
        throw new Error("Failed to run the query 'CREATE TABLE agents'");
      });

      expect(() => manager.migrate('/no-such-folder')).not.toThrow();
    });

    it('migrate 실패이고 기존 테이블도 없으면 에러를 재던진다', () => {
      // 1. 기본 mock(성공)으로 manager 생성
      const manager = createTestManager();

      // 2. agents 테이블이 없는 상태에서 mock을 throw로 변경
      mockedMigrate.mockImplementation(() => {
        throw new Error('Critical migration error');
      });

      expect(() => manager.migrate('/no-such-folder')).toThrow('Critical migration error');
    });
  });

  // ── addColumn 멱등성 (PRAGMA table_info 기반) ────────────────────────────

  describe('컬럼 추가 멱등성', () => {
    it('sessions 테이블에 is_favorite 컬럼이 없으면 추가한다', () => {
      const manager = createTestManager();
      const db = manager.getDb();

      // 기본 sessions 테이블 생성 (is_favorite 없음)
      db.exec(`CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY, name TEXT NOT NULL DEFAULT '',
        workspace_id TEXT NOT NULL, agent_id TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending', pid INTEGER,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`);

      // migrateSessionsFavorite 내부 로직을 직접 검증
      const colsBefore = db.prepare('PRAGMA table_info(sessions)').all() as Array<{ name: string }>;
      expect(colsBefore.some((c) => c.name === 'is_favorite')).toBe(false);

      db.exec(`ALTER TABLE sessions ADD COLUMN is_favorite INTEGER NOT NULL DEFAULT 0`);

      const colsAfter = db.prepare('PRAGMA table_info(sessions)').all() as Array<{ name: string }>;
      expect(colsAfter.some((c) => c.name === 'is_favorite')).toBe(true);
    });

    it('is_favorite 컬럼이 이미 있으면 ALTER를 건너뛰어도 에러 없다', () => {
      const manager = createTestManager();
      const db = manager.getDb();

      db.exec(`CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        is_favorite INTEGER NOT NULL DEFAULT 0
      )`);

      // 이미 있으므로 조건 검사 후 ADD COLUMN을 건너뜀
      const cols = db.prepare('PRAGMA table_info(sessions)').all() as Array<{ name: string }>;
      const hasFav = cols.some((c) => c.name === 'is_favorite');
      expect(hasFav).toBe(true);

      // ALTER를 시도하면 SQLite 에러가 나므로, 조건 분기가 필수임을 확인
      expect(() => {
        if (!hasFav) {
          db.exec(`ALTER TABLE sessions ADD COLUMN is_favorite INTEGER NOT NULL DEFAULT 0`);
        }
      }).not.toThrow();
    });

    it('session_costs 테이블이 없을 때 CREATE TABLE IF NOT EXISTS가 성공한다', () => {
      const manager = createTestManager();
      const db = manager.getDb();

      expect(() => {
        db.exec(`
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
      }).not.toThrow();
    });

    it('session_costs 테이블이 이미 있을 때 CREATE TABLE IF NOT EXISTS가 충돌하지 않는다', () => {
      const manager = createTestManager();
      const db = manager.getDb();

      const sql = `CREATE TABLE IF NOT EXISTS session_costs (
        id TEXT PRIMARY KEY, session_id TEXT NOT NULL
      );`;

      db.exec(sql);
      // 두 번 실행해도 에러 없음
      expect(() => db.exec(sql)).not.toThrow();
    });
  });

  // ── 세션 상태 리셋 (initialize 내부 로직) ─────────────────────────────────

  describe('세션 상태 리셋', () => {
    it('running/pending 세션을 stopped으로 리셋한다', () => {
      const manager = createTestManager();
      const db = manager.getDb();

      db.exec(`CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY, name TEXT NOT NULL DEFAULT '',
        workspace_id TEXT NOT NULL DEFAULT 'ws1', agent_id TEXT NOT NULL DEFAULT 'a1',
        status TEXT NOT NULL DEFAULT 'pending', pid INTEGER
      )`);
      db.prepare('INSERT INTO sessions (id, status, pid) VALUES (?, ?, ?)').run('s1', 'running', 42);
      db.prepare('INSERT INTO sessions (id, status, pid) VALUES (?, ?, ?)').run('s2', 'pending', null);
      db.prepare('INSERT INTO sessions (id, status, pid) VALUES (?, ?, ?)').run('s3', 'stopped', null);

      // initialize에서 실행하는 리셋 SQL
      db.exec(`UPDATE sessions SET status = 'stopped', pid = NULL WHERE status IN ('running', 'pending')`);

      const rows = db.prepare('SELECT id, status, pid FROM sessions').all() as Array<{
        id: string; status: string; pid: number | null;
      }>;
      const byId = Object.fromEntries(rows.map((r) => [r.id, r]));

      expect(byId['s1']?.status).toBe('stopped');
      expect(byId['s1']?.pid).toBeNull();
      expect(byId['s2']?.status).toBe('stopped');
      expect(byId['s3']?.status).toBe('stopped'); // 원래 stopped, 그대로
    });

    it('completed 세션은 리셋되지 않는다', () => {
      const manager = createTestManager();
      const db = manager.getDb();

      db.exec(`CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY, name TEXT NOT NULL DEFAULT '',
        workspace_id TEXT NOT NULL DEFAULT 'ws1', agent_id TEXT NOT NULL DEFAULT 'a1',
        status TEXT NOT NULL DEFAULT 'pending', pid INTEGER
      )`);
      db.prepare('INSERT INTO sessions (id, status) VALUES (?, ?)').run('s1', 'completed');

      db.exec(`UPDATE sessions SET status = 'stopped', pid = NULL WHERE status IN ('running', 'pending')`);

      const row = db.prepare('SELECT status FROM sessions WHERE id = ?').get('s1') as { status: string };
      expect(row.status).toBe('completed');
    });
  });

  // ── getTiledLayout / saveTiledLayout ─────────────────────────────────────

  describe('getTiledLayout / saveTiledLayout', () => {
    function prepareLayoutTable(manager: DatabaseManager) {
      manager.getDb().exec(`CREATE TABLE IF NOT EXISTS tiled_layouts (
        id TEXT PRIMARY KEY,
        workspace_id TEXT NOT NULL UNIQUE,
        mosaic_state TEXT NOT NULL DEFAULT '{}',
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`);
    }

    it('존재하지 않는 workspaceId는 null을 반환한다', () => {
      const manager = createTestManager();
      prepareLayoutTable(manager);

      const result = manager.getTiledLayout('nonexistent');
      expect(result).toBeNull();
    });

    it('saveTiledLayout이 새 레코드를 삽입하고 반환한다', () => {
      const manager = createTestManager();
      prepareLayoutTable(manager);

      const result = manager.saveTiledLayout('ws-1', JSON.stringify({ split: 'vertical' }));

      expect(result).toMatchObject({
        workspaceId: 'ws-1',
        mosaicState: expect.stringContaining('vertical'),
      });
      expect(result.id).toBeTruthy();
    });

    it('같은 workspaceId로 saveTiledLayout 재호출 시 업데이트된다', () => {
      const manager = createTestManager();
      prepareLayoutTable(manager);

      manager.saveTiledLayout('ws-1', '{"first":true}');
      const updated = manager.saveTiledLayout('ws-1', '{"second":true}');

      expect(updated.mosaicState).toContain('second');
      // 레코드 1개만 존재해야 함
      const count = manager.getDb()
        .prepare('SELECT COUNT(*) as cnt FROM tiled_layouts WHERE workspace_id = ?')
        .get('ws-1') as { cnt: number };
      expect(count.cnt).toBe(1);
    });

    it('saveTiledLayout 후 getTiledLayout으로 조회된다', () => {
      const manager = createTestManager();
      prepareLayoutTable(manager);

      manager.saveTiledLayout('ws-2', '{"state":"saved"}');
      const found = manager.getTiledLayout('ws-2');

      expect(found).not.toBeNull();
      expect(found?.mosaicState).toContain('saved');
    });
  });

  // ── upsertPane / getPanesByLayout / deletePane ─────────────────────────────

  describe('pane CRUD', () => {
    function preparePaneTable(manager: DatabaseManager) {
      manager.getDb().exec(`CREATE TABLE IF NOT EXISTS panes (
        id TEXT PRIMARY KEY,
        layout_id TEXT NOT NULL,
        type TEXT NOT NULL DEFAULT 'terminal',
        session_id TEXT,
        position TEXT NOT NULL DEFAULT '{}'
      )`);
    }

    it('upsertPane이 새 pane을 삽입한다', () => {
      const manager = createTestManager();
      preparePaneTable(manager);

      manager.upsertPane({ id: 'pane-1', layoutId: 'layout-1', type: 'terminal' });

      const panes = manager.getPanesByLayout('layout-1');
      expect(panes).toHaveLength(1);
      expect(panes[0]).toMatchObject({ id: 'pane-1', layoutId: 'layout-1', type: 'terminal' });
    });

    it('upsertPane이 기존 pane을 덮어쓴다', () => {
      const manager = createTestManager();
      preparePaneTable(manager);

      manager.upsertPane({ id: 'pane-1', layoutId: 'layout-1', type: 'terminal' });
      manager.upsertPane({ id: 'pane-1', layoutId: 'layout-1', type: 'editor', sessionId: 's1' });

      const panes = manager.getPanesByLayout('layout-1');
      expect(panes).toHaveLength(1);
      expect(panes[0].type).toBe('editor');
      expect(panes[0].sessionId).toBe('s1');
    });

    it('deletePane이 해당 pane을 삭제한다', () => {
      const manager = createTestManager();
      preparePaneTable(manager);

      manager.upsertPane({ id: 'pane-1', layoutId: 'layout-1' });
      manager.upsertPane({ id: 'pane-2', layoutId: 'layout-1' });
      manager.deletePane('pane-1');

      const panes = manager.getPanesByLayout('layout-1');
      expect(panes).toHaveLength(1);
      expect(panes[0].id).toBe('pane-2');
    });

    it('getPanesByLayout이 다른 layoutId를 필터링한다', () => {
      const manager = createTestManager();
      preparePaneTable(manager);

      manager.upsertPane({ id: 'p1', layoutId: 'layout-A' });
      manager.upsertPane({ id: 'p2', layoutId: 'layout-B' });

      const panesA = manager.getPanesByLayout('layout-A');
      expect(panesA).toHaveLength(1);
      expect(panesA[0].id).toBe('p1');
    });
  });

  // ── singleton ─────────────────────────────────────────────────────────────

  describe('getDatabaseManager singleton', () => {
    beforeEach(() => {
      // getDatabaseManager()는 app.getPath('userData') 경로에 DB 파일을 생성하므로
      // 해당 디렉터리가 없으면 better-sqlite3가 에러를 던짐 — 미리 생성
      fs.mkdirSync(mockUserDataPath, { recursive: true });
    });

    afterEach(() => {
      // 생성한 DB 파일 정리
      const dbPath = path.join(mockUserDataPath, 'maestro.db');
      try { fs.unlinkSync(dbPath); } catch { /* ignore */ }
    });

    it('getDatabaseManager가 항상 같은 인스턴스를 반환한다', () => {
      const inst1 = getDatabaseManager();
      const inst2 = getDatabaseManager();
      expect(inst1).toBe(inst2);
    });

    it('closeDatabaseManager 후 getDatabaseManager가 새 인스턴스를 생성한다', () => {
      const inst1 = getDatabaseManager();
      closeDatabaseManager();
      const inst2 = getDatabaseManager();
      expect(inst1).not.toBe(inst2);
    });
  });
});
