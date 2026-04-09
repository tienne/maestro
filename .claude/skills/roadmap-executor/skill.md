---
name: roadmap-executor
description: "로드맵 파일을 받아 Phase별로 Gestalt 파이프라인을 실행하는 오케스트레이터. '로드맵 실행해줘', 'P0 Phase 구현해줘', '기능 로드맵 자동으로 실행', 'feature-roadmap.md 실행', '페이즈별로 구현해줘' 같은 요청 시 반드시 이 스킬을 사용한다. 단일 기능 구현 요청은 maestro-feature 스킬을 사용한다."
---

# Roadmap Executor Orchestrator

로드맵 파일의 기능들을 Phase별로 순차 실행하는 메인 오케스트레이터.
각 기능은 Gestalt 3단계(인터뷰→스펙→실행)로 구현된다.

## 실행 모드: 서브 에이전트 (Phase별 순차)

Phase 간에 실시간 통신이 불필요하므로 서브 에이전트 모드를 사용한다.
각 Phase의 결과는 `_workspace/`에 파일로 저장되어 다음 Phase에 전달된다.

## 에이전트 구성

| 에이전트 | subagent_type | 역할 | 출력 |
|---------|--------------|------|------|
| roadmap-analyzer | roadmap-analyzer | 로드맵 파싱 + 실행 계획 수립 | `_workspace/00_roadmap_plan.json` |
| gestalt-phase-runner | gestalt-phase-runner | 단일 기능 Gestalt 실행 | `_workspace/{phase_id}_{feature_id}_result.md` |
| qa-engineer | qa-engineer | Phase 완료 후 빌드 검증 | `_workspace/{phase_id}_qa_report.md` |

## 워크플로우

### Phase 0: 준비

1. 로드맵 파일 경로 확인 (미제공 시 `docs/feature-roadmap.md` 기본값)
2. `_workspace/` 생성
3. 실행 범위 결정:
   - 전체 로드맵: 모든 Phase 순차 실행
   - 특정 Priority: "P0만 실행해줘" → P0만
   - 특정 기능: "IDE 딥링킹 구현해줘" → 해당 기능만

### Phase 1: 로드맵 파싱

```
Agent(
  description: "로드맵 파싱",
  subagent_type: "roadmap-analyzer",
  model: "opus",
  prompt: "로드맵 파일 '/Users/kwon-david/dev/maestro/docs/feature-roadmap.md'를 파싱하여
           _workspace/00_roadmap_plan.json을 생성해줘.
           실행 범위: {전체 / P0만 / 특정 기능명}
           _workspace 경로: /Users/kwon-david/dev/maestro/_workspace/"
)
```

`_workspace/00_roadmap_plan.json` 읽어 실행 계획 확인.

### Phase 2: 기능별 순차 실행

`00_roadmap_plan.json`의 `phases` 배열을 순서대로 반복한다.
**각 기능을 하나씩 순차 실행한다** (Phase 내 기능들도 순차).

```
for phase in roadmap_plan.phases:
  for feature in phase.features:
  
    # 2-a: Gestalt로 기능 구현
    Agent(
      description: f"{feature.name} Gestalt 구현",
      subagent_type: "gestalt-phase-runner",
      model: "opus",
      prompt: "다음 기능을 Gestalt 3단계로 구현해줘:
               feature: {feature JSON}
               phase_id: {phase.phase_id}
               workspace_dir: /Users/kwon-david/dev/maestro/_workspace/
               
               1. /Users/kwon-david/dev/maestro/.claude/skills/gestalt-phase/skill.md 읽기
               2. gestalt:interview → gestalt:spec → gestalt:execute 순서로 실행
               3. 완료 후 _workspace/{phase_id}_{feature_id}_result.md 저장"
    )
    
    # 2-b: 기능별 빠른 QA (선택적 — 빌드 오류 즉시 감지)
    Agent(
      description: f"{feature.name} QA",
      subagent_type: "qa-engineer",
      model: "opus",
      prompt: "방금 구현된 {feature.name}을 검증해줘:
               1. /Users/kwon-david/dev/maestro/.claude/skills/maestro-qa/skill.md 읽기
               2. pnpm nx run shared-types:build
               3. pnpm nx run desktop:type-check
               4. _workspace/{phase_id}_{feature_id}_qa_report.md에 결과 저장
               
               오류 발생 시 즉시 보고 (다음 기능 진행 전에 수정 필요)"
    )
    
    # QA 결과 읽기
    qa_result = Read("_workspace/{phase_id}_{feature_id}_qa_report.md")
    if qa_result contains FAILURE:
      # 사용자에게 보고하고 진행 여부 결정
      [사용자에게 실패 내용 보고]
      [계속 진행할지 중단할지 확인]
```

