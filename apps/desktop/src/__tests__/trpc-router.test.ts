/**
 * tRPC Router 단위 테스트
 *
 * DB / PTY / Git / Electron 등 외부 의존성을 모두 mock하고
 * 각 procedure의 비즈니스 로직만 검증한다.
 */

import { vi, describe, it, expect, beforeEach } from 'vitest';

// ── Electron mock (Node 환경에서 import 가능하게) ─────────────────────────────
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

function clearDrizzle() {
  drizzleCallQueue.length = 0;
  drizzleInsertRunMock.mockClear();
  drizzleUpdateRunMock.mockClear();
}

/** drizzle .all() 다음 호출이 반환할 rows를 큐에 추가 */
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
      onConflictDoUpdate: (_opts: unknown) => ({ run: vi.fn() }),
    }),
  }),
  update: (_table: unknown) => ({
    set: (_data: unknown) => ({
      where: (...__: unknown[]) => ({ run: drizzleUpdateRunMock }),
    }),
  }),
  delete: (_table: unknown) => ({
    where: (...__: unknown[]) => ({ run: vi.fn() }),
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

const mockPtyManager = {
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
};

vi.mock('../services/pty-manager', () => ({
  getPtyManager: vi.fn(() => mockPtyManager),
}));

const mockGit = {
  isGitRepo: vi.fn().mockReturnValue(true),
  getCurrentBranch: vi.fn().mockReturnValue('main'),
  cloneRepo: vi.fn().mockResolvedValue(undefined),
  getStatus: vi.fn().mockResolvedValue([]),
  stageAll: vi.fn().mockResolvedValue(undefined),
  commit: vi.fn().mockResolvedValue(undefined),
  getDiff: vi.fn().mockResolvedValue(''),
};

vi.mock('../services/git', () => ({
  getGitService: vi.fn(() => mockGit),
}));

vi.mock('../services/git-watcher', () => ({
  getGitWatcher: vi.fn(() => ({
    watch: vi.fn(),
    unwatch: vi.fn(),
    getStatus: vi.fn().mockReturnValue([]),
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

// ── mock DB 헬퍼 (raw SQL JOIN 쿼리용) ────────────────────────────────────────

type SqlHandler = { run?: (...args: unknown[]) => void; get?: (...args: unknown[]) => unknown; all?: (...args: unknown[]) => unknown[] };

function setupMockDb(handlers: Record<string, SqlHandler>) {
  mockDb.prepare.mockImplementation((sql: string) => {
    const normalized = sql.replace(/\s+/g, ' ').trim();
    for (const [pattern, handler] of Object.entries(handlers)) {
      if (normalized.includes(pattern)) {
        return {
          run: handler.run ?? vi.fn(),
          get: handler.get ?? vi.fn().mockReturnValue(undefined),
          all: handler.all ?? vi.fn().mockReturnValue([]),
        };
      }
    }
    return { run: vi.fn(), get: vi.fn().mockReturnValue(undefined), all: vi.fn().mockReturnValue([]) };
  });
}

// ── tRPC caller 헬퍼 ──────────────────────────────────────────────────────────

// router를 동적으로 import해서 vi.mock이 먼저 적용되게 한다
async function getCaller() {
  const { createCaller } = await import('../trpc/router');
  return createCaller({});
}

// ── 테스트 픽스처 (drizzle camelCase rows) ────────────────────────────────────

const drizzleRepoRow = {
  id: 'repo-1',
  name: 'my-repo',
  path: '/home/user/my-repo',
  baseBranch: 'main',
  branchPrefix: '',
  color: '#4B8BFF',
  worktreeBasePath: '',
  setupScript: '',
  teardownScript: '',
  createdAt: '2024-01-01T00:00:00.000Z',
};

const drizzleWorkspaceRow = {
  id: 'ws-1',
  name: 'workspace-1',
  repositoryId: 'repo-1',
  branch: 'feat/test',
  worktreePath: '/projects/repo/feat-test',
  createdAt: '2024-01-01',
  hookOnSessionStart: '',
  hookOnAgentComplete: '',
  hookOnError: '',
  taskId: null,
};

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

const drizzleSessionPendingRow = {
  id: 'session-1',
  name: 'My Session',
  workspaceId: 'ws-1',
  agentId: 'agent-1',
  status: 'pending',
  pid: null,
  createdAt: '2024-01-01',
  isFavorite: false,
  dependsOnSessionId: null,
  contextSourceSessionId: null,
  lastExitCode: null,
};

const drizzleSessionRunningRow = { ...drizzleSessionPendingRow, status: 'running', pid: 42 };

// ── 테스트 ─────────────────────────────────────────────────────────────────────

describe('repository 절차', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearDrizzle();
    mockDatabaseManager.getDb.mockReturnValue(mockDb);
  });

  describe('repository.list', () => {
    it('저장된 리포지토리 목록을 반환한다', async () => {
      pushDrizzleResult(drizzleRepoRow);

      const caller = await getCaller();
      const result = await caller.repository.list();

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        id: 'repo-1',
        name: 'my-repo',
        path: '/home/user/my-repo',
        baseBranch: 'main',
      });
    });

    it('리포지토리가 없으면 빈 배열을 반환한다', async () => {
      // 빈 배열 — pushDrizzleResult() 없이 shift()가 undefined를 반환 → ?? []

      const caller = await getCaller();
      const result = await caller.repository.list();

      expect(result).toEqual([]);
    });
  });

  describe('repository.add', () => {
    it('git 리포지토리를 추가하고 반환한다', async () => {
      mockGit.isGitRepo.mockReturnValue(true);
      mockGit.getCurrentBranch.mockReturnValue('main');

      const insertedRow = {
        ...drizzleRepoRow,
        id: 'new-repo-id',
        name: 'test-repo',
        path: '/home/user/test-repo',
      };
      // INSERT 후 SELECT: 1번 호출
      pushDrizzleResult(insertedRow);

      const caller = await getCaller();
      const result = await caller.repository.add({ path: '/home/user/test-repo' });

      expect(mockGit.isGitRepo).toHaveBeenCalledWith('/home/user/test-repo');
      expect(result).toMatchObject({ name: 'test-repo', path: '/home/user/test-repo' });
    });

    it('git 리포지토리가 아니면 에러를 던진다', async () => {
      mockGit.isGitRepo.mockReturnValue(false);

      const caller = await getCaller();
      await expect(
        caller.repository.add({ path: '/not/a/git/repo' }),
      ).rejects.toThrow('Not a git repository');
    });

    it('경로 마지막 세그먼트를 이름으로 사용한다', async () => {
      const repoPath = '/projects/my-awesome-project';
      mockGit.isGitRepo.mockReturnValue(true);
      mockGit.getCurrentBranch.mockReturnValue('develop');

      pushDrizzleResult({ ...drizzleRepoRow, id: 'id-1', name: 'my-awesome-project', path: repoPath, baseBranch: 'develop' });

      const caller = await getCaller();
      const result = await caller.repository.add({ path: repoPath });

      expect(result.name).toBe('my-awesome-project');
    });
  });
});

describe('session 절차', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearDrizzle();
    mockDatabaseManager.getDb.mockReturnValue(mockDb);
    mockPtyManager.create.mockReturnValue({ pid: 42 });
  });

  describe('session.create', () => {
    it('pending 세션을 생성하고 반환한다', async () => {
      // workspace 조회, agent 조회, session INSERT 후 조회
      pushDrizzleResult(drizzleWorkspaceRow);
      pushDrizzleResult(drizzleAgentRow);
      pushDrizzleResult({ ...drizzleSessionPendingRow, id: 'session-new', name: 'Test Session' });

      const caller = await getCaller();
      const result = await caller.session.create({
        name: 'Test Session',
        workspaceId: 'ws-1',
        agentId: 'agent-1',
      });

      expect(result.status).toBe('pending');
      expect(result.workspaceId).toBe('ws-1');
    });

    it('존재하지 않는 workspace면 에러를 던진다', async () => {
      // workspace 조회 → 빈 배열 (not found)
      // 아무것도 push하지 않음 → shift() returns undefined → []

      const caller = await getCaller();
      await expect(
        caller.session.create({ name: 'S', workspaceId: 'bad-ws', agentId: 'a' }),
      ).rejects.toThrow('Workspace bad-ws not found');
    });

    it('존재하지 않는 agent면 에러를 던진다', async () => {
      pushDrizzleResult(drizzleWorkspaceRow);
      // agent 조회 → 빈 배열 (not found)

      const caller = await getCaller();
      await expect(
        caller.session.create({ name: 'S', workspaceId: 'ws-1', agentId: 'bad-agent' }),
      ).rejects.toThrow('Agent bad-agent not found');
    });
  });

  describe('session.launch', () => {
    it('PTY를 생성하고 세션 상태를 running으로 업데이트한다', async () => {
      // 1. sessions.where(sessionId) → pending session
      pushDrizzleResult(drizzleSessionPendingRow);
      // 2. workspaces.where(workspaceId) → workspace
      pushDrizzleResult(drizzleWorkspaceRow);
      // 3. agents.where(agentId) → agent
      pushDrizzleResult(drizzleAgentRow);
      // 4. workspaces.select({hooks}).where(workspaceId) → hooks
      pushDrizzleResult(drizzleWorkspaceRow);
      // 5. sessions.update.run() → no result (void)
      // 6. emitWebhookEvent → webhooks.where(enabled).all() → no webhooks
      pushDrizzleResult();
      // 7. sessions.where(sessionId) → running session (final)
      pushDrizzleResult(drizzleSessionRunningRow);

      // raw SQL: env_vars JOIN query
      setupMockDb({ 'FROM env_vars': { all: vi.fn().mockReturnValue([]) } });

      const caller = await getCaller();
      const result = await caller.session.launch({ sessionId: 'session-1', cols: 80, rows: 24 });

      expect(mockPtyManager.create).toHaveBeenCalledWith(
        'session-1', 'claude', [], {}, '/projects/repo/feat-test', 80, 24,
      );
      expect(mockPtyManager.onOutput).toHaveBeenCalledWith('session-1', expect.any(Function));
      expect(mockPtyManager.onExit).toHaveBeenCalledWith('session-1', expect.any(Function));
      expect(result.status).toBe('running');
    });

    it('세션이 없으면 에러를 던진다', async () => {
      // sessions.where(sessionId) → not found (empty)

      const caller = await getCaller();
      await expect(
        caller.session.launch({ sessionId: 'nonexistent', cols: 80, rows: 24 }),
      ).rejects.toThrow('Session nonexistent not found');
    });

    it('repo env vars를 agent env에 병합한다', async () => {
      const agentWithEnv = { ...drizzleAgentRow, env: JSON.stringify({ AGENT_KEY: 'agent-val' }) };

      pushDrizzleResult(drizzleSessionPendingRow);
      pushDrizzleResult(drizzleWorkspaceRow);
      pushDrizzleResult(agentWithEnv);
      pushDrizzleResult(drizzleWorkspaceRow);   // hooks
      pushDrizzleResult();                       // emitWebhookEvent → no webhooks
      pushDrizzleResult(drizzleSessionRunningRow); // final

      setupMockDb({
        'FROM env_vars': {
          all: vi.fn().mockReturnValue([{ key: 'REPO_KEY', value: 'repo-val' }]),
        },
      });

      const caller = await getCaller();
      await caller.session.launch({ sessionId: 'session-1', cols: 80, rows: 24 });

      const callEnv = mockPtyManager.create.mock.calls[0][3] as Record<string, string>;
      expect(callEnv).toMatchObject({ REPO_KEY: 'repo-val', AGENT_KEY: 'agent-val' });
    });
  });
});
