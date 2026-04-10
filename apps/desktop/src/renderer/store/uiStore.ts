import { create } from 'zustand';
import type { Session } from '@maestro/shared-types';

export type RightPanelTab = 'files' | 'git' | 'commit' | 'merge' | 'ports';
export type SplitLayout = 'single' | 'horizontal' | 'vertical';
export type CurrentView = 'terminal' | 'repoSettings';

interface PaneState {
  sessionId: string | null;
}

interface UiStore {
  sidebarWidth: number;
  rightSidebarWidth: number;
  rightPanelTab: RightPanelTab;
  splitLayout: SplitLayout;
  panes: [PaneState, PaneState]; // left pane, right pane
  activePaneIndex: 0 | 1;
  currentView: CurrentView;
  settingsRepoId: string | null;
  pendingResumeSession: Session | null;

  setSidebarWidth: (w: number) => void;
  setRightSidebarWidth: (w: number) => void;
  setRightPanelTab: (tab: RightPanelTab) => void;
  setSplitLayout: (layout: SplitLayout) => void;
  setPaneSession: (paneIndex: 0 | 1, sessionId: string | null) => void;
  setActivePaneIndex: (index: 0 | 1) => void;
  setCurrentView: (view: CurrentView) => void;
  openRepoSettings: (repoId: string) => void;
  setPendingResumeSession: (session: Session | null) => void;
}

export const useUiStore = create<UiStore>((set) => ({
  sidebarWidth: 280,
  rightSidebarWidth: 320,
  rightPanelTab: 'files',
  splitLayout: 'single',
  panes: [{ sessionId: null }, { sessionId: null }],
  activePaneIndex: 0,
  currentView: 'terminal',
  settingsRepoId: null,
  pendingResumeSession: null,

  setSidebarWidth: (w) => set({ sidebarWidth: w }),
  setRightSidebarWidth: (w) => set({ rightSidebarWidth: w }),
  setRightPanelTab: (tab) => set({ rightPanelTab: tab }),
  setSplitLayout: (layout) => set({ splitLayout: layout }),

  setPaneSession: (paneIndex, sessionId) =>
    set((s) => {
      const panes = [...s.panes] as [PaneState, PaneState];
      panes[paneIndex] = { sessionId };
      return { panes };
    }),

  setActivePaneIndex: (index) => set({ activePaneIndex: index }),
  setCurrentView: (view) => set({ currentView: view }),
  openRepoSettings: (repoId) => set({ currentView: 'repoSettings', settingsRepoId: repoId }),
  setPendingResumeSession: (session) => set({ pendingResumeSession: session }),
}));
