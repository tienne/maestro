---
name: electron-frontend
description: "Maestro React 렌더러 컴포넌트, Zustand 스토어, tRPC 훅 통합 패턴. frontend-engineer가 renderer/ 아래를 작업할 때 이 스킬을 참조한다. 새 컴포넌트 추가, 상태 관리 업데이트, tRPC 쿼리/뮤테이션 연동 시 반드시 사용."
---

# Electron Frontend 개발 가이드

Maestro 렌더러 프로세스(React + Zustand + tRPC) 개발 패턴을 정의한다.

## 프로젝트 구조

```
apps/desktop/src/renderer/
├── components/       ← React 컴포넌트
│   ├── terminal/     ← 터미널 관련 (XTerminal, TerminalPanel, PromptInput)
│   ├── sidebar/      ← 좌측/우측 사이드바
│   ├── git-panel/    ← Git 관련 (FileTree, GitDiffView, CommitPanel)
│   ├── layout/       ← 타일 레이아웃 (TiledLayout)
│   └── modals/       ← 설정 모달들
├── store/            ← Zustand 스토어
├── hooks/            ← 커스텀 훅
├── lib/
│   ├── trpc.ts       ← tRPC React Query 훅 생성 (import 위치)
│   └── trpc-client.ts ← vanilla tRPC 클라이언트
└── providers/
    └── TRPCProvider.tsx ← QueryClient + tRPC Provider
```

## tRPC 훅 사용 패턴

### Query (데이터 조회)

```typescript
import { trpc } from '../lib/trpc';

function MyComponent() {
  const { data, isLoading, error } = trpc.workspace.list.useQuery(
    { repositoryId: activeRepositoryId },
    { enabled: !!activeRepositoryId }  // 조건부 실행
  );
  
  if (isLoading) return <div>Loading...</div>;
  if (error) return <div>Error: {error.message}</div>;
  return <div>{data?.map(ws => <div key={ws.id}>{ws.name}</div>)}</div>;
}
```

### Mutation (데이터 변경)

```typescript
function MyForm() {
  const utils = trpc.useUtils();
  
  const createMutation = trpc.workspace.create.useMutation({
    onSuccess: (newWorkspace) => {
      // 캐시 무효화 — 리스트 자동 갱신
      utils.workspace.list.invalidate();
      // 또는 직접 스토어 업데이트
      useWorkspaceStore.getState().addWorkspace(newWorkspace);
    },
    onError: (error) => {
      console.error('Failed to create workspace:', error.message);
    },
  });
  
  const handleSubmit = () => {
    createMutation.mutate({ name: 'my-workspace', repositoryId: 'repo-1' });
  };
  
  return (
    <button onClick={handleSubmit} disabled={createMutation.isPending}>
      {createMutation.isPending ? 'Creating...' : 'Create'}
    </button>
  );
}
```

### Subscription (실시간 이벤트)

```typescript
function TerminalOutput({ sessionId }: { sessionId: string }) {
  trpc.session.onOutput.useSubscription(
    { sessionId },
    {
      enabled: !!sessionId,
      onData: (data) => {
        // xterm.js에 데이터 쓰기
        terminalRef.current?.write(data);
      },
      onError: (error) => {
        console.error('Subscription error:', error);
      },
    }
  );
}
```

## Zustand 스토어 패턴

### 새 스토어 생성

```typescript
// renderer/store/myFeatureStore.ts
import { create } from 'zustand';
import type { MyItem } from '@maestro/shared-types';

interface MyFeatureStore {
  items: MyItem[];
  activeItemId: string | null;
  // Actions
  setItems: (items: MyItem[]) => void;
  addItem: (item: MyItem) => void;
  removeItem: (id: string) => void;
  setActiveItemId: (id: string | null) => void;
}

export const useMyFeatureStore = create<MyFeatureStore>((set) => ({
  items: [],
  activeItemId: null,
  setItems: (items) => set({ items }),
  addItem: (item) => set((s) => ({ items: [...s.items, item] })),
  removeItem: (id) => set((s) => ({ items: s.items.filter((i) => i.id !== id) })),
  setActiveItemId: (id) => set({ activeItemId: id }),
}));
```

### 스토어를 tRPC 뮤테이션과 연동

```typescript
// mutation 성공 시 스토어 동기화 (캐시 무효화보다 빠른 UI 업데이트)
const deleteMutation = trpc.workspace.delete.useMutation({
  onSuccess: (_, { id }) => {
    useWorkspaceStore.getState().removeWorkspace(id);
  },
});
```

## 컴포넌트 패턴

### 기본 구조

```typescript
// renderer/components/my-feature/MyPanel.tsx
import { useState } from 'react';
import { trpc } from '../../lib/trpc';
import { useMyFeatureStore } from '../../store/myFeatureStore';

interface MyPanelProps {
  workspaceId: string;
}

export function MyPanel({ workspaceId }: MyPanelProps) {
  const [isOpen, setIsOpen] = useState(false);
  const items = useMyFeatureStore((s) => s.items);
  
  const { data } = trpc.myFeature.list.useQuery({ workspaceId });
  
  return (
    <div className="flex flex-col h-full">
      {/* 컨텐츠 */}
    </div>
  );
}
```

### Tailwind CSS 클래스 패턴

기존 컴포넌트에서 사용하는 패턴을 따른다:
- 레이아웃: `flex flex-col h-full`, `flex items-center gap-2`
- 텍스트: `text-sm text-gray-400`, `font-mono`
- 인터랙티브: `hover:bg-gray-700 cursor-pointer`, `disabled:opacity-50`
- 스크롤: `overflow-y-auto`, `scrollbar-hide`

## 상세 패턴

모달 구현, 키보드 단축키, xterm.js 통합 등 상세 패턴은 `references/component-patterns.md` 참조.
