'use client';

import { useState, useCallback } from 'react';
import { useSessionStore } from '@/store/sessionStore';
import { useUiStore } from '@/store/uiStore';
import { TerminalTab } from './TerminalTab';
import { XTerminal } from './XTerminal';
import { PromptInput } from './PromptInput';
import type { Session } from '@maestro/shared-types';

export function TerminalPanel() {
  const { sessions, activeSessionId, setActiveSession } = useSessionStore();
  const { splitLayout, setSplitLayout, panes, setPaneSession, activePaneIndex, setActivePaneIndex } = useUiStore();

  // All open tab session IDs (deduplicated from panes + active session)
  const openTabs = sessions.filter((s) => panes.some((p) => p.sessionId === s.id) || s.id === activeSessionId);

  const handleTabClick = (session: Session) => {
    setActiveSession(session.id);
    setPaneSession(activePaneIndex, session.id);
  };

  const leftPaneSessionId = panes[0].sessionId;
  const rightPaneSessionId = panes[1].sessionId;

  return (
    <div className="flex flex-col h-full bg-gray-950">
      {/* Tab Bar */}
      <div className="flex items-center border-b border-gray-800 bg-gray-900 min-h-[36px] overflow-x-auto">
        <div className="flex items-center flex-1 gap-0">
          {sessions.map((session) => (
            <TerminalTab
              key={session.id}
              session={session}
              isActive={activeSessionId === session.id}
              onClick={() => handleTabClick(session)}
            />
          ))}
        </div>

        {/* Split controls */}
        <div className="flex items-center gap-1 px-2 flex-shrink-0">
          <button
            onClick={() => setSplitLayout('single')}
            className={`p-1 rounded text-xs ${splitLayout === 'single' ? 'bg-gray-700 text-gray-200' : 'text-gray-500 hover:text-gray-300'}`}
            title="Single view"
          >
            ▭
          </button>
          <button
            onClick={() => setSplitLayout('vertical')}
            className={`p-1 rounded text-xs ${splitLayout === 'vertical' ? 'bg-gray-700 text-gray-200' : 'text-gray-500 hover:text-gray-300'}`}
            title="Vertical split"
          >
            ◫
          </button>
          <button
            onClick={() => setSplitLayout('horizontal')}
            className={`p-1 rounded text-xs ${splitLayout === 'horizontal' ? 'bg-gray-700 text-gray-200' : 'text-gray-500 hover:text-gray-300'}`}
            title="Horizontal split"
          >
            ⊟
          </button>
        </div>
      </div>

      {/* Terminal Area */}
      <div className="flex-1 overflow-hidden flex flex-col">
        {splitLayout === 'single' ? (
          <div className="flex-1 overflow-hidden" onClick={() => setActivePaneIndex(0)}>
            {activeSessionId ? (
              <XTerminal sessionId={activeSessionId} isActive />
            ) : (
              <EmptyTerminal />
            )}
          </div>
        ) : splitLayout === 'vertical' ? (
          <div className="flex-1 flex overflow-hidden">
            <div
              className={`flex-1 overflow-hidden border-r border-gray-800 ${activePaneIndex === 0 ? 'ring-1 ring-inset ring-blue-600' : ''}`}
              onClick={() => setActivePaneIndex(0)}
            >
              {leftPaneSessionId ? <XTerminal sessionId={leftPaneSessionId} isActive={activePaneIndex === 0} /> : <EmptyTerminal />}
            </div>
            <div
              className={`flex-1 overflow-hidden ${activePaneIndex === 1 ? 'ring-1 ring-inset ring-blue-600' : ''}`}
              onClick={() => setActivePaneIndex(1)}
            >
              {rightPaneSessionId ? <XTerminal sessionId={rightPaneSessionId} isActive={activePaneIndex === 1} /> : <EmptyTerminal />}
            </div>
          </div>
        ) : (
          <div className="flex-1 flex flex-col overflow-hidden">
            <div
              className={`flex-1 overflow-hidden border-b border-gray-800 ${activePaneIndex === 0 ? 'ring-1 ring-inset ring-blue-600' : ''}`}
              onClick={() => setActivePaneIndex(0)}
            >
              {leftPaneSessionId ? <XTerminal sessionId={leftPaneSessionId} isActive={activePaneIndex === 0} /> : <EmptyTerminal />}
            </div>
            <div
              className={`flex-1 overflow-hidden ${activePaneIndex === 1 ? 'ring-1 ring-inset ring-blue-600' : ''}`}
              onClick={() => setActivePaneIndex(1)}
            >
              {rightPaneSessionId ? <XTerminal sessionId={rightPaneSessionId} isActive={activePaneIndex === 1} /> : <EmptyTerminal />}
            </div>
          </div>
        )}

        {/* Prompt Input */}
        <PromptInput />
      </div>
    </div>
  );
}

function EmptyTerminal() {
  return (
    <div className="h-full flex items-center justify-center text-gray-600 text-sm">
      Select a session to view terminal output
    </div>
  );
}
