import { useState, useRef, useCallback } from 'react';
import { useSessionStore } from '../../store/sessionStore';
import { trpc } from '../../lib/trpc';

interface Props {
  sessionId: string | null;
}

export function PromptInput({ sessionId }: Props) {
  const [text, setText] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { sessions } = useSessionStore();

  const activeSession = sessions.find((s) => s.id === sessionId);
  const isRunning = activeSession?.status === 'running';

  const sendInputMutation = trpc.session.sendInput.useMutation();

  const handleSend = useCallback(async () => {
    if (!sessionId || !text.trim()) return;
    sendInputMutation.mutate({ sessionId, text: text + '\r' });
    setText('');
    textareaRef.current?.focus();
  }, [sessionId, text, sendInputMutation]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      // 한국어 등 조합형 IME 입력 중 Enter를 누르면 조합 완료로 처리되어야 하므로
      // 전송을 막는다. keyCode 229도 체크.
      if (e.nativeEvent.isComposing || e.nativeEvent.keyCode === 229) return;
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div
      className="border-t px-3 py-2 flex items-end gap-2"
      style={{ borderColor: 'var(--border)', backgroundColor: 'var(--bg-panel)' }}
    >
      <textarea
        ref={textareaRef}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={handleKeyDown}
        disabled={!isRunning}
        placeholder={isRunning ? 'Type a prompt... (Enter to send, Shift+Enter for newline)' : 'Select a running session'}
        className="flex-1 text-xs rounded px-3 py-2 resize-none outline-none border focus:border-blue-600 placeholder-gray-600 disabled:opacity-40"
        style={{ height: '36px', backgroundColor: 'var(--bg-secondary)', color: 'var(--text-primary)', borderColor: 'var(--border)' }}
        rows={1}
      />
      <button
        onClick={handleSend}
        disabled={!isRunning || !text.trim()}
        className="px-3 py-2 text-white text-xs rounded transition-colors whitespace-nowrap disabled:opacity-50"
        style={{ backgroundColor: 'var(--accent)' }}
      >
        Send
      </button>
    </div>
  );
}
