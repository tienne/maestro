/**
 * project / projectTask tRPC 라우터 단위 테스트
 *
 * projectRouter와 projectTaskRouter의 주요 프로시저를 검증한다:
 * project.list/create/update, projectTask.list/create/update (상태 전환)
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
        orderBy: (...___: unknown[]) => ({
          all: () => drizzleCallQueue.shift() ?? [],
        }),
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

const NOW = 1700000000000;

const drizzleProjectRow = {
  id: 'project-1',
  name: 'My Project',
  description: 'Test project',
  repositoryId: 'repo-1',
  createdAt: NOW,
  updatedAt: NOW,
};

const drizzleTaskRow = {
  id: 'task-1',
  projectId: 'project-1',
  parentTaskId: null,
  title: 'Implement feature X',
  prd: 'Feature X requirements',
  spec: null,
  referenceFiles: null,
  acceptanceCriteria: 'It works',
  priority: 'medium',
  assignedAgentId: null,
  status: 'pending',
  createdBy: 'human',
  workspaceId: null,
  createdAt: NOW,
  updatedAt: NOW,
};

const drizzleTaskInProgressRow = { ...drizzleTaskRow, status: 'in_progress' };
const drizzleTaskCompletedRow = { ...drizzleTaskRow, status: 'completed' };

// ── 테스트 ────────────────────────────────────────────────────────────────────

describe('project 절차', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearDrizzle();
    mockDatabaseManager.getDb.mockReturnValue(mockDb);
  });

  // ── project.list ────────────────────────────────────────────────────────────

  describe('project.list', () => {
    it('저장된 프로젝트 목록을 반환한다', async () => {
      pushDrizzleResult(drizzleProjectRow);

      const caller = await getCaller();
      const result = await caller.project.list();

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        id: 'project-1',
        name: 'My Project',
        description: 'Test project',
        repositoryId: 'repo-1',
      });
    });

    it('프로젝트가 없으면 빈 배열을 반환한다', async () => {
      const caller = await getCaller();
      const result = await caller.project.list();

      expect(result).toEqual([]);
    });

    it('description이 null이면 undefined로 반환한다', async () => {
      pushDrizzleResult({ ...drizzleProjectRow, description: null });

      const caller = await getCaller();
      const result = await caller.project.list();

      expect(result[0].description).toBeUndefined();
    });

    it('repositoryId가 null이면 undefined로 반환한다', async () => {
      pushDrizzleResult({ ...drizzleProjectRow, repositoryId: null });

      const caller = await getCaller();
      const result = await caller.project.list();

      expect(result[0].repositoryId).toBeUndefined();
    });
  });

  // ── project.get ─────────────────────────────────────────────────────────────

  describe('project.get', () => {
    it('id로 특정 프로젝트를 반환한다', async () => {
      pushDrizzleResult(drizzleProjectRow);

      const caller = await getCaller();
      const result = await caller.project.get({ id: 'project-1' });

      expect(result).toMatchObject({ id: 'project-1', name: 'My Project' });
    });

    it('존재하지 않는 id면 null을 반환한다', async () => {
      // 빈 배열 → not found → null

      const caller = await getCaller();
      const result = await caller.project.get({ id: 'nonexistent' });

      expect(result).toBeNull();
    });
  });

  // ── project.create ──────────────────────────────────────────────────────────

  describe('project.create', () => {
    it('프로젝트를 생성하고 즉시 반환한다 (SELECT 없이)', async () => {
      // project.create는 INSERT 후 DB를 다시 조회하지 않고 바로 반환
      const caller = await getCaller();
      const result = await caller.project.create({
        name: 'New Project',
        description: 'A new project',
        repositoryId: 'repo-1',
      });

      expect(drizzleInsertRunMock).toHaveBeenCalled();
      expect(result).toMatchObject({
        name: 'New Project',
        description: 'A new project',
        repositoryId: 'repo-1',
      });
      expect(result.id).toBeDefined();
      expect(typeof result.createdAt).toBe('number');
    });

    it('name이 빈 문자열이면 유효성 오류를 던진다', async () => {
      const caller = await getCaller();
      await expect(
        caller.project.create({ name: '' }),
      ).rejects.toThrow();
    });

    it('description 없이 최소 필드로 생성 가능하다', async () => {
      const caller = await getCaller();
      const result = await caller.project.create({ name: 'Minimal Project' });

      expect(result.name).toBe('Minimal Project');
      expect(result.description).toBeUndefined();
      expect(result.repositoryId).toBeUndefined();
    });
  });

  // ── project.update ──────────────────────────────────────────────────────────

  describe('project.update', () => {
    it('프로젝트 이름과 설명을 수정한다', async () => {
      // 1. existing 확인
      pushDrizzleResult({ id: 'project-1' });
      // 2. UPDATE 후 SELECT
      pushDrizzleResult({ ...drizzleProjectRow, name: 'Updated Name', description: 'Updated desc' });

      const caller = await getCaller();
      const result = await caller.project.update({
        id: 'project-1',
        data: { name: 'Updated Name', description: 'Updated desc' },
      });

      expect(drizzleUpdateRunMock).toHaveBeenCalled();
      expect(result.name).toBe('Updated Name');
      expect(result.description).toBe('Updated desc');
    });

    it('존재하지 않는 프로젝트면 에러를 던진다', async () => {
      // existing 확인 → 빈 배열 → not found

      const caller = await getCaller();
      await expect(
        caller.project.update({ id: 'nonexistent', data: { name: 'X' } }),
      ).rejects.toThrow('Project not found: nonexistent');
    });
  });

  // ── project.delete ──────────────────────────────────────────────────────────

  describe('project.delete', () => {
    it('프로젝트를 삭제한다', async () => {
      const caller = await getCaller();
      await caller.project.delete({ id: 'project-1' });

      expect(drizzleDeleteRunMock).toHaveBeenCalledTimes(1);
    });
  });
});

// ── projectTask 절차 ──────────────────────────────────────────────────────────

describe('projectTask 절차', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearDrizzle();
    mockDatabaseManager.getDb.mockReturnValue(mockDb);
  });

  // ── projectTask.list ─────────────────────────────────────────────────────────

  describe('projectTask.list', () => {
    it('프로젝트별 태스크 목록을 반환한다', async () => {
      pushDrizzleResult(drizzleTaskRow);

      const caller = await getCaller();
      const result = await caller.projectTask.list({ projectId: 'project-1' });

      expect(result).toHaveLength(1);
      expect(result[0]).toMatchObject({
        id: 'task-1',
        projectId: 'project-1',
        title: 'Implement feature X',
        status: 'pending',
        priority: 'medium',
        createdBy: 'human',
      });
    });

    it('태스크가 없으면 빈 배열을 반환한다', async () => {
      const caller = await getCaller();
      const result = await caller.projectTask.list({ projectId: 'project-empty' });

      expect(result).toEqual([]);
    });

    it('referenceFiles가 JSON 문자열이면 배열로 파싱한다', async () => {
      pushDrizzleResult({
        ...drizzleTaskRow,
        referenceFiles: '["src/foo.ts","src/bar.ts"]',
      });

      const caller = await getCaller();
      const result = await caller.projectTask.list({ projectId: 'project-1' });

      expect(result[0].referenceFiles).toEqual(['src/foo.ts', 'src/bar.ts']);
    });

    it('referenceFiles가 null이면 undefined로 반환한다', async () => {
      pushDrizzleResult({ ...drizzleTaskRow, referenceFiles: null });

      const caller = await getCaller();
      const result = await caller.projectTask.list({ projectId: 'project-1' });

      expect(result[0].referenceFiles).toBeUndefined();
    });
  });

  // ── projectTask.get ──────────────────────────────────────────────────────────

  describe('projectTask.get', () => {
    it('id로 태스크를 반환한다', async () => {
      pushDrizzleResult(drizzleTaskRow);

      const caller = await getCaller();
      const result = await caller.projectTask.get({ id: 'task-1' });

      expect(result).toMatchObject({ id: 'task-1', title: 'Implement feature X' });
    });

    it('존재하지 않는 태스크면 null을 반환한다', async () => {
      const caller = await getCaller();
      const result = await caller.projectTask.get({ id: 'nonexistent' });

      expect(result).toBeNull();
    });
  });

  // ── projectTask.create ───────────────────────────────────────────────────────

  describe('projectTask.create', () => {
    it('태스크를 생성하고 즉시 반환한다 (status: pending)', async () => {
      const caller = await getCaller();
      const result = await caller.projectTask.create({
        projectId: 'project-1',
        title: 'New Task',
        priority: 'high',
        createdBy: 'human',
      });

      expect(drizzleInsertRunMock).toHaveBeenCalled();
      expect(result).toMatchObject({
        projectId: 'project-1',
        title: 'New Task',
        priority: 'high',
        status: 'pending',
        createdBy: 'human',
      });
      expect(result.id).toBeDefined();
    });

    it('기본값 priority는 medium, createdBy는 human이다', async () => {
      const caller = await getCaller();
      const result = await caller.projectTask.create({
        projectId: 'project-1',
        title: 'Default Task',
      });

      expect(result.priority).toBe('medium');
      expect(result.createdBy).toBe('human');
    });

    it('referenceFiles 배열을 함께 저장할 수 있다', async () => {
      const caller = await getCaller();
      const result = await caller.projectTask.create({
        projectId: 'project-1',
        title: 'Task with files',
        referenceFiles: ['src/foo.ts', 'src/bar.ts'],
      });

      expect(result.referenceFiles).toEqual(['src/foo.ts', 'src/bar.ts']);
    });

    it('title이 빈 문자열이면 유효성 오류를 던진다', async () => {
      const caller = await getCaller();
      await expect(
        caller.projectTask.create({ projectId: 'project-1', title: '' }),
      ).rejects.toThrow();
    });

    it('agent가 생성한 태스크는 createdBy: agent로 저장된다', async () => {
      const caller = await getCaller();
      const result = await caller.projectTask.create({
        projectId: 'project-1',
        title: 'Agent-created task',
        createdBy: 'agent',
      });

      expect(result.createdBy).toBe('agent');
    });
  });

  // ── projectTask.update ───────────────────────────────────────────────────────

  describe('projectTask.update', () => {
    it('태스크 상태를 pending → in_progress로 전환한다', async () => {
      // 1. existing 확인
      pushDrizzleResult({ id: 'task-1' });
      // 2. UPDATE 후 SELECT
      pushDrizzleResult(drizzleTaskInProgressRow);

      const caller = await getCaller();
      const result = await caller.projectTask.update({
        id: 'task-1',
        data: { status: 'in_progress' },
      });

      expect(drizzleUpdateRunMock).toHaveBeenCalled();
      expect(result.status).toBe('in_progress');
    });

    it('태스크 상태를 in_progress → completed로 전환한다', async () => {
      pushDrizzleResult({ id: 'task-1' });
      pushDrizzleResult(drizzleTaskCompletedRow);

      const caller = await getCaller();
      const result = await caller.projectTask.update({
        id: 'task-1',
        data: { status: 'completed' },
      });

      expect(result.status).toBe('completed');
    });

    it('priority를 high로 변경한다', async () => {
      pushDrizzleResult({ id: 'task-1' });
      pushDrizzleResult({ ...drizzleTaskRow, priority: 'high' });

      const caller = await getCaller();
      const result = await caller.projectTask.update({
        id: 'task-1',
        data: { priority: 'high' },
      });

      expect(result.priority).toBe('high');
    });

    it('workspaceId를 연결할 수 있다', async () => {
      pushDrizzleResult({ id: 'task-1' });
      pushDrizzleResult({ ...drizzleTaskRow, workspaceId: 'ws-99' });

      const caller = await getCaller();
      const result = await caller.projectTask.update({
        id: 'task-1',
        data: { workspaceId: 'ws-99' },
      });

      expect(result.workspaceId).toBe('ws-99');
    });

    it('존재하지 않는 태스크면 에러를 던진다', async () => {
      // 빈 배열 → not found

      const caller = await getCaller();
      await expect(
        caller.projectTask.update({ id: 'nonexistent', data: { status: 'completed' } }),
      ).rejects.toThrow('Task not found: nonexistent');
    });

    it('유효하지 않은 status 값이면 유효성 오류를 던진다', async () => {
      const caller = await getCaller();
      await expect(
        caller.projectTask.update({
          id: 'task-1',
          data: { status: 'invalid_status' as 'pending' },
        }),
      ).rejects.toThrow();
    });
  });

  // ── projectTask.delete ───────────────────────────────────────────────────────

  describe('projectTask.delete', () => {
    it('태스크를 삭제한다', async () => {
      const caller = await getCaller();
      await caller.projectTask.delete({ id: 'task-1' });

      expect(drizzleDeleteRunMock).toHaveBeenCalledTimes(1);
    });
  });

  // ── projectTask.listChildren ─────────────────────────────────────────────────

  describe('projectTask.listChildren', () => {
    it('부모 태스크의 자식 태스크 목록을 반환한다', async () => {
      const childTask = {
        ...drizzleTaskRow,
        id: 'task-child-1',
        parentTaskId: 'task-1',
        title: 'Child Task',
      };
      pushDrizzleResult(childTask);

      const caller = await getCaller();
      const result = await caller.projectTask.listChildren({ parentTaskId: 'task-1' });

      expect(result).toHaveLength(1);
      expect(result[0].parentTaskId).toBe('task-1');
      expect(result[0].title).toBe('Child Task');
    });

    it('자식 태스크가 없으면 빈 배열을 반환한다', async () => {
      const caller = await getCaller();
      const result = await caller.projectTask.listChildren({ parentTaskId: 'task-leaf' });

      expect(result).toEqual([]);
    });
  });
});
