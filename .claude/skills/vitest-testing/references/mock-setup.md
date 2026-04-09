# Vitest Mock 전체 설정 코드

새 테스트 파일을 생성할 때 이 전체 블록을 복사하여 시작한다.

```typescript
import { vi, describe, it, expect, beforeEach } from 'vitest';

// ── Electron mock ───────────────────────────────────────────────────────────
vi.mock('electron', () => ({
  dialog: {
    showOpenDialog: vi.fn().mockResolvedValue({ canceled: false, filePaths: ['/some/path'] }),
  },
  BrowserWindow: class {},
  ipcMain: { handle: vi.fn(), on: vi.fn() },
}));

// ── DB mock ─────────────────────────────────────────────────────────────────
const mockDb = { prepare: vi.fn() };
const mockDatabaseManager = { getDb: vi.fn().mockReturnValue(mockDb) };

vi.mock('../db/database', () => ({
  getDatabaseManager: vi.fn(() => mockDatabaseManager),
}));

// ── PTY Manager mock ─────────────────────────────────────────────────────────
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

// ── Git mock ─────────────────────────────────────────────────────────────────
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

// ── 기타 서비스 mock ───────────────────────────────────────────────────────
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

// ── Helpers ──────────────────────────────────────────────────────────────────
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
    return {
      run: vi.fn(),
      get: vi.fn().mockReturnValue(undefined),
      all: vi.fn().mockReturnValue([]),
    };
  });
}

async function getCaller() {
  const { createCaller } = await import('../trpc/router');
  return createCaller({});
}

// ── 공통 픽스처 ───────────────────────────────────────────────────────────────
const repositoryRow = {
  id: 'repo-1', name: 'my-repo', path: '/home/user/my-repo',
  base_branch: 'main', branch_prefix: 'feat', color: '#4B8BFF',
  worktree_base_path: '', setup_script: '', teardown_script: '',
  created_at: '2024-01-01T00:00:00.000Z',
};

const workspaceRow = {
  id: 'ws-1', name: 'workspace-1', repository_id: 'repo-1',
  branch: 'feat/test', worktree_path: '/projects/repo/feat-test',
  created_at: '2024-01-01',
};

const agentRow = {
  id: 'agent-1', name: 'Claude Code', command: 'claude',
  args: '[]', env: '{}',
};

const sessionRow = {
  id: 'session-1', name: 'Test Session', workspace_id: 'ws-1',
  agent_id: 'agent-1', status: 'pending', pid: null, created_at: '2024-01-01',
};
```

## 주요 사용 패턴

### 순차 반환 (같은 쿼리를 여러 번 호출할 때)

```typescript
setupMockDb({
  'FROM sessions WHERE id': {
    get: vi.fn()
      .mockReturnValueOnce(sessionRow)     // 첫 번째 호출 (시작 전)
      .mockReturnValueOnce({ ...sessionRow, status: 'running', pid: 42 }), // 두 번째 (업데이트 후)
  },
});
```

### 서비스 직접 mock (라우터가 아닌 서비스를 테스트할 때)

```typescript
// 서비스를 직접 import하고 의존성만 mock
import { myServiceFunction } from '../services/my-service';

vi.mock('../db/database', () => ({ ... }));

it('서비스 함수가 올바르게 동작한다', () => {
  // 직접 호출
  const result = myServiceFunction({ id: '1' });
  expect(result).toMatchObject({ ... });
});
```
