/**
 * agent tRPC 라우터 단위 테스트
 *
 * agentRouter의 주요 프로시저를 검증한다:
 * list, create, update (built-in 보호), delete (built-in 보호), 에러 케이스
 */

import { vi, describe, it, expect, beforeEach } from 'vitest';

// ── Electron mock ─────────────────────────────────────────────────────────────
vi.mock('electron', () => ({
  dialog: {
    showOpenDialog: vi.fn().mockResolvedValue({ canceled: false, filePaths: ['/some/path'] }),
  },
  BrowserWindow: class {},
  ipcMain: { handle: vi.fn(), on: vi.fn() },
}));

// ── drizzle mock ──────────────────────────────────────────────────────────────

const drizzleCallQueue: unknown[][] = [];
const drizzleInsertRunMock = vi.fn();
const drizzleUpdateRunMock = vi.fn();
const drizzleDeleteRunMock = vi.fn();

function clearDrizzle() {
  drizzleCallQueue.length = 0;
  drizzleInsertRunMock.mockClear();
  drizzleUpdateRunMock.mockClear();
  drizzleDeleteRunMock.mockClear();
}

function pushDrizzleResult(...rows: unknown[]) {
  drizzleCallQueue.push(rows);
}

const mockDrizzle = {
  select: (..._: unknown[]) => ({
    from: (_table: unknown) => ({
      where: (...__: unknown[]) => ({
        all: () => drizzleCallQueue.shift() ?? [],
        get: () => (drizzleCallQueue.shift() ?? [])[0] ?? undefined,
      }),
      orderBy: (...__: unknown[]) => ({
        all: () => drizzleCallQueue.shift() ?? [],
      }),
      all: () => drizzleCallQueue.shift() ?? [],
    }),
  }),
  insert: (_table: unknown) => ({
    values: (_data: unknown) => ({
      run: drizzleInsertRunMock,
      returning: vi.fn().mockReturnValue([]),
    }),
  }),
  update: (_table: unknown) => ({
    set: (_data: unknown) => ({
      where: (...__: unknown[]) => ({ run: drizzleUpdateRunMock }),
    }),
  }),
  delete: (_table: unknown) => ({
    where: (...__: unknown[]) => ({ run: drizzleDeleteRunMock }),
  }),
};

// ── 서비스 mock ───────────────────────────────────────────────────────────────

const mockDb = {
  prepare: vi.fn(),
};

const mockDatabaseManager = {
  getDb: vi.fn().mockReturnValue(mockDb),
  drizzle: mockDrizzle,
};

vi.mock('../db/database', () => ({
  getDatabaseManager: vi.fn(() => mockDatabaseManager),
}));

vi.mock('../services/git', () => ({
  getGitService: vi.fn(() => ({
    isGitRepo: vi.fn().mockReturnValue(true),
    getCurrentBranch: vi.fn().mockReturnValue('main'),
    addWorktree: vi.fn().mockResolvedValue(undefined),
    removeWorktree: vi.fn().mockResolvedValue(undefined),
  })),
}));

vi.mock('../services/git-watcher', () => ({
  getGitWatcher: vi.fn(() => ({
    watch: vi.fn(),
    unwatch: vi.fn(),
    getStatus: vi.fn().mockReturnValue([]),
  })),
}));

vi.mock('../services/pty-manager', () => ({
  getPtyManager: vi.fn(() => ({
    create: vi.fn().mockReturnValue({ pid: 12345 }),
    onOutput: vi.fn(),
    onExit: vi.fn(),
    removeOutput: vi.fn(),
    removeExit: vi.fn(),
    write: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn(),
    isAlive: vi.fn().mockReturnValue(false),
    getScrollback: vi.fn().mockReturnValue(null),
  })),
}));

vi.mock('../main', () => ({
  getMainWindow: vi.fn(() => null),
}));

vi.mock('../services/http-server', () => ({
  getServerPort: vi.fn().mockReturnValue(0),
  getAuthToken: vi.fn().mockReturnValue(''),
}));

vi.mock('../services/wrappers', () => ({
  createWrapper: vi.fn(() => ({
    injectHook: vi.fn().mockResolvedValue(undefined),
    removeHook: vi.fn().mockResolvedValue(undefined),
  })),
}));

vi.mock('../services/session-intelligence', () => ({
  getSessionIntelligence: vi.fn(() => ({
    startSession: vi.fn(),
    feedData: vi.fn(),
    handleExit: vi.fn(),
  })),
}));

vi.mock('../services/teams-watcher', () => ({
  teamsWatcher: {
    processOutput: vi.fn(),
    detachFromSession: vi.fn(),
    attachToSession: vi.fn(),
  },
}));

