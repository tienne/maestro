# Maestro PRD — Superset 비교 기반 기능 보강 계획

> **기준일:** 2026-04-10  
> **참조:** [superset-sh/superset](https://github.com/superset-sh/superset) — AI 에이전트 오케스트레이션 데스크톱 앱 (9.2K ★)  
> **작성 목적:** Superset 대비 부족한 기능을 파악하고, 동일한 구현 방식을 Maestro에 적용하기 위한 PRD

---

## 1. 현재 구현 현황 요약

| 영역 | Maestro | Superset |
|------|---------|----------|
| 멀티탭 터미널 (XTerminal + WebGL) | ✅ | ✅ |
| Git 패널 (Diff/Commit/Merge) | ✅ | ✅ |
| 에이전트 관리 (CRUD) | ✅ | ✅ |
| MCP 서버 관리 | ✅ | ✅ |
| IDE 딥링킹 (4종) | ✅ | ✅ |
| 워크스페이스 / 세션 격리 | ✅ | ✅ |
| 키보드 단축키 시스템 | ❌ | ✅ |
| 알림 시스템 (Toast) | ❌ | ✅ |
| 앱 자동 업데이트 | ❌ | ✅ |
| 파일 탐색기 | ❌ | ✅ |
| AI 출력 마크다운 렌더링 | ❌ | ✅ |
| 에이전트 진행 상태 대시보드 | ❌ | ✅ |
| 글로벌 검색 | ❌ | ✅ |
| 에러 바운더리 / 크래시 복구 | ❌ | ✅ |
| 커스텀 딥링크 프로토콜 | ❌ | ✅ |
| Zustand persistence | 부분 | ✅ |
| 드래그 앤 드롭 패널 리사이즈 | 부분 | ✅ |
| 테마 시스템 (Light/Dark/커스텀) | 부분 | ✅ |

---

## 2. 기능별 PRD

---

### 🔴 P0 — 생산 안정성

---

#### F-01. 알림 시스템 (Toast Notifications)

**배경**  
Superset은 `ThemedToaster` + `UpdateToast` 컴포넌트로 앱 전반의 상태 변화를 사용자에게 즉시 알린다. 현재 Maestro는 에러/성공 피드백이 모달 인라인 메시지에 국한되어 있어 UX가 단편적이다.

**구현 방식 (Superset 참조)**
- Superset: `sonner` 라이브러리 기반 토스트 스택, `ThemedToaster` 컴포넌트에서 앱 테마(Dark/Light) 동기화
- 적용 위치: `AppShell` 최상위에 `<Toaster />` 마운트, 각 tRPC mutation의 `onSuccess`/`onError`에서 호출

**Maestro 적용 스펙**

| 항목 | 내용 |
|------|------|
| 라이브러리 | `sonner` |
| 트리거 시점 | 세션 시작/종료, 커밋, 푸시, 워크스페이스 생성/삭제, MCP 연결 변경, 에러 |
| 종류 | `success` / `error` / `info` / `loading` |
| 위치 | 우측 하단, 최대 3개 스택 |
| 테마 | 앱 테마(Dark/Light) 연동 |

**수용 기준**
- [ ] 세션 launch 성공 시 "세션 시작됨" 토스트 표시
- [ ] tRPC mutation error 시 에러 메시지 토스트 표시
- [ ] Git push 성공/실패 피드백 토스트 표시
- [ ] 기존 모달 인라인 에러 메시지와 병행 유지 (제거 금지)

---

#### F-02. 앱 자동 업데이트 (Auto Updater)

**배경**  
Superset은 `UpdateToast` 컴포넌트로 신버전 감지 시 비침습적 알림을 띄우고, 사용자 클릭으로 재시작·업데이트를 처리한다. Maestro는 현재 수동 업데이트만 가능하다.

**구현 방식 (Superset 참조)**
- Superset: `electron-updater` + GitHub Releases 연동, `autoUpdater.checkForUpdatesAndNotify()` 방식
- 업데이트 감지 → `UpdateToast` 배너 표시 → 사용자 "지금 재시작" 클릭 → `autoUpdater.quitAndInstall()`

**Maestro 적용 스펙**

| 항목 | 내용 |
|------|------|
| 라이브러리 | `electron-updater` |
| 업데이트 채널 | GitHub Releases (stable) |
| 감지 주기 | 앱 시작 시 + 4시간마다 |
| UI | 상단 고정 배너 (닫기 가능) |
| 동작 | "지금 재시작" / "나중에" 선택 |

**수용 기준**
- [ ] 앱 시작 시 백그라운드 업데이트 체크
- [ ] 신버전 발견 시 상단 배너 표시 (터미널 사용 방해 없음)
- [ ] "지금 재시작" 클릭 시 업데이트 후 재실행
- [ ] 업데이트 중 세션 상태 보존 (scrollback DB 활용)

---

#### F-03. 에러 바운더리 & 크래시 복구

**배경**  
Superset은 `BootErrorBoundary` 컴포넌트로 렌더러 크래시 시 앱 전체가 흰 화면으로 멈추는 현상을 방지하고, 에러 상세와 재시도 버튼을 제공한다. 현재 Maestro는 React 에러 바운더리가 없다.

**구현 방식 (Superset 참조)**
- Superset: `class ErrorBoundary extends React.Component` + `componentDidCatch` 에서 Sentry 전송
- `BootErrorBoundary`: 앱 최상위 감싸기, 에러 발생 시 에러 정보 + "앱 재시작" 버튼 렌더

**Maestro 적용 스펙**

| 항목 | 내용 |
|------|------|
| 구현 방식 | `react-error-boundary` 라이브러리 |
| 적용 범위 | `AppShell` 전체 + 각 패널(터미널, Git, 사이드바) 개별 바운더리 |
| 폴백 UI | 에러 메시지 + "새로고침" / "앱 재시작" 버튼 |
| 에러 리포트 | 콘솔 출력 + 로컬 파일 로그 (`~/.maestro/error.log`) |

**수용 기준**
- [ ] React 렌더링 오류 시 전체 흰 화면 대신 에러 UI 표시
- [ ] 각 패널(터미널/Git/사이드바) 개별 바운더리로 한 패널 크래시가 전체로 전파되지 않음
- [ ] "새로고침" 버튼으로 문제 패널만 리마운트 가능

---

#### F-04. Zustand Persistence (설정 영속성)

**배경**  
Superset은 Zustand `persistence` 미들웨어로 테마, 사이드바 너비, 탭 상태 등 UI 설정을 `electron-store` 또는 `localStorage`에 자동 저장한다. Maestro는 일부 상태만 DB에 수동 저장하고 있어 재시작 시 설정이 초기화된다.

**구현 방식 (Superset 참조)**
- Superset: `zustand/middleware`의 `persist` + `createJSONStorage(() => localStorage)` 조합
- 선택적 저장: `partialize` 옵션으로 저장할 slice만 지정

**Maestro 적용 스펙**

| 스토어 | 저장할 상태 |
|--------|------------|
| `uiStore` | 사이드바 너비, 우측 패널 탭, 분할 레이아웃 |
| `settingsStore` (신규) | 테마, 폰트 크기, 단축키 커스텀 |
| `agentStore` | 마지막 선택 에이전트 ID |

**수용 기준**
- [ ] 앱 재시작 후 사이드바 너비 복원
- [ ] 테마 설정 재시작 후 유지
- [ ] 분할 레이아웃 상태 재시작 후 유지

---

### 🟠 P1 — UX 핵심 개선

---

#### F-05. 키보드 단축키 시스템

**배경**  
Superset은 `HotkeyMenuShortcut` 컴포넌트와 `/renderer/hotkeys` 모듈로 전역 단축키를 관리하며, UI 어디서든 단축키를 확인할 수 있다. 개발자 도구 특성상 키보드 중심 조작은 필수 생산성 요소다.

**구현 방식 (Superset 참조)**
- Superset: `hotkeys-js` 또는 `@github/hotkey` 라이브러리
- `useHotkeys` 커스텀 훅으로 컴포넌트 단위 등록
- 단축키 충돌 방지: IME 입력 중(`isComposing`) 비활성화
- `HotkeyMenuShortcut` 컴포넌트: `⌘K` 같은 표기를 플랫폼별 자동 변환

**Maestro 적용 스펙**

| 단축키 | 동작 |
|--------|------|
| `⌘T` | 새 세션 생성 |
| `⌘W` | 현재 세션 닫기 |
| `⌘1~9` | 세션 탭 전환 |
| `⌘\` | 터미널 분할 (vertical) |
| `⌘Shift\` | 터미널 분할 (horizontal) |
| `⌘K` | 커맨드 팔레트 열기 |
| `⌘B` | 좌측 사이드바 토글 |
| `⌘Shift\`` | 새 세션 브로드캐스트 모드 토글 |
| `⌘G` | Git 패널 포커스 |
| `Esc` | 모달 닫기 |

**수용 기준**
- [ ] 위 단축키 전부 동작
- [ ] 터미널 포커스 중 에이전트 입력과 충돌 없음 (xterm 내부 단축키 우선)
- [ ] IME 조합 중 단축키 비활성화
- [ ] 단축키 목록 UI (Help 패널 또는 `⌘/`)

---

#### F-06. 커맨드 팔레트

**배경**  
Superset의 `HotkeyMenuShortcut` 시스템 확장선으로, VS Code 스타일의 `⌘K` 커맨드 팔레트는 모든 액션에 키보드만으로 접근할 수 있게 한다. 에이전트와 대화하며 앱을 조작하는 워크플로우에 필수적이다.

**구현 방식 (Superset 참조)**
- Superset: `cmdk` 라이브러리 기반 커맨드 메뉴
- 전역 `⌘K` 단축키 → 오버레이 팔레트 표시
- 최근 사용 명령 우선 정렬

**Maestro 적용 스펙**

| 항목 | 내용 |
|------|------|
| 라이브러리 | `cmdk` |
| 단축키 | `⌘K` |
| 검색 대상 | 세션, 워크스페이스, 에이전트, Git 액션, 설정 |
| 기능 그룹 | Sessions / Workspaces / Git / Settings / Agents |

**수용 기준**
- [ ] `⌘K`로 팔레트 열기/닫기
- [ ] 텍스트 입력으로 명령 퍼지 검색
- [ ] 엔터로 선택 실행
- [ ] 최근 사용 5개 상단 고정

---

#### F-07. 파일 탐색기 패널

**배경**  
Superset은 `file-explorer` Zustand 스토어를 통해 워크스페이스 디렉토리를 탐색하는 파일 트리를 제공한다. 에이전트가 수정한 파일을 즉시 확인하고 열 수 있어야 하며, Git diff와 파일 탐색이 통합되어야 한다.

**구현 방식 (Superset 참조)**
- Superset: `file-explorer` Zustand 스토어 + 재귀적 `FolderNode`/`FileNode` 컴포넌트
- tRPC `git.readDir` 프로시저로 디렉토리 읽기 (이미 Maestro에 존재)
- 파일 클릭 → diff 조회 또는 외부 에디터로 열기

**Maestro 적용 스펙**

| 항목 | 내용 |
|------|------|
| 위치 | 우측 사이드바 탭 (Files 탭, 이미 존재) |
| 데이터 소스 | `trpc.git.readDir` (이미 구현됨) |
| 트리 깊이 | 초기 2단계, 클릭으로 확장 |
| 파일 액션 | Git diff 보기 / 외부 에디터로 열기 |
| 변경 파일 표시 | git status 기반 색상 마킹 (M/A/D) |

**수용 기준**
- [ ] 워크스페이스 루트 디렉토리 트리 표시
- [ ] 변경된 파일 색상 마킹 (수정/추가/삭제)
- [ ] 파일 클릭 → Git diff 패널 연동
- [ ] 우클릭 컨텍스트 메뉴 (IDE로 열기)

---

#### F-08. 마크다운 렌더러 패널

**배경**  
Superset은 `MarkdownRenderer` + `MarkdownPreferences` Zustand 스토어로 AI 에이전트 출력(README, 설계 문서, 에이전트 응답)을 마크다운으로 렌더링한다. 터미널 raw 출력 외에 구조화된 콘텐츠를 볼 수 있는 뷰가 필요하다.

**구현 방식 (Superset 참조)**
- Superset: `react-markdown` + `rehype-highlight` + `remark-gfm`
- 타일식 레이아웃의 별도 패널로 마운트
- GFM(GitHub Flavored Markdown) 지원: 테이블, 체크리스트, 코드 블록 하이라이팅

**Maestro 적용 스펙**

| 항목 | 내용 |
|------|------|
| 라이브러리 | `react-markdown` + `rehype-highlight` + `remark-gfm` |
| 위치 | TiledLayout 내 새 패널 타입 (`type: 'markdown'`) |
| 콘텐츠 소스 | 지정 파일 경로 읽기 / 에이전트 출력 스트림 파이프 |
| 기능 | 코드 블록 복사 버튼, 앵커 링크, 이미지 렌더링 |

**수용 기준**
- [ ] `.md` 파일 경로 입력 → 마크다운 렌더링
- [ ] 코드 블록 신택스 하이라이팅 (앱 테마 연동)
- [ ] GFM 체크리스트, 테이블 지원
- [ ] 코드 블록 클립보드 복사 버튼

---

#### F-09. 에이전트 진행 상태 대시보드

**배경**  
Superset의 핵심 가치는 여러 에이전트를 병렬로 돌리면서 각 진행 상황을 한눈에 파악하는 것이다. 현재 Maestro는 탭별 상태 dot와 세션 카운터만 있어, 병렬 작업 모니터링이 어렵다.

**구현 방식 (Superset 참조)**
- Superset: 워크스페이스 카드 뷰로 각 에이전트 상태(Running / Ready for Review / Error) 표시
- 에이전트별 마지막 출력 미리보기 (터미널 stdout 마지막 3줄)
- 상태별 필터링 + 전체 현황 카운터

**Maestro 적용 스펙**

| 항목 | 내용 |
|------|------|
| 위치 | 좌측 사이드바 상단 요약 카드 또는 별도 대시보드 뷰 |
| 표시 정보 | 에이전트명, 세션 상태, 마지막 활동 시간, 출력 미리보기 |
| 상태 분류 | `Running` / `Waiting` / `Ready for Review` / `Error` / `Stopped` |
| 액션 | 카드 클릭 → 해당 세션 탭 포커스 |

**수용 기준**
- [ ] 전체 세션 상태 요약 카운터 (Running N / Review N / Error N)
- [ ] 각 세션 카드에 마지막 터미널 출력 2줄 미리보기
- [ ] 상태별 색상 구분
- [ ] 카드 클릭 시 해당 세션 탭으로 포커스 이동

---

### 🟡 P2 — 개발자 경험

---

#### F-10. 커스텀 딥링크 프로토콜 (`maestro://`)

**배경**  
Superset은 `superset://` 프로토콜로 외부(터미널, 브라우저, 다른 앱)에서 앱을 제어할 수 있다. 현재 Maestro의 HTTP REST API(`/api/remote/*`)와 결합하면 강력한 자동화가 가능해진다.

**구현 방식 (Superset 참조)**
- Superset: `app.setAsDefaultProtocolClient('superset')` → `app.on('open-url')` 핸들러
- URL 파싱: `new URL(url)`로 pathname/searchParams 추출
- 경로별 라우팅: `/auth/callback`, `/workspace/:id`, `/session/:id`

**Maestro 적용 스펙**

| URL 패턴 | 동작 |
|----------|------|
| `maestro://session/:id` | 해당 세션 탭 포커스 |
| `maestro://session/new?workspace=:id&agent=:id` | 새 세션 생성 |
| `maestro://workspace/:id` | 워크스페이스 활성화 |
| `maestro://broadcast?text=:text` | 브로드캐스트 입력 전송 |

**수용 기준**
- [ ] `maestro://` 프로토콜 macOS/Windows 등록
- [ ] URL 파싱 → 앱 포그라운드 전환
- [ ] 위 4가지 URL 패턴 처리
- [ ] 인증 없이 로컬에서만 동작 (localhost 한정)

---

#### F-11. 글로벌 세션 검색

**배경**  
세션, 워크스페이스, 에이전트가 많아질수록 탐색이 어려워진다. Superset의 커맨드 팔레트 내 검색과 별도로, 세션 목록 자체를 필터링하는 인라인 검색이 필요하다.

**구현 방식**
- 탭바 위 검색 입력 (포커스 단축키: `⌘F`)
- 세션 이름 / 워크스페이스 이름 / 에이전트 이름 퍼지 검색
- 검색 결과 하이라이팅

**Maestro 적용 스펙**

| 항목 | 내용 |
|------|------|
| 위치 | 탭바 우측 검색 아이콘 클릭 또는 `⌘F` |
| 검색 대상 | 세션 이름, 워크스페이스 이름, 에이전트 종류 |
| 라이브러리 | `fuse.js` (퍼지 검색) |

**수용 기준**
- [ ] 검색 중 탭 목록이 필터링됨
- [ ] 오타 허용 퍼지 검색
- [ ] `Esc`로 검색 닫기 및 전체 목록 복원

---

#### F-12. 에이전트 리소스 모니터링

**배경**  
Superset의 `macos-process-metrics` 패키지는 각 에이전트 프로세스의 CPU/메모리 사용량을 수집한다. 장시간 병렬 실행 시 리소스 과부하를 조기에 감지해야 한다.

**구현 방식 (Superset 참조)**
- Superset: macOS `proc_pidinfo` 시스템 콜 → 네이티브 애드온 (`packages/macos-process-metrics`)
- PID 기반 CPU/메모리 추적
- tRPC subscription으로 실시간 스트리밍

**Maestro 적용 스펙**

| 항목 | 내용 |
|------|------|
| 구현 방식 | `pidusage` npm 패키지 (크로스 플랫폼) |
| 수집 주기 | 5초마다 폴링 |
| 표시 위치 | 세션 탭 툴팁 또는 대시보드 카드 |
| 메트릭 | CPU %, 메모리 MB |

**수용 기준**
- [ ] 각 세션 프로세스의 CPU/메모리 수집
- [ ] 세션 탭 hover 시 툴팁으로 표시
- [ ] CPU 80% 초과 시 탭에 경고 표시

---

#### F-13. 설정 파일 미리보기 (Config Preview)

**배경**  
Superset의 `ConfigFilePreview` 컴포넌트는 `.superset/config.json` 내용을 UI 내에서 직접 확인·편집할 수 있게 한다. Maestro에서는 에이전트 설정(`CLAUDE.md`, `.env`, MCP 설정)을 앱 내에서 바로 편집할 수 있으면 워크플로우가 단순해진다.

**Maestro 적용 스펙**

| 파일 | 설명 |
|------|------|
| `CLAUDE.md` | Claude Code 지시 파일 |
| `.env` | 워크스페이스 환경 변수 |
| `mcp.json` / `.mcp.json` | MCP 서버 설정 |

**수용 기준**
- [ ] 워크스페이스 루트의 위 파일 목록 표시
- [ ] 클릭 시 모달에서 읽기 전용 프리뷰
- [ ] "에디터로 열기" 버튼으로 IDE 딥링킹 연계

---

### 🟢 P3 — 확장 기능

---

#### F-14. 멀티 윈도우 지원

**배경**  
Superset은 여러 Electron 윈도우를 열어 각 윈도우에서 다른 워크스페이스를 병렬로 모니터링할 수 있다. 듀얼 모니터 환경에서 에이전트 작업을 분리하여 관찰하는 데 유용하다.

**구현 방식 (Superset 참조)**
- Superset: `windows/` 모듈에서 `BrowserWindow` 인스턴스 풀 관리
- 새 윈도우: `new BrowserWindow()` + 같은 renderer HTML로 라우팅
- 윈도우 간 상태 공유: `electron-store` 또는 메인 프로세스 중재

**Maestro 적용 스펙**

| 항목 | 내용 |
|------|------|
| 단축키 | `⌘Shift N` — 새 윈도우 열기 |
| 상태 공유 | DB (SQLite)를 통한 공유 (이미 구현됨) |
| 윈도우 독립성 | 각 윈도우가 다른 워크스페이스 포커스 가능 |

**수용 기준**
- [ ] 새 윈도우에서 독립적인 세션 탭 구성 가능
- [ ] 두 윈도우가 같은 DB를 공유하여 세션 상태 동기화
- [ ] 윈도우 닫기 시 세션 유지 (탭만 닫힘)

---

#### F-15. 링톤 / 알림음 시스템

**배경**  
Superset은 `ringtone` Zustand 스토어로 에이전트 작업 완료 시 사운드 알림을 제공한다. 병렬 에이전트를 백그라운드로 두고 다른 작업 중일 때 완료 신호로 유용하다.

**구현 방식 (Superset 참조)**
- Superset: `new Audio('/sounds/notification.mp3').play()` 방식
- 에이전트 `exit` 이벤트 감지 → 사운드 재생
- 설정에서 ON/OFF 토글

**Maestro 적용 스펙**

| 이벤트 | 사운드 |
|--------|--------|
| 에이전트 종료 (성공) | 짧은 완료음 |
| 에이전트 에러 | 에러음 |
| 사용자 멘션 (`@` 감지) | 알림음 |

**수용 기준**
- [ ] 에이전트 세션 종료 시 알림음 재생
- [ ] 설정에서 사운드 ON/OFF 토글
- [ ] 앱이 백그라운드일 때도 macOS 알림 센터 연동

---

#### F-16. 분석 / 텔레메트리 (선택적)

**배경**  
Superset은 PostHog으로 기능 사용 패턴을 수집한다. 에이전트별 사용 빈도, 세션 시간, 자주 사용하는 워크플로우를 파악해 제품 개선에 활용한다.

**구현 방식 (Superset 참조)**
- Superset: `PostHogUserIdentifier` 컴포넌트 + `posthog-js` SDK
- 옵트인 방식: 첫 실행 시 동의 여부 확인
- 이벤트: `session_created`, `agent_selected`, `merge_completed` 등

**Maestro 적용 스펙**

| 항목 | 내용 |
|------|------|
| 라이브러리 | `posthog-js` 또는 자체 수집 서버 |
| 수집 데이터 | 기능 사용 이벤트 (PII 제외) |
| 옵트인 | 설정 → "익명 사용 통계 전송" 체크박스 |

**수용 기준**
- [ ] 첫 실행 시 동의 화면 표시
- [ ] 동의 취소 시 즉시 중단
- [ ] 수집 데이터 목록 UI에 명시

---

## 3. 구현 우선순위 매트릭스

| 기능 | 우선순위 | 구현 난이도 | 사용자 임팩트 | 라이브러리 |
|------|---------|-----------|-------------|---------|
| F-01 Toast 알림 | 🔴 P0 | 낮음 | 높음 | `sonner` |
| F-02 자동 업데이트 | 🔴 P0 | 중간 | 높음 | `electron-updater` |
| F-03 에러 바운더리 | 🔴 P0 | 낮음 | 높음 | `react-error-boundary` |
| F-04 Zustand Persistence | 🔴 P0 | 낮음 | 중간 | `zustand/middleware` |
| F-05 키보드 단축키 | 🟠 P1 | 중간 | 높음 | `hotkeys-js` |
| F-06 커맨드 팔레트 | 🟠 P1 | 중간 | 높음 | `cmdk` |
| F-07 파일 탐색기 | 🟠 P1 | 중간 | 중간 | (네이티브 tRPC) |
| F-08 마크다운 렌더러 | 🟠 P1 | 낮음 | 중간 | `react-markdown` |
| F-09 에이전트 대시보드 | 🟠 P1 | 높음 | 높음 | (커스텀) |
| F-10 딥링크 프로토콜 | 🟡 P2 | 중간 | 중간 | (Electron 내장) |
| F-11 글로벌 검색 | 🟡 P2 | 낮음 | 중간 | `fuse.js` |
| F-12 리소스 모니터링 | 🟡 P2 | 높음 | 낮음 | `pidusage` |
| F-13 설정 파일 미리보기 | 🟡 P2 | 낮음 | 낮음 | (커스텀) |
| F-14 멀티 윈도우 | 🟢 P3 | 높음 | 중간 | (Electron 내장) |
| F-15 알림음 | 🟢 P3 | 낮음 | 낮음 | (Web Audio API) |
| F-16 텔레메트리 | 🟢 P3 | 중간 | 낮음 | `posthog-js` |

---

## 4. 데이터 흐름 아키텍처 (신규 기능)

```
Electron Main Process
├─ auto-updater.ts          ← F-02: 업데이트 체크 + 설치
├─ protocol-handler.ts      ← F-10: maestro:// URL 처리
└─ process-monitor.ts       ← F-12: pidusage 폴링

Renderer Process (React)
├─ providers/
│  ├─ ToastProvider.tsx     ← F-01: <Toaster /> 루트 마운트
│  ├─ ErrorBoundary.tsx     ← F-03: 전역 + 패널별 바운더리
│  └─ HotkeyProvider.tsx    ← F-05: 전역 단축키 컨텍스트
│
├─ components/
│  ├─ CommandPalette.tsx    ← F-06: cmdk 기반 팔레트
│  ├─ FileExplorer.tsx      ← F-07: 재귀 파일 트리
│  ├─ MarkdownPanel.tsx     ← F-08: react-markdown 패널
│  ├─ AgentDashboard.tsx    ← F-09: 병렬 에이전트 현황
│  └─ UpdateBanner.tsx      ← F-02: 업데이트 알림 배너
│
└─ store/
   ├─ settingsStore.ts      ← F-04: persist 미들웨어 적용
   └─ searchStore.ts        ← F-11: 글로벌 검색 상태
```

---

## 5. 마일스톤

| Phase | 기능 | 목표 |
|-------|------|------|
| **M1** | F-01, F-03, F-04 | 기본 안정성 확보 |
| **M2** | F-02, F-05, F-06 | 생산성 단축키 체계 |
| **M3** | F-07, F-08, F-09 | 병렬 에이전트 가시성 |
| **M4** | F-10, F-11, F-13 | 고급 탐색 및 자동화 |
| **M5** | F-12, F-14, F-15, F-16 | 확장 및 최적화 |
