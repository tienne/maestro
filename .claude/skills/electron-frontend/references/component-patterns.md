# 컴포넌트 심화 패턴

## 목차
1. [모달 패턴](#모달-패턴)
2. [초기 데이터 로드 (useAppInit 연동)](#초기-데이터-로드)
3. [키보드 단축키](#키보드-단축키)
4. [xterm.js 통합](#xtermjs-통합)
5. [react-mosaic 레이아웃](#react-mosaic-레이아웃)
6. [유틸리티 훅 패턴](#유틸리티-훅-패턴)

---

## 모달 패턴

기존 모달(`renderer/components/modals/`)을 참조한다. 기본 구조:

```typescript
// modals/MyModal.tsx
interface MyModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirm: (data: SomeData) => void;
}

export function MyModal({ isOpen, onClose, onConfirm }: MyModalProps) {
  if (!isOpen) return null;
  
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
      <div className="bg-gray-800 rounded-lg p-6 w-full max-w-md">
        <h2 className="text-lg font-semibold mb-4">제목</h2>
        {/* 컨텐츠 */}
        <div className="flex justify-end gap-2 mt-4">
          <button onClick={onClose} className="px-4 py-2 text-gray-400 hover:text-white">
            취소
          </button>
          <button onClick={() => onConfirm(data)} className="px-4 py-2 bg-blue-600 rounded hover:bg-blue-700">
            확인
          </button>
        </div>
      </div>
    </div>
  );
}
```

---

## 초기 데이터 로드

`useAppInit` 훅(`hooks/useAppInit.ts`)이 앱 시작 시 모든 초기 데이터를 로드한다.

새 데이터를 초기 로드에 추가하려면:

```typescript
// hooks/useAppInit.ts에 추가
const { data: myItems } = trpc.myFeature.list.useQuery(undefined, {
  onSuccess: (items) => {
    useMyFeatureStore.getState().setItems(items);
  },
});
```

---

## 키보드 단축키

```typescript
import { useEffect } from 'react';

function useKeyboardShortcut(key: string, callback: () => void) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.metaKey && e.key === key) {
        e.preventDefault();
        callback();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [key, callback]);
}
```

---

## xterm.js 통합

xterm.js 인스턴스에 접근하는 패턴 (XTerminal 컴포넌트 참조):

```typescript
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { useEffect, useRef } from 'react';

function MyTerminal() {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  
  useEffect(() => {
    if (!containerRef.current) return;
    
    const terminal = new Terminal({
      theme: { background: '#1a1a1a' },
      fontFamily: 'monospace',
      fontSize: 14,
    });
    
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(containerRef.current);
    fitAddon.fit();
    
    terminalRef.current = terminal;
    
    return () => terminal.dispose();
  }, []);
  
  return <div ref={containerRef} className="w-full h-full" />;
}
```

**중요**: xterm.js는 DOM에 직접 마운트한다. SSR 불가, `useEffect` 내에서만 초기화.

---

## react-mosaic 레이아웃

타일형 레이아웃 (`components/layout/TiledLayout.tsx` 패턴):

```typescript
import { Mosaic, MosaicWindow } from 'react-mosaic-component';
import 'react-mosaic-component/react-mosaic-component.css';

type PaneId = string;

function TiledView() {
  const [mosaicState, setMosaicState] = useState<MosaicNode<PaneId> | null>('pane-1');
  
  return (
    <Mosaic<PaneId>
      renderTile={(id, path) => (
        <MosaicWindow<PaneId> path={path} title={id}>
          <MyPane paneId={id} />
        </MosaicWindow>
      )}
      value={mosaicState}
      onChange={setMosaicState}
    />
  );
}
```

---

## 유틸리티 훅 패턴

### 자동 저장 훅

```typescript
// hooks/useAutoSave.ts
import { useEffect, useRef } from 'react';
import { trpc } from '../lib/trpc';

export function useAutoSaveLayout(workspaceId: string, mosaicState: unknown) {
  const saveLayoutMutation = trpc.layout.save.useMutation();
  const timerRef = useRef<ReturnType<typeof setTimeout>>();
  
  useEffect(() => {
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      saveLayoutMutation.mutate({
        workspaceId,
        mosaicState: JSON.stringify(mosaicState),
      });
    }, 150); // debounce 150ms (Superset 패턴)
    
    return () => clearTimeout(timerRef.current);
  }, [workspaceId, mosaicState]);
}
```

### 스크롤 하단 고정

```typescript
// xterm.js scrollback 관련 패턴 (Superset 패턴 참조)
function useScrollToBottom(containerRef: React.RefObject<HTMLElement>) {
  const wasAtBottomRef = useRef(true);
  
  const handleScroll = () => {
    const el = containerRef.current;
    if (!el) return;
    wasAtBottomRef.current = 
      el.scrollHeight - el.scrollTop - el.clientHeight < 10;
  };
  
  const scrollToBottom = () => {
    if (wasAtBottomRef.current) {
      containerRef.current?.scrollTo({ top: Infinity });
    }
  };
  
  return { handleScroll, scrollToBottom };
}
```
