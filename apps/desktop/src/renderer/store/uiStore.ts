import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
export type RightPanelTab = 'files' | 'git' | 'history' | 'merge' | 'ports' | 'markdown';
export type SplitLayout = 'single' | 'horizontal' | 'vertical';
export type CurrentView = 'terminal' | 'settings';
export type RelayStatus = 'connected' | 'connecting' | 'disconnected';

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
  settingsSection: string | null;
  blameFilePath: string | null;
  /** M3-03: 마크다운 패널 파일 경로 */
  markdownFilePath: string | null;
  /** 핀된 탭 세션 ID 목록 */
  pinnedTabs: string[];
  /** 탭 순서 (세션 ID 배열) */
  tabOrder: string[];
  /** M6-05: Relay 연결 상태 */
  relayStatus: RelayStatus;
  /** M6-05: Relay 지연 시간 (ms) */
  relayLatencyMs: number | null;

  setSidebarWidth: (w: number) => void;
  setRightSidebarWidth: (w: number) => void;
  setRightPanelTab: (tab: RightPanelTab) => void;
  setSplitLayout: (layout: SplitLayout) => void;
  setPaneSession: (paneIndex: 0 | 1, sessionId: string | null) => void;
  setActivePaneIndex: (index: 0 | 1) => void;
  setCurrentView: (view: CurrentView) => void;
  openRepoSettings: (repoId: string) => void;
  openSettings: (section?: string) => void;
  openBlame: (filePath: string) => void;
  closeBlame: () => void;
  setMarkdownFilePath: (filePath: string | null) => void;
  openMarkdownPanel: (filePath: string) => void;
  togglePinTab: (sessionId: string) => void;
  setTabOrder: (order: string[]) => void;
  setRelayStatus: (status: RelayStatus) => void;
  setRelayLatencyMs: (ms: number | null) => void;
}

export const useUiStore = create<UiStore>()(
  persist(
    (set) => ({
      sidebarWidth: 280,
      rightSidebarWidth: 320,
      rightPanelTab: 'files',
      splitLayout: 'single',
      panes: [{ sessionId: null }, { sessionId: null }],
      activePaneIndex: 0,
      currentView: 'terminal',
      settingsRepoId: null,
      settingsSection: null,
      blameFilePath: null,
      markdownFilePath: null,
      pinnedTabs: [],
      tabOrder: [],
      relayStatus: 'disconnected',
      relayLatencyMs: null,

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
      openRepoSettings: (repoId) => set({ currentView: 'settings', settingsSection: 'repositories', settingsRepoId: repoId }),
      openSettings: (section) => set({ currentView: 'settings', settingsSection: section ?? null }),
      openBlame: (filePath) => set({ blameFilePath: filePath, rightPanelTab: 'files' }),
      closeBlame: () => set({ blameFilePath: null }),
      setMarkdownFilePath: (filePath) => set({ markdownFilePath: filePath }),
      openMarkdownPanel: (filePath) => set({ markdownFilePath: filePath, rightPanelTab: 'markdown' }),

      togglePinTab: (sessionId) =>
        set((s) => {
          const pinned = s.pinnedTabs.includes(sessionId)
            ? s.pinnedTabs.filter((id) => id !== sessionId)
            : [...s.pinnedTabs, sessionId];
          return { pinnedTabs: pinned };
        }),

      setTabOrder: (order) => set({ tabOrder: order }),
      setRelayStatus: (relayStatus) => set({ relayStatus }),
      setRelayLatencyMs: (relayLatencyMs) => set({ relayLatencyMs }),
    }),
    {
      name: 'maestro-ui',
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({
        sidebarWidth: s.sidebarWidth,
        rightSidebarWidth: s.rightSidebarWidth,
        rightPanelTab: s.rightPanelTab,
        splitLayout: s.splitLayout,
        pinnedTabs: s.pinnedTabs,
        tabOrder: s.tabOrder,
      }),
    }
  )
);
