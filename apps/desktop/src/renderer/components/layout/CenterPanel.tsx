/**
 * CenterPanel — AI Agent Editor 중앙 레이아웃
 *
 * 상단: TaskCardEditor (태스크 편집기)
 * 하단: TerminalPanel (세션 탭 + xterm.js PTY)
 *
 * 두 영역 사이에 드래그 가능한 분할선을 제공한다.
 * TiledLayout 모드일 때는 기존 TiledLayout만 표시 (TaskCardEditor 없음).
 */

import { useState, useCallback, useRef, Suspense, lazy } from 'react';
import { ErrorBoundary } from 'react-error-boundary';
import { ErrorFallback } from '../ErrorFallback';
import { TerminalPanel } from '../terminal/TerminalPanel';
import { TaskCardEditor } from '../task/TaskCardEditor';
import { useLayoutStore } from '../../store/layoutStore';
import { useTaskStore } from '../../store/taskStore';
import { trpc } from '../../lib/trpc';

// 무거운 TiledLayout은 lazy import 유지
const TiledLayout = lazy(() => import('./TiledLayout').then((m) => ({ default: m.TiledLayout })));

function LazyFallback() {
  return (
    <div className="flex items-center justify-center h-full w-full" style={{ color: 'var(--text-muted)' }}>
      <span className="text-xs">Loading...</span>
    </div>
  );
}

// 분할 높이 제약
const MIN_EDITOR_HEIGHT = 120;
const MIN_TERMINAL_HEIGHT = 160;

interface CenterPanelProps {
  /** 초기 에디터 높이 (px). 기본값: 화면의 약 40% */
  initialEditorHeight?: number;
}

export function CenterPanel({ initialEditorHeight }: CenterPanelProps) {
  const { mosaicState } = useLayoutStore();
  const isMosaicMode = mosaicState !== null;
  const selectedTaskId = useTaskStore((s) => s.selectedTaskId);
  const tasks = useTaskStore((s) => s.tasks);
  const selectedTask = tasks.find((t) => t.id === selectedTaskId);

  // 선택된 태스크의 workspaceId를 TerminalPanel에 넘겨 세션 필터링에 사용
  const taskWorkspaceId = selectedTask?.workspaceId ?? null;

  // 선택된 태스크가 없으면 workspaceId가 없어도 괜찮으므로 DB에서 최신값 보정
  // (태스크 실행 직후 store가 갱신되기 전을 대비해 tRPC로 재조회)
  const { data: freshTask } = trpc.projectTask.get.useQuery(
    { id: selectedTaskId! },
    { enabled: !!selectedTaskId && !taskWorkspaceId },
  );
  const resolvedTaskWorkspaceId = taskWorkspaceId ?? freshTask?.workspaceId ?? null;

  // 초기 에디터 높이: 전달된 값 또는 창 높이의 40%
  const defaultHeight = initialEditorHeight ?? Math.round(window.innerHeight * 0.4);
  const [editorHeight, setEditorHeight] = useState(defaultHeight);

  // 드래그 핸들 ref (mousemove 클린업용)
  const dragRef = useRef<{
    startY: number;
    startHeight: number;
  } | null>(null);

  const handleDividerMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragRef.current = { startY: e.clientY, startHeight: editorHeight };

    const onMove = (ev: MouseEvent) => {
      if (!dragRef.current) return;
      const delta = ev.clientY - dragRef.current.startY;
      // 컨테이너 전체 높이를 기준으로 상하 최솟값 보장
      const totalHeight = (e.currentTarget as HTMLElement)
        .closest('.center-panel-root')
        ?.getBoundingClientRect().height ?? window.innerHeight;

      const next = dragRef.current.startHeight + delta;
      const clamped = Math.max(
        MIN_EDITOR_HEIGHT,
        Math.min(totalHeight - MIN_TERMINAL_HEIGHT, next),
      );
      setEditorHeight(clamped);
    };

    const onUp = () => {
      dragRef.current = null;
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };

    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  }, [editorHeight]);

  // TiledLayout 모드: 기존 동작 유지, TaskCardEditor 없음
  if (isMosaicMode) {
    return (
      <ErrorBoundary FallbackComponent={(props) => <ErrorFallback {...props} panelName="터미널" />}>
        <Suspense fallback={<LazyFallback />}>
          <TiledLayout />
        </Suspense>
      </ErrorBoundary>
    );
  }

  // 태스크 미선택 시 TaskCardEditor를 숨기고 TerminalPanel만 표시
  if (!selectedTaskId) {
    return (
      <ErrorBoundary FallbackComponent={(props) => <ErrorFallback {...props} panelName="터미널" />}>
        <TerminalPanel />
      </ErrorBoundary>
    );
  }

  return (
    <div
      className="center-panel-root flex flex-col h-full min-h-0 overflow-hidden"
      style={{ backgroundColor: 'var(--bg-primary)' }}
    >
      {/* ── 상단: TaskCardEditor ─────────────────────────────────────────────── */}
      <div
        className="flex-shrink-0 overflow-hidden"
        style={{ height: editorHeight }}
      >
        <ErrorBoundary FallbackComponent={(props) => <ErrorFallback {...props} panelName="태스크 편집기" />}>
          <TaskCardEditor />
        </ErrorBoundary>
      </div>

      {/* ── 드래그 분할선 ────────────────────────────────────────────────────── */}
      <div
        className="flex-shrink-0 h-1.5 cursor-row-resize group transition-colors"
        style={{ backgroundColor: 'var(--border)' }}
        onMouseDown={handleDividerMouseDown}
        title="드래그하여 높이 조절"
        role="separator"
        aria-orientation="horizontal"
      >
        {/* 호버 시 강조 인디케이터 */}
        <div
          className="h-full w-full opacity-0 group-hover:opacity-100 transition-opacity"
          style={{ backgroundColor: 'var(--accent)' }}
        />
      </div>

      {/* ── 하단: TerminalPanel ──────────────────────────────────────────────── */}
      {/* taskWorkspaceId를 넘겨 해당 워크스페이스 세션만 표시하도록 한다. */}
      {/* taskId도 함께 넘겨 세션 없을 때 [실행] 버튼에서 run mutation 호출에 사용한다. */}
      <div className="flex-1 min-h-0 overflow-hidden">
        <ErrorBoundary FallbackComponent={(props) => <ErrorFallback {...props} panelName="터미널" />}>
          <TerminalPanel
            taskWorkspaceId={resolvedTaskWorkspaceId}
            taskId={selectedTaskId}
          />
        </ErrorBoundary>
      </div>
    </div>
  );
}
