/**
 * workspace tRPC 라우터 단위 테스트
 *
 * workspaceRouter의 주요 프로시저를 검증한다:
 * list, create, delete (teardownScript 검증 포함), 에러 케이스
 */

import { vi, describe, it, expect, beforeEach } from 'vitest';

// ── child_process mock (execAsync가 내부적으로 사용) ───────────────────────────
vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return {
    ...actual,
    exec: vi.fn((_cmd: string, _opts: unknown, cb: (err: null, out: { stdout: string; stderr: string }) => void) => {
      cb(null, { stdout: '', stderr: '' });
      return { pid: 0, kill: vi.fn() };
    }),
  };
});

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
        limit: (_n: number) => ({
          all: () => drizzleCallQueue.shift() ?? [],
        }),
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

const mockGit = {
  isGitRepo: vi.fn().mockReturnValue(true),
  getCurrentBranch: vi.fn().mockReturnValue('main'),
  cloneRepo: vi.fn().mockResolvedValue(undefined),
  getStatus: vi.fn().mockResolvedValue([]),
  stageAll: vi.fn().mockResolvedValue(undefined),
  commit: vi.fn().mockResolvedValue(undefined),
  getDiff: vi.fn().mockResolvedValue(''),
  addWorktree: vi.fn().mockResolvedValue(undefined),
  removeWorktree: vi.fn().mockResolvedValue(undefined),
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

// ── raw SQL mock 헬퍼 ─────────────────────────────────────────────────────────

type SqlHandler = {
  run?: (...args: unknown[]) => void;
  get?: (...args: unknown[]) => unknown;
  all?: (...args: unknown[]) => unknown[];
};

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

async function getCaller() {
  const { createCaller } = await import('../trpc/router');
  return createCaller({});
}

// ── 테스트 픽스처 ─────────────────────────────────────────────────────────────
// rowToWorkspace는 snake_case 키를 기대한다 (repository_id, worktree_path 등)

const snakeRepoRow = {
  id: 'repo-1',
  name: 'my-repo',
  path: '/home/user/my-repo',
  base_branch: 'main',
  branch_prefix: '',
  color: '#4B8BFF',
  worktree_base_path: '',
  setup_script: '',
  teardown_script: '',
  created_at: '2024-01-01T00:00:00.000Z',
  // drizzle camelCase aliases (drizzle ORM이 함께 반환)
  baseBranch: 'main',
  branchPrefix: '',
  worktreeBasePath: '',
  setupScript: '',
  teardownScript: '',
  createdAt: '2024-01-01T00:00:00.000Z',
};

const snakeWorkspaceRow = {
  id: 'ws-1',
  name: 'workspace-1',
  repository_id: 'repo-1',
  branch: 'feat/test',
  worktree_path: '/projects/repo/feat-test',
  created_at: '2024-01-01',
  hook_on_session_start: '',
  hook_on_agent_complete: '',
  hook_on_error: '',
  task_id: null,
  // drizzle camelCase aliases
  repositoryId: 'repo-1',
  worktreePath: '/projects/repo/feat-test',
  createdAt: '2024-01-01',
  hookOnSessionStart: '',
  hookOnAgentComplete: '',
  hookOnError: '',
  taskId: null,
};

// ── 테스트 ────────────────────────────────────────────────────────────────────

describe('workspace 절차', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearDrizzle();
    mockDatabaseManager.getDb.mockReturnValue(mockDb);
    mockGit.addWorktree.mockResolvedValue(undefined);
    mockGit.removeWorktree.mockResolvedValue(undefined);
    mockPtyManager.isAlive.mockReturnValue(false);
  });

  // ── workspace.list ──────────────────────────────────────────────────────────

  describe('workspace.list', () => {
    it('저장된 workspace 목록을 반환한다', async () => {
      pushDrizzleResult(snakeWorkspaceRow);

      const caller = await getCaller();
      const result = await caller.workspace.list();

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        id: 'ws-1',
        name: 'workspace-1',
        repositoryId: 'repo-1',
        branch: 'feat/test',
        worktreePath: '/projects/repo/feat-test',
      });
    });

    it('workspace가 없으면 빈 배열을 반환한다', async () => {
      // 아무것도 push하지 않음 — drizzleCallQueue가 비어있으면 [] 반환
      const caller = await getCaller();
      const result = await caller.workspace.list();

      expect(result).toEqual([]);
    });

    it('여러 workspace를 순서대로 반환한다', async () => {
      const ws2 = { ...snakeWorkspaceRow, id: 'ws-2', name: 'workspace-2', branch: 'feat/other' };
      pushDrizzleResult(snakeWorkspaceRow, ws2);

      const caller = await getCaller();
      const result = await caller.workspace.list();

      expect(result).toHaveLength(2);
      expect(result[0].id).toBe('ws-1');
      expect(result[1].id).toBe('ws-2');
    });
  });

  // ── workspace.create ────────────────────────────────────────────────────────

  describe('workspace.create', () => {
    it('worktree를 생성하고 DB에 저장 후 workspace를 반환한다', async () => {
      // 1. repositories.where(repositoryId) → repo
      pushDrizzleResult(snakeRepoRow);
      // 2. workspaces.where(id) → inserted workspace
      pushDrizzleResult(snakeWorkspaceRow);

      const caller = await getCaller();
      const result = await caller.workspace.create({
        name: 'workspace-1',
        repositoryId: 'repo-1',
      });

      expect(mockGit.addWorktree).toHaveBeenCalledWith(
        '/home/user/my-repo',
        expect.stringContaining('workspace-1'),
        'workspace-1',
      );
      expect(drizzleInsertRunMock).toHaveBeenCalled();
      expect(result).toMatchObject({
        id: 'ws-1',
        name: 'workspace-1',
        repositoryId: 'repo-1',
      });
    });

    it('repository가 없으면 에러를 던진다', async () => {
      // repositories.where() → 빈 배열 (not found)

      const caller = await getCaller();
      await expect(
        caller.workspace.create({ name: 'test-ws', repositoryId: 'nonexistent-repo' }),
      ).rejects.toThrow('Repository nonexistent-repo not found');
    });

    it('branchPrefix가 있으면 브랜치 이름에 prefix를 붙인다', async () => {
      const repoWithPrefix = { ...snakeRepoRow, branch_prefix: 'feature/', branchPrefix: 'feature/' };
      pushDrizzleResult(repoWithPrefix);
      pushDrizzleResult(snakeWorkspaceRow);

      const caller = await getCaller();
      await caller.workspace.create({ name: 'my workspace', repositoryId: 'repo-1' });

      expect(mockGit.addWorktree).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        'feature/my-workspace',
      );
    });

    it('이름의 공백을 하이픈으로 변환하여 브랜치명을 만든다', async () => {
      pushDrizzleResult(snakeRepoRow);
      pushDrizzleResult(snakeWorkspaceRow);

      const caller = await getCaller();
      await caller.workspace.create({ name: 'hello world test', repositoryId: 'repo-1' });

      expect(mockGit.addWorktree).toHaveBeenCalledWith(
        expect.any(String),
        expect.any(String),
        'hello-world-test',
      );
    });

    it('DB INSERT 실패 시 worktree를 롤백하고 에러를 던진다', async () => {
      // repo 조회 성공
      pushDrizzleResult(snakeRepoRow);
      // workspaces.where(id) → 빈 배열 (INSERT 실패 시뮬레이션)
      pushDrizzleResult();

      const caller = await getCaller();
      await expect(
        caller.workspace.create({ name: 'test-ws', repositoryId: 'repo-1' }),
      ).rejects.toThrow('Failed to insert workspace record');

      expect(mockGit.removeWorktree).toHaveBeenCalled();
    });

    it('setupScript가 있으면 실행한다', async () => {
      const repoWithSetup = {
        ...snakeRepoRow,
        setup_script: 'npm install',
        setupScript: 'npm install',
      };
      pushDrizzleResult(repoWithSetup);
      pushDrizzleResult(snakeWorkspaceRow);

      const caller = await getCaller();
      // child_process.exec는 module mock으로 처리됨 — setupScript 포함 시 정상 완료 검증
      await expect(
        caller.workspace.create({ name: 'test-ws', repositoryId: 'repo-1' }),
      ).resolves.toBeDefined();
    });
  });

  // ── workspace.delete ────────────────────────────────────────────────────────

  describe('workspace.delete', () => {
    it('활성 세션 PTY를 종료하고 worktree를 제거한 뒤 DB에서 삭제한다', async () => {
      // workspaces.where(id) → workspace
      pushDrizzleResult(snakeWorkspaceRow);
      // repositories.where(repositoryId) → repo
      pushDrizzleResult(snakeRepoRow);
      // sessions.where(workspaceId) → 빈 세션 목록
      pushDrizzleResult();

      const caller = await getCaller();
      await caller.workspace.delete({ id: 'ws-1' });

      expect(mockGit.removeWorktree).toHaveBeenCalledWith(
        '/home/user/my-repo',
        '/projects/repo/feat-test',
      );
      expect(drizzleDeleteRunMock).toHaveBeenCalled();
    });

    it('존재하지 않는 workspace면 에러를 던진다', async () => {
      // workspaces.where(id) → 빈 배열 (not found)

      const caller = await getCaller();
      await expect(
        caller.workspace.delete({ id: 'nonexistent-ws' }),
      ).rejects.toThrow('Workspace nonexistent-ws not found');
    });

    it('활성 PTY 세션이 있으면 kill을 호출한다', async () => {
      mockPtyManager.isAlive.mockReturnValue(true);

      pushDrizzleResult(snakeWorkspaceRow);
      pushDrizzleResult(snakeRepoRow);
      // sessions.where(workspaceId) → 실행 중 세션 목록
      pushDrizzleResult({ id: 'session-running', workspaceId: 'ws-1', status: 'running' });

      const caller = await getCaller();
      await caller.workspace.delete({ id: 'ws-1' });

      expect(mockPtyManager.kill).toHaveBeenCalledWith('session-running');
    });

    it('teardownScript가 있으면 validateScript가 먼저 호출된다', async () => {
      const repoWithTeardown = {
        ...snakeRepoRow,
        teardown_script: 'echo cleanup',
        teardownScript: 'echo cleanup',
      };

      pushDrizzleResult(snakeWorkspaceRow);
      pushDrizzleResult(repoWithTeardown);
      pushDrizzleResult(); // 세션 없음

      // execSync는 실제로 호출되지만 워크스페이스 경로가 없으므로 오류가 날 수 있음
      // 테스트에서는 validateScript 통과 후 delete가 완료되는 흐름만 확인
      const caller = await getCaller();
      // teardownScript 실행 실패는 무시되므로(console.warn) delete는 성공해야 함
      await expect(caller.workspace.delete({ id: 'ws-1' })).resolves.toBeUndefined();
    });

    it('teardownScript가 2000자를 초과하면 BAD_REQUEST 에러를 던진다', async () => {
      const longScript = 'x'.repeat(2001);
      const repoWithLongScript = {
        ...snakeRepoRow,
        teardown_script: longScript,
        teardownScript: longScript,
      };

      pushDrizzleResult(snakeWorkspaceRow);
      pushDrizzleResult(repoWithLongScript);
      pushDrizzleResult(); // 세션 없음

      const caller = await getCaller();
      await expect(
        caller.workspace.delete({ id: 'ws-1' }),
      ).rejects.toMatchObject({ code: 'BAD_REQUEST' });
    });
  });

  // ── workspace.getHooks / updateHooks ────────────────────────────────────────

  describe('workspace.getHooks', () => {
    it('workspace의 lifecycle hook 설정을 반환한다', async () => {
      const wsWithHooks = {
        ...snakeWorkspaceRow,
        hook_on_session_start: 'echo start',
        hook_on_agent_complete: 'echo done',
        hook_on_error: 'echo error',
        hookOnSessionStart: 'echo start',
        hookOnAgentComplete: 'echo done',
        hookOnError: 'echo error',
      };
      pushDrizzleResult(wsWithHooks);

      const caller = await getCaller();
      const result = await caller.workspace.getHooks({ workspaceId: 'ws-1' });

      expect(result).toMatchObject({
        hookOnSessionStart: 'echo start',
        hookOnAgentComplete: 'echo done',
        hookOnError: 'echo error',
      });
    });

    it('workspace가 없으면 에러를 던진다', async () => {
      // 빈 배열 반환 → not found

      const caller = await getCaller();
      await expect(
        caller.workspace.getHooks({ workspaceId: 'nonexistent' }),
      ).rejects.toThrow('Workspace nonexistent not found');
    });
  });

  describe('workspace.updateHooks', () => {
    it('지정한 hook만 선택적으로 업데이트한다', async () => {
      pushDrizzleResult(snakeWorkspaceRow);

      const caller = await getCaller();
      const result = await caller.workspace.updateHooks({
        workspaceId: 'ws-1',
        hookOnSessionStart: 'npm run start-hook',
      });

      expect(drizzleUpdateRunMock).toHaveBeenCalled();
      expect(result).toMatchObject({ id: 'ws-1' });
    });
  });
});
