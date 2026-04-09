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

// ── 서비스 mock ───────────────────────────────────────────────────────────────
const mockDb = {
  prepare: vi.fn(),
};

const mockDatabaseManager = {
  getDb: vi.fn().mockReturnValue(mockDb),
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

// ── mock DB 헬퍼 ──────────────────────────────────────────────────────────────

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

// ── 테스트 ─────────────────────────────────────────────────────────────────────

describe('repository 절차', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDatabaseManager.getDb.mockReturnValue(mockDb);
  });

  describe('repository.list', () => {
    it('저장된 리포지토리 목록을 반환한다', async () => {
      setupMockDb({
        'FROM repositories': {
          all: vi.fn().mockReturnValue([
            {
              id: 'repo-1',
              name: 'my-repo',
              path: '/home/user/my-repo',
              base_branch: 'main',
              branch_prefix: 'feat',
              color: '#4B8BFF',
              worktree_base_path: '',
              setup_script: '',
              teardown_script: '',
              created_at: '2024-01-01T00:00:00.000Z',
            },
          ]),
        },
      });

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
      setupMockDb({ 'FROM repositories': { all: vi.fn().mockReturnValue([]) } });

      const caller = await getCaller();
      const result = await caller.repository.list();

      expect(result).toEqual([]);
    });
  });

  describe('repository.add', () => {
    it('git 리포지토리를 추가하고 반환한다', async () => {
      const repoPath = '/home/user/test-repo';
      const insertedRow = {
        id: 'new-repo-id',
        name: 'test-repo',
        path: repoPath,
        base_branch: 'main',
        branch_prefix: '',
        color: '#4B8BFF',
        worktree_base_path: '',
        setup_script: '',
        teardown_script: '',
        created_at: '2024-01-01T00:00:00.000Z',
      };

      mockGit.isGitRepo.mockReturnValue(true);
      mockGit.getCurrentBranch.mockReturnValue('main');

      setupMockDb({
        'INSERT INTO repositories': { run: vi.fn() },
        'SELECT * FROM repositories WHERE id': { get: vi.fn().mockReturnValue(insertedRow) },
      });

      const caller = await getCaller();
      const result = await caller.repository.add({ path: repoPath });

      expect(mockGit.isGitRepo).toHaveBeenCalledWith(repoPath);
      expect(result).toMatchObject({ name: 'test-repo', path: repoPath });
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

      const insertedRow = {
        id: 'id-1', name: 'my-awesome-project', path: repoPath,
        base_branch: 'develop', branch_prefix: '', color: '#4B8BFF',
        worktree_base_path: '', setup_script: '', teardown_script: '',
        created_at: '2024-01-01T00:00:00.000Z',
      };

      setupMockDb({
        'INSERT INTO repositories': { run: vi.fn() },
        'SELECT * FROM repositories WHERE id': { get: vi.fn().mockReturnValue(insertedRow) },
      });

      const caller = await getCaller();
      const result = await caller.repository.add({ path: repoPath });

      expect(result.name).toBe('my-awesome-project');
    });
  });
});

