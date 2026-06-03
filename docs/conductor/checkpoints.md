# Conductor Git 체크포인트 시스템

## 개요

Conductor는 에이전트 턴(turn)마다 git 커밋을 생성해서 작업을 추적하고 복구 가능하게 만든다.

---

## 체크포인트 타입

```typescript
checkpointType: "start" | "end"
```

- **start checkpoint**: 에이전트 턴 시작 전 현재 상태 저장
- **end checkpoint**: 에이전트 턴 완료 후 변경사항 저장

---

## 체크포인트 생성 흐름

### Claude Code

```typescript
// 1. 턴 시작 전 start checkpoint
b.info(`[ClaudeAgentRunner] Waiting for start checkpoint before ${action}`)
await startCheckpoint  // checkpoint 완료 대기

// 2. 턴 완료 후 end checkpoint
V2({
  session,
  checkpoint: () => createCheckpoint({
    sessionId,
    turnId,
    checkpointType: "end",
    cwd: workspaceDir,
    manager: checkpointManager,
  })
}).catch((err) => $.error("End checkpoint failed", err))
```

### Codex (pre-tool-use hook)

Codex는 도구 실행 전에 자동으로 체크포인트를 생성한다:

```typescript
preToolUseHooks: [{
  matcher: ".*",          // 모든 도구에 적용
  statusMessage: "Waiting for Conductor checkpoint",
  timeoutSec: 120,        // 2분 타임아웃
  handler: () => createCheckpoint({ workspaceDir, sessionId })
}]
```

---

## 체크포인트 스크립트 (`checkpointer.sh`)

```bash
# /Applications/Conductor.app/Contents/Resources/bin/checkpointer.sh
# git 커밋 생성 + diff 계산
```

체크포인트 이벤트 데이터:
```typescript
{
  manager: checkpointManager,
  turnId: string,
  checkpointType: "start" | "end",
  checkpointId: string,
  refPath: string,    // git ref 경로
  diff: {
    size: number,     // 변경된 파일 수
    // diff too large면 omit
  }
}
```

---

## 체크포인트 skip 조건

```typescript
// 스킵되는 경우 로깅
$.info(`[checkpoint] Checkpoint ${id} skipped: index has unresolved conflicts`)
$.info(`[checkpoint] Checkpoint ${id} skipped: merge/rebase in progress`)
```

충돌이 있거나 merge/rebase 진행 중이면 체크포인트를 건너뛴다.

---

## 세션 재개 (Resume)

체크포인트를 이용한 세션 재개:

```typescript
// Claude Code
await claude.resumeThread(threadId, {
  model, modelProvider, cwd,
  persistExtendedHistory: true,
  ...
})

// 실패 시 새 스레드 시작
this.logger.info(
  `[CodexAgentRunner] Resume failed for session ${id}, starting a new thread instead`
)
```

### lastAssistantMessageId

세션 DB에 `last_assistant_message_id` 저장 → 이 지점부터 재개 가능.

---

## Diff 크기 제한

```typescript
// diff가 너무 크면 이벤트에서 제외
$.info(`[checkpoint] Diff too large (${diff.size} files), omitting from event`)
```

---

## 세션 상태의 checkpoint 관련 필드

```typescript
session: {
  checkpointState: {
    pendingStart: Promise | undefined,  // 대기 중인 start checkpoint
    pendingEnd:   Promise | undefined,  // 대기 중인 end checkpoint
  },
  currentTurnId: string | undefined,
  runningMessageId: string | undefined,
}
```

---

## 체크포인트 롤백 (Codex 전용)

```typescript
// Codex는 턴 롤백 지원
await codex.rollbackThread({
  threadId: thread.id,
  numTurns: n,  // 롤백할 턴 수
})
```

Claude Code는 롤백이 없고 git reset으로 직접 처리.

---

## checkpointer.sh와 spotlighter.sh

```
bin/checkpointer.sh   ← git 체크포인트 커밋 생성
bin/spotlighter.sh    ← Spotlight testing 지원 (루트에서 실행해야 하는 프로젝트용)
bin/git-busy-check.sh ← merge/rebase 진행 여부 확인
```
