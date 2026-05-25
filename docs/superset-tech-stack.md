# Superset 기술 스택 분석

> **기준일:** 2026-05-25
> **참조:** [superset-sh/superset](https://github.com/superset-sh/superset) — AI 에이전트 오케스트레이션 데스크톱 앱 (11K ★)
> **라이선스:** Elastic License 2.0 (ELv2) — 소스 열람·참조 가능, SaaS 제공 불가
> **버전:** 1.11.3

---

## 1. 전체 기술 스택

### AI / LLM

| 패키지 | 버전 | 용도 |
|--------|------|------|
| `ai` (Vercel AI SDK) | 6.0.141 | 통합 LLM 인터페이스 |
| `@ai-sdk/anthropic` | 3.0.64 | Claude 연동 |
| `@ai-sdk/openai` | 3.0.36 | OpenAI 연동 |
| `@ai-sdk/react` | 3.0.143 | 스트리밍 React 훅 |
| `@mastra/core` | 1.33.1 | 에이전트 오케스트레이션 프레임워크 |
| `mastracode` | 0.18.1 | 에이전트 CLI 런타임 |

### 프론트엔드 코어

- **React 19.2.3** + TypeScript
- **framer-motion** 12.38.0 — 애니메이션
- **react-hook-form**, **react-hotkeys-hook**

### 에디터

- **CodeMirror 6** — C++, Go, Python, SQL, Rust 등 11개 언어 지원
- **Tiptap** (30+ 익스텐션) — 리치 텍스트 에디터
- **streamdown** 2.5.0 + **@streamdown/mermaid** 1.0.2 — 스트리밍 마크다운 렌더러

### 터미널

- **xterm.js** + 11개 애드온 (WebGL, image, ligatures, search, serialize 등)
- **node-pty** 1.1.0 — 실제 PTY 데몬
- **execa** 9.6.1 — 프로세스 실행

### 상태 관리 / 데이터 페칭

- **zustand** 5.0.12 — 클라이언트 상태
- **@tanstack/react-query** 5.100.9 — 서버 상태
- **tRPC v11** + 커스텀 Electron IPC transport (`trpc-electron`)
- **superjson** 2.2.6 — tRPC 직렬화 (Date, Map, Set, BigInt 타입 보존)

### DB / 퍼시스턴스

- **better-sqlite3** + **drizzle-orm** — 로컬 SQLite
- **Dexie** 4.4.2 — IndexedDB
- **@electric-sql/client** — SQLite 리얼타임 싱크 (Local-first)
- **@durable-streams/client** — 오프라인 스트림 영속성
- **lowdb** 7.0.1 — 앱 UI 상태(탭·테마·단축키)를 JSON 파일로 저장

### 라우팅 / UI

- **@tanstack/react-router** 1.168.8
- **@tanstack/react-table** 8.21.3
- **Radix UI** — 헤드리스 컴포넌트
- **react-mosaic-component** — 윈도우 레이아웃 (IDE 스타일)
- **@dnd-kit** — 드래그 앤 드롭
- **react-resizable-panels**
- **@pierre/diffs** 1.2.2 — diff 뷰어

### Electron / 네이티브

- **electron-updater**, **electron-log**
- **@sentry/electron** — 에러 트래킹
- **Hono** + **Express 5** — 인앱 HTTP 서버
- **@ast-grep/napi** — AST 파싱 (코드 인텔리전스)
- **native-keymap** — 키보드 매핑
- **simple-git** 3.36.0 — Git 연동
- **pidusage**, **pidtree** — 프로세스 모니터링

### 분석 / 인증

- **PostHog** (`posthog-js` + `posthog-node`) — 프로덕트 애널리틱스
- **better-auth** 1.6.5 + API Key / Stripe 플러그인

### 모노레포 내부 패키지 (14개)

`@superset/auth`, `@superset/chat`, `@superset/db`, `@superset/host-service`,
`@superset/local-db`, `@superset/macos-process-metrics`, `@superset/panes`,
`@superset/port-scanner`, `@superset/pty-daemon`, `@superset/shared`,
`@superset/trpc`, `@superset/ui`, `@superset/workspace-client`, `@superset/workspace-fs`

---

## 2. Mastra 사용 패턴

### 아키텍처

```
Superset 앱
├── MastraGateway    → 모델 라우팅 (OpenRouter 포함)
├── MastraCode Runtime → 에이전트 실행 하네스
│   ├── Memory        → 대화 상태 관리
│   ├── Thread        → 멀티턴 세션
│   └── HookManager   → 라이프사이클 훅
└── createTool()      → 커스텀 툴 (MCP는 별도 관리)
```

### Model Gateway

`MastraGateway`가 `MastraModelGateway`를 상속해서 모델 접근을 추상화한다.

```ts
// 기본 URL: https://gateway-api.mastra.ai
// 인증: MASTRA_GATEWAY_API_KEY 환경변수
class MastraGateway extends MastraModelGateway {
  id = "mastra"
  name = "Memory Gateway"
}
```

### MastraCode 런타임

```ts
const harness = mastracode.createMastraCode({
  disableMcp: true,  // MCP는 Superset이 별도 관리
  memory: new Memory({ observationalMemory: false })
})

// 세션별 스레드 생성/관리
hookManager.setSessionId(sessionId)
harness.selectOrCreateThread()
harness.setResourceId(resourceId)
```

`SessionRuntime` 객체로 `harness`, `mcpManager`, `hookManager`를 묶어 관리한다.

### 에이전트 글로벌 인스트럭션

`~/.mastracode/AGENTS.md` 파일에 `ask_user` 툴 사용법 등 Superset 전용 지시사항 저장.

### 커스텀 툴 정의

```ts
import { createTool } from "@mastra/core/tools"

const searchTool = createTool({
  id: "web_search",
  inputSchema: z.object({ query: z.string() }),
  execute: async ({ context }) => { ... }
})
```

---

## 3. streamdown 사용 패턴

### 의존성

- `streamdown` v2.5.0
- `@streamdown/mermaid` v1.0.2

### 핵심 패턴 — 애니메이션 중 플러그인 비활성화

```ts
const streamdownPlugins = {
  mermaid: mermaidPlugin
}

<Streamdown
  controls={{ table: false }}
  isAnimating={isAnimating}
  linkSafety={{ enabled: false }}
  mode="streaming"
  plugins={isAnimating ? undefined : streamdownPlugins}  // 핵심!
/>
```

스트리밍 중에는 Mermaid 렌더러를 비활성화해 성능 저하 방지. 스트리밍 완료 후에만 플러그인 적용.

### CSS data attribute 패턴

- `data-streamdown="mermaid-block"` — Mermaid 블록 커스텀 스타일
- `data-streamdown="table-cell"` / `"table-header-cell"` / `"table-wrapper"` — 테이블 스타일
- `--streamdown-caret` CSS 변수 — 스트리밍 커서 (타이핑 커서 효과)

---

## 4. Task 시스템

### DB 스키마 (PostgreSQL + drizzle-orm)

```ts
// packages/db/src/schema/schema.ts
tasks = pgTable("tasks", {
  id: uuid().primaryKey().defaultRandom(),
  slug: text().notNull(),        // 예: "SUP-42"
  title: text().notNull(),
  description: text(),
  statusId: uuid().references(() => taskStatuses.id),  // 커스텀 상태
  priority: taskPriority().default("none"),             // none|urgent|high|medium|low

  // 소유권
  organizationId, creatorId, assigneeId,

  // 기획
  estimate: integer(),
  dueDate: timestamp(),
  labels: jsonb().$type<string[]>().default([]),

  // Git 연동
  branch: text(),
  prUrl: text(),

  // External 싱크 (null이면 로컬 전용)
  externalProvider: integrationProvider(),  // "linear" | null
  externalId, externalKey, externalUrl,     // 예: externalKey = "ENG-172"
  lastSyncedAt, syncError,

  // 외부 담당자 스냅샷 (매칭 안된 Linear 사용자)
  assigneeExternalId, assigneeDisplayName, assigneeAvatarUrl,

  startedAt, completedAt, deletedAt,
  createdAt, updatedAt,
})
```

### tRPC 라우터 (`packages/trpc/src/router/task/`)

| 프로시저 | 역할 |
|---------|------|
| `task.list` | 필터(status, priority, assignee, search) + 페이지네이션 |
| `task.byId` / `task.bySlug` / `task.byIdOrSlug` | 단건 조회 |
| `task.create` | 생성 (slug 충돌 시 최대 5회 retry) |
| `task.update` | 수정 (내부 담당자 지정 시 외부 스냅샷 자동 클리어) |
| `task.delete` | 소프트 딜리트 (`deletedAt` 세팅) |
| `task.statuses.*` | 커스텀 상태 CRUD |

생성/수정/삭제 후 `syncTask(taskId)` 호출 → 외부 동기화 큐 등록.

### Linear 동기화 흐름

```
task.create / update / delete
  → syncTask(taskId)                              // packages/trpc/src/lib/integrations/sync/tasks.ts
    → QStash.publishJSON({ retries: 3 })          // 비동기 메시지 큐
      → POST /api/integrations/linear/jobs/sync-task
        → QStash 서명 검증
          → syncTaskToLinear()
            - 신규: client.createIssue() → slug를 Linear identifier로 교체
            - 수정: client.updateIssue() (상태명으로 Linear stateId resolve)
            - 삭제: client.archiveIssue()
```

### "Open in Workspace" — 에이전트 자동 실행 플로우

```
Task 선택
  → deriveBranchName({ slug, title })   // 브랜치명 생성
  → createWorkspace({ projectId, name: task.title, branchName })
  → buildTaskAgentLaunchRequest({
       task: { id, slug, title, description, priority, statusName, labels },
       selectedAgent,
       autoRun
     })
    → renderTaskPromptTemplate(config.taskPromptTemplate, task)
      → launchAgentSession()            // 에이전트에 태스크 컨텍스트 전달
```

### 프롬프트 템플릿 엔진

`{{변수}}` 치환 방식 (Mustache-lite). 알 수 없는 변수는 그대로 유지.

**기본 Terminal 에이전트 템플릿:**

```
Task: "{{title}}" ({{slug}})
Priority: {{priority}}
Status: {{statusName}}
Labels: {{labels}}

{{description}}

Work in the current workspace. Inspect the relevant code, make the needed changes,
verify them when practical, and update task "{{id}}" with a short summary when done.
```

**기본 Chat 에이전트 템플릿:**

```
Task: "{{title}}" ({{slug}})
Priority: {{priority}}
Status: {{statusName}}
Labels: {{labels}}

{{description}}

Help with this task in the current workspace and take the next concrete step.
```

지원 변수: `id`, `slug`, `title`, `description`, `priority`, `statusName`, `labels`

템플릿은 Settings에서 에이전트별로 커스터마이징 가능.

### Terminal 에이전트 프롬프트 전달 방식

```ts
// 파일로 저장 후 에이전트에 전달
const taskPromptFileName = `task-${task.slug}.md`
// .superset/task-{slug}.md 경로로 heredoc/stdin 방식 전달
```

---

## 5. lowdb 사용 패턴

앱 UI 상태를 JSON 파일로 영속화. SQLite(drizzle)와 역할 분리:

| 저장소 | 데이터 |
|--------|--------|
| SQLite (drizzle) | 대화, 워크스페이스, 태스크 등 구조화 데이터 |
| lowdb (JSON 파일) | 탭 레이아웃, 테마, 단축키 설정 등 UI 상태 |

```ts
// APP_STATE_PATH 경로의 JSON 파일
_appState = await JSONFilePreset(appEnvironment.APP_STATE_PATH, {
  tabsState: { tabs: [], panes: {}, activeTabIds: {}, ... },
  themeState: { activeThemeId: "dark", customThemes: [], ... },
  hotkeysState: { version: 1, byPlatform: { darwin: {}, win32: {}, linux: {} } }
})
```
