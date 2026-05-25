# Conductor Chat 구현 분석

> Conductor Mac 앱의 채팅 관련 구현 로직을 리버스 엔지니어링으로 분석한 문서.  
> 분석 시점: 2026-05-25 / 앱 버전: 0.56.1

---

## 1. 전체 아키텍처

```
Conductor UI (Tauri/React)
        ↕  Unix Socket IPC (newline-delimited JSON)
Node.js Sidecar (index.bundled.js)
        ↕  stdin/stdout stream-json
Claude Code CLI
        ↕  HTTPS
Anthropic API
```

UI와 Sidecar는 Unix 소켓으로 통신하고, Sidecar는 Claude Code CLI를 자식 프로세스로 스폰하여 `stream-json` 형식으로 양방향 스트리밍한다.

---

## 2. 데이터베이스 스키마

### sessions

```sql
CREATE TABLE sessions (
  id                        TEXT PRIMARY KEY,
  status                    TEXT,              -- 'idle' | 'active'
  claude_session_id         TEXT,
  workspace_id              TEXT,
  model                     TEXT,
  agent_type                TEXT,              -- 'claude_code'
  title                     TEXT,
  context_token_count       INTEGER,
  fast_mode                 INTEGER,           -- boolean
  codex_thinking_level      TEXT,
  last_user_message_at      TEXT
);

CREATE INDEX idx_sessions_workspace_id ON sessions (workspace_id);
```

### session_messages

```sql
CREATE TABLE session_messages (
  id                        TEXT PRIMARY KEY,
  session_id                TEXT,
  role                      TEXT,              -- 'user' | 'assistant'
  content                   TEXT,
  full_message              TEXT,              -- 확장 페이로드
  sent_at                   TEXT,
  cancelled_at              TEXT,
  model                     TEXT,
  sdk_message_id            TEXT,
  last_assistant_message_id TEXT,              -- 재개 포인트
  turn_id                   TEXT,
  is_resumable_message      INTEGER,           -- boolean
  queue_order               INTEGER,
  sender_id                 TEXT
);

CREATE INDEX idx_session_messages_sent_at        ON session_messages (session_id, sent_at);
CREATE INDEX idx_session_messages_cancelled_at   ON session_messages (session_id, cancelled_at);
CREATE INDEX idx_session_messages_turn_id        ON session_messages (turn_id);
```

---

## 3. Node.js Sidecar 핵심 클래스

**파일:** `~/Library/Application Support/com.conductor.app/index.bundled.js` (478KB, 13,197줄)

| 클래스 | 위치 (줄) | 역할 |
|-------|----------|------|
| `ProcessTransport` | 6247–6700 | Claude Code CLI 프로세스 스폰, stdin/stdout 관리 |
| `Stream` | 6618–6680 | 비동기 메시지 큐 (`Symbol.asyncIterator`) |
| `SdkControlServerTransport` | 6682–6703 | MCP 프로토콜 전송 레이어 |
| `Query` | 7303–7800 | 멀티턴 대화 상태머신, 메시지 분류 |
| `ClaudeSidecar` | 12242– | Unix 소켓 서버, UI ↔ Sidecar IPC 허브 |

---

## 4. 메시지 프로토콜

### 4.1 UI → Sidecar

소켓 경로: `/tmp/conductor-claude-{pid}.sock`  
형식: newline-delimited JSON

```json
{
  "id": "session-uuid",
  "type": "query",
  "prompt": "사용자 입력 텍스트",
  "options": {
    "model": "claude-3-5-sonnet-20241022",
    "cwd": "/path/to/workspace",
    "provider": "anthropic",
    "permissionMode": "default",
    "maxTurns": 1000,
    "shouldResetGenerator": false,
    "lastAssistantMessageId": "msg-123",
    "resumeSessionAt": "msg-456",
    "gitCheckpointingEnabled": true,
    "anthropicBaseUrl": "https://api.anthropic.com",
    "anthropicApiKey": "sk-***"
  }
}
```

취소 요청:
```json
{ "id": "session-uuid", "type": "cancel" }
```

### 4.2 Sidecar → UI (스트리밍)

```json
{ "id": "session-uuid", "type": "message", "data": { /* Claude 응답 */ } }
{ "id": "session-uuid", "type": "error",   "data": { /* 오류 정보 */ } }
```

초기 연결 시:
```json
{ "type": "init_status", "sessionId": "optional" }
```

### 4.3 Claude Code ↔ Sidecar (stream-json)

