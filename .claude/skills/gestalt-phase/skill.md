---
name: gestalt-phase
description: "Gestalt 3단계(인터뷰→스펙→실행) 파이프라인으로 단일 기능을 구현하는 워크플로우 가이드. gestalt-phase-runner가 하나의 로드맵 기능 항목을 구현할 때 참조한다."
---

# Gestalt Phase 실행 가이드

하나의 로드맵 기능 항목을 Gestalt 파이프라인으로 구현하는 전체 절차를 정의한다.

## 파이프라인 개요

```
기능 입력
    ↓
[Step 1] gestalt:interview — 요구사항 구체화 (자율 Q&A)
    ↓
[Step 2] gestalt:spec — 구조화된 Spec 생성
    ↓
[Step 3] gestalt:execute — 실행 계획 + 코드 구현 + 평가
    ↓
결과 문서화
```

## Step 1: 인터뷰 절차

`gestalt:interview` 스킬을 호출한다. Gestalt는 passthrough 모드로 동작하므로, **호출자(gestalt-phase-runner)가 질문을 직접 생성하고 답변한다.**

### 인터뷰 시작

```
action: "start"
topic: "{feature.name} — {feature.description 핵심 요약}"
cwd: "/Users/kwon-david/dev/maestro"  ← brownfield 감지 필수
```

### 질문/답변 루프

Gestalt가 반환하는 promptHint를 기반으로 질문을 생성하고, 로드맵 내용을 바탕으로 답변한다.

**자율 답변 전략:**

| 질문 유형 | 답변 기준 |
|----------|----------|
| "이 기능의 목적은?" | 로드맵 기능 설명 그대로 |
| "어떤 UI 컴포넌트가 필요한가?" | 기존 컴포넌트 패턴 참고 (TerminalPanel, GitPanel 등) |
| "데이터는 어디에 저장하나?" | 기존 DB 스키마 + better-sqlite3 패턴 |
| "API는 어떻게 구성하나?" | 기존 tRPC router 패턴 (query/mutation) |
| "엣지 케이스는?" | 가장 단순한 처리 (에러 로깅, NOT_FOUND 예외) |

### 완료 조건

`resolution score >= 0.7` 이 되면 인터뷰 종료. 미달이면 2회 더 시도 후 force=true로 Spec 강제 생성.

```
action: "score"
resolutionScore: {
  goalClarity: 0~1,
  constraintClarity: 0~1,
  successCriteria: 0~1,
  priorityClarity: 0~1,
  contextClarity: 0~1
}
```

## Step 2: Spec 생성

인터뷰 세션 ID를 사용하여 Spec을 생성한다.

```
gestalt:spec 호출
sessionId: {인터뷰에서 받은 sessionId}
```

생성된 Spec의 핵심 필드:
- `goal`: 기능의 핵심 목표
- `acceptanceCriteria`: 완료 판단 기준 목록
- `constraints`: 기술 제약사항 (Electron, tRPC v11, React 18, Zustand 등)
- `ontologySchema`: 도메인 엔티티 관계 (기존 DB 스키마와 일치해야 함)

Spec을 `_workspace/{phase_id}_{feature_id}_spec.json`에 저장한다.

## Step 3: 실행 절차

Gestalt execute는 4단계 계획(figure_ground → closure → proximity → continuity)과 실행을 수행한다.

```
gestalt:execute 호출
action: "start"
spec: {생성된 Spec 전체}
```

### 계획 단계 (Planning)

Gestalt가 각 원칙별로 계획을 요청한다:

| 원칙 | 역할 | 적용 방식 |
|------|------|---------|
| `figure_ground` | MVP vs 부가기능 분리 | 핵심 기능 먼저, UI 폴리시 나중 |
| `closure` | 빈틈 채우기 | 로드맵에 없는 에러 처리, 로딩 상태 등 |
| `proximity` | 관련 작업 그룹화 | 타입 정의 → 백엔드 → 프론트엔드 순서 |
| `continuity` | 의존성 확인 | 기존 코드와 일관성 유지 |

각 계획 단계에 `plan_step(stepResult: {...})` 응답을 제출한다.

### 실행 단계

Gestalt가 태스크 목록을 생성하면 각 태스크를 실제로 구현한다:

```
action: "execute_task"
taskResult: {
  taskId: "task-xxx",
  status: "completed",  // 또는 "failed"
  output: "변경 내용 요약",
  artifacts: ["apps/desktop/src/trpc/router.ts", ...]
}
```

**실행 원칙:**
- 기존 하네스(maestro-feature, bug-resolution)의 패턴을 따른다
- tRPC 프로시저 추가: `trpc-backend` 스킬 참조
- React 컴포넌트 추가: `electron-frontend` 스킬 참조
- DB 스키마 변경 시: 마이그레이션 없이 `ALTER TABLE ADD COLUMN ... DEFAULT` 활용

### 평가 단계

```
action: "evaluate"
evaluationResult: {
  verifications: [
    { acIndex: 0, satisfied: true/false, evidence: "근거", gaps: [] }
  ],
  overallScore: 0~1,
  recommendations: []
}
```

`overallScore >= 0.8` 이면 성공. 미달 시 evolve 루프 최대 2회.

## 결과 문서화

`_workspace/{phase_id}_{feature_id}_result.md` 저장 형식은 gestalt-phase-runner.md의 출력 프로토콜 참조.
