# AI/채팅 통신 구조

## 개요: 두 가지 AI 통신 경로

Superset의 AI 통신은 **두 가지 완전히 다른 경로**로 나뉜다:

| 경로 | 대상 | 방식 |
|------|------|------|
| **터미널 에이전트** | Claude Code, Gemini CLI, etc. | node-pty로 직접 CLI 실행 |
| **채팅 에이전트** | 자체 AI 채팅 창 | mastracode 런타임 + Durable Streams |

---

## 경로 1: 터미널 에이전트 (CLI 래핑)

### 동작 방식

Superset은 CLI 에이전트를 직접 실행하지 않는다. 사용자가 claude, codex 등을 직접 입력하면, Superset의 wrapper 스크립트가 중간에서 훅을 캡처한다.

```
~/.superset/bin/claude   (shim 스크립트)
    ↓
실제 claude binary 실행
    ↓
Claude Code의 Start/Stop/PermissionRequest 훅 → notifications 서버 POST
    ↓
Superset UI 상태 업데이트 (working/review/permission indicator)
```

### 에이전트 훅 수신 서버

```typescript
// apps/desktop/src/main/lib/notifications/server.ts (추론)
// apps/desktop/src/lib/trpc/routers/notifications.ts

export const notificationsEmitter = new EventEmitter();

// tRPC subscription → 렌더러 연결
subscribe: publicProcedure.subscription(() => {
  return observable<NotificationEvent>((emit) => {
    const onLifecycle = (data: AgentLifecycleEvent) => {
      emit.next({ type: NOTIFICATION_EVENTS.AGENT_LIFECYCLE, data });
    };
    notificationsEmitter.on(NOTIFICATION_EVENTS.AGENT_LIFECYCLE, onLifecycle);
    return () => notificationsEmitter.off(...);
  });
})
```

### 렌더러 훅 리스너

```typescript
// apps/desktop/src/renderer/stores/tabs/useAgentHookListener.ts

export function useAgentHookListener() {
  electronTrpc.notifications.subscribe.useSubscription(undefined, {
    onData: (event) => {
      const state = useTabsStore.getState();
      const target = resolveNotificationTarget(event.data, state);

      if (event.type === NOTIFICATION_EVENTS.AGENT_LIFECYCLE) {
        if (eventType === "Start") {
          state.setPaneStatus(paneId, "working");
        } else if (eventType === "PermissionRequest" || eventType === "PendingQuestion") {
          state.setPaneStatus(paneId, "permission");
        } else if (eventType === "Stop") {
          // 현재 포커스된 탭이면 idle, 아니면 review
          const nextStatus = isInActiveTab ? "idle" : "review";
          state.setPaneStatus(paneId, nextStatus);
        }
      }
    },
  });
}
```

**상태 의미:**
- `working` → 앰버 펄싱 인디케이터
- `permission` → 빨간 펄싱 인디케이터 (사용자 응답 필요)
- `review` → 초록 정적 인디케이터 (완료, 탭 비활성)
- `idle` → 인디케이터 없음

---

## 경로 2: 채팅 에이전트 (자체 AI 런타임)

### 핵심: ChatRuntimeService

채팅 창은 CLI를 실행하는 것이 아니라 자체 AI 런타임을 사용한다.

```typescript
// packages/chat/src/server/trpc/service.ts

export class ChatRuntimeService {
  private readonly runtimes = new Map<string, RuntimeSession>();

  private async getOrCreateRuntime(sessionId: string, cwd?: string): Promise<RuntimeSession> {
    const runtime = await createMastraCode({
      cwd: runtimeCwd,
      extraTools,          // Superset MCP 도구들
      disableMcp: !ENABLE_MASTRA_MCP_SERVERS,
      memory: new Memory({ options: { observationalMemory: false } }),
    });

    // 런타임 초기화
    runtime.hookManager?.setSessionId(sessionId);
    await runtime.harness.init();
    runtime.harness.setResourceId({ resourceId: sessionId });
    await runtime.harness.selectOrCreateThread();

    // 라이프사이클 이벤트 구독
    subscribeToSessionEvents(sessionRuntime, this.opts.onLifecycleEvent);
    return sessionRuntime;
  }
}
```

