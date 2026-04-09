---
name: maestro-feature
description: "Maestro 풀스택 기능 구현 에이전트 팀을 조율하는 오케스트레이터. '새 기능 구현', '엔드투엔드로 만들어줘', '타입-백엔드-프론트 한번에', 'tRPC 추가하고 화면까지', '세션/워크스페이스/저장소/에이전트/MCP에 기능 추가' 같은 요청 시 반드시 이 스킬을 사용한다. 단일 레이어만 수정하는 작업(router.ts만 수정, 컴포넌트만 수정)에는 사용하지 않는다."
---

# Maestro Feature Orchestrator

Maestro의 풀스택 기능 구현을 end-to-end로 조율하는 오케스트레이터.

shared-types 설계 → 백엔드(tRPC + 서비스) + 프론트엔드(React + Zustand) 병렬 구현 → QA 검증 순서로 진행한다.

## 실행 모드: 에이전트 팀

## 에이전트 구성

| 팀원 | 에이전트 타입 | 역할 | 참조 스킬 | 출력 |
|------|-------------|------|---------|------|
| type-architect | type-architect | shared-types 타입/스키마 정의 | — | `_workspace/01_types.md` |
| backend-engineer | backend-engineer | tRPC router + 서비스 구현 | `trpc-backend` | `_workspace/02_backend.md` |
| frontend-engineer | frontend-engineer | React 컴포넌트 + Zustand 구현 | `electron-frontend` | `_workspace/02_frontend.md` |
| qa-engineer | qa-engineer | 빌드 검증 + 경계면 비교 | `maestro-qa` | `_workspace/03_qa_report.md` |

## 워크플로우

### Phase 1: 요구사항 분석

1. 요청 내용에서 다음을 파악한다:
   - 추가/수정할 도메인 (세션, 워크스페이스, 저장소, 에이전트, MCP, 레이아웃 등)
   - 필요한 tRPC 프로시저 종류 (query / mutation / subscription)
   - UI 변경 범위 (새 컴포넌트 / 기존 컴포넌트 수정)
   - 새 DB 테이블/컬럼 필요 여부

2. `_workspace/` 디렉토리 생성:
   ```
   mkdir -p {프로젝트 루트}/_workspace
   ```

3. `_workspace/00_requirements.md`에 분석 결과 저장

### Phase 2: 팀 구성

```
TeamCreate(
  team_name: "maestro-feature-team",
  members: [
    { 
      name: "type-architect", 
      agent_type: "type-architect", 
      model: "opus",
      prompt: "당신은 type-architect입니다. 
               요구사항: {요구사항 요약}
               1. /Users/kwon-david/dev/maestro/packages/shared-types/src/index.ts를 읽어 기존 패턴 파악
               2. 필요한 타입/Zod 스키마 추가
               3. 완료 후 _workspace/01_types.md에 정의 요약 저장
               4. backend-engineer와 frontend-engineer에게 SendMessage로 타입 내용 전달"
    },
    { 
      name: "backend-engineer", 
      agent_type: "backend-engineer", 
      model: "opus",
      prompt: "당신은 backend-engineer입니다.
               요구사항: {요구사항 요약}
               1. type-architect의 타입 완료 대기 (SendMessage 수신)
               2. /Users/kwon-david/dev/maestro/.claude/skills/trpc-backend/skill.md 읽기
               3. router.ts와 services/ 구현
               4. 완료 후 _workspace/02_backend.md에 변경 목록 저장
               5. frontend-engineer와 qa-engineer에게 SendMessage로 완료 알림"
    },
    { 
      name: "frontend-engineer", 
      agent_type: "frontend-engineer", 
      model: "opus",
      prompt: "당신은 frontend-engineer입니다.
               요구사항: {요구사항 요약}
               1. type-architect의 타입 완료 대기 (SendMessage 수신)
               2. /Users/kwon-david/dev/maestro/.claude/skills/electron-frontend/skill.md 읽기
               3. React 컴포넌트 + Zustand 스토어 구현
               4. 완료 후 _workspace/02_frontend.md에 변경 목록 저장
               5. qa-engineer에게 SendMessage로 완료 알림"
    },
    { 
      name: "qa-engineer", 
      agent_type: "qa-engineer", 
      model: "opus",
      prompt: "당신은 qa-engineer입니다.
               1. backend-engineer와 frontend-engineer 모두 완료 대기
               2. /Users/kwon-david/dev/maestro/.claude/skills/maestro-qa/skill.md 읽기
               3. 빌드 검증 실행 (shared-types → tsc → 경계면 비교 → lint)
               4. 오류 발견 시 해당 에이전트에게 SendMessage로 즉시 보고
               5. 전체 통과 시 _workspace/03_qa_report.md 저장 후 오케스트레이터에게 보고"
    },
  ]
)
```

### Phase 3: 작업 등록