| 타입 | 방향 | 설명 |
|------|------|------|
| `control_response` | CLI → Sidecar | 컨트롤 요청에 대한 응답 |
| `control_request` | CLI → Sidecar | 권한 요청, 훅 콜백, MCP 메시지 |
| `control_cancel_request` | CLI → Sidecar | 취소 신호 |
| `keep_alive` | CLI → Sidecar | 하트비트 (무시) |
| `result` | CLI → Sidecar | 최종 응답, 입력 스트림 종료 트리거 |

---

## 5. 채팅 메시지 흐름

### 5.1 전송 (UI → Claude Code)

```
UI 입력 텍스트
  → socket.write(JSON.stringify({type:"query", prompt}) + '\n')
  → ClaudeSidecar.handleRequest()
  → 기존 generator 재사용 or 신규 생성
  → messageQueue.push(prompt)
  → promptInput async generator yield {type:"user", message:{role:"user", content}}
  → ProcessTransport.write() → Claude Code stdin
```

### 5.2 수신 (Claude Code → UI, 스트리밍)

```
Claude Code stdout (stream-json)
  → readline createInterface
  → ProcessTransport.readMessages()
  → Query 상태머신 메시지 분류
  → for await (message of queryResult)
  → socket.write(JSON.stringify({type:"message", data}) + '\n')
  → UI 실시간 렌더링
```

### 5.3 메시지 큐 구현 (핵심 패턴)

```javascript
// promptInput: async generator로 사용자 메시지를 Claude Code에 스트리밍
const promptInput = async function* () {
  while (true) {
    let message;
    if (messageQueue.length > 0) {
      message = messageQueue.shift();
    } else {
      message = await new Promise(resolve => {
        waitingForMessage = resolve;  // 다음 메시지 올 때까지 대기
      });
    }
    if (asyncIterableTerminated) break;
    yield {
      type: "user",
      message: { role: "user", content: message },
      parent_tool_use_id: null,
      session_id: sessionId
    };
  }
}();

// 응답 스트리밍
const queryResult = query({ prompt: promptInput, options: sdkOptions });
for await (const message of queryResult) {
  socket.write(JSON.stringify({ id: sessionId, type: "message", data: message }) + '\n');
}
```

---

## 6. Claude Code 실행 인수

```bash
claude \
  --output-format stream-json \
  --input-format stream-json \
  --verbose \
  --model sonnet \
  --max-thinking-tokens 16000 \
  --thinking-display summarized \
  --effort high \
  --max-turns 1000 \
  --permission-prompt-tool stdio \
  --disallowedTools AskUserQuestion \
  --setting-sources=user,project,local \
  --permission-mode bypassPermissions
```

---

## 7. 핵심 구현 패턴

### 7.1 Generator 재사용

같은 세션에서 연속 메시지를 보낼 때 새 프로세스를 스폰하지 않는다.  
아래 조건이 모두 같으면 기존 generator에 메시지만 추가한다:

- 동일한 `session_id`
- 동일한 `model`
- `shouldResetGenerator !== true`
- 설정 변경 없음

### 7.2 Git 체크포인팅

```
어시스턴트 응답 완료
  → conductor-checkpoint-{lastAssistantMessageId} 커밋 생성
  → session_messages.last_assistant_message_id 업데이트
```

### 7.3 세션 재개

```json
{
  "lastAssistantMessageId": "msg-456",
  "resumeSessionAt": "msg-456"
}
```

체크포인트 커밋을 기준으로 대화 컨텍스트를 복원하고 해당 메시지부터 재시작한다.

### 7.4 타임아웃

| 항목 | 값 |
|------|-----|
| 스트림 닫힘 대기 | 60초 (`CLAUDE_CODE_STREAM_CLOSE_TIMEOUT`) |
| 첫 result 수신 대기 | 60초 |

---

## 8. 환경변수 (Provider별)

```bash
# Anthropic (기본)
ANTHROPIC_BASE_URL
ANTHROPIC_AUTH_TOKEN
ANTHROPIC_API_KEY

# AWS Bedrock
CLAUDE_CODE_USE_BEDROCK=1
AWS_PROFILE

# Google Vertex AI
CLAUDE_CODE_USE_VERTEX=true
ANTHROPIC_VERTEX_PROJECT_ID

# 프록시
HTTP_PROXY
HTTPS_PROXY
```

---

## 9. 파일 위치 요약

| 컴포넌트 | 경로 |
|---------|------|
| Node.js Sidecar 번들 | `~/Library/Application Support/com.conductor.app/index.bundled.js` |
| SQLite DB | `~/Library/Application Support/com.conductor.app/conductor.db` |
| Claude Code 실행파일 | `~/Library/Application Support/com.conductor.app/agent-binaries/claude/2.1.139/claude` |
| Unix 소켓 | `/tmp/conductor-claude-{pid}.sock` |
| 로그 | `/tmp/conductor-claude-{dateTime}.log` |
