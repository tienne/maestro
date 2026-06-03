# 상태 관리 패턴

## 개요

Superset의 상태 관리는 **4개 계층**으로 나뉜다:

| 계층 | 기술 | 용도 |
|------|------|------|
| **UI 상태** | Zustand 5 | 탭/페인/모달/사이드바 등 UI 로직 |
| **서버 캐시** | TanStack DB + Electric SQL | Postgres 데이터 실시간 동기화 |
| **로컬 영구 저장** | Zustand persist (tRPC storage) | 탭 상태, 사용자 설정 |
| **클라이언트 전용 로컬** | Zustand + localStorage | 워크스페이스 로컬 오버라이드 |

---

## 1. Zustand 스토어

### useTabsStore (핵심 스토어, ~900줄)

```typescript
// apps/desktop/src/renderer/stores/tabs/store.ts

interface TabsState {
  tabs: Tab[];
  panes: Record<string, Pane>;
  activeTabIds: Record<string, string>;      // workspaceId → tabId
  focusedPaneIds: Record<string, string>;    // tabId → paneId
  tabHistoryStacks: Record<string, string[]>; // workspaceId → tabId[]
  closedTabsStack: ClosedTab[];              // 최대 20개
}
```

**Persist 설정:**
- 버전 9
- `trpcTabsStorage` 사용 (tRPC IPC를 통해 로컬 SQLite에 저장)
- 마이그레이션 지원 (버전별 스키마 변환)

**DevTools**: `zustand/middleware` devtools, `"TabsStore"` 라벨

**탭 전환 우선순위:**
1. history stack에서 가장 최근 탭
2. 위치상 다음/이전 탭
3. 남은 탭 중 아무거나

**주요 동작:**
```typescript
// 앱 시작 시 상태 정규화
// "working", "permission" → "idle" (인프라 재시작)
// "review" → 유지 (사용자가 확인해야 함)

// 닫힌 탭 복원 (최대 20개)
closedTabsStack: { tab, panes }[]
// 복원 시 ID 리매핑 (충돌 방지)

// browser history (100개 캡)
tabHistoryStacks: Record<workspaceId, tabId[]>
// 새 탭 이동 시 forward-truncation
```

### 나머지 주요 스토어

```
stores/
├── sidebar-state.ts          # 사이드바 열림/닫힘
├── settings-state.ts         # 설정 패널 활성 섹션
├── new-workspace-modal.ts    # 새 워크스페이스 모달 상태
├── new-workspace-draft.ts    # 워크스페이스 생성 드래프트
├── changes/                  # git diff 상태
├── chat-preferences/         # 채팅 환경설정 (persist)
├── editor-state/             # 코드에디터 상태
├── theme/                    # 테마 (dark/light)
├── tabs/
│   ├── store.ts              # 메인 탭 스토어
│   ├── useAgentHookListener.ts  # 에이전트 훅 → 상태 연결
│   ├── preset-launch.ts      # 에이전트 실행 프리셋
│   └── workspace-run.ts      # 워크스페이스 실행 상태
└── ports/                    # 포트 스캐너 상태
```

---

## 2. TanStack DB + Electric SQL (서버 동기화)

### 아키텍처

```
Postgres (클라우드)
    ↓ Electric SQL
TanStack DB Collections (렌더러 메모리)
    ↓ optimistic update
UI (즉시 반응)
    ↓ API 호출
Postgres 확정
    ↓ txid 반환
Electric가 해당 트랜잭션 스트리밍
TanStack DB overlay 제거 또는 롤백
```

### 컬렉션 분류

**서버 기반 Electric 컬렉션 (optimistic):**
```typescript
const tasks = createElectricCollection({
  handlers: {
    insert: async (tx) => {
      const result = await api.tasks.create(tx.changes);
      // txid를 같은 트랜잭션에서 캡처해서 반환해야 함
      return { txid: result.txid };
    },
    update: async (tx) => {
      const result = await api.tasks.update(tx.changes);
      return { txid: result.txid };
    },
    delete: async (tx) => {
      const result = await api.tasks.delete(tx.id);
      return { txid: result.txid };
    },
  }
})

// collections: tasks, v2Projects, v2Workspaces, chatSessions, agentCommands
```

**읽기 전용 Electric 컬렉션:**
```typescript
// organizations, taskStatuses, members, users
// 뮤테이션 핸들러 없음 — API 쓰기 후 Electric이 행을 스트리밍해옴
```

**로컬 스토리지 컬렉션:**
```typescript
// v2SidebarProjects, v2WorkspaceLocalState, pendingWorkspaces 등
// localStorage 기반, Electric/Postgres와 무관
// 동기 로컬 영구 저장
```

### Optimistic Update 규칙

```typescript
// features 코드는 직접 뮤테이션 대신 이것을 사용
const { insert, update, delete: remove } = useOptimisticCollectionActions("tasks");

// handlers는 반드시 txid 반환 (같은 트랜잭션 내에서 pg_current_xact_id() 캡처)
// { optimistic: false }는 서버 생성 ID가 필요할 때만 사용
// 실패 시: 에러 토스트 + TanStack DB가 롤백 담당
```

**명시적 오프라인 퍼스트가 아님:**
> "Electric is our read/sync confirmation path and the API remains the write authority."

---

## 3. 로컬 영구 저장 (SQLite)

### tRPC Storage (탭 상태)

```typescript
// 탭/페인 상태는 tRPC IPC를 통해 SQLite에 저장
const useTabsStore = create(
  persist(
    (set, get) => ({ ... }),
    {
      name: "tabs-store",
      storage: createJSONStorage(() => trpcTabsStorage),
      version: 9,
      migrate: (persistedState, version) => { /* 버전별 마이그레이션 */ }
    }
  )
)
```