```
TaskCreate(tasks: [
  { 
    title: "shared-types 정의", 
    description: "packages/shared-types/src/index.ts에 새 타입/스키마 추가",
    assignee: "type-architect" 
  },
  { 
    title: "tRPC 백엔드 구현", 
    description: "router.ts 프로시저 + services/ 비즈니스 로직",
    assignee: "backend-engineer",
    depends_on: ["shared-types 정의"]
  },
  { 
    title: "React 프론트엔드 구현", 
    description: "컴포넌트 + Zustand 스토어 + tRPC 훅 통합",
    assignee: "frontend-engineer",
    depends_on: ["shared-types 정의"]
  },
  { 
    title: "QA 검증", 
    description: "빌드 타입체크 + 경계면 비교",
    assignee: "qa-engineer",
    depends_on: ["tRPC 백엔드 구현", "React 프론트엔드 구현"]
  },
])
```

### Phase 4: 실행 모니터링

팀원들이 자체 조율하며 작업을 수행한다.

**통신 흐름:**
```
type-architect → (타입 완료) → backend-engineer + frontend-engineer (동시)
backend-engineer → (백엔드 완료) → frontend-engineer (tRPC path 알림)
backend-engineer + frontend-engineer → (모두 완료) → qa-engineer
qa-engineer → (검증 결과) → 오류 있으면 해당 팀원, 전체 통과 시 오케스트레이터
```

**리더(오케스트레이터) 역할:**
- 팀원이 유휴 상태가 되면 자동 알림 수신
- QA 검증 사이클 후 수정 루프 (최대 2회)
- 전체 완료 후 결과 수집

### Phase 5: 결과 수집 및 보고

1. `_workspace/*.md` 파일들을 Read로 수집
2. 팀원들에게 종료 신호 (SendMessage to all)
3. 팀 정리 (TeamDelete)
4. `_workspace/` 보존 (삭제 금지 — 감사 추적용)
5. 사용자에게 결과 요약 보고:
   - 추가된 tRPC 프로시저 목록
   - 수정된 파일 목록
   - QA 검증 결과

## 데이터 흐름

```
[오케스트레이터]
    │
    ├── TeamCreate + TaskCreate
    │
    ▼
[type-architect] ──SendMessage──→ [backend-engineer]
                  ──SendMessage──→ [frontend-engineer]
                                        ↓
                               (병렬 구현)
                                        ↓
                    [backend-engineer] ──SendMessage──→ [qa-engineer]
                    [frontend-engineer] ─SendMessage──→ [qa-engineer]
                                                              ↓
                                                    (검증 실행)
                                                              ↓
                                                     오류 있으면 팀원에게
                                                     통과 시 오케스트레이터에게
```

## 에러 핸들링

| 상황 | 전략 |
|------|------|
| type-architect 실패 | 1회 재시도. 재실패 시 사용자에게 알림 |
| backend/frontend 타입 오류 | QA가 팀원에게 전달 → 팀원 수정 → 재검증 (최대 2회 루프) |
| QA 최대 루프(2회) 초과 | 사용자에게 현재 상태 보고 + 수동 개입 요청 |
| 팀원 무응답 | SendMessage로 상태 확인 → 재시작 |
| 경계면 불일치 | backend-engineer + frontend-engineer 동시 알림 |

## 테스트 시나리오

### 정상 흐름

1. 사용자 요청: "세션에 메모(note) 기능 추가해줘. 세션별로 텍스트 메모를 저장/조회할 수 있게"
2. Phase 1: 도메인=세션, 프로시저=`session.setNote`(mutation) + `session.getNote`(query), UI=사이드바 텍스트 영역, DB=sessions 테이블에 note 컬럼 추가
3. Phase 2: 4명 팀 구성 + 4개 작업 등록
4. Phase 3: type-architect가 `note?: string` 타입 추가 → backend/frontend에 알림
5. Phase 3: backend가 router에 프로시저 추가, frontend가 노트 UI 구현 (병렬)
6. Phase 4: QA 검증 통과
7. Phase 5: 팀 정리 + 결과 보고

### 에러 흐름

1. 사용자 요청: "저장소에 태그 기능 추가"
2. backend-engineer가 `tag` 테이블 추가 후 타입 정의와 컬럼명 불일치
3. QA가 타입 체크 실패 감지 → backend-engineer에게 SendMessage
4. backend-engineer 수정 후 QA 재검증
5. 최종 통과 → 오케스트레이터에게 보고

## 중요 경로

- 프로젝트 루트: `/Users/kwon-david/dev/maestro`
- shared-types: `packages/shared-types/src/index.ts`
- tRPC 라우터: `apps/desktop/src/trpc/router.ts`
- 서비스: `apps/desktop/src/services/`
- DB: `apps/desktop/src/db/database.ts`
- 렌더러 컴포넌트: `apps/desktop/src/renderer/components/`
- Zustand 스토어: `apps/desktop/src/renderer/store/`
- 워크스페이스 작업 디렉토리: `/Users/kwon-david/dev/maestro/_workspace/`
