# Superset 전체 아키텍처

## 모노레포 구조

```
superset/
├── apps/
│   ├── desktop/          # Electron 데스크탑 앱 (핵심)
│   ├── api/              # Next.js API 서버 (클라우드)
│   └── admin/            # Next.js 어드민 대시보드
├── packages/
│   ├── auth/             # better-auth 설정
│   ├── chat/             # AI 채팅 런타임 (mastracode 기반)
│   ├── db/               # Drizzle + Postgres 스키마 (클라우드 DB)
│   ├── host-service/     # 워크스페이스 서비스 (Hono HTTP)
│   ├── local-db/         # SQLite 스키마 (로컬 DB)
│   ├── mcp/              # MCP 서버 구현
│   ├── panes/            # 창 레이아웃 관리
│   ├── pty-daemon/       # PTY 소유 장수 프로세스
│   ├── shared/           # 공통 상수/타입
│   ├── trpc/             # 클라우드 tRPC 라우터
│   ├── ui/               # shadcn/ui 기반 UI 컴포넌트
│   └── workspace-client/ # 워크스페이스 API 클라이언트
```

---

## Electron 앱 내부 구조

```
apps/desktop/src/
├── main/                 # Electron Main Process
│   ├── index.ts          # 앱 엔트리포인트 (프로토콜, 딥링크, 생명주기)
│   ├── env.main.ts       # 환경 변수 검증 (Zod)
│   ├── host-service/     # host-service 서브프로세스 엔트리
│   │   └── index.ts      # Hono 서버 시작, relay 연결
│   ├── terminal-host/    # (레거시) PTY daemon 엔트리
│   │   └── index.ts      # 유닉스 소켓 서버, NDJSON 프로토콜
│   ├── pty-daemon/       # pty-daemon 서브프로세스 엔트리
│   │   └── index.ts      # @superset/pty-daemon 패키지 shim
│   ├── git-task-worker.ts # Worker Thread (무거운 git 연산)
│   └── lib/              # 메인 프로세스 유틸리티
│       ├── host-service-coordinator.ts  # 조직별 host-service 관리
│       ├── terminal.ts   # PTY daemon 조율
│       ├── app-state.ts  # 앱 전역 상태 (탭/테마 persist)
│       └── notifications/server.ts  # 에이전트 훅 이벤트 emitter
├── preload/
│   └── index.ts          # contextBridge + exposeElectronTRPC
├── renderer/             # React 렌더러
│   ├── index.tsx         # React 앱 마운트
│   ├── routes/           # TanStack Router 파일 기반 라우팅
│   │   ├── __root.tsx
│   │   ├── _authenticated/   # 인증 필요 레이아웃
│   │   │   ├── layout.tsx    # CollectionsProvider, providers
│   │   │   ├── _dashboard/   # 메인 대시보드 뷰
│   │   │   └── settings/     # 설정 페이지들
│   │   └── sign-in/
│   ├── stores/           # Zustand 스토어들
│   │   ├── tabs/         # 핵심: 탭/페인 상태
│   │   │   ├── store.ts  # useTabsStore (900줄, persisted)
│   │   │   └── useAgentHookListener.ts  # 에이전트 훅 구독
│   │   ├── settings.ts
│   │   └── sidebar-state.ts
│   ├── hotkeys/          # 키보드 단축키 시스템
│   └── lib/
│       ├── electron-trpc.ts  # 렌더러 tRPC 클라이언트
│       └── terminal/     # 터미널 포워딩 유틸
└── lib/
    └── trpc/
        ├── index.ts      # tRPC 라우터 조합 (메인 프로세스)
        └── routers/      # 도메인별 라우터
            ├── terminal/terminal.ts   # PTY 제어
            ├── notifications.ts       # 에이전트 훅 이벤트
            ├── chat-runtime-service/  # AI 채팅 런타임 브릿지
            ├── changes/              # git diff/status
            ├── workspaces/           # 워크스페이스 CRUD
            └── filesystem/           # 파일 읽기/쓰기
```

---

## 4계층 프로세스 아키텍처

```
┌─────────────────────────────────────────────────────────┐
│  Electron Renderer (React)                              │
│  TanStack Router + Zustand + TanStack DB                │
└────────────────┬────────────────────────────────────────┘
                 │ tRPC over IPC (trpc-electron)
┌────────────────▼────────────────────────────────────────┐
│  Electron Main Process                                  │
│  - HostServiceCoordinator (조직별 host-service 관리)    │
│  - AppState (탭/테마 persist)                           │
│  - NotificationsEmitter (에이전트 훅 이벤트)            │
└──────────┬─────────────────────┬────────────────────────┘
           │ child_process.fork  │ Unix Socket (NDJSON)
┌──────────▼──────────┐  ┌──────▼──────────────────────┐
│  host-service        │  │  pty-daemon                  │
│  (조직당 1개)        │  │  (장수 프로세스)             │
│  Hono HTTP on :PORT  │  │  PTY master fd 소유          │
│  - 워크스페이스 CRUD │  │  - 앱 재시작 시에도 생존     │
│  - git 연산          │  │  - 핸드오프 프로토콜 지원    │
│  - AI 채팅 런타임    │  └──────────────────────────────┘
│  - filesystem watch  │
└─────────────────────┘
```

