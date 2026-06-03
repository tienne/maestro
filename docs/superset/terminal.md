# 터미널 세션 관리

## 아키텍처 개요

Superset의 터미널 시스템은 **두 개의 백엔드**가 공존한다:

| 백엔드 | 설명 | 상태 |
|--------|------|------|
| **pty-daemon** | `@superset/pty-daemon` 패키지, 장수 프로세스, 유닉스 소켓 | 현재 메인 |
| **terminal-host** | 구버전 NDJSON 소켓 프로토콜 | 레거시, 단계적 제거 중 |

핵심 설계 원칙: **PTY는 앱과 분리된 daemon 프로세스가 소유**한다. 앱이 재시작되어도 터미널 세션은 살아있고, 재연결(attach)할 수 있다.

---

## terminal-host (레거시 NDJSON 데몬)

### 소켓 프로토콜

```
~/.superset/terminal-host.sock   (Unix domain socket)
~/.superset/terminal-host.token  (랜덤 32바이트 auth 토큰)
~/.superset/terminal-host.pid
```

### 클라이언트 역할 분리

각 클라이언트는 `clientId`와 `role`로 식별되는 **2개의 소켓** 연결을 사용:

```typescript
// control socket (role: "control") — RPC 요청/응답
// stream socket  (role: "stream")  — 비동기 이벤트 수신

const clientsById = new Map<string, {
  control?: Socket;
  stream?: Socket;
}>();
```

**이유**: 터미널 출력 이벤트 홍수가 RPC 응답을 블로킹하지 않도록.

### 지원 요청 타입

```typescript
type RequestHandlers = {
  hello:               // 인증 + 프로토콜 버전 확인
  createOrAttach:      // 세션 생성 또는 기존 세션 재연결
  cancelCreateOrAttach:
  write:              // PTY에 입력
  resize:             // 터미널 크기 변경
  detach:             // 스트림에서 분리 (세션은 유지)
  kill:               // 세션 종료
  signal:             // PTY에 시그널 전송
  killAll:
  listSessions:
  clearScrollback:
  shutdown:
}
```

### NDJSON 프레임 포맷

```typescript
// 요청
{ id: string; type: string; payload: unknown }

// 성공 응답
{ id: string; ok: true; payload: unknown }

// 에러 응답
{ id: string; ok: false; error: { code: string; message: string } }

// 비동기 이벤트 (stream socket으로 전달)
{ type: "event"; event: "data"|"exit"|"error"; sessionId: string; payload: ... }
```

### 이벤트 타입

```typescript
// data 이벤트
{ type: "data"; data: string }

// exit 이벤트
{ type: "exit"; exitCode: number; signal?: number }

// error 이벤트
{ type: "error"; error: string; code?: string }
```

### 백프레셔 3단계

```
레벨 1: client socket 버퍼 가득 참 → stdout 정지 → PTY 블로킹 → 커널 블로킹
레벨 2: stdin 큐 2MB 초과 → 프레임 드롭, WRITE_QUEUE_FULL 에러
레벨 3: PTY 커널 버퍼 가득 참 → 지수 백오프(2ms→50ms) → 최대 64MB → 이후 드롭
```

---

## pty-daemon (신규 아키텍처)

`@superset/pty-daemon` 패키지가 핵심. 두 가지 실행 모드:

### 신규 시작 (fresh spawn)

```typescript
// apps/desktop/src/main/pty-daemon/index.ts

async function runFresh(): Promise<void> {
  const server = new Server({
    socketPath: args.socket,
    daemonVersion,
    bufferCap: args.bufferBytes,
  });
  await server.listen();
}
```

### 핸드오프 수신 (업그레이드 시 세션 유지)

```typescript
async function runHandoffReceiver(): Promise<void> {
  // --handoff 플래그로 실행됨 (env var X — esbuild DCE 우회)
  const snapshot = readSnapshot(snapshotPath);
  const server = new Server({ socketPath, daemonVersion });

  // 이전 daemon의 PTY 세션 채택
  server.adoptSnapshot(snapshot);

  // 이전 daemon에게 ACK 전송
  process.send?.({ type: "upgrade-ack", successorPid: process.pid });

  // 이전 daemon 연결 해제 대기
  await new Promise(resolve => { process.once("disconnect", resolve); });

  await server.listenWithRetry();
  clearSnapshot(snapshotPath);
}
```

