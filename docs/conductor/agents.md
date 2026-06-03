# Conductor 에이전트 아키텍처

## 두 에이전트 타입의 근본적 차이

Conductor는 에이전트 타입에 따라 완전히 다른 실행 경로를 사용한다.

---

## Claude Code (agentType: "claude")

### 실행 방식

Claude Code CLI를 **PTY + stream-json I/O**로 실행한다.

```typescript
// claude-code 에이전트 실행
{
  claudeExecutablePath: "/path/to/claude",
  workspaceDir: "/path/to/worktree",  // cwd
  claudeEnv: { ...shellEnv },
}

// 스레드 시작
await claude.startThread({
  model: "sonnet",
  modelProvider: "anthropic",
  cwd: workspaceDir,
  serviceTier: fastMode ? "fast" : null,
  approvalPolicy: "never",
  sandbox: "danger-full-access",
  personality: personality,
  persistExtendedHistory: true,
  developerInstructions: conductorSkillInstructions,
  config: threadConfig,
})
```

### stream-json 프로토콜

Claude Code CLI와 통신은 `--output-format stream-json --input-format stream-json`으로 이루어진다. 각 메시지는 newline-delimited JSON.

### 세션 재개

`resumeThread(threadId, options)` — 마지막 체크포인트 이후 대화 재개 가능.

```typescript
await claude.resumeThread(threadId, {
  model, modelProvider, cwd, serviceTier,
  approvalPolicy: "never",
  sandbox: "danger-full-access",
  config: threadConfig,
  personality,
  persistExtendedHistory: true,
  developerInstructions,
})
```

---

## Codex (agentType: "codex")

### 실행 방식

Codex를 **`app-server` 모드**로 실행하고 JSON-RPC over stdio로 통신한다.

```typescript
// Codex 실행
zm.spawn(codexPath, [...spawnArgs, "app-server", "--listen", "stdio://"], {
  env: codexEnv,
  stdio: ["pipe", "pipe", "pipe"],
})
```

Claude Code와 달리 **별도의 JSON-RPC 프로토콜**을 사용하며, `@openai/codex-sdk`를 통해 통신한다.

### 환경변수

```typescript
env.CODEX_API_KEY = apiKey
env.OPENAI_API_KEY = apiKey
delete env.OPENAI_BASE_URL  // 필요시 제거
```

### 스레드 관리

Codex도 thread 개념을 사용하지만 Claude와 다른 API:

```typescript
// Codex 스레드 시작
const thread = await codex.startThread({
  model: "gpt-5.3-codex",
  modelProvider: "openai",
  cwd: workspaceDir,
  serviceTier: null,
  approvalPolicy: "never",
  sandbox: "danger-full-access",
  config,
  persistExtendedHistory: false,
})

// Codex 세션 실행 (streamText 방식)
const { events, runtimeMetadata } = await thread.runStreamed(message, {
  model: routedModel,
  cwd: workspaceDir,
  effort: thinkingLevel,  // "low" | "medium" | "high"
  serviceTier: fastMode ? "fast" : null,
  summary: "none",
  sandboxPolicy: { type: "dangerFullAccess" },
  personality: personality,
  signal: abortSignal,
  collaborationMode: { mode, settings },
})
```

### 계정 정보 조회

Codex는 계정 정보를 직접 조회한다:

```typescript
codex.request("account/read", { refreshToken: false }).then((account) => {
  // accountType: "chatgpt" | "apiKey"
  // email, planType (ChatGPT 계정인 경우)
  // modelProvider
})
```

---

## 에이전트 팩토리 패턴

```typescript
// agentType으로 적절한 runner 선택
const runner = agentRunnerFactory.get(agentType)
// "claude" → ClaudeAgentRunner
// "codex"  → CodexAgentRunner
```

### 공통 초기화

```typescript
await host.initializeSession({
  sessionId,
  agentType,  // "claude" | "codex"
  config: {
    collaborationMode: "default" | "plan",
    model: "sonnet" | "gpt-5.3-codex" | ...,
    thinkingLevel: "low" | "medium" | "high" | "none" | "max",
    fastMode: boolean,
  }
})
```

---

## 모델 라우팅

`getModelRouting(modelAlias)` — short alias를 실제 모델 ID + provider로 매핑:

```typescript
// Claude alias → { model: "claude-sonnet-4-6", modelProvider: "anthropic" }
// Codex alias  → { model: "gpt-5.3-codex",   modelProvider: "openai" }

// 기본 Codex 모델 폴백
let model = isValidCodexModel(requested) ? requested : "gpt-5.3-codex"
```

---

## pre-tool-use 훅 (Codex 전용)

Codex 에이전트는 도구 실행 전 체크포인트를 생성한다:

```typescript
preToolUseHooks: [{
  matcher: ".*",
  statusMessage: "Waiting for Conductor checkpoint",
  timeoutSec: 120,
  handler: () => createCheckpoint({ workspaceDir, sessionId })
}]
```

---

## 비교 요약

| 항목 | Claude Code | Codex |
|------|-------------|-------|
| **프로세스** | PTY spawn | stdio app-server |
| **프로토콜** | stream-json (newline-delimited) | JSON-RPC over stdio |
| **SDK** | Anthropic SDK (내장) | @openai/codex-sdk |
| **인증** | API Key / OIDC federation | API Key / ChatGPT 구독 |
| **스레드 재개** | resumeThread() | 실패 시 새 스레드 시작 |
| **컨텍스트** | CLAUDE.md + .claude/ 자동 로드 | developerInstructions 주입 |
| **persistExtendedHistory** | true | false |
| **AI Gateway** | 미지원 | Vercel AI Gateway 지원 |