`mastracode` 패키지 = Mastra AI 프레임워크 기반의 AI 에이전트 런타임. Anthropic/OpenAI SDK를 내부에서 사용.

### 채팅 tRPC 라우터

```typescript
// packages/chat/src/server/trpc/service.ts (createRouter)

session: t.router({
  getDisplayState: t.procedure.input(displayStateInput).query(...),
  listMessages:    t.procedure.input(listMessagesInput).query(...),

  sendMessage: t.procedure.input(sendMessageInput).mutation(async ({ input }) => {
    const runtime = await this.getOrCreateRuntime(input.sessionId, input.cwd);
    await onUserPromptSubmit(runtime, userMessage);  // 훅 실행
    return runtime.harness.sendMessage(input.payload);
  }),

  restartFromMessage: t.procedure.input(...).mutation(...),
  stop:   t.procedure.input(sessionIdInput).mutation(({ input }) => runtime.harness.abort()),
  abort:  t.procedure.input(sessionIdInput).mutation(({ input }) => runtime.harness.abort()),

  approval: t.router({
    respond: t.procedure.mutation(({ input }) =>
      runtime.harness.respondToToolApproval(input.payload)
    ),
  }),
  question: t.router({
    respond: t.procedure.mutation(({ input }) =>
      respondToQuestionWithOptimisticState(runtime, input.payload)
    ),
  }),
  plan: t.router({
    respond: t.procedure.mutation(({ input }) =>
      runtime.harness.respondToPlanApproval(input.payload)
    ),
  }),
})
```

### 채팅 런타임 서비스 데스크탑 연결

```typescript
// apps/desktop/src/lib/trpc/routers/chat-runtime-service/index.ts

const service = new ChatRuntimeService({
  headers: async (): Promise<Record<string, string>> => {
    const { token } = await loadToken();
    if (token) return { Authorization: `Bearer ${token}` };
    return {};
  },
  apiUrl: env.NEXT_PUBLIC_API_URL,
  onLifecycleEvent: handleLifecycleEvent,  // ← 에이전트 훅 → notificationsEmitter로 연결
});

export const createChatRuntimeServiceRouter = () => service.createRouter();
```

---

## 클라우드 채팅 스트리밍 (Durable Streams)

채팅 세션의 **메시지 기록 및 스트리밍**은 자체 클라우드 인프라를 사용한다.

### API 서버 스트림 핸들러

```typescript
// apps/api/src/app/api/chat/[sessionId]/stream/route.ts

// GET: 스트림 구독 (SSE/durable stream)
export async function GET(request, { params }) {
  const upstream = streamUrl(sessionId);  // https://streams.superset.sh/sessions/<id>
  const response = await fetch(upstream, {
    method: "GET",
    headers: { Authorization: `Bearer ${env.DURABLE_STREAMS_SECRET}` },
  });
  return new Response(response.body, { status, headers });
}

// POST: 스트림에 이벤트 추가
export async function POST(request, { params }) {
  const upstream = streamUrl(sessionId);
  // 스트림 프로토콜 헤더들 (producer-id, producer-epoch, stream-closed 등) 전달
  const response = await fetch(upstream, { method: "POST", headers, body });
  return new Response(respBody, { status: response.status, headers: respHeaders });
}
```

### 스트림 URL 및 헬퍼

```typescript
// apps/api/src/app/api/chat/lib.ts

export function streamUrl(sessionId: string) {
  return `${env.DURABLE_STREAMS_URL}/sessions/${sessionId}`;
}

export function getDurableStream(sessionId: string) {
  return new DurableStream({
    url: streamUrl(sessionId),
    headers: { Authorization: `Bearer ${env.DURABLE_STREAMS_SECRET}` },
  });
}

export async function appendToStream(sessionId: string, event: string) {
  const response = await fetch(streamUrl(sessionId), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.DURABLE_STREAMS_SECRET}`,
      "Content-Type": "application/json",
    },
    body: event,
  });
}
```

**스트림 프로토콜 헤더:**
```
stream-next-offset
stream-cursor
stream-up-to-date
stream-closed
producer-id / producer-epoch / producer-seq
```

### 채팅 세션 생성

```typescript
// apps/api/src/app/api/chat/[sessionId]/route.ts

