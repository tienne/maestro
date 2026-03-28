'use client';

import { useState, useRef, useCallback } from 'react';
import { useSessionStore } from '@/store/sessionStore';
import { useUiStore } from '@/store/uiStore';

export function PromptInput() {
  const [text, setText] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const { sessions, sendInput } = useSessionStore();
  const { panes, activePaneIndex } = useUiStore();

  const activeSessionId = panes[activePaneIndex].sessionId;
  const activeSession = sessions.find((s) => s.id === activeSessionId);
  const isRunning = activeSession?.status === 'running';

  const handleSend = useCallback(async () => {
    if (!activeSessionId || !text.trim()) return;
    await sendInput(activeSessionId, text + '\n');
    setText('');
    textareaRef.current?.focus();
  }, [activeSessionId, text, sendInput]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  return (
    <div className="border-t border-gray-800 bg-gray-900 px-3 py-2 flex items-end gap-2">
      <textarea
        ref={textareaRef}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={handleKeyDown}
        disabled={!isRunning}
        placeholder={isRunning ? 'Type a prompt... (Enter to send, Shift+Enter for newline)' : 'Select a running session'}
        className="flex-1 bg-gray-800 text-gray-100 text-xs rounded px-3 py-2 resize-none outline-none border border-gray-700 focus:border-blue-600 placeholder-gray-600 disabled:opacity-40 min-h-[36px] max-h-[120px]"
        rows={1}
      />
      <button
        onClick={handleSend}
        disabled={!isRunning || !text.trim()}
        className="px-3 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 disabled:text-gray-500 text-white text-xs rounded transition-colors whitespace-nowrap"
      >
        Send
      </button>
    </div>
  );
}