vi.mock('../services/subagent-handler', () => ({
  attachSubagentHandler: vi.fn(),
}));

vi.mock('../services/app-state-service', () => ({
  AppStateService: {
    getInstance: vi.fn(() => ({
      set: vi.fn().mockResolvedValue(undefined),
      get: vi.fn().mockReturnValue({}),
      initialize: vi.fn().mockResolvedValue(undefined),
    })),
  },
}));

vi.mock('../services/session-archiver', () => ({
  archiveSession: vi.fn(),
}));

vi.mock('../services/error-logger', () => ({
  writeErrorLog: vi.fn(),
}));

vi.mock('../services/orchestrator', () => ({
  selectAgentForTask: vi.fn().mockReturnValue('agent-1'),
}));

// ── tRPC caller 헬퍼 ──────────────────────────────────────────────────────────

async function getCaller() {
  const { createCaller } = await import('../trpc/router');
  return createCaller({});
}

// ── 테스트 픽스처 ─────────────────────────────────────────────────────────────

const drizzleAgentRow = {
  id: 'agent-1',
  name: 'Claude Code',
  command: 'claude',
  args: '[]',
  env: '{}',
  isBuiltIn: false,
  scriptPath: null,
  scriptContent: null,
};

const drizzleBuiltInAgentRow = {
  ...drizzleAgentRow,
  id: 'agent-builtin',
  name: 'Built-in Agent',
  isBuiltIn: true,
};

const drizzleAgentWithEnvRow = {
  ...drizzleAgentRow,
  id: 'agent-env',
  args: '["--dangerously-skip-permissions"]',
  env: '{"CLAUDE_API_KEY":"sk-abc","MAX_TOKENS":"4096"}',
};

// ── 테스트 ────────────────────────────────────────────────────────────────────