export async function PUT(request, { params }) {
  // 1. Durable Stream 생성
  await stream.create({ contentType: "application/json" });

  // 2. DB에 채팅 세션 기록
  await db.insert(chatSessions).values({
    id: sessionId,
    organizationId: body.organizationId,
    workspaceId: body.workspaceId,
    createdBy: session.user.id,
  }).onConflictDoNothing();

  return Response.json({ sessionId, streamUrl: `/api/chat/${sessionId}/stream` });
}
```

---

## AI Provider 지원

### 채팅 런타임 (mastracode)
mastracode는 내부적으로 Vercel AI SDK를 사용:
- `@ai-sdk/anthropic` (3.0.64) — Claude 모델
- `@ai-sdk/openai` (3.0.36) — GPT 모델
- `ai` (6.0.141) — Vercel AI SDK core

모델 선택은 메시지 전송 시:
```typescript
if (selectedModel) {
  await runtime.harness.switchModel({
    modelId: selectedModel,
    scope: "thread",
  });
}
```

### 터미널 에이전트 (CLI)
사용자 머신에 설치된 모든 CLI 에이전트:
- Claude Code (`claude`)
- Gemini CLI (`gemini`)
- OpenAI Codex CLI (`codex`)
- GitHub Copilot
- Cursor Agent
- Amp Code, Droid, Mastra Code, OpenCode, Pi

---

## 에이전트 프롬프트 컨텍스트 구성

V2 워크스페이스 생성 시 에이전트 프롬프트 컨텍스트를 조합하는 파이프라인:

```
buildLaunchSourcesFromPending → LaunchSource[]
  ↓
buildLaunchContext → LaunchContext
  ↓
buildLaunchSpec → AgentLaunchSpec
  ↓
renderPromptTemplate (Mustache)
  → {{userPrompt}}
  → {{tasks}}     (Linear/Jira 태스크 제목)
  → {{issues}}    (GitHub 이슈 제목)
  → {{prs}}       (GitHub PR 정보)
  → {{attachments}}
```

**결과**: 에이전트에게 전달되는 첫 메시지가 컨텍스트 풍부하게 조합됨.

---

## MCP 서버 통합

```typescript
// apps/api/src/app/api/agent/[transport]/route.ts

export async function handleRequest(req: Request): Promise<Response> {
  const authInfo = await verifyToken(req, deps);  // 세션/API키/OAuth JWT 모두 지원
  const transport = new WebStandardStreamableHTTPServerTransport();
  const server = createMcpServer();
  await server.connect(transport);
  return transport.handleRequest(req, { authInfo });
}
```

**인증 방식 우선순위:**
1. `sk_live_` 접두사 → API 키 검증
2. 3-part JWT → OAuth 액세스 토큰 (`better-auth/oauth2`)
3. 세션 쿠키 → `auth.api.getSession`

---

## 메시지 저장 방식

| 데이터 | 저장소 |
|--------|--------|
| 채팅 세션 메타데이터 (id, orgId, title) | Postgres (`chatSessions` 테이블) |
| 채팅 메시지 스트림 | Durable Streams 서비스 (`streams.superset.sh`) |
| 터미널 출력 스크롤백 | pty-daemon 메모리 내 버퍼 (앱 재시작 시 복원용 snapshot) |
| 탭/페인/채팅 상태 | 로컬 SQLite (tRPC storage via `@superset/local-db`) |

---

## Maestro 참고 포인트

### 채팅 런타임 아키텍처
Superset의 ChatRuntimeService가 하는 일:
1. sessionId별 런타임 인스턴스 캐싱 (`Map<sessionId, RuntimeSession>`)
2. 동시 생성 요청 dedup (`runtimeCreations` Map)
3. cwd 변경 감지 시 런타임 재생성
4. optimistic question response (pendingQuestionResponses Map)

### 스트리밍 아키텍처
Durable Streams는 Superset의 자체 인프라이므로 Maestro에서 직접 쓸 수 없다. 대신:
- SSE (Server-Sent Events)
- tRPC subscription (observable 패턴)
- ElectricSQL shape sync

중 하나로 대체 구현 필요.

### 에이전트 훅 수신
`notificationsEmitter` 패턴: EventEmitter를 중간 버스로 사용하고, tRPC observable subscription으로 렌더러에 전달하는 패턴은 Maestro에 그대로 적용 가능.
