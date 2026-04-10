# Maestro PRD v2 — Superset 재비교 기반 로드맵

> **기준일:** 2026-04-10  
> **참조:** [superset-sh/superset](https://github.com/superset-sh/superset) (9.2K ★)  
> **전판 대비 변경:** 이전 PRD(v1) P0~P1 항목 상당수가 구현 완료됨에 따라 전면 재평가

---

## 1. 현재 구현 현황 재평가

### 1-1. v1 PRD 이후 완료된 항목

| v1 항목 | 현재 상태 |
|---------|----------|
| 알림 시스템 | ✅ OS 네이티브 알림 (Web Notifications API) |
| 에러 바운더리 | ✅ react-error-boundary (AppShell + 패널별) |
| Zustand Persistence | ✅ uiStore / settingsStore persist 미들웨어 |
| 키보드 단축키 | ✅ useAppHotkeys (⌘K, ⌘B, ⌘\, ⌘G 등) |
| 커맨드 팔레트 | ✅ Fuse.js 퍼지 검색 기반 CommandPalette |
| 파일 탐색기 | ✅ FileTree (git status 색상 마킹 포함) |
| 마크다운 렌더러 | ✅ shared/MarkdownRenderer.tsx |
| 에이전트 대시보드 | ✅ AgentDashboard (좌측 사이드바 Agents 탭) |
| 딥링크 | ✅ useDeepLink 훅 |
| 알림음 | ✅ useSessionSounds |
| UpdateBanner | ✅ IPC 기반 자동 업데이트 UI |
| Config 파일 미리보기 | ✅ shared/ConfigPreview.tsx |
| 리소스 모니터링 기반 | ✅ resource.subscribe tRPC subscription |

### 1-2. Superset 대비 현재 격차 분석

```
Maestro 현재 강점
├── tRPC v11 + SQLite 완전한 데이터 계층 (74 procedures)
├── Git worktree 기반 워크스페이스 격리
├── 멀티 에이전트 병렬 실행 + 모니터링
├── 4종 IDE 딥링킹 (vscode / cursor / webstorm / zed)
├── MCP 서버 통합 관리
└── 우측 패널 탭 구조 (Files / Git / Merge / Ports)

Superset 대비 격차 (신규 로드맵 대상)
├── [Git] commit 히스토리 / stash / fetch / reset / blame
├── [Terminal] 브로드캐스트 모드 / 터미널 내 검색 / 탭 reorder
├── [AI] 세션별 비용 추적 / 작업 진행률 감지 / 구조화 출력
├── [Session] 이름 변경 / 템플릿 / 그룹 / 즐겨찾기
├── [UX] 온보딩 플로우 / 빈 상태 UI / 드래그 앤 드롭
├── [Automation] 웹훅 / CLI 연동 / 딥링크 확장
├── [Perf] 가상 스크롤 / 메모리 관리 / 프로세스 메트릭 UI
└── [Platform] 멀티 윈도우 / 세션 내보내기 / 팀 공유
```

---

## 2. 마일스톤 개요

| M# | 이름 | 핵심 가치 | 기능 수 |
|----|------|----------|--------|
| M1 | Git 심화 | 완전한 Git 워크플로우 | 8개 |
| M2 | 터미널 & 세션 UX | 키보드 중심 생산성 | 7개 |
| M3 | AI 세션 인텔리전스 | 에이전트 출력 파악 | 5개 |
| M4 | 에이전트 오케스트레이션 | 병렬 작업 제어 | 5개 |
| M5 | 워크스페이스 자동화 | 환경 표준화 | 4개 |
| M6 | 원격 제어 & API | 외부 자동화 연동 | 5개 |
| M7 | 성능 & 관찰성 | 장시간 안정 운영 | 5개 |
| M8 | UX 폴리시 & 온보딩 | 첫 사용자 경험 | 6개 |
| M9 | 멀티 윈도우 & 공유 | 협업 및 공유 | 4개 |
| M10 | 플러그인 & 확장 | 커뮤니티 생태계 | 4개 |

---

## 3. 마일스톤 상세

---

### M1 — Git 심화 (`🔴 P0`)

> 현재 `add / commit / push / pull / checkout / merge` 수준의 기본 Git만 구현됨.  
> 실제 개발 워크플로우에서 일상적으로 필요한 고급 기능을 완성한다.

#### F-M1-01. Commit 히스토리 뷰어

**배경**  
Superset은 브랜치별 커밋 로그를 타임라인으로 시각화한다. 에이전트가 수행한 작업 내역을 커밋 단위로 추적해야 리뷰와 롤백이 가능하다.

**스펙**
- `git log --oneline --graph` 기반 커밋 목록
- 커밋 클릭 → 해당 커밋 diff 조회
- 커밋 메시지 / 해시 / 날짜 / 작성자 표시
- `git show <hash>` 로 파일별 변경 확인

**구현 위치:** 우측 사이드바 Git 탭 → "History" 서브탭

**수용 기준**
- [ ] 현재 브랜치의 최근 50개 커밋 목록 표시
- [ ] 커밋 클릭 → diff 뷰어 연동
- [ ] "Reset to here" 컨텍스트 메뉴 (soft/hard 선택)

---

#### F-M1-02. Stash 관리

**배경**  
에이전트가 작업 중 브랜치를 전환해야 할 때 임시 저장이 필요하다.

**스펙**
- `git stash push -m "메시지"` / `git stash pop` / `git stash drop`
- stash 목록 UI (이름, 날짜, 변경 파일 수)
- stash 적용 시 충돌 처리 안내

**수용 기준**
- [ ] Git 패널에서 stash 생성 / 목록 조회 / 적용 / 삭제
- [ ] stash 클릭 시 변경 내용 미리보기

---

#### F-M1-03. Fetch & 원격 브랜치 추적

**배경**  
현재 push/pull만 구현됨. fetch로 원격 상태를 가져와 로컬과 비교하는 기능이 없다.

**스펙**
- `git fetch --all` 실행 버튼
- 원격 브랜치와 로컬 브랜치 ahead/behind 카운터 표시
- 원격 브랜치 체크아웃 (tracking 설정 포함)

**수용 기준**
- [ ] Fetch 버튼 → 원격 상태 동기화
- [ ] 브랜치 셀렉터에 ahead/behind 표시 (`↑2 ↓1`)
- [ ] 원격 브랜치 목록에서 로컬 체크아웃

---

#### F-M1-04. Git Reset & Revert

**배경**  
에이전트가 잘못된 변경을 했을 때 빠르게 되돌리는 방법이 필요하다.

**스펙**
- 커밋 히스토리에서 "Reset to here" (soft/mixed/hard 선택)
- 특정 커밋의 Revert 커밋 생성
- Unstage All / Discard All Changes 버튼

**수용 기준**
- [ ] soft/mixed/hard reset 3가지 모드 제공
- [ ] 각 모드 동작 설명 툴팁
- [ ] 실행 전 confirm 다이얼로그

---

#### F-M1-05. Blame 뷰어

**배경**  
어떤 커밋이 어느 라인을 변경했는지 추적. 에이전트 작업 책임 추적에 유용.

**스펙**
- 파일 선택 → blame 모드 토글
- 라인별 커밋 해시 / 날짜 / 커밋 메시지 표시
- 클릭 시 해당 커밋 diff 오픈

**수용 기준**
- [ ] FileTree에서 우클릭 → "Blame" 메뉴
- [ ] blame 패널에서 라인별 커밋 정보 표시
- [ ] 커밋 클릭 → History 뷰어 해당 커밋으로 점프

---

#### F-M1-06. Tag 관리

**배경**  
릴리즈 시점 마킹. 에이전트가 완료한 주요 마일스톤을 태그로 기록한다.

**스펙**
- 태그 생성 (annotated/lightweight)
- 태그 목록 조회 + 삭제
- 태그를 원격에 push

**수용 기준**
- [ ] Git 패널에서 태그 생성 / 목록 / 삭제
- [ ] `git push --tags` 연동

---

#### F-M1-07. Cherry-pick

**배경**  
다른 브랜치의 특정 커밋만 현재 브랜치에 적용. 에이전트 간 작업 부분 공유에 유용.

**스펙**
- 커밋 히스토리에서 "Cherry-pick" 컨텍스트 메뉴
- 충돌 시 conflict 해결 유도 UI

**수용 기준**
- [ ] 커밋 우클릭 → Cherry-pick
- [ ] 충돌 발생 시 conflict 파일 목록 표시 + abort 버튼

---

#### F-M1-08. Interactive Rebase (기본)

**배경**  
커밋 정리(squash/fixup/reorder). 에이전트가 만든 많은 작은 커밋을 PR 전에 정리.

**스펙**
- `git rebase -i HEAD~N` 실행
- 커밋 목록 드래그 리오더 + squash/fixup/drop 선택

**구현 방식:** xterm.js 터미널 내에서 git rebase 실행 (full interactive는 범위 밖, 단순 squash/reorder UI만)

**수용 기준**
- [ ] 최근 N개 커밋을 UI에서 선택하여 squash
- [ ] 결과 커밋 메시지 편집

---

### M2 — 터미널 & 세션 UX (`🔴 P0`)

> 터미널은 Maestro의 핵심 인터페이스다.  
> Superset 수준의 스크롤 정확도, 검색, 세션 관리 UX를 완성한다.

#### F-M2-01. 터미널 내 검색 (Ctrl+F)

**배경**  
긴 에이전트 출력에서 특정 텍스트를 찾아야 할 때 xterm.js `SearchAddon`이 필요하다.

**스펙**
- `Ctrl+F` → 터미널 우상단 검색 바 표시
- 다음/이전 이동 (`Enter` / `Shift+Enter`)
- 정규식 / 대소문자 구분 옵션
- 결과 하이라이팅

**구현:** `@xterm/addon-search` + 검색 바 컴포넌트

**수용 기준**
- [ ] Ctrl+F로 검색 모드 진입
- [ ] 검색어 입력 → 일치 항목 하이라이트
- [ ] 매치 수 표시 ("3 of 12")

---

#### F-M2-02. 브로드캐스트 모드

**배경**  
여러 에이전트에 같은 명령을 동시에 전송. 병렬 작업 지시에 유용.

**스펙**
- 탭바의 "Broadcast" 토글 버튼 (또는 `⌘Shift+Enter`)
- 활성화 시 모든 세션에 동시 입력 전송
- 브로드캐스트 대상 세션 개별 선택 가능

**구현:** `trpc.session.broadcast` 프로시저 이미 존재 → UI 연결

**수용 기준**
- [ ] Broadcast 모드 토글 시 탭바 시각적 표시
- [ ] 입력 → 선택된 모든 세션에 전송
- [ ] 대상 세션 체크박스 선택 UI

---

#### F-M2-03. 세션 이름 변경 (Rename)

**배경**  
세션이 많아지면 "Session 1", "Session 2" 구분이 어렵다. 의미 있는 이름 부여 필요.

**스펙**
- 탭 더블클릭 → 인라인 텍스트 편집
- DB에 `name` 컬럼 업데이트
- 이름이 없으면 워크스페이스명 fallback

**수용 기준**
- [ ] 탭 더블클릭으로 이름 편집 진입
- [ ] Enter 확정 / Esc 취소
- [ ] 30자 제한

---

#### F-M2-04. 탭 드래그 리오더 & 핀

**배경**  
자주 쓰는 세션을 고정하거나 순서를 조정하는 기능.

**스펙**
- 탭 드래그 앤 드롭으로 순서 변경
- 탭 우클릭 → "Pin" (고정된 탭은 좌측 고정, 닫기 버튼 숨김)
- 핀 상태 persistence

**구현:** `@dnd-kit/core` 또는 `react-beautiful-dnd`

**수용 기준**
- [ ] 탭 드래그로 순서 변경 가능
- [ ] 핀된 탭은 좌측 고정 + 닫기 불가
- [ ] 앱 재시작 후에도 핀 상태 유지

---

#### F-M2-05. 스크롤 동작 개선 (Superset 패턴)

**배경**  
Superset 소스에서 발견한 `wasAtBottom` 체크 패턴이 현재 미적용. 리사이즈 시 뷰포트 맨 아래에 있던 경우 리사이즈 후에도 자동 스크롤.

**스펙 (Superset 패턴 그대로 적용)**
```typescript
const wasAtBottom = buffer.viewportY >= buffer.baseY;
fitAddon.fit();
if (wasAtBottom) requestAnimationFrame(() => xterm.scrollToBottom());
```
- `scrollback: 5000` 설정
- `scrollbar: { showScrollbar: false }` — fit addon 버그 방지

**수용 기준**
- [ ] 터미널 리사이즈 시 맨 아래에 있었다면 리사이즈 후에도 맨 아래
- [ ] TUI 프롬프트(vim, htop 등)가 리사이즈 후 뷰포트 아래로 잘리지 않음

---

#### F-M2-06. 세션 즐겨찾기 & 최근 세션

**배경**  
세션이 많아질수록 탐색이 어렵다. 즐겨찾기와 최근 방문 세션 빠른 접근.

**스펙**
- 탭 우클릭 → "Favorite" 토글 (★ 아이콘)
- 커맨드 팔레트에 "Recent Sessions" 그룹 우선 표시
- 즐겨찾기 세션은 탭바 좌측 고정

**수용 기준**
- [ ] 즐겨찾기 상태 DB 저장 + 재시작 후 유지
- [ ] 커맨드 팔레트에서 즐겨찾기/최근 세션 빠른 접근

---

#### F-M2-07. 터미널 폰트 & 색상 테마 커스텀

**배경**  
현재 터미널 폰트 크기 조절만 있음. Superset은 터미널 색상 팔레트 커스텀을 지원한다.

**스펙**
- 설정 → 터미널 테마 선택 (Dracula / Solarized / One Dark / 커스텀)
- xterm.js `theme` 옵션 연동
- 기본 폰트 패밀리 선택 (JetBrains Mono / Fira Code / Cascadia Code)

**수용 기준**
- [ ] 설정에서 터미널 색상 테마 선택
- [ ] 즉시 적용 (재시작 불필요)
- [ ] 폰트 패밀리 3종 선택

---

### M3 — AI 세션 인텔리전스 (`🟠 P1`)

> 에이전트 출력을 단순 텍스트 스트림이 아닌 **구조화된 정보**로 해석하고 표시한다.

#### F-M3-01. 세션별 비용 추적 (Token Cost)

**배경**  
Claude / GPT / Gemini 등 API 비용이 세션별로 얼마나 발생했는지 가시화. 장시간 에이전트 실행에서 예산 초과 방지.

**스펙**
- 에이전트 출력에서 토큰 사용량 파싱 (`claude --output-format json` 모드 활용)
- 세션 탭에 현재 비용 표시 (예: `$0.23`)
- 일별/세션별 비용 집계 대시보드

**구현 방식**
```
PTY stdout → token usage 정규식 파싱
→ session_cost 테이블 (SQLite)
→ tRPC subscription으로 실시간 업데이트
```

**수용 기준**
- [ ] Claude Code JSON 출력에서 input/output 토큰 파싱
- [ ] 세션 탭 hover 시 누적 비용 툴팁
- [ ] 설정에서 비용 경고 임계값 설정 (예: 세션당 $5 초과 시 경고)

---

#### F-M3-02. 작업 진행률 감지 (Task Detection)

**배경**  
에이전트 출력에서 TODO 리스트 / 진행 단계를 파싱하여 시각적 진행 표시기 제공.

**스펙**
- Claude의 `TodoWrite` 도구 출력 파싱
- "완료됨 N/M" 형태의 진행 바 표시
- 대시보드 카드에 현재 단계 명시

**파싱 패턴:**
```
✅ completed / 🔄 in_progress / ⏳ pending 이모지 + 작업명
```

**수용 기준**
- [ ] 에이전트 대시보드 카드에 진행률 표시 (N/M)
- [ ] 완료된 항목 취소선 + 색상 변경
- [ ] 세션 탭 헤더에 진행률 % 표시

---

#### F-M3-03. 구조화 출력 패널 (Markdown 전용 뷰)

**배경**  
`MarkdownRenderer` 컴포넌트가 이미 있으나, 터미널과 독립된 전용 Markdown 패널로 노출되지 않음.

**스펙**
- TiledLayout에 새 패널 타입 `'markdown'` 추가
- 특정 파일 경로 지정 또는 에이전트 최근 출력 자동 감지
- 실시간 업데이트 (파일 변경 watcher)

**수용 기준**
- [ ] 커맨드 팔레트에서 "Open Markdown Panel" → 파일 경로 입력
- [ ] 에이전트가 `.md` 파일 생성 시 자동 감지 알림
- [ ] 분할 레이아웃에서 터미널 + 마크다운 나란히 표시

---

#### F-M3-04. 에이전트 에러 패턴 분류

**배경**  
에이전트 오류 유형을 분류하여 반복 오류를 빠르게 파악한다.

**스펙**
- PTY 출력에서 오류 패턴 감지: `Error:`, `FAILED`, `Traceback`, `fatal:` 등
- 오류 유형 분류 (API Error / Build Error / Git Error / Permission Error)
- 세션 카드에 최근 오류 타입 배지 표시

**수용 기준**
- [ ] 오류 감지 시 세션 탭에 빨간 뱃지
- [ ] 오류 메시지 클릭 → 해당 출력 위치로 스크롤

---

#### F-M3-05. 에이전트 완료 감지 & 다음 액션 제안

**배경**  
에이전트가 작업을 완료했을 때 자동으로 다음 단계를 제안한다.

**스펙**
- 프로세스 exit 0 감지 → "작업 완료" 알림 + 제안 카드 표시
- 제안 액션: "변경사항 커밋", "PR 생성", "다음 세션 시작"
- 클릭 시 해당 액션 즉시 실행

**수용 기준**
- [ ] 에이전트 정상 종료 시 완료 카드 표시
- [ ] "커밋하기" 버튼 → Git 패널 커밋 모드 자동 전환
- [ ] OS 알림 연동 (앱 백그라운드 시에도)

---

### M4 — 에이전트 오케스트레이션 (`🟠 P1`)

> Maestro의 핵심 차별점: 여러 에이전트를 **조율하고 관찰**하는 기능을 강화한다.

#### F-M4-01. 에이전트 의존성 체인 (Pipeline)

**배경**  
A 에이전트 완료 → B 에이전트 자동 시작 같은 파이프라인 워크플로우.

**스펙**
- 세션 생성 시 "선행 세션 완료 후 시작" 옵션
- 의존성 그래프 시각화 (DAG 뷰)
- 파이프라인 저장 + 재사용 (템플릿)

**수용 기준**
- [ ] A → B 단순 체인 설정 가능
- [ ] 선행 세션 실패 시 파이프라인 중단 + 알림
- [ ] 파이프라인 상태 대시보드 표시

---

#### F-M4-02. 에이전트 출력 공유 (Context Sharing)

**배경**  
A 에이전트의 출력을 B 에이전트의 입력으로 자동 전달.

**스펙**
- 세션 A의 마지막 N줄 출력을 세션 B의 시작 입력으로 삽입
- 파일 기반 공유: A가 생성한 파일을 B의 작업 디렉토리에 복사

**수용 기준**
- [ ] 세션 설정에서 "입력 소스 세션" 선택 가능
- [ ] 공유 시 입력 길이 제한 설정 (기본 4000자)

---

#### F-M4-03. 병렬 에이전트 제어판 (Command Center)

**배경**  
Superset의 워크스페이스 카드 뷰 수준의 병렬 모니터링. 현재 AgentDashboard 기반으로 기능 강화.

**스펙**
- 전체 세션 카드 뷰 (그리드 레이아웃)
- 카드: 세션명, 에이전트, 상태, 마지막 출력 3줄, 비용, 진행률
- 상태별 필터 (Running / Waiting / Done / Error)
- 일괄 정지 / 일괄 재시작

**수용 기준**
- [ ] 대시보드에서 상태별 필터링
- [ ] "모두 정지" / "오류만 재시작" 일괄 액션
- [ ] 카드 클릭 → 해당 세션 탭으로 포커스

---

#### F-M4-04. 에이전트 프리셋 (Quick Launch)

**배경**  
자주 쓰는 에이전트 + 워크스페이스 + 초기 명령 조합을 프리셋으로 저장.

**스펙**
- "새 세션" 시 프리셋 선택 옵션
- 프리셋: 에이전트, 워크스페이스, 시작 명령, 환경변수 세트
- 커맨드 팔레트에서 빠른 실행

**수용 기준**
- [ ] 프리셋 저장 / 수정 / 삭제
- [ ] 커맨드 팔레트에서 "Launch: [프리셋명]" 검색
- [ ] 프리셋 기반 새 세션 1회 클릭으로 생성

---

#### F-M4-05. 세션 그룹 & 라벨

**배경**  
"프론트엔드 에이전트들", "백엔드 에이전트들" 같은 그룹 관리.

**스펙**
- 세션에 라벨 태그 부여 (색상 + 이름)
- 탭바에서 라벨로 필터링
- 그룹 단위 브로드캐스트 / 정지

**수용 기준**
- [ ] 세션 우클릭 → 라벨 부여
- [ ] 탭바 상단에 라벨 필터 드롭다운
- [ ] 라벨 그룹 전체 브로드캐스트

---

### M5 — 워크스페이스 자동화 (`🟡 P1.5`)

> 반복적인 워크스페이스 설정을 자동화하고, 표준 환경을 빠르게 복제한다.

#### F-M5-01. 워크스페이스 템플릿

**배경**  
"Next.js + Claude Code" 같은 자주 쓰는 워크스페이스 설정을 템플릿으로 저장.

**스펙**
- 현재 워크스페이스 설정을 템플릿으로 저장
- 템플릿에 포함: 에이전트, 환경변수, setup script, branch 설정
- "템플릿에서 생성" 워크스페이스 생성 플로우

**수용 기준**
- [ ] 워크스페이스 → "Save as Template"
- [ ] 새 워크스페이스 생성 시 템플릿 선택 가능
- [ ] 기본 제공 템플릿 3종 (Claude Code / Codex / Gemini)

---

#### F-M5-02. 환경 스냅샷 & 복원

**배경**  
특정 시점의 워크스페이스 상태(env vars, scripts, git HEAD)를 스냅샷으로 저장.

**스펙**
- 워크스페이스 설정 + 현재 git HEAD를 스냅샷으로 저장
- 스냅샷 목록 + 날짜/커밋 정보 표시
- 복원 시 env vars / scripts만 적용 (git은 체크아웃 선택)

**수용 기준**
- [ ] 워크스페이스 설정 페이지에서 스냅샷 생성
- [ ] 최근 10개 스냅샷 유지
- [ ] 스냅샷 복원 시 confirm 다이얼로그

---

#### F-M5-03. Lifecycle Hook 강화

**배경**  
현재 setup/teardown script 외에 더 세밀한 라이프사이클 훅이 필요하다.

**스펙**
- `onSessionStart`: 세션 시작 직후 실행 (예: env 로드)
- `onAgentComplete`: 에이전트 완료 시 실행 (예: 자동 커밋)
- `onError`: 에러 감지 시 실행 (예: 알림 전송)
- 훅 스크립트를 워크스페이스 설정 UI에서 편집

**수용 기준**
- [ ] 설정 페이지에서 3가지 훅 스크립트 편집
- [ ] 훅 실행 결과를 터미널 패널에 표시
- [ ] 훅 실패 시 세션 계속 진행 여부 선택

---

#### F-M5-04. 워크스페이스 상태 동기화

**배경**  
여러 세션이 같은 워크스페이스를 사용할 때 환경변수 변경이 즉시 반영되어야 한다.

**스펙**
- 워크스페이스 env var 변경 → 해당 워크스페이스 활성 세션에 실시간 반영 알림
- "Reload ENV" 버튼으로 수동 적용

**수용 기준**
- [ ] 환경변수 저장 시 활성 세션에 알림 배너
- [ ] "Reload" 클릭 → 해당 세션에 env reload 명령 전송

---

### M6 — 원격 제어 & API (`🟡 P2`)

> Maestro를 다른 도구에서 제어하고 외부 자동화 파이프라인에 통합한다.

#### F-M6-01. 딥링크 프로토콜 확장 (`maestro://`)

**배경**  
`useDeepLink` 훅이 이미 있으나, 지원하는 URL 패턴이 제한적이다.

**스펙**

| URL 패턴 | 동작 |
|----------|------|
| `maestro://session/new?workspace=:id&agent=:agentId&cmd=:command` | 새 세션 생성 + 시작 명령 |
| `maestro://session/:id/send?text=:text` | 특정 세션에 텍스트 전송 |
| `maestro://workspace/:id/focus` | 워크스페이스 포커스 |
| `maestro://broadcast?text=:text&label=:label` | 라벨 그룹 브로드캐스트 |
| `maestro://preset/:name/launch` | 프리셋 즉시 실행 |

**수용 기준**
- [ ] 위 5가지 URL 패턴 처리
- [ ] macOS / Windows 프로토콜 등록 확인
- [ ] 잘못된 URL에 대한 에러 처리

---

#### F-M6-02. 웹훅 지원

**배경**  
세션 상태 변화를 외부 서비스(Slack, Discord, n8n, Zapier)에 자동 전송.

**스펙**
- 설정에서 웹훅 URL 등록
- 이벤트 선택: `session.completed`, `session.error`, `agent.task_done`
- HTTP POST (JSON body: 세션 정보 + 이벤트 데이터)
- 재시도 (3회, 지수 백오프)

**수용 기준**
- [ ] 설정에서 웹훅 URL + 이벤트 설정
- [ ] "Test" 버튼으로 즉시 테스트 발송
- [ ] 발송 이력 로그 (최근 20개)

---

#### F-M6-03. REST API 개선 & 문서화

**배경**  
현재 `/api/remote/*` 엔드포인트가 있으나 문서화되지 않았고, 인증 체계가 미흡하다.

**스펙**
- API Key 인증 (설정에서 생성/폐기)
- Swagger UI 내장 (`/api/docs`)
- 주요 엔드포인트 확장: 세션 목록, 세션 생성, 터미널 전송, 상태 조회

**수용 기준**
- [ ] API Key 발급 / 폐기 UI
- [ ] 앱 내 Swagger 문서 페이지
- [ ] curl 예시 자동 생성

---

#### F-M6-04. CLI 연동 도구

**배경**  
터미널에서 직접 `maestro` 명령으로 앱을 제어한다.

**스펙**
```bash
maestro session list           # 활성 세션 목록
maestro session send <id> "..."  # 특정 세션에 입력
maestro session new --workspace <id> --agent claude
maestro broadcast "..."        # 전체 브로드캐스트
```

**구현 방식:** Node.js CLI → REST API 호출 → `npx maestro-cli` 배포

**수용 기준**
- [ ] `npm install -g @maestro/cli`로 설치
- [ ] 위 4개 커맨드 동작
- [ ] `maestro --help` 도움말

---

#### F-M6-05. 원격 세션 공유 (Relay 개선)

**배경**  
현재 relay 서버 구조가 있으나 연결 안정성과 UI가 미흡하다.

**스펙**
- relay 연결 상태를 TitleBar에 표시
- 연결 끊김 시 자동 재연결 (지수 백오프)
- relay를 통한 세션 스트리밍 지연시간 표시 (ms)

**수용 기준**
- [ ] TitleBar에 relay 연결 상태 도트 (초록/빨강/노랑)
- [ ] 연결 끊김 → 5초 내 자동 재연결 시도
- [ ] 지연 30ms 초과 시 경고 표시

---

### M7 — 성능 & 관찰성 (`🟡 P2`)

> 장시간 병렬 에이전트 실행에서의 안정성과 관찰성을 확보한다.

#### F-M7-01. 터미널 가상 스크롤

**배경**  
에이전트가 수만 줄 출력 시 xterm.js scrollback 버퍼가 메모리를 과다 소비한다.

**스펙**
- scrollback 한계 도달 시 오래된 출력을 디스크 캐시로 내림
- xterm.js `CustomScrollback` 플러그인 또는 `scrollback: 'none'` + 커스텀 버퍼

**수용 기준**
- [ ] 100K줄 출력 시에도 메모리 500MB 이하 유지
- [ ] 스크롤 업 시 디스크 캐시에서 로드 (자연스러운 UX)

---

#### F-M7-02. 프로세스 메트릭 대시보드 UI

**배경**  
`resource.subscribe` tRPC subscription이 이미 구현됨. 이를 시각화하는 UI가 없다.

**스펙**
- 에이전트 대시보드 카드에 CPU% + 메모리 MB 실시간 표시
- 설정에서 리소스 경고 임계값 설정 (CPU > 80%, Mem > 2GB)
- 경고 초과 시 카드 테두리 빨간색 + 알림

**수용 기준**
- [ ] 각 세션 카드에 CPU / 메모리 실시간 수치
- [ ] 임계값 초과 시 시각적 경고
- [ ] 1시간 단위 리소스 사용 히스토리 그래프 (간단한 라인 차트)

---

#### F-M7-03. 자동 세션 정리 (GC)

**배경**  
정지된 세션이 쌓이면 DB가 비대해지고 목록이 복잡해진다.

**스펙**
- 설정: "N일 이상 비활성 세션 자동 삭제" (기본 30일)
- 삭제 전 하루 전 알림
- 보관된 세션 아카이브 내보내기 (JSON)

**수용 기준**
- [ ] 설정에서 자동 정리 주기 설정
- [ ] 정리 대상 세션 미리보기 + 개별 제외 선택
- [ ] 아카이브 내보내기 (세션명 + 설정 정보)

---

#### F-M7-04. 에러 로그 & 크래시 리포트

**배경**  
현재 에러는 콘솔에만 출력됨. 로컬 파일 로그와 사용자 가시 에러 리포트 필요.

**스펙**
- 에러 발생 → `~/.maestro/logs/error-{date}.log` 기록
- 설정에서 "오류 보고서 보기" → 로그 파일 오픈
- PTY 프로세스 비정상 종료 시 세션 상태를 `error`로 마킹 + 원인 코드 저장

**수용 기준**
- [ ] 앱 오류 로컬 파일 기록
- [ ] 설정 → About에서 "로그 파일 열기" 버튼
- [ ] PTY 비정상 종료 원인 코드 (exit code) 세션 상세에 표시

---

#### F-M7-05. 시작 성능 최적화

**배경**  
Electron 앱 특성상 첫 시작이 느릴 수 있다. Superset은 스플래시 스크린 + 지연 로딩으로 체감 속도를 개선한다.

**스펙**
- 스플래시 스크린 (로고 + 로딩 바)
- React 컴포넌트 코드 스플리팅 (lazy import)
- DB 초기화와 렌더러 로딩 병렬화

**수용 기준**
- [ ] 스플래시 스크린 → 메인 UI 전환 시 기존 대비 50% 이상 체감 개선
- [ ] DevTools Performance 기준 LCP < 2s

---

### M8 — UX 폴리시 & 온보딩 (`🟡 P2`)

> 첫 사용자가 막힘 없이 첫 에이전트를 실행할 수 있는 경험을 만든다.

#### F-M8-01. 온보딩 위자드

**배경**  
신규 사용자가 앱 설치 후 "무엇을 해야 하지?"에서 막힌다.

**스펙**
- 첫 실행 시 3단계 위자드:
  1. 에이전트 선택 (Claude Code / Codex / Gemini)
  2. 레포지토리 추가 (폴더 선택 or 클론)
  3. 첫 세션 생성 (워크스페이스 자동 생성)
- 이후 "다시 보지 않기" 체크

**수용 기준**
- [ ] 3단계 위자드 완료 후 세션 탭 자동 열림
- [ ] 언제든 설정에서 온보딩 재시작 가능
- [ ] 10분 이내에 첫 에이전트 실행 가능

---

#### F-M8-02. 빈 상태 UI (Empty States)

**배경**  
레포/워크스페이스/세션이 없을 때 사용자를 안내하는 UI가 부족하다.

**스펙**
- 각 빈 상태별 일러스트 + 안내 텍스트 + CTA 버튼:
  - 레포 없음: "레포지토리를 추가하세요" + [+ 추가] 버튼
  - 워크스페이스 없음: "워크스페이스를 생성하세요"
  - 세션 없음: "에이전트 세션을 시작하세요"
  - Git 변경 없음: "깨끗한 워크트리입니다"

**수용 기준**
- [ ] 각 패널별 빈 상태 디자인 적용
- [ ] CTA 버튼 클릭 → 적절한 생성 모달 오픈

---

#### F-M8-03. 툴팁 & 키보드 단축키 힌트

**배경**  
단축키가 있어도 사용자가 발견하지 못한다. Superset의 `HotkeyLabel` 패턴 적용.

**스펙**
- 주요 버튼 hover 시 단축키 표시 (`⌘K`, `⌘G` 등)
- `?` 키 → 단축키 치트시트 오버레이
- 설정 → 단축키 탭에서 커스터마이징

**수용 기준**
- [ ] 주요 버튼 툴팁에 단축키 포함
- [ ] `?` 단축키로 치트시트 표시
- [ ] 단축키 5개 커스터마이징 가능

---

#### F-M8-04. 드래그 앤 드롭 강화

**배경**  
파일 드롭, 패널 리사이즈, 탭 리오더 등 D&D 인터랙션 통합.

**스펙**
- 파일을 터미널에 드롭 → 파일 경로 자동 입력
- TiledLayout 패널 비율 드래그 조절 (현재는 클릭 드래그로만 리사이즈)
- 좌측 사이드바 레포 순서 드래그 리오더

**수용 기준**
- [ ] 파일 드롭 → 터미널에 절대 경로 삽입
- [ ] 사이드바 레포 순서 D&D 리오더 + 재시작 후 유지

---

#### F-M8-05. 테마 & 외관 강화

**배경**  
현재 Dark/Light 2가지만 있음. Superset은 커스텀 테마와 accent 컬러 선택을 지원한다.

**스펙**
- Accent 컬러 커스터마이징 (CSS 변수 `--accent` 동적 변경)
- 내장 테마 추가: Catppuccin / Nord / Gruvbox / One Dark
- 테마 미리보기 (적용 전 hover 프리뷰)

**수용 기준**
- [ ] 설정에서 accent 컬러 피커
- [ ] 4개 추가 테마 제공
- [ ] hover 시 즉시 미리보기

---

#### F-M8-06. 접근성 (A11y) 기본 지원

**배경**  
스크린 리더, 키보드 전용 네비게이션 기본 지원.

**스펙**
- `aria-label`, `role` 속성 주요 인터랙티브 요소에 추가
- 포커스 트랩: 모달 내 Tab 순환
- 대비율: WCAG AA 기준 준수

**수용 기준**
- [ ] 모달 포커스 트랩 동작
- [ ] 주요 버튼 aria-label 추가
- [ ] 텍스트 대비율 4.5:1 이상

---

### M9 — 멀티 윈도우 & 공유 (`🟢 P3`)

#### F-M9-01. 멀티 윈도우 지원

**배경**  
듀얼 모니터에서 각 윈도우로 다른 에이전트 그룹 모니터링.

**스펙**
- `⌘Shift+N` → 새 BrowserWindow (동일 React 앱)
- 윈도우 간 SQLite DB 공유 (이미 구현됨)
- 각 윈도우 독립적 탭 세트

**수용 기준**
- [ ] 새 윈도우에서 독립적 세션 탭 구성
- [ ] 두 윈도우가 동일 세션 상태 실시간 동기화

---

#### F-M9-02. 세션 내보내기 (Export)

**배경**  
에이전트 작업 결과를 공유하거나 아카이빙.

**스펙**
- 세션 전체 출력을 HTML / TXT / JSON으로 내보내기
- 내보내기 옵션: 타임스탬프 포함, ANSI 색상 포함 여부

**수용 기준**
- [ ] 세션 탭 우클릭 → "Export Session"
- [ ] HTML 내보내기 시 터미널 스타일 그대로 보존

---

#### F-M9-03. 설정 프로파일 가져오기/내보내기

**배경**  
팀원들이 동일한 에이전트/MCP 설정을 공유.

**스펙**
- 설정 → "Export Profile" → `.maestro-profile.json`
- `.maestro-profile.json` 가져오기
- 포함 내용: 에이전트 목록, MCP 서버, 테마, 단축키

**수용 기준**
- [ ] 프로파일 JSON 내보내기
- [ ] 가져오기 시 기존 설정과 병합 또는 덮어쓰기 선택

---

#### F-M9-04. 세션 아카이브 & 검색

**배경**  
종료된 세션의 전체 출력을 로컬에 저장하고 나중에 검색.

**스펙**
- 세션 종료 시 출력 전체를 `~/.maestro/sessions/<id>.log`에 저장
- 설정에서 아카이브 자동 저장 ON/OFF
- 커맨드 팔레트에서 "Search Past Sessions" → 내용 검색

**수용 기준**
- [ ] 세션 종료 시 자동 로그 저장
- [ ] 텍스트 검색으로 과거 세션 출력 검색
- [ ] 검색 결과에서 세션 ID / 날짜 표시

---

### M10 — 플러그인 & 확장 (`🟢 P3`)

#### F-M10-01. 플러그인 API 설계

**배경**  
서드파티가 Maestro에 새 에이전트 타입, 패널, 훅을 추가할 수 있는 확장 포인트.

**스펙**
- 플러그인 형태: Node.js 패키지 (`maestro-plugin-*`)
- 플러그인 등록: 설정 → Plugins → 로컬 경로 또는 npm 패키지명
- 확장 포인트: 커스텀 에이전트 타입, 우측 패널 탭, 커맨드 팔레트 항목

**수용 기준**
- [ ] 플러그인 로드 / 언로드 가능
- [ ] 공식 예제 플러그인 1종 제공

---

#### F-M10-02. 커스텀 에이전트 스크립트

**배경**  
Claude / Codex 외에 사용자가 직접 만든 스크립트를 에이전트로 등록.

**스펙**
- 에이전트 설정에서 "Script" 타입 추가 (bash/python 스크립트)
- stdin/stdout 기반 프로토콜로 Maestro와 통신
- 스크립트 에디터 내장 (CodeMirror lite)

**수용 기준**
- [ ] 스크립트 에이전트 등록 + 세션 생성
- [ ] 표준 입출력으로 터미널 연동

---

#### F-M10-03. 테마 커스터마이저 & 공유

**배경**  
사용자가 만든 테마를 내보내고 공유할 수 있는 기반.

**스펙**
- 테마 에디터 (CSS 변수 기반 색상 편집기)
- 테마를 `.maestro-theme.json`으로 내보내기 / 가져오기
- 커뮤니티 테마 갤러리 링크 (GitHub 기반)

**수용 기준**
- [ ] 설정에서 CSS 변수 직접 편집
- [ ] 테마 JSON 내보내기 / 가져오기

---

#### F-M10-04. 텔레메트리 & 분석 (선택적)

**배경**  
기능 사용 패턴 데이터로 제품 개선. 현재 `telemetryEnabled` 토글이 있으나 실제 전송 로직 없음.

**스펙**
- `posthog-js` 연동
- 수집 이벤트: `session_created`, `agent_selected`, `feature_used`
- 옵트인: 설정 토글로 즉시 on/off
- 전송 데이터 목록 UI에 명시

**수용 기준**
- [ ] 옵트인 ON 시 이벤트 전송
- [ ] 설정에서 수집 항목 확인 가능
- [ ] PII(개인식별정보) 미포함 보장

---

## 4. 기능 우선순위 매트릭스

| 기능 | M# | 우선순위 | 난이도 | 임팩트 | Superset 격차 |
|------|-----|---------|--------|--------|--------------|
| 터미널 내 검색 | M2 | 🔴 P0 | 낮음 | 높음 | ✅ Superset 있음 |
| 스크롤 동작 개선 | M2 | 🔴 P0 | 낮음 | 높음 | ✅ Superset 있음 |
| 세션 이름 변경 | M2 | 🔴 P0 | 낮음 | 높음 | ✅ Superset 있음 |
| 브로드캐스트 모드 UI | M2 | 🔴 P0 | 낮음 | 높음 | ✅ Superset 있음 |
| Commit 히스토리 | M1 | 🔴 P0 | 중간 | 높음 | ✅ Superset 있음 |
| Stash 관리 | M1 | 🔴 P0 | 낮음 | 높음 | ✅ Superset 있음 |
| 세션 비용 추적 | M3 | 🟠 P1 | 중간 | 높음 | ❌ Maestro 차별 |
| 작업 진행률 감지 | M3 | 🟠 P1 | 중간 | 높음 | ❌ Maestro 차별 |
| 에이전트 완료 감지 | M3 | 🟠 P1 | 낮음 | 높음 | ❌ Maestro 차별 |
| 병렬 제어판 강화 | M4 | 🟠 P1 | 중간 | 높음 | ✅ Superset 있음 |
| 에이전트 프리셋 | M4 | 🟠 P1 | 중간 | 높음 | ✅ Superset 있음 |
| Git Reset/Revert | M1 | 🟠 P1 | 중간 | 높음 | ✅ Superset 있음 |
| Fetch + 원격 추적 | M1 | 🟠 P1 | 낮음 | 높음 | ✅ Superset 있음 |
| 온보딩 위자드 | M8 | 🟠 P1 | 중간 | 높음 | ✅ Superset 있음 |
| 빈 상태 UI | M8 | 🟠 P1 | 낮음 | 중간 | ✅ Superset 있음 |
| 워크스페이스 템플릿 | M5 | 🟡 P2 | 중간 | 중간 | ❌ Maestro 차별 |
| 딥링크 확장 | M6 | 🟡 P2 | 낮음 | 중간 | ✅ Superset 있음 |
| 웹훅 | M6 | 🟡 P2 | 중간 | 중간 | ❌ Maestro 차별 |
| 프로세스 메트릭 UI | M7 | 🟡 P2 | 낮음 | 중간 | ✅ Superset 있음 |
| 탭 D&D 리오더 | M2 | 🟡 P2 | 중간 | 중간 | ✅ Superset 있음 |
| 터미널 테마 | M2 | 🟡 P2 | 낮음 | 낮음 | ✅ Superset 있음 |
| 멀티 윈도우 | M9 | 🟢 P3 | 높음 | 중간 | ✅ Superset 있음 |
| 세션 내보내기 | M9 | 🟢 P3 | 낮음 | 낮음 | ✅ Superset 있음 |
| 플러그인 API | M10 | 🟢 P3 | 높음 | 낮음 | ❌ Maestro 차별 |

---

## 5. 마일스톤 실행 순서 & 의존성

```
M1 (Git 심화) ──────────────────────────┐
M2 (터미널 UX) ──────────────┐          │
                              ▼          ▼
                         M4 (오케스트레이션) ← M3 (AI 인텔리전스)
                              │
              ┌───────────────┼────────────────┐
              ▼               ▼                ▼
         M5 (워크스페이스)  M7 (성능)     M8 (UX 폴리시)
              │               │
              └───────┬───────┘
                      ▼
                 M6 (원격 제어 & API)
                      │
              ┌───────┴───────┐
              ▼               ▼
         M9 (공유)       M10 (플러그인)
```

---

## 6. M1 & M2 즉시 실행 계획 (Quick Wins)

> 난이도 낮음 + 임팩트 높음 항목을 최우선으로 실행한다.

### Quick Wins (1~2일 단위)

| 순서 | 기능 | 예상 시간 |
|------|------|---------|
| 1 | 스크롤 동작 개선 (wasAtBottom 패턴) | 2시간 |
| 2 | 세션 이름 변경 (탭 더블클릭) | 4시간 |
| 3 | Fetch + ahead/behind 표시 | 6시간 |
| 4 | Stash 기본 (push/pop/list) | 8시간 |
| 5 | 브로드캐스트 모드 UI 연결 | 6시간 |
| 6 | 에이전트 완료 감지 카드 | 4시간 |
| 7 | Git Reset 버튼 | 4시간 |
| 8 | 빈 상태 UI (각 패널) | 6시간 |

---

## 7. 아키텍처 영향도

### 신규 DB 스키마

```sql
-- M3: 비용 추적
CREATE TABLE session_costs (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id),
  input_tokens INTEGER DEFAULT 0,
  output_tokens INTEGER DEFAULT 0,
  cost_usd REAL DEFAULT 0,
  recorded_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- M2: 탭 핀 / 즐겨찾기
ALTER TABLE sessions ADD COLUMN is_pinned INTEGER DEFAULT 0;
ALTER TABLE sessions ADD COLUMN is_favorite INTEGER DEFAULT 0;
ALTER TABLE sessions ADD COLUMN display_order INTEGER DEFAULT 0;

-- M1: Git 작업 이력
CREATE TABLE git_operations (
  id TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  operation TEXT NOT NULL, -- 'commit'|'push'|'merge'|'stash'|...
  result TEXT,             -- 'success'|'failure'
  metadata TEXT,           -- JSON
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- M5: 워크스페이스 템플릿
CREATE TABLE workspace_templates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  agent_id TEXT,
  setup_script TEXT,
  env_vars TEXT,  -- JSON
  branch_prefix TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- M6: 웹훅
CREATE TABLE webhooks (
  id TEXT PRIMARY KEY,
  url TEXT NOT NULL,
  events TEXT NOT NULL,  -- JSON array
  enabled INTEGER DEFAULT 1,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
```

### 신규 tRPC Router

```
appRouter
├── session (기존 + M2 rename, pin, favorite)
├── git (기존 + M1 log, stash, fetch, reset, blame, tag, cherry-pick)
├── cost (신규 M3: list, total, threshold)
├── pipeline (신규 M4: create, run, status)
├── template (신규 M5: list, create, apply, delete)
├── webhook (신규 M6: list, create, test, delete)
└── plugin (신규 M10: list, enable, disable)
```