### 프로세스 엔트리포인트 (electron-vite rollupOptions)

```typescript
// apps/desktop/electron.vite.config.ts
input: {
  index:          "src/main/index.ts",           // Electron Main
  "terminal-host": "src/main/terminal-host/index.ts",  // 레거시 PTY daemon
  "pty-subprocess": "src/main/terminal-host/pty-subprocess.ts",
  "git-task-worker": "src/main/git-task-worker.ts",
  "host-service": "src/main/host-service/index.ts",
  "pty-daemon":   "src/main/pty-daemon/index.ts",
}
```

---

## host-service 아키텍처

### createApp() 팩토리 패턴

```typescript
// packages/host-service/src/app.ts (추론)
createApp({
  config: {
    dbPath: env.HOST_DB_PATH,
    cloudApiUrl: env.SUPERSET_API_URL,
    migrationsFolder: env.HOST_MIGRATIONS_FOLDER,
    allowedOrigins: [`http://localhost:${env.DESKTOP_VITE_PORT}`],
    organizationId: env.ORGANIZATION_ID,
    hostServiceSecret: env.HOST_SERVICE_SECRET,
  },
  providers: {
    auth: new JwtApiAuthProvider(...),
    hostAuth: new PskHostAuthProvider(env.HOST_SERVICE_SECRET),
    credentials: new LocalGitCredentialProvider(),
    modelResolver: new LocalModelProvider(),
  },
})
```

- **config**: 정적 값 (경로, URL, 비밀키)
- **providers**: 환경별 구현체 (Electron vs. 독립 서버)
- `process.env` 직접 읽기 없음 — 모든 것이 주입

### HostServiceCoordinator 책임

```typescript
interface HostServiceCoordinator {
  start(organizationId: string, config: SpawnConfig): Promise<{port, secret}>
  stop(organizationId: string): void
  restart(organizationId: string, config: SpawnConfig): Promise<{port, secret}>
  stopAll(): void
  discoverAll(): Promise<void>  // 매니페스트 파일로 재연결
  getConnection(organizationId: string): {port, secret} | null
}
```

- 각 인스턴스: `{ pid, port, secret }`
- `unref()` 후 독립 실행 → 앱 종료 시 살아있음
- 매니페스트 파일: `~/.superset/host/<orgId>/manifest.json`

---

## 데이터 흐름

### 워크스페이스 생성 흐름

```
1. 렌더러: pendingWorkspaces 컬렉션에 pending row 삽입
2. 렌더러: /pending/<id> 라우트로 이동
3. pending 페이지: useFireIntent() → intent 분기
   - "fork"     → host.workspaceCreation.create (git worktree add)
   - "checkout" → host.workspaceCreation.checkout
   - "adopt"    → host.workspaceCreation.adopt
4. host-service: git 연산 + 클라우드 등록
5. Electric: Postgres → 클라이언트 실시간 동기화
6. v2Workspaces 컬렉션 업데이트 감지 → 워크스페이스 뷰로 이동
```

### 에이전트 라이프사이클 이벤트 흐름

```
1. CLI 에이전트 (Claude Code 등) → 훅 실행
2. ~/.superset/bin/[tool-name] wrapper → notifications 서버 POST
3. notificationsEmitter.emit(AGENT_LIFECYCLE, { eventType, paneId })
4. tRPC notifications.subscribe → 렌더러 구독자
5. useAgentHookListener → useTabsStore.setPaneStatus("working"|"review"|"idle")
```

---

## TanStack Router 라우팅 구조

- **파일 기반 라우팅**: Next.js 스타일 (`page.tsx`, `layout.tsx`)
- **인증 레이아웃**: `_authenticated/` prefix로 보호
- **자동 코드 스플리팅**: Vite 플러그인 `autoCodeSplitting: true`
- **타입 안전 파라미터**: `navigate({ to: "/settings/$section", params: { section } })`

```
routes/
├── __root.tsx              # 최상위 레이아웃
├── sign-in/page.tsx
├── create-organization/page.tsx
└── _authenticated/
    ├── layout.tsx           # CollectionsProvider, OrgsProvider 등
    ├── _dashboard/
    │   ├── layout.tsx       # 대시보드 공통 레이아웃
    │   ├── workspace/$workspaceId/page.tsx
    │   ├── pending/$pendingId/page.tsx
    │   └── v2-workspace/$workspaceId/page.tsx
    └── settings/
        └── $section/page.tsx
```

---

## 빌드 파이프라인

```
bun run dev
  → electron-vite dev --watch
  → Main: esbuild (6개 엔트리포인트 병렬)
  → Preload: externalizeDepsPlugin + trpc-electron 포함
  → Renderer: Vite + React + TanStack Router plugin + Tailwind
```

패키지 매니저: Bun (bun.lock)
모노레포 도구: Turborepo (turbo.json)
