/**
 * AppStateService — UI 상태 영속화 (lowdb JSON 파일 기반)
 *
 * SQLite app_state 테이블을 대체한다.
 * lowdb v7은 순수 ESM이므로 dynamic import로 초기화한다.
 *
 * 저장 경로: {userData}/app-state.json
 */

import * as path from 'path';
import log from 'electron-log';

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

// ── Service ───────────────────────────────────────────────────────────────────

export class AppStateService {
  private static _instance: AppStateService | null = null;

  /** lowdb Low<AppState> 인스턴스 — dynamic import 후 할당 */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private db: any = null;

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
   * lowdb를 dynamic import로 초기화한다.
   * 앱 시작 시 한 번만 호출하면 된다.
   *
   * @param userDataPath — app.getPath('userData') 값을 주입받는다.
   *   테스트 환경에서 임의 경로를 주입할 수 있도록 분리했다.
   */
  async initialize(userDataPath: string): Promise<void> {
    if (this.db) {
      log.warn('[AppStateService] Already initialized, skipping.');
      return;
    }

    const filePath = path.join(userDataPath, 'app-state.json');

    try {
      // lowdb v7 is pure ESM — must use dynamic import
      const { JSONFilePreset } = await import('lowdb/node');

      this.db = await JSONFilePreset<AppState>(filePath, { ...DEFAULT_STATE });
      await this.db.read();

      // 누락된 필드를 default로 채운다 (기존 파일 호환)
      let dirty = false;
      for (const [key, value] of Object.entries(DEFAULT_STATE) as [keyof AppState, AppState[keyof AppState]][]) {
        if (this.db.data[key] === undefined) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          (this.db.data as any)[key] = value;
          dirty = true;
        }
      }
      if (dirty) {
        await this.db.write();
      }

      log.info(`[AppStateService] Initialized → ${filePath}`);
    } catch (err) {
      log.error('[AppStateService] Failed to initialize:', err);
      throw err;
    }
  }

  // ── Read / Write ───────────────────────────────────────────────────────────

  /**
   * 현재 AppState 전체를 반환한다.
   * initialize() 호출 전에 접근하면 default 값을 반환한다.
   */
  get(): AppState {
    if (!this.db) {
      log.warn('[AppStateService] get() called before initialize(). Returning defaults.');
      return { ...DEFAULT_STATE };
    }
    return this.db.data as AppState;
  }

  /**
   * AppState의 일부를 업데이트하고 파일에 저장한다.
   */
  async set(patch: Partial<AppState>): Promise<void> {
    if (!this.db) {
      log.error('[AppStateService] set() called before initialize(). Patch dropped.');
      return;
    }

    Object.assign(this.db.data, patch);
    await this.db.write();
  }
}
