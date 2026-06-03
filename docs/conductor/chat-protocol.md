# Conductor 채팅 프로토콜 및 이벤트 시스템

## 이벤트 타입 전체 목록

conductor-runtime에서 처리하는 이벤트 타입 (실제 바이너리에서 추출):

### 사용자 → 에이전트 (upstream)
```
user.message              ← 사용자 메시지
user.interrupt            ← 실행 중단 요청
user.tool_confirmation    ← 도구 실행 승인
user.custom_tool_result   ← 커스텀 도구 결과
```

### 에이전트 → 사용자 (downstream)
```
agent.message             ← 에이전트 응답 메시지
agent.thinking            ← 에이전트 사고 과정 (extended thinking)
agent.tool_use            ← 도구 사용 시작
agent.tool_result         ← 도구 사용 결과
agent.mcp_tool_use        ← MCP 도구 사용
agent.mcp_tool_result     ← MCP 도구 결과
agent.custom_tool_use     ← 커스텀 도구 사용
agent.thread_context_compacted  ← 컨텍스트 압축 완료
```

### Anthropic API 원시 이벤트 (Claude 전용 스트리밍)
```
message_start
message_delta
message_stop
content_block_start
content_block_delta
content_block_stop
message
```

### 세션 상태
```
session.status_running     ← 세션 실행 중
session.status_idle        ← 세션 유휴
session.status_rescheduled ← 재스케줄됨
session.status_terminated  ← 세션 종료
session.error              ← 세션 에러
session.deleted            ← 세션 삭제
```

### 스팬 (성능 추적)
```
span.model_request_start   ← 모델 요청 시작
span.model_request_end     ← 모델 요청 종료
```

### 아이템 (Codex 전용)
```
item.started               ← 아이템 처리 시작
item.completed             ← 아이템 처리 완료 (contextCompaction 포함)
```

---

## 세션 상태 머신

```
idle
  ↓ user.message
running
  ↓ 완료
idle
  ↓ 에러
session.error
  ↓ 취소
session.status_terminated
```

내부 상태:
```typescript
liveState: {
  status: "idle" | "running",
  fastModeAvailable: boolean,
  activeQuestions: null | Question[],  // 승인 대기 중인 질문들
  proposedPlan: null | Plan,           // plan 모드의 제안 계획
}
```

---

## Conductor SDK 메타데이터

각 응답에 메타데이터가 첨부된다:

```typescript
conductor_sdk_metadata: {
  requestedModel: string,       // 요청한 모델 alias
  thinkingLevel: string,        // "none" | "low" | "medium" | "high" | "max"
  fastMode: boolean,
  sdkReportedModel: string,     // 실제 사용된 모델 ID
  serviceTier: string | null,   // "fast" | null
  speed: number,                // 토큰/초
}
```

---

## 컨텍스트 압축 (Context Compaction)

긴 대화에서 컨텍스트 토큰이 임계값을 초과하면 자동 압축:

```typescript
contextTokenThreshold  // 기본값 있음

// 압축 이벤트
{
  type: "item.completed",
  item: {
    type: "contextCompaction",
    id: string,
    preTokens: number,   // 압축 전 토큰 수
    postTokens: number,  // 압축 후 토큰 수
  }
}
```

Claude Code에서는 `agent.thread_context_compacted` 이벤트로 처리.

---

## 모델 재라우팅

실행 중 모델이 변경될 수 있다:

```typescript
// 이벤트
{ method: "model/rerouted" }

// 처리
await session.queryResult.setModel(newModelId)
session.currentModel = newModel
session.currentSdkModel = undefined  // SDK 보고 모델 초기화
```

---

## 협업 모드 (Collaboration Mode)

```typescript
collaborationMode: {
  mode: "default" | "plan",
  settings: object,
}

// plan 모드 전환
session.updateConfig({ collaborationMode: "plan" })
```

**plan 모드**: 에이전트가 실행 전에 계획을 제안하고 사용자 승인을 기다린다.

---

## 스트리밍 처리 (Claude 전용)

Claude Code와의 통신은 async generator 패턴:

```typescript
// 메시지 큐 + async generator
const promptInput = async function* () {
  while (true) {
    const message = messageQueue.length > 0
      ? messageQueue.shift()
      : await new Promise(resolve => { waitingForMessage = resolve })
    yield { type: "user", message: { role: "user", content: message } }
  }
}()

// 응답 스트리밍
for await (const event of queryResult) {
  socket.write(JSON.stringify({ type: "message", data: event }) + '\n')
}
```

**핵심**: 같은 Claude Code 프로세스를 계속 재사용해서 멀티턴 대화를 처리한다.

---

## 취소 처리

```typescript
// AbortController 기반
session.abortController?.abort(
  systemInitiated
    ? { systemInitiated: true, systemReason: reason }
    : undefined
)

// 취소 로그
{
  sessionId,
  agentType: "claude" | "codex",
  systemInitiated: boolean,
  systemReason?: string,
  wasInitializing: boolean,
}
```

---

## 토큰 사용량 추적

```typescript
// 세션별 컨텍스트 사용량
latestContextUsage.set(sessionId, {
  tokenUsage: {
    // 입력/출력 토큰
  },
  rateLimits: {
    // 레이트 리밋 정보
  }
})
```
