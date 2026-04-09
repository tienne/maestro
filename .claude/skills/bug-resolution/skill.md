---
name: bug-resolution
description: "Maestro 앱 이슈 해결 에이전트 팀을 조율하는 오케스트레이터. '버그 수정해줘', '이거 왜 안 돼', '오류 고쳐줘', '기능이 동작 안 해', '에러 났어', '테스트도 같이 써줘' 같은 요청 시 반드시 이 스킬을 사용한다. 새 기능을 처음 구현하는 요청에는 maestro-feature를 사용한다."
---

# Bug Resolution Orchestrator

Maestro 앱 이슈를 조사하고, 수정하고, 테스트를 작성하는 팀을 조율하는 오케스트레이터.

이슈 조사 → 수정 + 테스트 작성(병렬) → 회귀 검증 순서로 진행한다.

## 실행 모드: 에이전트 팀

## 에이전트 구성

| 팀원 | 에이전트 타입 | 역할 | 참조 스킬 | 출력 |
|------|-------------|------|---------|------|
| bug-investigator | bug-investigator | 이슈 분석 + 근본 원인 파악 | `bug-investigation` | `_workspace/01_investigation.md` |
| bug-fixer | bug-fixer | 최소 범위 수정 구현 | — | `_workspace/02_fix.md` |
| test-writer | test-writer | Vitest 테스트 작성 | `vitest-testing` | `_workspace/02_tests.md` |
| qa-engineer | qa-engineer | 전체 테스트 실행 + 회귀 검증 | `maestro-qa` | `_workspace/03_qa_report.md` |

## 워크플로우

### Phase 1: 이슈 정리

이슈 설명에서 다음을 파악한다:
- 증상 (에러 메시지, 잘못된 동작, 빌드 실패 등)
- 재현 방법 (어떤 조작을 하면 발생하는지)
- 예상 동작 vs 실제 동작

`_workspace/` 디렉토리 생성:
```
mkdir -p {프로젝트 루트}/_workspace
```

### Phase 2: 팀 구성

```
TeamCreate(
  team_name: "bug-resolution-team",
  members: [
    {
      name: "bug-investigator",
      agent_type: "bug-investigator",
      model: "opus",
      prompt: "당신은 bug-investigator입니다.
               이슈 설명: {이슈 내용 그대로}
               1. /Users/kwon-david/dev/maestro/.claude/skills/bug-investigation/skill.md 읽기
               2. 관련 코드 탐색 및 근본 원인 분석
               3. _workspace/01_bug_investigator_report.md에 분석 결과 저장
               4. bug-fixer에게 SendMessage: 수정 필요 파일 + 구체적 수정 방향
               5. test-writer에게 SendMessage: 재현 케이스 + 관련 프로시저/서비스 정보"
    },
    {
      name: "bug-fixer",
      agent_type: "bug-fixer",
      model: "opus",
      prompt: "당신은 bug-fixer입니다.
               1. bug-investigator의 SendMessage 대기
               2. 분석 결과 수신 후 /Users/kwon-david/dev/maestro/apps/desktop/src/의 해당 파일 수정
               3. 수정 후 pnpm nx run desktop:type-check로 타입 오류 없음 확인
               4. _workspace/02_bug_fixer_changes.md에 변경 내역 저장
               5. test-writer에게 SendMessage: 수정 완료 + 수정된 로직 설명
               6. qa-engineer에게 SendMessage: 수정 완료 신호"
    },
    {
      name: "test-writer",
      agent_type: "test-writer",
      model: "opus",
      prompt: "당신은 test-writer입니다.
               1. /Users/kwon-david/dev/maestro/.claude/skills/vitest-testing/skill.md 읽기
               2. bug-investigator의 SendMessage 수신 (재현 케이스)
               3. 재현 테스트 작성 (apps/desktop/src/__tests__/ 또는 해당 서비스 파일 옆)
               4. bug-fixer의 수정 완료 SendMessage 수신
               5. 테스트 실행으로 통과 확인 + 엣지 케이스 추가
               6. _workspace/02_test_writer_report.md에 보고서 저장
               7. qa-engineer에게 SendMessage: 테스트 작성 완료 + 파일 위치"
    },
    {
      name: "qa-engineer",
      agent_type: "qa-engineer",
      model: "opus",
      prompt: "당신은 qa-engineer입니다.
               1. bug-fixer와 test-writer 모두 완료 SendMessage 대기
               2. /Users/kwon-david/dev/maestro/.claude/skills/maestro-qa/skill.md 읽기
               3. pnpm nx run desktop:test — 전체 테스트 실행
               4. pnpm nx run desktop:type-check — 타입 체크
               5. pnpm nx run desktop:lint — 린트
               6. 오류 있으면 해당 에이전트에게 SendMessage로 즉시 보고
               7. _workspace/03_qa_engineer_report.md 저장 후 오케스트레이터에게 보고"
    },
  ]
)
```