describe('agent 절차', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearDrizzle();
    mockDatabaseManager.getDb.mockReturnValue(mockDb);
  });

  // ── agent.list ──────────────────────────────────────────────────────────────

  describe('agent.list', () => {
    it('저장된 에이전트 목록을 반환한다', async () => {
      pushDrizzleResult(drizzleAgentRow);

      const caller = await getCaller();
      const result = await caller.agent.list();

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        id: 'agent-1',
        name: 'Claude Code',
        command: 'claude',
        args: [],
        env: {},
        isBuiltIn: false,
      });
    });

    it('에이전트가 없으면 빈 배열을 반환한다', async () => {
      const caller = await getCaller();
      const result = await caller.agent.list();

      expect(result).toEqual([]);
    });

    it('JSON 직렬화된 args와 env를 파싱하여 반환한다', async () => {
      pushDrizzleResult(drizzleAgentWithEnvRow);

      const caller = await getCaller();
      const result = await caller.agent.list();

      expect(result[0].args).toEqual(['--dangerously-skip-permissions']);
      expect(result[0].env).toEqual({ CLAUDE_API_KEY: 'sk-abc', MAX_TOKENS: '4096' });
    });

    it('built-in 에이전트와 커스텀 에이전트를 함께 반환한다', async () => {
      pushDrizzleResult(drizzleBuiltInAgentRow, drizzleAgentRow);

      const caller = await getCaller();
      const result = await caller.agent.list();

      expect(result).toHaveLength(2);
      const builtIn = result.find((a) => a.isBuiltIn);
      const custom = result.find((a) => !a.isBuiltIn);
      expect(builtIn?.name).toBe('Built-in Agent');
      expect(custom?.name).toBe('Claude Code');
    });
  });

  // ── agent.create ────────────────────────────────────────────────────────────

  describe('agent.create', () => {
    it('신규 에이전트를 생성하고 반환한다', async () => {
      const createdRow = {
        ...drizzleAgentRow,
        id: 'agent-new',
        name: 'My Agent',
        command: 'my-command',
        args: '["--flag"]',
        env: '{"KEY":"val"}',
      };
      pushDrizzleResult(createdRow);

      const caller = await getCaller();
      const result = await caller.agent.create({
        name: 'My Agent',
        command: 'my-command',
        args: ['--flag'],
        env: { KEY: 'val' },
      });

      expect(drizzleInsertRunMock).toHaveBeenCalled();
      expect(result).toMatchObject({
        name: 'My Agent',
        command: 'my-command',
        args: ['--flag'],
        env: { KEY: 'val' },
        isBuiltIn: false,
      });
    });

    it('scriptPath와 scriptContent를 함께 저장한다', async () => {
      const createdRow = {
        ...drizzleAgentRow,
        id: 'agent-script',
        name: 'Script Agent',
        scriptPath: '/path/to/script.sh',
        scriptContent: '#!/bin/bash\necho hello',
      };
      pushDrizzleResult(createdRow);

      const caller = await getCaller();
      const result = await caller.agent.create({
        name: 'Script Agent',
        command: 'bash',
        args: [],
        env: {},
        scriptPath: '/path/to/script.sh',
        scriptContent: '#!/bin/bash\necho hello',
      });

      expect(result.scriptPath).toBe('/path/to/script.sh');
      expect(result.scriptContent).toBe('#!/bin/bash\necho hello');
    });

    it('name이 빈 문자열이면 유효성 오류를 던진다', async () => {
      const caller = await getCaller();
      await expect(
        caller.agent.create({ name: '', command: 'claude', args: [], env: {} }),
      ).rejects.toThrow();
    });

    it('command가 빈 문자열이면 유효성 오류를 던진다', async () => {
      const caller = await getCaller();
      await expect(
        caller.agent.create({ name: 'My Agent', command: '', args: [], env: {} }),
      ).rejects.toThrow();
    });
  });

  // ── agent.update ────────────────────────────────────────────────────────────

  describe('agent.update', () => {
    it('커스텀 에이전트를 수정하고 반환한다', async () => {
      // 1. isBuiltIn 체크 조회
      pushDrizzleResult({ isBuiltIn: false });
      // 2. UPDATE 후 SELECT
      pushDrizzleResult({ ...drizzleAgentRow, name: 'Updated Agent', command: 'new-cmd' });

      const caller = await getCaller();
      const result = await caller.agent.update({
        id: 'agent-1',
        name: 'Updated Agent',
        command: 'new-cmd',
        args: [],
        env: {},
      });

      expect(drizzleUpdateRunMock).toHaveBeenCalled();
      expect(result.name).toBe('Updated Agent');
      expect(result.command).toBe('new-cmd');
    });

    it('built-in 에이전트는 수정할 수 없다', async () => {
      // isBuiltIn: true → 에러
      pushDrizzleResult({ isBuiltIn: true });

      const caller = await getCaller();
      await expect(
        caller.agent.update({
          id: 'agent-builtin',
          name: 'Hacked',
          command: 'evil',
          args: [],
          env: {},
        }),
      ).rejects.toThrow('Cannot modify built-in agents');
    });

    it('존재하지 않는 에이전트면 에러를 던진다', async () => {
      // 빈 배열 → not found

      const caller = await getCaller();
      await expect(
        caller.agent.update({
          id: 'nonexistent',
          name: 'X',
          command: 'x',
          args: [],
          env: {},
        }),
      ).rejects.toThrow('Agent nonexistent not found');
    });

    it('env를 JSON 직렬화하여 저장한다', async () => {
      pushDrizzleResult({ isBuiltIn: false });
      pushDrizzleResult({ ...drizzleAgentRow, env: '{"NEW_KEY":"new-val"}' });

      const caller = await getCaller();
      const result = await caller.agent.update({
        id: 'agent-1',
        name: 'Claude Code',
        command: 'claude',
        args: [],
        env: { NEW_KEY: 'new-val' },
      });

      expect(result.env).toEqual({ NEW_KEY: 'new-val' });
    });
  });

  // ── agent.delete ────────────────────────────────────────────────────────────

  describe('agent.delete', () => {
    it('커스텀 에이전트를 삭제한다', async () => {
      pushDrizzleResult({ isBuiltIn: false });

      const caller = await getCaller();
      await caller.agent.delete({ id: 'agent-1' });

      expect(drizzleDeleteRunMock).toHaveBeenCalled();
    });

    it('built-in 에이전트는 삭제할 수 없다', async () => {
      pushDrizzleResult({ isBuiltIn: true });

      const caller = await getCaller();
      await expect(
        caller.agent.delete({ id: 'agent-builtin' }),
      ).rejects.toThrow('Cannot delete built-in agents');
    });

    it('존재하지 않는 에이전트면 에러를 던진다', async () => {
      // 빈 배열 → not found

      const caller = await getCaller();
      await expect(
        caller.agent.delete({ id: 'nonexistent' }),
      ).rejects.toThrow('Agent nonexistent not found');
    });

    it('삭제 시 drizzle.delete가 한 번만 호출된다', async () => {
      pushDrizzleResult({ isBuiltIn: false });

      const caller = await getCaller();
      await caller.agent.delete({ id: 'agent-1' });

      expect(drizzleDeleteRunMock).toHaveBeenCalledTimes(1);
    });
  });
});
