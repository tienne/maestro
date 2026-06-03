# Superset 분석 — 전체 요약

> 분석 기준: `superset-sh/superset` main 브랜치 (2026-05-31)

## TL;DR

Superset은 **"AI 에이전트 오케스트레이터"** Electron 데스크탑 앱이다. Claude Code, Gemini CLI, OpenAI Codex CLI 등 CLI 기반 에이전트를 git worktree 격리 환경에서 병렬로 실행하고, 단일 대시보드에서 모니터링한다.

Maestro와 비교하면:
- **구조적 유사점**: Electron + tRPC IPC + Zustand + node-pty + Drizzle ORM
- **핵심 차이점**: Superset은 사용자가 직접 AI CLI를 사용하고 Superset이 그것을 감싸는 방식. Maestro는 자체 AI 오케스트레이션 레이어를 가진다.

---

## 기술 스택

| 레이어 | 기술 |
|--------|------|
| **런타임** | Electron 40.x + electron-vite + Bun |
| **프론트엔드** | React 19 + TanStack Router + Tailwind CSS v4 |
| **IPC** | tRPC v11 (trpc-electron 0.1.2) |
| **상태 관리** | Zustand 5 + TanStack DB (Electric SQL 기반) |
| **데이터 동기화** | ElectricSQL (Postgres → 클라이언트 실시간 동기화) |
| **로컬 DB** | better-sqlite3 + Drizzle ORM |
| **터미널** | @xterm/xterm 6 + node-pty 1.1.0 |
| **에디터** | CodeMirror 6 (다중 언어 지원) |
| **AI** | @ai-sdk/anthropic + @ai-sdk/openai + mastracode |
| **클라우드 스트리밍** | @durable-streams/client (자체 스트림 인프라) |
| **인증** | better-auth 1.6.5 |
| **빌드** | Turborepo + electron-builder |
| **모노레포** | 패키지 20개 (packages/), 앱 3개 (desktop/api/admin) |

---

## 핵심 차별점

### 1. 다중 프로세스 아키텍처 (4계층)
```
Electron Main
├── host-service (조직당 1개, Hono HTTP 서버)
├── pty-daemon (장수 프로세스, PTY 소유)
├── terminal-host (레거시, 유닉스 소켓)
└── git-task-worker (Worker Thread)
```
PTY를 별도 daemon 프로세스에 위임해서 앱 재시작해도 터미널 세션 유지.

### 2. 워크트리 격리
각 에이전트 작업은 `git worktree`로 격리된 별도 브랜치에서 실행. 충돌 없이 병렬 작업 가능.

### 3. Electric SQL 실시간 동기화
Postgres → Electric → TanStack DB 컬렉션으로 optimistic update 구현. 오프라인 퍼스트 X, 온라인 optimistic.

### 4. 에이전트 훅 시스템
Claude Code의 Start/Stop/PermissionRequest 훅을 캡처해서 UI 상태 인디케이터에 반영. tRPC 구독으로 렌더러에 실시간 전달.

### 5. Chat 런타임은 mastracode
채팅 에이전트는 CLI가 아니라 자체 AI 런타임(`mastracode` 패키지, Mastra AI 기반). 스트리밍은 `@durable-streams` 인프라 경유.

---

## 분석 문서 목록

| 파일 | 내용 |
|------|------|
| `architecture.md` | 전체 아키텍처, 폴더 구조, 레이어, 데이터 흐름 |
| `ai-communication.md` | AI/채팅 통신 구조 (가장 중요) |
| `terminal.md` | 터미널 세션 관리 (PTY daemon, 소켓 프로토콜) |
| `state-management.md` | 상태 관리 패턴 (Zustand, TanStack DB, Electric) |

---

## Maestro 개발에 바로 쓸 수 있는 인사이트

1. **pty-daemon 분리**: PTY를 앱과 분리된 long-lived daemon으로 운영하면 앱 재시작에도 터미널 세션 유지 가능
2. **tRPC subscription + observable 패턴**: 터미널 스트림, 에이전트 라이프사이클 이벤트 모두 tRPC `observable`로 처리
3. **exit은 subscription 완료가 아님**: `emit.complete()` 호출하면 @trpc/react-query가 재구독 안 함 → `emit.next({ type: "exit" })`로 처리
4. **150ms debounce for CWD**: 터미널 CWD 업데이트마다 Zustand store 업데이트 → 모든 터미널 리렌더. 150ms debounce 필수
5. **세션 granular selector**: `s.panes[paneId]` 선택, 전체 panes 객체 prop 금지
6. **pending row as transport**: 워크스페이스 생성 의도를 pending row에 담아 creator → consumer 간 durable bus로 활용