### Phase 3: 작업 등록

```
TaskCreate(tasks: [
  { title: "이슈 조사", description: "근본 원인 분석 + 재현 케이스 문서화", assignee: "bug-investigator" },
  { title: "버그 수정", description: "최소 범위 코드 수정", assignee: "bug-fixer", depends_on: ["이슈 조사"] },
  { title: "테스트 작성", description: "재현 테스트 + 회귀 방지 테스트", assignee: "test-writer", depends_on: ["이슈 조사"] },
  { title: "회귀 검증", description: "전체 테스트 실행 + 타입 체크", assignee: "qa-engineer", depends_on: ["버그 수정", "테스트 작성"] },
])
```

### Phase 4: 실행 모니터링

**통신 흐름:**
```
bug-investigator → (분석 완료) → bug-fixer + test-writer (동시)
bug-fixer → (수정 완료) → test-writer + qa-engineer
test-writer → (테스트 완료) → qa-engineer
qa-engineer → (검증 결과) → 오류 시 해당 팀원, 통과 시 오케스트레이터
```

리더 역할:
- QA 오류 발견 시 수정-재검증 루프 (최대 2회)
- 팀원 무응답 시 SendMessage로 상태 확인

### Phase 5: 결과 수집 및 보고

1. `_workspace/*.md` 파일들 Read로 수집
2. 팀 정리 (TeamDelete)
3. `_workspace/` 보존
4. 사용자에게 요약 보고:
   - 근본 원인
   - 수정된 파일 목록
   - 작성된 테스트 목록
   - QA 결과

## 데이터 흐름

```
[오케스트레이터]
    │
    ├── TeamCreate + TaskCreate
    │
    ▼
[bug-investigator]
    │
    ├──SendMessage──→ [bug-fixer]
    │                      │
    └──SendMessage──→ [test-writer] ←── SendMessage(수정 완료) ──┘
                           │
                    [qa-engineer] ←── SendMessage(테스트 완료) ──┘
                           │
                    회귀 오류 시 → bug-fixer / test-writer
                    통과 시 → 오케스트레이터
```

## 에러 핸들링

| 상황 | 전략 |
|------|------|
| bug-investigator가 근본 원인 불명확 | 복수 가설 제시 → bug-fixer가 가능성 높은 순으로 시도 |
| bug-fixer 수정 후 타입 오류 | bug-fixer 즉시 재수정 |
| 테스트 작성 후 실행 오류 | test-writer가 mock 설정 수정 |
| QA에서 회귀 테스트 실패 | bug-fixer에게 알림 → 재수정 → 재검증 (최대 2회) |
| 모든 재시도 실패 | 사용자에게 현재 상태 보고 + 수동 개입 요청 |

## 테스트 시나리오

### 정상 흐름

1. 사용자: "session.launch 후 PTY가 env_vars를 무시하는 버그가 있어"
2. Phase 1: 도메인=세션, 증상=env 병합 누락
3. Phase 2: 4명 팀 구성 + 4개 작업 등록
4. bug-investigator: `router.ts`의 `session.launch`와 `pty-manager.ts` 분석 → env 병합 로직 버그 발견
5. bug-fixer + test-writer 병렬:
   - bug-fixer: `router.ts` 수정 (env 병합 로직 추가)
   - test-writer: `trpc-router.test.ts`에 재현 테스트 추가 (`[BUG-FIX] env_vars 병합 누락`)
6. bug-fixer 완료 → test-writer가 테스트 실행으로 통과 확인
7. qa-engineer: `pnpm nx run desktop:test` 전체 통과
8. 결과: 버그 수정 + 테스트 2개 추가 (재현 + 엣지 케이스)

### 에러 흐름

1. 사용자: "repository.add가 가끔 에러 나"
2. bug-investigator: 간헐적 오류 → DB 경쟁 조건 가설 제시 (확실하지 않음)
3. bug-fixer: 가능성 높은 원인부터 수정
4. QA에서 관련 없는 테스트 실패 발견 (회귀)
5. bug-fixer에게 회귀 알림 → 재수정
6. 2회 재시도 후 통과

## 중요 경로

- 프로젝트 루트: `/Users/kwon-david/dev/maestro`
- 기존 테스트: `apps/desktop/src/__tests__/`
- Vitest 설정: `apps/desktop/vitest.config.ts` (coverage: src/trpc/**, src/services/**)
- 타입 체크: `pnpm nx run desktop:type-check`
- 테스트 실행: `pnpm nx run desktop:test`
- 워크스페이스: `/Users/kwon-david/dev/maestro/_workspace/`