describe('session 절차', () => {
  const workspaceRow = {
    id: 'ws-1', name: 'workspace-1', repository_id: 'repo-1',
    branch: 'feat/test', worktree_path: '/projects/repo/feat-test', created_at: '2024-01-01',
  };
  const agentRow = {
    id: 'agent-1', name: 'Claude Code', command: 'claude',
    args: '[]', env: '{}',
  };

  beforeEach(() => {
    vi.clearAllMocks();
    mockDatabaseManager.getDb.mockReturnValue(mockDb);
    mockPtyManager.create.mockReturnValue({ pid: 42 });
  });

  describe('session.create', () => {
    it('pending 세션을 생성하고 반환한다', async () => {
      const sessionRow = {
        id: 'session-new', name: 'Test Session', workspace_id: 'ws-1',
        agent_id: 'agent-1', status: 'pending', pid: null, created_at: '2024-01-01',
      };

      setupMockDb({
        'FROM workspaces WHERE id': { get: vi.fn().mockReturnValue(workspaceRow) },
        'FROM agents WHERE id': { get: vi.fn().mockReturnValue(agentRow) },
        'INSERT INTO sessions': { run: vi.fn() },
        'FROM sessions WHERE id': { get: vi.fn().mockReturnValue(sessionRow) },
      });

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
      setupMockDb({
        'FROM workspaces WHERE id': { get: vi.fn().mockReturnValue(undefined) },
      });

      const caller = await getCaller();
      await expect(
        caller.session.create({ name: 'S', workspaceId: 'bad-ws', agentId: 'a' }),
      ).rejects.toThrow('Workspace bad-ws not found');
    });

    it('존재하지 않는 agent면 에러를 던진다', async () => {
      setupMockDb({
        'FROM workspaces WHERE id': { get: vi.fn().mockReturnValue(workspaceRow) },
        'FROM agents WHERE id': { get: vi.fn().mockReturnValue(undefined) },
      });

      const caller = await getCaller();
      await expect(
        caller.session.create({ name: 'S', workspaceId: 'ws-1', agentId: 'bad-agent' }),
      ).rejects.toThrow('Agent bad-agent not found');
    });
  });

  describe('session.launch', () => {
    const sessionRow = {
      id: 'session-1', name: 'My Session', workspace_id: 'ws-1',
      agent_id: 'agent-1', status: 'pending', pid: null, created_at: '2024-01-01',
    };
    const runningRow = { ...sessionRow, status: 'running', pid: 42 };

    it('PTY를 생성하고 세션 상태를 running으로 업데이트한다', async () => {
      const updateRun = vi.fn();
      const appStateRun = vi.fn();

      setupMockDb({
        'FROM sessions WHERE id': {
          get: vi.fn()
            .mockReturnValueOnce(sessionRow)   // 첫 번째 get: session 조회
            .mockReturnValueOnce(runningRow),  // 두 번째 get: 업데이트 후 반환
        },
        'FROM workspaces WHERE id': { get: vi.fn().mockReturnValue(workspaceRow) },
        'FROM agents WHERE id': { get: vi.fn().mockReturnValue(agentRow) },
        'FROM env_vars': { all: vi.fn().mockReturnValue([]) },
        "UPDATE sessions SET status": { run: updateRun },
        'INSERT INTO app_state': { run: appStateRun },
      });

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
      setupMockDb({
        'FROM sessions WHERE id': { get: vi.fn().mockReturnValue(undefined) },
      });

      const caller = await getCaller();
      await expect(
        caller.session.launch({ sessionId: 'nonexistent', cols: 80, rows: 24 }),
      ).rejects.toThrow('Session nonexistent not found');
    });

    it('repo env vars를 agent env에 병합한다', async () => {
      const agentWithEnv = { ...agentRow, env: JSON.stringify({ AGENT_KEY: 'agent-val' }) };

      setupMockDb({
        'FROM sessions WHERE id': {
          get: vi.fn()
            .mockReturnValueOnce(sessionRow)
            .mockReturnValueOnce(runningRow),
        },
        'FROM workspaces WHERE id': { get: vi.fn().mockReturnValue(workspaceRow) },
        'FROM agents WHERE id': { get: vi.fn().mockReturnValue(agentWithEnv) },
        'FROM env_vars': {
          all: vi.fn().mockReturnValue([
            { key: 'REPO_KEY', value: 'repo-val' },
          ]),
        },
        'UPDATE sessions SET status': { run: vi.fn() },
        'INSERT INTO app_state': { run: vi.fn() },
      });

      const caller = await getCaller();
      await caller.session.launch({ sessionId: 'session-1', cols: 80, rows: 24 });

      // ptyManager.create 3번째 인자(env)에 둘 다 포함돼야 함
      const callEnv = mockPtyManager.create.mock.calls[0][3] as Record<string, string>;
      expect(callEnv).toMatchObject({ REPO_KEY: 'repo-val', AGENT_KEY: 'agent-val' });
    });
  });
});
