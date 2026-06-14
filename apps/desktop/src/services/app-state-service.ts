/**
 * AppStateService — UI 상태 영속화 (SQLite app_state 테이블 기반)
 *
 * 기존 lowdb JSON 파일 방식에서 DatabaseManager가 관리하는
 * better-sqlite3 기반 SQLite로 전환한다.
 *
 * 저장 방식: key='main', value=JSON.stringify(AppState)
 */

import log from 'electron-log';
import { getDatabaseManager } from '../db/database';

// ── Types ─────────────────────────────────────────────────────────────────────

export type AppStateTab = {
  id: string;
  type: string;
  title: string;
  workspaceId?: string;
};

export type AppState = {
  sidebarWidth: number;
  rightSidebarWidth: number;
  theme: 'light' | 'dark' | 'system';
  tabs: AppStateTab[];
  shortcuts: Record<string, string>;
  /** 마지막으로 활성화된 세션 ID (session handlers에서 사용) */
  lastSessionId?: string;
  /** 마지막으로 활성화된 workspace ID (cold-start redirect에서 사용) */
  activeWorkspaceId?: string;
};

// ── Defaults ──────────────────────────────────────────────────────────────────

const DEFAULT_STATE: AppState = {
  sidebarWidth: 240,
  rightSidebarWidth: 320,
  theme: 'system',
  tabs: [],
  shortcuts: {},
};

const STATE_KEY = 'main';

// ── Service ───────────────────────────────────────────────────────────────────

export class AppStateService {
  private static _instance: AppStateService | null = null;

  private constructor() {}

  // ── Singleton ──────────────────────────────────────────────────────────────

  static getInstance(): AppStateService {
    if (!AppStateService._instance) {
      AppStateService._instance = new AppStateService();
    }
    return AppStateService._instance;
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  /**
   * 하위 호환을 위해 시그니처를 유지하되 no-op으로 동작한다.
   * SQLite는 DatabaseManager가 초기화하므로 별도 처리가 불필요하다.
   */
  async initialize(_userDataPath: string): Promise<void> {
    log.info('[AppStateService] Using SQLite backend — no separate initialization needed.');
  }

  // ── Read / Write ───────────────────────────────────────────────────────────

  /**
   * 현재 AppState 전체를 반환한다.
   * 저장된 값이 없으면 DEFAULT_STATE를 반환한다.
   */
  get(): AppState {
    try {
      const db = getDatabaseManager().getDb();
      const row = db
        .prepare('SELECT value FROM app_state WHERE key = ?')
        .get(STATE_KEY) as { value: string } | undefined;
      if (!row) return { ...DEFAULT_STATE };
      const stored = JSON.parse(row.value) as Partial<AppState>;
      return { ...DEFAULT_STATE, ...stored };
    } catch (err) {
      log.error('[AppStateService] get() failed:', err);
      return { ...DEFAULT_STATE };
    }
  }

  /**
   * AppState의 일부를 업데이트하고 SQLite에 저장한다.
   */
  async set(patch: Partial<AppState>): Promise<void> {
    try {
      const current = this.get();
      const next = { ...current, ...patch };
      const db = getDatabaseManager().getDb();
      db.prepare(`
        INSERT INTO app_state (key, value) VALUES (?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
      `).run(STATE_KEY, JSON.stringify(next));
    } catch (err) {
      log.error('[AppStateService] set() failed:', err);
    }
  }
}