**핸드오프 프로토콜:**
```
이전 daemon → 새 daemon (--handoff --snapshot=... --socket=...로 실행)
             → PTY master fd 상속 (stdio 상속)
             → IPC 채널로 upgrade-ack 수신
             → 소켓 해제, 새 daemon이 바인딩
```

---

## tRPC Terminal 라우터 (메인 ↔ 렌더러 브릿지)

```typescript
// apps/desktop/src/lib/trpc/routers/terminal/terminal.ts

export const createTerminalRouter = () => {
  const registry = getWorkspaceRuntimeRegistry();
  const terminal = registry.getDefault().terminal;

  return router({
    createOrAttach: publicProcedure.input({
      paneId, requestId, joinPending, tabId, workspaceId,
      cols, rows, cwd, command, skipColdRestore, allowKilled, themeType,
    }).mutation(async ({ input }) => {
      const result = await terminal.createOrAttach({
        paneId,
        workspaceName, workspacePath, rootPath, cwd,
        // 환경 변수도 여기서 설정:
        // SUPERSET_PANE_ID, SUPERSET_TAB_ID, SUPERSET_WORKSPACE_ID
        // SUPERSET_WORKSPACE_NAME, SUPERSET_WORKSPACE_PATH
        // PATH: ~/.superset/bin prepend (에이전트 wrapper용)
      });
      return { paneId, isNew, scrollback, wasRecovered, isColdRestore, snapshot };
    }),

    write:   publicProcedure.input({ paneId, data }).mutation(...),
    resize:  publicProcedure.input({ paneId, cols, rows }).mutation(...),
    signal:  publicProcedure.input({ paneId, signal }).mutation(...),
    kill:    publicProcedure.input({ paneId }).mutation(...),
    detach:  publicProcedure.input({ paneId }).mutation(...),
    clearScrollback: publicProcedure.input({ paneId }).mutation(...),

    // 스트림 구독 (핵심!)
    stream: publicProcedure.input(z.string()).subscription(({ input: paneId }) => {
      return observable<
        | { type: "data"; data: string }
        | { type: "exit"; exitCode: number; signal?: number; reason?: string }
        | { type: "disconnect"; reason: string }
        | { type: "error"; error: string; code?: string }
      >((emit) => {
        terminal.on(`data:${paneId}`, (data) => emit.next({ type: "data", data }));
        terminal.on(`exit:${paneId}`, (exitCode, signal, reason) => {
          // ⚠️ emit.complete() 절대 호출하지 않음
          // paneId는 재시작에도 재사용됨
          // complete() 호출 시 @trpc/react-query가 재구독 안 함 → 페인 영구 분리
          emit.next({ type: "exit", exitCode, signal, reason });
        });
        terminal.on(`disconnect:${paneId}`, (reason) => emit.next({ type: "disconnect", reason }));
        terminal.on(`error:${paneId}`, (payload) => emit.next({ type: "error", ...payload }));

        return () => {
          terminal.off(`data:${paneId}`, onData);
          // cleanup...
        };
      });
    }),
  });
};
```

### 핵심: exit은 subscription 완료가 아니다

```typescript
// WRONG — 이렇게 하면 페인이 영구적으로 출력에서 분리됨
terminal.on(`exit:${paneId}`, () => emit.complete());

// CORRECT — exit을 상태 전환 이벤트로 처리
terminal.on(`exit:${paneId}`, (exitCode, signal, reason) => {
  emit.next({ type: "exit", exitCode, signal, reason });
  // subscription은 계속 유지됨 → 재시작 시 새 출력 수신 가능
});
```

---

## Cold Restore (콜드 리스토어)

앱 재시작 후 이전 세션 복원 흐름:

```
1. main/index.ts 시작: reconcileDaemonSessions() 호출
2. 기존 pty-daemon에 listSessions 요청
3. 살아있는 세션 목록 확인
4. 렌더러: createOrAttach(paneId, { skipColdRestore: false })
5. terminal.createOrAttach 응답: { isColdRestore: true, snapshot: TerminalSnapshot }
6. 렌더러: xterm에 snapshot 적용 (화면 복원)
7. 사용자가 새 입력 시 새 shell 시작 (cold restore는 read-only)
```

