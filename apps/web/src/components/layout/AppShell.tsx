'use client';


import { useAppInit, useAutoSaveState } from '@/hooks/useAppInit';
import { LeftSidebar } from '@/components/sidebar/LeftSidebar';
import { TerminalPanel } from '@/components/terminal/TerminalPanel';
import { RightSidebar } from '@/components/git-panel/RightSidebar';
import { useUiStore } from '@/store/uiStore';

export function AppShell() {
  useAppInit();
  useAutoSaveState();

  const { sidebarWidth, rightSidebarWidth } = useUiStore();

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-gray-950">
      {/* Left Sidebar */}
      <div
        style={{ width: sidebarWidth }}
        className="flex-shrink-0 border-r border-gray-800 bg-gray-900 flex flex-col"
      >
        <LeftSidebar />
      </div>

      {/* Main Terminal Area */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <TerminalPanel />
      </div>

      {/* Right Sidebar */}
      <div
        style={{ width: rightSidebarWidth }}
        className="flex-shrink-0 border-l border-gray-800 bg-gray-900 flex flex-col"
      >
        <RightSidebar />
      </div>
    </div>
  );
}
