import { useState, useRef, useCallback, useEffect } from 'react';
import { useSessionStore } from '../../store/sessionStore';
import { trpc } from '../../lib/trpc';

interface Props {
  sessionId: string | null;
}

export function PromptInput({ sessionId }: Props) {
  const [text, setText] = useState('');
  const [broadcastMode, setBroadcastMode] = useState(false);
  /** 히스토리 탐색 인덱스 (null = 현재 입력 상태) */
  const [historyIdx, setHistoryIdx] = useState<number | null>(null);
  /** 히스토리 탐색 시작 전 원본 텍스트 보존 */
  const draftRef = useRef('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { sessions } = useSessionStore();

  const activeSession = sessions.find((s) => s.id === sessionId);
  const isRunning = activeSession?.status === 'running';
  const runningSessions = sessions.filter((s) => s.status === 'running');

  const sendInputMutation = trpc.session.sendInput.useMutation();
  const broadcastMutation = trpc.session.broadcast.useMutation();
  const savePromptMutation = trpc.session.savePrompt.useMutation();

  // 히스토리 조회 — 활성 세션의 최근 50개
  const historyQuery = trpc.session.getPromptHistory.useQuery(
    { sessionId: sessionId ?? '', limit: 50 },
    { enabled: !!sessionId, staleTime: 5000 }
  );
  const history = historyQuery.data ?? [];

  // 히스토리 인덱스가 바뀔 때마다 textarea 텍스트 업데이트
  useEffect(() => {
    if (historyIdx === null) {
      setText(draftRef.current);
    } else {
      const item = history[history.length - 1 - historyIdx]; // 최신 → 오래된 순
      if (item) setText(item.text);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [historyIdx]);

  const handleSend = useCallback(async () => {
    if (!text.trim()) return;
    const trimmed = text.trim();

    if (broadcastMode) {
      if (runningSessions.length === 0) return;
      broadcastMutation.mutate({ sessionIds: runningSessions.map((s) => s.id), text: trimmed });
      // 브로드캐스트도 현재 세션 히스토리에 저장
      if (sessionId) savePromptMutation.mutate({ sessionId, text: trimmed });
    } else {
      if (!sessionId) return;
      sendInputMutation.mutate({ sessionId, text: trimmed + '\r' });
      savePromptMutation.mutate({ sessionId, text: trimmed });
    }

    setText('');
    draftRef.current = '';
    setHistoryIdx(null);
    textareaRef.current?.focus();
  }, [sessionId, text, broadcastMode, runningSessions, sendInputMutation, broadcastMutation, savePromptMutation]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // IME 조합 중 Enter 차단
    if (e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229) return;

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
      return;
    }

    // ↑ — 이전 히스토리
    if (e.key === 'ArrowUp' && !e.shiftKey) {
      e.preventDefault();
      if (history.length === 0) return;
      if (historyIdx === null) {
        draftRef.current = text;
        setHistoryIdx(0);
      } else {
        setHistoryIdx(Math.min(historyIdx + 1, history.length - 1));
      }
      return;
    }

    // ↓ — 다음 히스토리 (혹은 현재 입력으로 복귀)
    if (e.key === 'ArrowDown' && !e.shiftKey) {
      e.preventDefault();
      if (historyIdx === null) return;
      if (historyIdx === 0) {
        setHistoryIdx(null);
      } else {
        setHistoryIdx(historyIdx - 1);
      }
      return;
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setText(e.target.value);
    // 직접 편집하면 히스토리 탐색 취소
    if (historyIdx !== null) {
      setHistoryIdx(null);
      draftRef.current = e.target.value;
    } else {
      draftRef.current = e.target.value;
    }
  };

  const canSend = broadcastMode
    ? runningSessions.length > 0 && text.trim().length > 0
    : isRunning && text.trim().length > 0;

  const placeholder = broadcastMode
    ? `Broadcast to ${runningSessions.length} running session(s)... (Enter to send)`
    : isRunning
      ? 'Type a prompt... (↑/↓ history, Enter to send, Shift+Enter for newline)'
      : 'Select a running session';

  return (
    <div
      className="border-t px-3 py-2 flex flex-col gap-1.5"
      style={{ borderColor: 'var(--border)', backgroundColor: 'var(--bg-panel)' }}
    >
      {/* 브로드캐스트 모드 배너 */}
      {broadcastMode && (
        <div
          className="text-[10px] px-2 py-1 rounded flex items-center gap-1"
          style={{ backgroundColor: 'rgba(168,85,247,0.12)', color: '#a855f7' }}
        >
          <span>◈</span>
          <span>브로드캐스트 모드 — {runningSessions.length}개 세션에 동시 전송됩니다</span>
        </div>
      )}

      <div className="flex items-end gap-2">
        <textarea
          ref={textareaRef}
          value={text}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          disabled={broadcastMode ? runningSessions.length === 0 : !isRunning}
          placeholder={placeholder}
          className="flex-1 text-xs rounded px-3 py-2 resize-none outline-none border focus:border-blue-600 placeholder-gray-600 disabled:opacity-40"
          style={{ height: '36px', backgroundColor: 'var(--bg-secondary)', color: 'var(--text-primary)', borderColor: broadcastMode ? '#a855f7' : 'var(--border)' }}
          rows={1}
        />

        {/* 브로드캐스트 토글 */}
        {runningSessions.length > 1 && (
          <button
            onClick={() => setBroadcastMode(!broadcastMode)}
            title={broadcastMode ? '브로드캐스트 모드 끄기' : '전체 세션에 브로드캐스트'}
            className="px-2 py-2 text-xs rounded transition-colors flex-shrink-0"
            style={{
              backgroundColor: broadcastMode ? 'rgba(168,85,247,0.2)' : 'var(--bg-hover)',
              color: broadcastMode ? '#a855f7' : 'var(--text-muted)',
              border: `1px solid ${broadcastMode ? '#a855f7' : 'var(--border)'}`,
            }}
          >
            ◈
          </button>
        )}

        <button
          onClick={handleSend}
          disabled={!canSend}
          className="px-3 py-2 text-white text-xs rounded transition-colors whitespace-nowrap disabled:opacity-50"
          style={{ backgroundColor: broadcastMode ? '#a855f7' : 'var(--accent)' }}
        >
          {broadcastMode ? 'Broadcast' : 'Send'}
        </button>
      </div>
    </div>
  );
}