**중요**: cold restore 중 stale `exit` 이벤트가 큐에 있을 수 있음 → 새 shell 시작 전에 버려야 `restartTerminal()` 의도치 않게 호출되는 것 방지.

---

## 세션 라이프사이클

```
[idle]
  ↓ createOrAttach
[creating/attaching]
  ↓ 성공
[alive]            ←→ write, resize, signal
  ↓ kill or exit
[terminated]
  ↓ kill({deleteHistory: false})
[dead but scrollback preserved]
```

### race condition 처리

```typescript
// session.ts 내부 (추론)
// terminatingAt 타임스탬프로 kill vs attach 경쟁 조건 처리
isAttachable(): boolean {
  return this.terminatingAt === null;
}
```

---

## xterm.js 통합 (렌더러)

### 사용 패키지

```json
"@xterm/xterm": "6.1.0-beta.220",
"@xterm/addon-fit": "0.12.0-beta.220",
"@xterm/addon-webgl": "0.20.0-beta.219",
"@xterm/addon-search": "0.17.0-beta.220",
"@xterm/addon-serialize": "0.15.0-beta.220",
"@xterm/addon-clipboard": "0.3.0-beta.220",
"@xterm/addon-ligatures": "0.11.0-beta.220",
"@xterm/addon-image": "0.10.0-beta.220",
"@xterm/addon-progress": "0.3.0-beta.220",
"@xterm/headless": "6.1.0-beta.220",
```

### 스크롤백 성능 최적화 (Superset 레퍼런스 구현 참고)

```typescript
// apps/desktop/src/renderer/lib/terminal/...
// 아래 패턴 활용:

// 1. wasAtBottom 추적 (새 데이터 도착 시 자동 스크롤 여부 판단)
const wasAtBottom = terminal.buffer.active.viewportY >=
  terminal.buffer.active.length - terminal.rows;

// 2. 데이터 쓰기
terminal.write(data);

// 3. 자동 스크롤
if (wasAtBottom) {
  terminal.scrollToBottom();
}

// 4. 리사이즈 debounce (150ms)
const debouncedResize = useMemo(
  () => debounce((cols: number, rows: number) => {
    trpc.terminal.resize.mutate({ paneId, cols, rows });
  }, 150),
  [paneId]
);
```

### CWD 업데이트 debounce

```typescript
// 스트림 이벤트마다 CWD 업데이트 → Zustand store → 전체 구독자 리렌더
// 해결: 150ms debounce

const debouncedUpdateCwd = useRef(
  debounce((cwd: string) => {
    usePaneStore.getState().updateCwd(paneId, cwd);
  }, 150)
).current;
```

---

## 시스템 환경 변수

터미널 세션에 자동으로 설정되는 환경 변수:

```bash
SUPERSET_PANE_ID=<paneId>
SUPERSET_TAB_ID=<tabId>
SUPERSET_WORKSPACE_ID=<workspaceId>
SUPERSET_WORKSPACE_NAME=<name>
SUPERSET_WORKSPACE_PATH=<path>
SUPERSET_ROOT_PATH=<rootPath>
SUPERSET_PORT=<notificationsPort>
PATH=~/.superset/bin:$PATH   # 에이전트 wrapper 스크립트 우선 탐색
```

---

## Maestro 참고 포인트

1. **pty-daemon 분리**: `node-pty`를 메인 프로세스가 아닌 별도 daemon에서 실행하면 앱 재시작 시 터미널 세션 유지 가능. 이는 Superset의 핵심 UX 차별점.

2. **NDJSON + Unix Socket 프로토콜**: 단순하고 검증된 IPC. WebSocket보다 오버헤드 낮음. 각 연결을 control/stream으로 분리하는 패턴 효과적.

3. **exit ≠ complete**: tRPC subscription에서 `emit.complete()` 금지. exit을 상태 이벤트로 처리해야 재시작 가능.

4. **scrollback = memory buffer**: 영구 저장이 아닌 메모리 버퍼 + snapshot. 앱 재시작 시 snapshot으로 복원 후 새 PTY 연결.

5. **wasAtBottom 패턴**: 스크롤 중일 때는 자동 스크롤 안 함. 새 데이터 도착 전 `wasAtBottom` 체크.
