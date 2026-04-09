---
name: vitest-testing
description: "Maestro Vitest 테스트 작성 패턴. tRPC 프로시저와 서비스 레이어 단위 테스트 구현 방법. test-writer가 버그 재현 테스트와 회귀 방지 테스트를 작성할 때 반드시 이 스킬을 참조한다."
---

# Maestro Vitest 테스트 작성 가이드

## 프로젝트 테스트 설정

```typescript
// apps/desktop/vitest.config.ts
// - environment: 'node' (Electron 환경 아님)
// - include: 'src/**/*.test.ts'
// - coverage: src/trpc/**, src/services/**
```

**테스트 파일 위치:**
- tRPC 프로시저 테스트: `src/__tests__/trpc-router.test.ts` (기존 파일에 추가)
- 서비스 단위 테스트: `src/services/{name}.test.ts` 또는 `src/__tests__/{name}.test.ts`

**실행 명령:**
```bash
pnpm nx run desktop:test
pnpm nx run desktop:test --testNamePattern="session 절차"  # 특정 테스트만
```

## 필수 Mock 구조

tRPC 라우터 테스트는 Node 환경에서 실행되므로 Electron과 외부 의존성을 모두 mock해야 한다. 기존 `trpc-router.test.ts`에 이미 정의된 mock을 재사용한다.

### 기존 파일에 테스트 추가 시

```typescript
// 기존 trpc-router.test.ts에 describe 블록 추가
describe('내 새 도메인 절차', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockDatabaseManager.getDb.mockReturnValue(mockDb);
  });
  
  // ... 테스트
});
```

### 새 파일 생성 시

반드시 기존 mock 설정을 전체 복사하여 시작한다. `references/mock-setup.md` 참조.

## setupMockDb 패턴

DB 쿼리를 SQL 패턴 문자열로 mock한다:

```typescript
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
```

**사용 패턴:**

```typescript
// 단순 조회
setupMockDb({
  'FROM sessions WHERE id': { 
    get: vi.fn().mockReturnValue({ id: 'session-1', status: 'pending' }) 
  },
});

// 여러 SQL 패턴 (순서 주의 — 먼저 매칭된 것이 우선)
setupMockDb({
  'INSERT INTO sessions': { run: vi.fn() },
  'FROM sessions WHERE id': { 
    get: vi.fn()
      .mockReturnValueOnce(pendingRow)   // 첫 번째 호출
      .mockReturnValueOnce(runningRow),  // 두 번째 호출
  },
  'UPDATE sessions SET status': { run: vi.fn() },
});
```

**핵심**: `normalized.includes(pattern)` — 부분 문자열 매칭이므로 패턴은 SQL의 고유한 일부를 사용한다.

## tRPC Caller 패턴

```typescript
// vi.mock이 먼저 적용되도록 동적 import
async function getCaller() {
  const { createCaller } = await import('../trpc/router');
  return createCaller({});
}

// 사용
it('session을 생성한다', async () => {
  setupMockDb({ ... });
  const caller = await getCaller();
  const result = await caller.session.create({ ... });
  expect(result.status).toBe('pending');
});
```

## 버그 재현 테스트 작성 패턴

버그를 TDD 방식으로 표현한다:

```typescript
describe('session 절차', () => {
  describe('session.launch', () => {
    // 기존 정상 케이스들...
    
    // ── 버그 재현 테스트 (수정 전 실패, 수정 후 통과) ────────────
    it('[BUG-FIX] env_vars가 없을 때 PTY가 빈 env로 실행된다', async () => {
      // 버그: env_vars 쿼리가 undefined를 반환하면 크래시
      setupMockDb({
        'FROM sessions WHERE id': { get: vi.fn().mockReturnValueOnce(sessionRow).mockReturnValueOnce(runningRow) },
        'FROM workspaces WHERE id': { get: vi.fn().mockReturnValue(workspaceRow) },
        'FROM agents WHERE id': { get: vi.fn().mockReturnValue(agentRow) },
        'FROM env_vars': { all: vi.fn().mockReturnValue(undefined) }, // 버그 시나리오: undefined 반환
        'UPDATE sessions SET status': { run: vi.fn() },
        'INSERT INTO app_state': { run: vi.fn() },
      });

      const caller = await getCaller();
      // 수정 전: 이 줄에서 TypeError 발생
      // 수정 후: 빈 env로 정상 실행
      await expect(
        caller.session.launch({ sessionId: 'session-1', cols: 80, rows: 24 })
      ).resolves.toBeDefined();
      
      // 수정 후 검증: undefined 대신 빈 객체로 처리
      const callEnv = mockPtyManager.create.mock.calls[0][3];
      expect(callEnv).toEqual({});
    });
  });
});
```

## 서비스 단위 테스트 패턴

서비스를 직접 import하여 단위 테스트한다:

```typescript
// src/services/config-store.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as fs from 'fs';

vi.mock('fs');
vi.mock('os', () => ({ homedir: () => '/home/test' }));

describe('ConfigStore', () => {
  beforeEach(() => vi.clearAllMocks());

  it('서버 설정을 파일에 저장한다', () => {
    const writeFileSyncMock = vi.mocked(fs.writeFileSync);
    
    // 서비스 함수 import 및 실행
    const { saveServerConfig } = require('./config-store');
    saveServerConfig({ port: 3000, token: 'abc' });
    
    expect(writeFileSyncMock).toHaveBeenCalledWith(
      expect.stringContaining('.maestro/server.json'),
      expect.stringContaining('"port":3000')
    );
  });
});
```

## 테스트 품질 기준

| 기준 | 구현 |
|------|------|
| 재현 가능성 | mock 값이 명확히 버그 시나리오를 표현 |
| 독립성 | `beforeEach(vi.clearAllMocks())` 필수 |
| 명확한 실패 메시지 | `expect(x).toBe(y)` 대신 `expect(x).toMatchObject({ key: y })` |
| 경계 케이스 | null/undefined/빈 배열/잘못된 타입 각각 테스트 |

상세 mock 설정 전체 코드는 `references/mock-setup.md` 참조.