### local-db 스키마 (@superset/local-db)

```typescript
// packages/local-db/schema.ts (추론)
// 로컬 SQLite 테이블들:
// - workspaces (로컬 워크스페이스 메타)
// - worktrees (git worktree 경로)
// - settings (앱 설정)
// - tab_state (직렬화된 탭 상태)
```

---

## 4. AppState (메인 프로세스 상태)

```typescript
// apps/desktop/src/main/lib/app-state.ts

interface AppStateData {
  tabsState?: {
    panes: Record<string, { chat?: { sessionId: string }; tabId?: string; status?: string }>;
    tabs?: { id: string; workspaceId: string }[];
    activeTabIds?: Record<string, string>;
    focusedPaneIds?: Record<string, string>;
  };
  themeState?: "dark" | "light" | "system";
}

export const appState = {
  data: AppStateData;
  // 메인 프로세스에서 탭 상태를 읽어서 에이전트 훅 이벤트의 paneId 해석에 사용
}
```

**chat-runtime-service가 appState를 읽는 이유:**
```typescript
// chat-runtime-service/index.ts
function resolveNotificationIdsFromSession(sessionId: string) {
  const tabsState = appState.data.tabsState;
  // sessionId → paneId → tabId → workspaceId 역방향 조회
  // 채팅 에이전트 훅 이벤트를 어느 페인에 귀속시킬지 결정
}
```

---

## 5. 키보드 단축키 상태 (Zustand + native-keymap)

```typescript
// src/renderer/hotkeys/stores/keyboardLayoutStore.ts
// src/renderer/hotkeys/stores/hotkeyOverridesStore.ts

interface KeyboardLayoutState {
  layoutMap: Record<string, string>;  // event.code → 출력 문자 매핑
}

interface HotkeyOverridesState {
  overrides: Record<HotkeyId, ShortcutBinding>;  // localStorage persist
}

type ShortcutBinding =
  | string                   // physical mode (v1, 레거시 호환)
  | { version: 2; mode: BindingMode; chord: string };

type BindingMode = "physical" | "logical" | "named";
```

**레이아웃 데이터 흐름:**
```
Main Process: native-keymap.getKeyMap()
    ↓ tRPC subscription (keyboardLayout.subscribe)
Renderer: keyboardLayoutStore.layoutMap 업데이트
    ↓ useHotkeyDisplay hook
UI: 현재 레이아웃 기준 단축키 텍스트 표시
```

---

## 6. 페인 상태 관리 (@superset/panes)

```typescript
// packages/panes/src/types.ts (추론)
interface Pane {
  id: string;
  tabId: string;
  type: "terminal" | "chat" | "file-viewer" | "diff";
  status: "idle" | "working" | "review" | "permission";
  // terminal 페인
  terminal?: { sessionId: string };
  // chat 페인
  chat?: { sessionId: string; launchConfig?: LaunchConfig };
  // file viewer
  fileViewer?: { path: string; pinned: boolean };
}
```

**파일 뷰어 특수 동작:**
- `pinned` vs `preview` 상태 (preview는 새 파일 열면 교체됨)
- 워크스페이스 탭 간 재사용 로직

---

## 상태 persist 범위 요약

| 상태 | persist 위치 | 생존 범위 |
|------|-------------|----------|
| 탭/페인 레이아웃 | SQLite (tRPC storage) | 앱 재시작 후에도 유지 |
| 에이전트 상태 (working/review) | Zustand 메모리 | 앱 재시작 시 리셋 |
| 사용자 설정 | SQLite | 앱 재시작 후에도 유지 |
| 단축키 오버라이드 | localStorage | 앱 재시작 후에도 유지 |
| 워크스페이스 목록 | Electric (Postgres → 클라이언트) | 어디서나 동기화 |
| 채팅 세션 메타 | Electric (Postgres) | 어디서나 동기화 |
| 로컬 워크스페이스 오버라이드 | localStorage | 이 기기에만 |
| 터미널 스크롤백 | pty-daemon 메모리 버퍼 | 앱 재시작 후에도 유지 (daemon 살아있는 한) |

---

## 렌더러 ↔ 메인 상태 동기화

### AppState 업데이트 흐름

```typescript
// 렌더러: 탭 상태 변경 시
useTabsStore.subscribe((state) => {
  // tRPC를 통해 메인 프로세스에 상태 동기화
  trpc.uiState.hotkeys.set.mutate({ tabsState: state });
});

// 메인 프로세스: appState.data.tabsState 업데이트
// → chat-runtime-service에서 에이전트 훅 이벤트 라우팅에 활용
```

---

## Maestro 참고 포인트

### Zustand persist 전략
Superset은 `localStorage` 대신 `tRPC storage` (SQLite IPC)를 사용. 성능과 용량 모두 우수. Maestro가 탭/세션 상태를 persist할 때 동일 패턴 권장.

### optimistic update 패턴
```typescript
// 1. 컬렉션 뮤테이션 호출 → 즉시 UI 반영
// 2. API 호출 → txid 반환
// 3. Electric 스트림 → 서버 확정 시 overlay 제거
// 4. 실패 시 자동 롤백

// 핵심: handlers 반드시 { txid } 반환 (같은 DB 트랜잭션 안에서)
```

### AppState를 메인 프로세스와 공유
렌더러의 탭 상태를 메인 프로세스에서도 알아야 하는 경우 (에이전트 훅 라우팅 등), `appState` 같은 공유 상태 객체를 메인 프로세스에 두고 tRPC IPC로 업데이트하는 패턴이 효과적.

### 상태 정규화 on restore
앱 재시작 시 `"working"`, `"permission"` 같은 transient 상태는 `"idle"`로 리셋. `"review"` (사용자 확인 필요)는 유지. 이 원칙은 Maestro에서도 그대로 적용.
