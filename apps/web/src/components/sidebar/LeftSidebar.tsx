'use client';

import { useState } from 'react';
import { useWorkspaceStore } from '@/store/workspaceStore';
import { useSessionStore } from '@/store/sessionStore';
import { useUiStore } from '@/store/uiStore';
import { CreateWorkspaceModal } from '@/components/modals/CreateWorkspaceModal';
import { CreateSessionModal } from '@/components/modals/CreateSessionModal';
import { AgentSettingsModal } from '@/components/modals/AgentSettingsModal';
import type { Workspace } from '@maestro/shared-types';

const STATUS_COLORS: Record<string, string> = {
  running: 'bg-green-400',
  stopped: 'bg-gray-500',
  error: 'bg-red-400',
};

export function LeftSidebar() {
  const { workspaces, activeWorkspaceId, setActiveWorkspace } = useWorkspaceStore();
  const { sessions, activeSessionId, setActiveSession } = useSessionStore();
  const { setPaneSession, activePaneIndex } = useUiStore();

  const [showCreateWorkspace, setShowCreateWorkspace] = useState(false);
  const [showCreateSession, setShowCreateSession] = useState(false);
  const [showAgentSettings, setShowAgentSettings] = useState(false);
  const [sessionWorkspace, setSessionWorkspace] = useState<Workspace | null>(null);

  const handleWorkspaceClick = (id: string) => {
    setActiveWorkspace(id === activeWorkspaceId ? null : id);
  };

  const handleSessionClick = (sessionId: string) => {
    setActiveSession(sessionId);
    setPaneSession(activePaneIndex, sessionId);
  };

  const handleAddSession = (workspace: Workspace) => {
    setSessionWorkspace(workspace);
    setShowCreateSession(true);
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-800">
        <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">Maestro</span>
        <button
          onClick={() => setShowCreateWorkspace(true)}
          className="text-gray-400 hover:text-gray-200 text-lg leading-none"
          title="New Workspace"
        >
          +
        </button>
      </div>

      {/* Workspace + Session Tree */}
      <div className="flex-1 overflow-y-auto py-1">
        {workspaces.length === 0 ? (
          <div className="px-3 py-4 text-xs text-gray-500 text-center">
            No workspaces yet.
            <br />
            Click + to create one.
          </div>
        ) : (
          workspaces.map((ws) => {
            const wsSessions = sessions.filter((s) => s.workspaceId === ws.id);
            const isExpanded = activeWorkspaceId === ws.id;

            return (
              <div key={ws.id}>
                {/* Workspace Row */}
                <button
                  onClick={() => handleWorkspaceClick(ws.id)}
                  className={`w-full flex items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-gray-800 transition-colors ${
                    isExpanded ? 'bg-gray-800 text-gray-100' : 'text-gray-400'
                  }`}
                >
                  <span className={`transition-transform ${isExpanded ? 'rotate-90' : ''}`}>▶</span>
                  <span className="truncate flex-1">{ws.name}</span>
                  <span className="text-gray-600 text-[10px]">{ws.branch}</span>
                  <button
                    onClick={(e) => { e.stopPropagation(); handleAddSession(ws); }}
                    className="text-gray-500 hover:text-gray-300 ml-1"
                    title="New Session"
                  >
                    +
                  </button>
                </button>

                {/* Session Rows */}
                {isExpanded && wsSessions.map((session) => (
                  <button
                    key={session.id}
                    onClick={() => handleSessionClick(session.id)}
                    className={`w-full flex items-center gap-2 pl-8 pr-3 py-1.5 text-left text-xs hover:bg-gray-800 transition-colors ${
                      activeSessionId === session.id ? 'bg-gray-700 text-gray-100' : 'text-gray-400'
                    }`}
                  >
                    <span
                      className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${STATUS_COLORS[session.status] ?? 'bg-gray-500'}`}
                    />
                    <span className="truncate">{session.name}</span>
                  </button>
                ))}

                {isExpanded && wsSessions.length === 0 && (
                  <div className="pl-8 pr-3 py-1.5 text-[11px] text-gray-600">
                    No sessions
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Agents Settings link */}
      <div className="border-t border-gray-800 px-3 py-2">
        <button
          onClick={() => setShowAgentSettings(true)}
          className="text-xs text-gray-500 hover:text-gray-300 flex items-center gap-1"
        >
          ⚙ Agents
        </button>
      </div>

      {showCreateWorkspace && (
        <CreateWorkspaceModal onClose={() => setShowCreateWorkspace(false)} />
      )}
      {showCreateSession && sessionWorkspace && (
        <CreateSessionModal
          workspace={sessionWorkspace}
          onClose={() => { setShowCreateSession(false); setSessionWorkspace(null); }}
        />
      )}
      {showAgentSettings && (
        <AgentSettingsModal onClose={() => setShowAgentSettings(false)} />
      )}
    </div>
  );
}
