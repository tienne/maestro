import { create } from 'zustand';

export type RightPanelTab = 'files' | 'git' | 'commit';
export type SplitLayout = 'single' | 'horizontal' | 'vertical';

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

  setSidebarWidth: (w: number) => void;
  setRightSidebarWidth: (w: number) => void;
  setRightPanelTab: (tab: RightPanelTab) => void;
  setSplitLayout: (layout: SplitLayout) => void;
  setPaneSession: (paneIndex: 0 | 1, sessionId: string | null) => void;
  setActivePaneIndex: (index: 0 | 1) => void;
}

export const useUiStore = create<UiStore>((set) => ({
  sidebarWidth: 280,
  rightSidebarWidth: 320,
  rightPanelTab: 'files',
  splitLayout: 'single',
  panes: [{ sessionId: null }, { sessionId: null }],
  activePaneIndex: 0,

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
}));
