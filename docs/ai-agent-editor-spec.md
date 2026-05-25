# AI Agent Editor — Maestro 개념 전환 스펙

> Spec ID: `086e0352-4e2e-418b-9994-cf6e0c4e6ad0`  
> Interview Session: `71bc8546-998e-40aa-b9d4-2c1f23e66b70`  
> 해상도 점수: 0.82 | 생성일: 2026-05-25

---

## 목표

Maestro를 **AI Agent Editor**로 전환한다. 태스크(Jira 티켓 형태)가 주인공이 되고 에이전트는 태스크를 실행하는 도구가 되는 오케스트레이션 편집기를 구현한다.

사용자는 IDE에서 코드를 작성하듯 태스크 카드에 PRD·스펙·완료기준을 작성하고, 에이전트가 이를 실행하며, Claude Code Teams를 통해 에이전트끼리 서브태스크를 위임하는 계층적 실행 흐름을 Maestro UI에서 시각화한다.

---

## 제약 조건

- 기존 Electron + electron-trpc + better-sqlite3 스택 유지
- 터미널 기반 에이전트 실행 방식(node-pty + xterm.js) 유지
- 워크스페이스(Git worktree)는 일시적 실행 환경 — 삭제될 수 있음
- 태스크 문서는 영속적 상태 — 워크스페이스가 사라져도 태스크는 보존
- 진행 내용 자동 업데이트(워크스페이스 복구 기능)는 MVP 제외 → Phase 2
- 기존 Repository/Agent/MCP 설정 데이터 마이그레이션 필요

---

## 완료 기준 (Acceptance Criteria)

1. **Project > Task > Workspace > Session** 4단계 계층 데이터 모델로 DB 재구성
2. 태스크 카드에 제목·PRD·스펙·담당에이전트·참조파일·완료기준·우선순위·상태 필드 CRUD 가능
3. 담당 에이전트 미지정 태스크 실행 시 오케스트레이터 에이전트가 적절한 에이전트 자동 할당
4. 태스크 실행 시 Git worktree 워크스페이스 자동 생성
5. Claude Code Teams가 서브 에이전트를 spawn할 때 Maestro가 감지하여 자식 태스크 카드 자동 생성
6. 사이드바에 Project→Task→Workspace 계층 트리 표시, 세션은 터미널 탭으로 처리
7. 중앙 패널 상단 고정: 태스크 카드 편집기 (선택된 태스크의 PRD/스펙/필드 편집)
8. 중앙 패널 하단: 세션 탭 (각 탭은 독립 터미널)
9. 자동 생성된 서브 태스크도 사람이 편집 가능 (동일한 Task 구조, 일부 필드 선택적)
10. 태스크 트리에서 부모-자식 관계 시각적으로 표시

---

## UI 레이아웃

```
┌──────────────┬────────────────────────────────────────┐
│ [프로젝트 선택] │  Task Card Editor (상단 고정)           │
├──────────────│  제목 / PRD / 스펙 / 완료기준 / 담당에이전트│
│ Project A    │  참조파일 / 우선순위 / 상태               │
│ └─ Task 1 ●  ├────────────────────────────────────────┤
│    └─ WS 1   │  [⚡ Session 1] [⚡ Session 2] [+]     │
│    └─ WS 2   │  터미널 출력 (PTY)                      │
│ └─ Task 2    │  $ claude --agent ...                  │
│    └─ WS 1   │  > 로그인 API 구현 중...                 │
│ Project B    │                                        │
└──────────────┴────────────────────────────────────────┘
```

---

## 데이터 모델 (Ontology)

### 엔티티

| 엔티티 | 설명 | 주요 필드 |
|--------|------|-----------|
| **Project** | 코드베이스 단위. Repository에 연결된 최상위 컨테이너 | id, name, repositoryId |
| **Task** | Jira 티켓 형태의 영속적 작업 단위 | id, projectId, **parentTaskId**, title, prd, spec, referenceFiles, acceptanceCriteria, priority, assignedAgentId, status, **createdBy**, workspaceId |
| **Workspace** | 태스크 실행을 위해 생성되는 일시적 Git worktree 환경 | id, taskId, worktreePath, branch, status |
| **Session** | 워크스페이스 내 에이전트 PTY 프로세스 1개. 터미널 탭으로 노출 | id, workspaceId, agentId, status, pid |
| **OrchestratorAgent** | 담당 에이전트 미지정 태스크에 적절한 에이전트를 자동 할당하는 시스템 에이전트 | id, type, config |

> **Task.createdBy**: `"human"` | `"agent"` — 사람이 만든 태스크와 Teams가 자동 생성한 서브태스크 구분  
> **Task.parentTaskId**: 부모 태스크 참조 — 트리 구조 형성

### 관계

```
Project     1 ──── N  Task
Task        1 ──── N  Task (self, parentTaskId)
Task        1 ──── 1  Workspace (optional, 실행 시 생성)
Workspace   1 ──── N  Session
OrchestratorAgent ──── assigns ──── Task
```

---

## Phase 구분

### Phase 1 — MVP
- [ ] Task 엔티티 DB 추가 (Project/Task/Workspace 재구성)
- [ ] 태스크 카드 편집기 UI
- [ ] Project→Task→Workspace 사이드바 트리
- [ ] 태스크 실행 시 워크스페이스 자동 생성
- [ ] 오케스트레이터 에이전트 (자동 할당 로직)
- [ ] Claude Code Teams 서브 에이전트 감지 → 자식 태스크 자동 생성
- [ ] 세션 탭 하단 패널 (기존 터미널 재활용)

### Phase 2
- [ ] 태스크 문서에 진행 내용 자동 업데이트
- [ ] 워크스페이스 삭제 후 다른 워크스페이스에서 이어서 실행

---

## Gestalt 분석

| 원리 | 발견 | 신뢰도 |
|------|------|--------|
| **Closure** | 태스크 문서(영속) / 워크스페이스(일시적) 분리가 핵심 아키텍처 결정 | 0.90 |
| **Proximity** | 4단계 계층 그룹핑. 세션은 터미널 탭으로 분리 — 실행 컨텍스트와 관리 컨텍스트 구분 | 0.88 |
| **Similarity** | 사람 태스크 = 에이전트 서브태스크 — 동일 Task 엔티티, createdBy로 출처 구분 | 0.85 |
| **Figure-Ground** | MVP(전경): 카드 편집기+오케스트레이터+태스크트리+워크스페이스 자동생성 / Phase2(배경): 진행 자동 업데이트 | 0.92 |
| **Continuity** | 기존 PTY/xterm.js 유지 + Task 레이어 추가. 기존 Session → Task→Workspace→Session으로 재배치 | 0.82 |
