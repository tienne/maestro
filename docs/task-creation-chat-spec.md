# Spec: 태스크를 AI 에이전트와 채팅으로 생성하는 기능

**Spec ID**: `705157e9-a5cf-405c-a87d-0d4e1bb33f61`  
**Interview Session**: `a217d495-15f9-470a-a428-1f9da526378a`  
**Resolution Score**: 0.76  
**Generated**: 2026-05-25

---

## Goal

새 태스크 생성 시 항상 Claude AI와의 채팅을 통해 모든 태스크 필드(title, PRD, spec, 인수 조건, priority, 담당 에이전트, 참조 파일)를 자동으로 완성하는 AI 퍼스트 태스크 생성 기능 구현

---

## Constraints

1. 새 태스크 버튼 클릭 시 항상 AI 채팅 플로우로 시작 — 직접 입력 옵션 없음
2. Claude API(claude-sonnet-4-6)를 사용하여 AI 채팅 구현
3. 채팅 시작 시 현재 프로젝트명·레포지토리 정보를 컨텍스트로 자동 전달
4. 사용자가 명시적 명령(예: '태스크 만들어')을 입력해야 필드 생성 트리거 — AI가 자동으로 판단하지 않음
5. 검토/확인 단계 없이 즉시 DB 저장 (no confirmation dialog)
6. 채팅 취소(창 닫기) 시 대화 내용 저장하지 않고 폐기 (no draft persistence)
7. Settings 페이지 내 '태스크 생성 AI' 섹션에서 인터뷰 시스템 프롬프트만 커스터마이징 가능
8. 시스템 프롬프트 미설정 시 기본값(default interview prompt) 자동 사용
9. 기존 ProjectTask DB 스키마 및 tRPC 프로시저 활용 (brownfield 제약)

---

## Acceptance Criteria

1. ProjectTree에서 '+ 새 태스크' 버튼 클릭 시 AI 채팅창(모달 또는 패널)이 즉시 열린다
2. 채팅창 오픈 시 현재 프로젝트명과 레포지토리 정보가 Claude API 시스템 프롬프트에 자동으로 포함된다
3. 사용자가 자유 형식으로 기능 설명을 입력하면 AI가 응답한다
4. AI가 스펙이 불명확하다고 판단하면 추가 인터뷰 질문을 한다 (Settings에서 설정한 시스템 프롬프트 기준)
5. 사용자가 '태스크 만들어' 등의 생성 명령을 입력하면 AI가 title·description(PRD)·spec·acceptanceCriteria·priority·assignedAgent·referenceFiles 전체 필드를 생성한다
6. AI 생성 완료 즉시 projectTask.create tRPC 호출로 DB 저장, 채팅창 자동 닫힘
7. 저장 후 ProjectTree에 새 태스크가 즉시 반영된다
8. 채팅창 닫기/취소 시 DB 저장 없이 상태가 초기화된다
9. Claude API 오류(네트워크 실패, API 키 없음 등) 시 채팅창 내 에러 메시지 표시 및 재시도 가능
10. Settings > '태스크 생성 AI' 섹션에서 인터뷰 시스템 프롬프트를 편집·저장할 수 있다
11. Settings에 시스템 프롬프트 미입력 시 기본 인터뷰 프롬프트가 사용된다

---

## 전체 플로우

```
① + 새 태스크 클릭
      ↓
② AI 채팅창 오픈
   (프로젝트명 + 레포 정보 자동 주입)
      ↓
③ 사용자 자유 입력 ("로그인 기능 만들어줘")
      ↓
④ AI 응답 (스펙 불명확하면 추가 질문)
      ↓
⑤ 사용자: "태스크 만들어" 입력
      ↓
⑥ AI: 전체 필드 생성 (JSON)
      ↓
⑦ projectTask.create 즉시 저장
      ↓
⑧ 채팅창 닫힘 + ProjectTree 반영

[취소] → 폐기, 저장 없음
[API 오류] → 에러 메시지 + 재시도
```

---

## Ontology

### Entities

| Entity | Description | Key Attributes |
|--------|-------------|----------------|
| `TaskCreationChat` | AI 채팅 세션 (in-memory) | sessionId, projectId, projectName, repositoryName, messages, status |
| `ChatMessage` | 채팅 메시지 | id, role(user\|assistant), content, timestamp |
| `TaskCreationSettings` | AI 설정 (Settings 페이지) | interviewSystemPrompt, defaultInterviewSystemPrompt |
| `ProjectTask` | 생성된 태스크 (기존 + 필드 확장) | id, projectId, title, description, spec, acceptanceCriteria, priority, assignedAgent, referenceFiles, createdBy |
| `Project` | 프로젝트 컨텍스트 (기존) | id, name, repositoryId |

### Relations

- `TaskCreationChat` → `ChatMessage`: contains (1:N)
- `TaskCreationChat` → `ProjectTask`: creates (1:0..1)
- `Project` → `TaskCreationChat`: provides_context (1:N)
- `TaskCreationSettings` → `TaskCreationChat`: configures (1:N)

---

## Gestalt Analysis

| Principle | Finding | Confidence |
|-----------|---------|------------|
| Closure | 모든 필드 완전 채움 필수, 부분 생성 불허 | 0.97 |
| Proximity | 채팅 = 태스크 생성, 분리된 단계 없음 | 0.95 |
| Similarity | Settings 패턴이 기존 에이전트 설정과 동일 구조 | 0.92 |
| Figure-Ground | AI 채팅이 MVP 핵심, 확인/드래프트/자동트리거 제외 | 0.95 |
| Continuity | 순차 플로우 일관성, 취소=폐기, 오류=재시도 | 0.90 |
