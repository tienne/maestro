# Maestro Feature Roadmap

Superset(superset.sh) 참고 기반 기능 추가 계획 — 2026-04-09

---

## 현재 구현 상태

| 영역 | 구현 여부 |
|------|-----------|
| 사이드바 (워크스페이스 + 세션 트리) | ✅ |
| 멀티탭 터미널 (XTerminal) | ✅ |
| Git 패널 (Diff 뷰, 커밋, 파일 트리) | ✅ |
| 에이전트 / MCP / 레포지토리 관리 | ✅ |
| PTY 매니저, Git Watcher, HTTP 서버 | ✅ |

---

## 추가 기능 목록

### 🔴 P0 — 핵심 차별화 기능

#### 1. 워크스페이스 상태 대시보드
- "In Progress 3 / Ready for Review 2" 병렬 에이전트 현황 한눈에 보기
- 각 워크스페이스 카드에 진행 상태 배지 + 마지막 활동 시간
- 사이드바 트리 상태 인디케이터

#### 2. Approve & Merge 워크플로우
- 변경사항 리뷰 후 "Approve" → 메인 브랜치 병합
- squash / rebase / merge 옵션 선택
- worktree → main 완성된 병합 플로우

#### 3. Diff Side-by-Side 뷰
- 현재 GitDiffView.tsx 인라인 뷰에 Side-by-side 토글 추가

---

### 🟠 P1 — 생산성 향상

#### 4. IDE 딥링킹
- 워크스페이스 경로를 VS Code / Cursor / JetBrains에서 단축키 한 번에 열기
- `open -a "Cursor" <worktreePath>` 수준, UI 추가

#### 5. 포트 포워딩 패널
- 세션 내 프로세스가 포트 listen 시 자동 감지
- 포트 목록 표시 + 브라우저 열기 버튼
- 기존 `http-server.ts` / `getServerPort()` 활용, UI 노출 필요

#### 6. 에이전트 아이콘 + 선택 UI 개선
- Claude / Codex / Gemini / Cursor 각각 아이콘
- 세션 생성 모달 시각적 에이전트 선택

---

### 🟡 P2 — 안정성 / 편의성

#### 7. 세션 영속성 (Sleep 대응)
- 노트북 닫아도 세션 상태 복원
- PTY 프로세스 재연결 or 재시작 + 스크롤백 버퍼 보존
- Superset 사용자들이 가장 칭찬하는 기능

#### 8. MCP 서버 연결 상태 표시
- 세션별 "MCP connected / disconnected" 인디케이터
- 터미널 탭 내 연결 상태 뱃지

#### 9. 워크스페이스 생성 자동화 플로우
- `git worktree add` → 의존성 설치 → 에이전트 실행 자동화
- 진행 상황 단계 표시 ("Setting up new parallel environment...")

---

### 🔵 P3 — 차별화 추가 기능 (Superset에 없는 것)

#### 10. 프롬프트 히스토리 & 재실행
- 각 세션에서 보낸 프롬프트 기록
- 이전 태스크 재실행 or 수정 실행

#### 11. 에이전트 병렬 태스크 브로드캐스트
- 동일 프롬프트를 선택한 여러 세션에 동시 전송
- A/B 테스트 식으로 에이전트 결과 비교

#### 12. 원격 제어
- 릴레이 서버 방식으로 외부에서 에이전트 세션 제어
- (별도 계획 문서 참조)

---

## 우선순위 실행 순서

```
1. IDE 딥링킹          — 빠른 구현, 즉각적 체감 개선
2. 상태 대시보드        — 병렬 에이전트 관리 UX 핵심
3. Approve/Merge 플로우 — 작업 완결성
4. 포트 포워딩 UI       — 개발 서버 편의성
5. 세션 영속성          — 안정성 킬러 피처
6. 브로드캐스트 / 원격 제어
```
