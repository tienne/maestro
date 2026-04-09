# tRPC Router 심화 패턴

## 목차
1. [에러 처리](#에러-처리)
2. [Context 활용](#context-활용)
3. [Input 검증 패턴](#input-검증-패턴)
4. [PTY Manager 연동](#pty-manager-연동)
5. [Git 서비스 연동](#git-서비스-연동)
6. [IPC 이벤트 발행](#ipc-이벤트-발행)

---

## 에러 처리

```typescript
import { TRPCError } from '@trpc/server';

const myRouter = router({
  get: publicProcedure
    .input(z.object({ id: z.string() }))
    .query(({ input }) => {
      const item = db.getMyItem(input.id);
      if (!item) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: `Item ${input.id} not found`,
        });
      }
      return item;
    }),
});
```

tRPC 에러 코드: `NOT_FOUND`, `BAD_REQUEST`, `INTERNAL_SERVER_ERROR`, `UNAUTHORIZED`, `CONFLICT`

---

## Input 검증 패턴

```typescript
// 복잡한 검증
const createWorkspaceInput = z.object({
  name: z.string().min(1).max(100),
  repositoryId: z.string().uuid(),
  branch: z.string().regex(/^[a-zA-Z0-9/_-]+$/),
}).refine(
  (data) => !data.branch.includes('..'),
  { message: "Branch name cannot contain '..'", path: ['branch'] }
);

// enum 검증
const statusInput = z.enum(['pending', 'running', 'stopped', 'error']);

// optional with default
const listInput = z.object({
  limit: z.number().int().positive().default(50),
  cursor: z.string().optional(),
});
```

---

## PTY Manager 연동

```typescript
import { ptyManager } from '../services/pty-manager';

const sessionRouter = router({
  launch: publicProcedure
    .input(z.object({
      sessionId: z.string(),
      cols: z.number(),
      rows: z.number(),
    }))
    .mutation(async ({ input }) => {
      const session = db.getSession(input.sessionId);
      if (!session) throw new TRPCError({ code: 'NOT_FOUND' });
      
      const agent = db.getAgent(session.agentId);
      const workspace = db.getWorkspace(session.workspaceId);
      
      await ptyManager.launch({
        sessionId: input.sessionId,
        command: agent.command,
        args: agent.args,
        cwd: workspace.worktreePath,
        cols: input.cols,
        rows: input.rows,
      });
      
      db.updateSessionStatus(input.sessionId, 'running');
      return { success: true };
    }),
    
  onOutput: publicProcedure
    .input(z.object({ sessionId: z.string() }))
    .subscription(({ input }) => {
      return observable<string>((emit) => {
        const handler = (data: string) => emit.next(data);
        ptyManager.onData(input.sessionId, handler);
        return () => ptyManager.offData(input.sessionId, handler);
      });
    }),
});
```

---

## Git 서비스 연동

```typescript
import { getGitService } from '../services/git';

const gitRouter = router({
  status: publicProcedure
    .input(z.object({ worktreePath: z.string() }))
    .query(async ({ input }) => {
      const git = getGitService(input.worktreePath);
      return git.getStatus();
    }),
    
  commit: publicProcedure
    .input(z.object({
      worktreePath: z.string(),
      message: z.string().min(1),
      files: z.array(z.string()),
    }))
    .mutation(async ({ input }) => {
      const git = getGitService(input.worktreePath);
      await git.stage(input.files);
      await git.commit(input.message);
      return { success: true };
    }),
});
```

---

## IPC 이벤트 발행

tRPC subscription 외에, 메인→렌더러 단방향 이벤트가 필요하면:

```typescript
import { BrowserWindow } from 'electron';

// 메인 프로세스에서 렌더러로 이벤트 발행
function broadcastToRenderer(event: string, data: unknown) {
  const windows = BrowserWindow.getAllWindows();
  windows.forEach((win) => {
    win.webContents.send(event, data);
  });
}

// 사용 예시 (서비스 내부)
ptyManager.on('exit', (sessionId) => {
  db.updateSessionStatus(sessionId, 'stopped');
  broadcastToRenderer('session:exit', { sessionId });
});
```

렌더러에서 수신:
```typescript
// renderer에서는 preload를 통해 접근
window.electron?.on('session:exit', (data) => { ... });
```
