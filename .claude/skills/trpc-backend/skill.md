---
name: trpc-backend
description: "Maestro tRPC v11 프로시저, 서비스 레이어, better-sqlite3 쿼리 구현 패턴. backend-engineer가 router.ts와 services/를 작업할 때 이 스킬을 참조한다. 새 API 엔드포인트 추가, DB 쿼리 구현, 서비스 로직 작성 시 반드시 사용."
---

# tRPC Backend 개발 가이드

Maestro의 Electron 메인 프로세스 개발 패턴을 정의한다.

## 프로젝트 구조

```
apps/desktop/src/
├── trpc/
│   ├── router.ts       ← 모든 프로시저 정의 (메인 파일)
│   └── ipc.ts          ← tRPC v11 IPC 핸들러 (수정 불필요)
├── services/
│   ├── pty-manager.ts  ← PTY 터미널 세션
│   ├── git.ts          ← Git 작업
│   ├── http-server.ts  ← CLI 연동 HTTP 서버
│   ├── config-store.ts ← 설정 파일
│   └── wrappers/       ← AI 에이전트 래퍼
└── db/
    └── database.ts     ← SQLite 스키마 + 쿼리 헬퍼
```

## tRPC 프로시저 패턴

### Query 프로시저 (데이터 조회)

```typescript
// router.ts — 기존 workspaceRouter 패턴을 따른다
const workspaceRouter = router({
  list: publicProcedure
    .input(z.object({ repositoryId: z.string() }))
    .query(({ input }) => {
      return db.getWorkspacesByRepository(input.repositoryId);
    }),
});
```

### Mutation 프로시저 (데이터 변경)

```typescript
const sessionRouter = router({
  create: publicProcedure
    .input(z.object({
      name: z.string(),
      workspaceId: z.string(),
      agentId: z.string(),
    }))
    .mutation(({ input }) => {
      const id = nanoid();
      return db.createSession({ id, ...input });
    }),
});
```

### Subscription 프로시저 (실시간 이벤트)

```typescript
import { observable } from '@trpc/server/observable';

const sessionRouter = router({
  onOutput: publicProcedure
    .input(z.object({ sessionId: z.string() }))
    .subscription(({ input }) => {
      return observable<string>((emit) => {
        const handler = (data: string) => emit.next(data);
        ptyManager.onOutput(input.sessionId, handler);
        return () => ptyManager.offOutput(input.sessionId, handler);
      });
    }),
});
```

### 라우터 등록

```typescript
// router.ts 하단의 appRouter에 추가
export const appRouter = router({
  workspace: workspaceRouter,
  repository: repositoryRouter,
  // 새 라우터 추가:
  myFeature: myFeatureRouter,
});
```

## better-sqlite3 패턴

### 테이블 생성 (db/database.ts)

```typescript
// database.ts의 initDatabase() 함수 안에 추가
db.exec(`
  CREATE TABLE IF NOT EXISTS my_table (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )
`);
```

### CRUD 헬퍼 함수 패턴

```typescript
// database.ts에 추가
export function createMyItem(data: { id: string; name: string }) {
  const stmt = db.prepare(
    'INSERT INTO my_table (id, name) VALUES (?, ?)'
  );
  stmt.run(data.id, data.name);
  return getMyItem(data.id)!;
}

export function getMyItem(id: string) {
  return db.prepare('SELECT * FROM my_table WHERE id = ?').get(id) as MyItem | undefined;
}

export function listMyItems(): MyItem[] {
  return db.prepare('SELECT * FROM my_table ORDER BY created_at DESC').all() as MyItem[];
}

export function deleteMyItem(id: string) {
  db.prepare('DELETE FROM my_table WHERE id = ?').run(id);
}
```

**주의**: better-sqlite3는 동기 API다. async/await 불필요. `get()`은 단일 행, `all()`은 배열, `run()`은 변경 작업.

## 서비스 레이어 패턴

복잡한 비즈니스 로직은 `services/`에 분리하고, router에서 서비스를 호출한다.

```typescript
// services/my-service.ts
export class MyService {
  private items = new Map<string, ItemState>();
  
  start(id: string) {
    // 상태 관리 로직
  }
  
  stop(id: string) {
    // 정리 로직
  }
}

export const myService = new MyService(); // 싱글톤
```

```typescript
// router.ts에서 서비스 사용
import { myService } from '../services/my-service';

const myRouter = router({
  start: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(({ input }) => {
      myService.start(input.id);
      return { success: true };
    }),
});
```

## 상세 패턴

상세 패턴이 필요하면 `references/router-patterns.md` 참조.