### Phase 3: Phase 완료 후 종합 검증

각 Phase의 모든 기능이 완료되면 전체 빌드 + 테스트 실행:

```
Agent(
  description: "Phase {phase_id} 종합 QA",
  subagent_type: "qa-engineer",
  model: "opus",
  prompt: "Phase {phase_id} 전체 기능 구현 완료 후 종합 검증:
           1. pnpm nx run shared-types:build
           2. pnpm nx run desktop:type-check
           3. pnpm nx run desktop:test
           4. pnpm nx run desktop:lint
           5. _workspace/{phase_id}_phase_qa_report.md에 결과 저장"
)
```

### Phase 4: Phase 게이트 (사용자 확인)

각 Phase 완료 후 다음 Phase 진행 여부를 사용자에게 확인한다:
```
[Phase P0 완료 — 구현된 기능: {목록}]
[QA 결과: 통과/실패]
→ P1 Phase 계속 진행하시겠습니까?
```

사용자가 승인하면 다음 Phase 시작.

### Phase 5: 전체 완료 보고

```
_workspace/final_report.md 생성:
- 전체 실행된 기능 목록
- 각 기능별 Gestalt 평가 점수
- QA 결과 요약
- 미완료 기능 (있는 경우)
```

## 데이터 흐름

```
로드맵 파일
    │
    ▼
roadmap-analyzer → _workspace/00_roadmap_plan.json
    │
    ▼ (for each feature, 순차)
gestalt-phase-runner → _workspace/{phase}_{feature}_result.md
    │
    ▼
qa-engineer → _workspace/{phase}_{feature}_qa_report.md
    │
    ▼ (Phase 완료 시)
qa-engineer → _workspace/{phase}_phase_qa_report.md
    │
    ▼ (전체 완료)
오케스트레이터 → _workspace/final_report.md
```

## 에러 핸들링

| 상황 | 전략 |
|------|------|
| 로드맵 파일 없음 | 사용자에게 경로 확인 요청 |
| gestalt-phase-runner 실패 | 결과 파일에 실패 기록 → 사용자에게 보고 → 건너뛸지 재시도할지 확인 |
| QA 빌드 오류 | 오류 내용 보고 → 다음 기능 전에 수정 필요 알림 |
| Phase 전체 QA 실패 | 다음 Phase 진행 중단, 수동 수정 요청 |
| Gestalt evolve 한계 초과 | 현재 완성도 기록 후 다음 기능으로 이동 |

## 실행 범위 옵션

사용자 요청에서 다음 키워드를 감지하여 실행 범위를 결정한다:

| 키워드 | 범위 |
|--------|------|
| "전체", "전부", "로드맵 다" | 모든 Phase |
| "P0", "P0만", "핵심 먼저" | P0 Phase만 |
| "P0, P1" | P0 + P1 |
| "{기능 이름}" | 해당 기능 1개 |
| "첫 번째", "다음 Phase" | 현재 미완료 첫 Phase |

## 테스트 시나리오

### 정상 흐름

1. 사용자: "feature-roadmap.md 로드맵 실행해줘, 먼저 P0만"
2. 로드맵 파싱 → P0에 3개 기능 확인
3. P0-1 "상태 대시보드": Gestalt 인터뷰 → Spec → 실행 → QA ✅
4. P0-2 "Approve & Merge": 동일 → QA ✅
5. P0-3 "Diff Side-by-Side": 동일 → QA ✅
6. Phase P0 종합 QA 통과
7. 사용자에게 P0 완료 보고 + P1 진행 여부 확인

### 에러 흐름

1. P0-1 구현 후 QA에서 타입 오류 발견
2. 사용자에게 오류 보고 (파일:라인 + 오류 메시지)
3. 사용자가 수정 요청 → bug-fixer 에이전트에 위임 가능
4. 수정 완료 후 QA 재실행
5. 통과 시 P0-2로 진행

## 중요 경로

- 프로젝트 루트: `/Users/kwon-david/dev/maestro`
- 기본 로드맵: `docs/feature-roadmap.md`
- 워크스페이스: `_workspace/`
- Gestalt Phase 스킬: `.claude/skills/gestalt-phase/skill.md`
- QA 스킬: `.claude/skills/maestro-qa/skill.md`
