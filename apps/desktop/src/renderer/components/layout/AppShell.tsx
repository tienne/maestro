import { useAppInit, useAutoSaveState, useAutoSaveLayout } from '../../hooks/useAppInit';
import { LeftSidebar } from '../sidebar/LeftSidebar';
import { TerminalPanel } from '../terminal/TerminalPanel';
import { TiledLayout } from './TiledLayout';
import { RightSidebar } from '../git-panel/RightSidebar';
import { RepoSettingsPage } from '../repo-settings/RepoSettingsPage';
import { SessionResumeModal } from '../modals/SessionResumeModal';
import { useUiStore } from '../../store/uiStore';
import { useLayoutStore } from '../../store/layoutStore';
import { Toaster } from 'sonner';
import { useTheme } from '../ThemeProvider';

const MIN_SIDEBAR = 160;
const MAX_SIDEBAR = 520;

export function AppShell() {
  useAppInit();
  useAutoSaveState();
  useAutoSaveLayout();

  const { theme } = useTheme();

  const {
    sidebarWidth,
    rightSidebarWidth,
    currentView,
    settingsRepoId,
    pendingResumeSession,
    setSidebarWidth,
    setRightSidebarWidth,
  } = useUiStore();

  const { mosaicState } = useLayoutStore();
  const isMosaicMode = mosaicState !== null;

  const handleLeftResizeMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = sidebarWidth;
    const onMove = (ev: MouseEvent) => {
      setSidebarWidth(Math.max(MIN_SIDEBAR, Math.min(MAX_SIDEBAR, startWidth + (ev.clientX - startX))));
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  const handleRightResizeMouseDown = (e: React.MouseEvent) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = rightSidebarWidth;
    const onMove = (ev: MouseEvent) => {
      setRightSidebarWidth(Math.max(MIN_SIDEBAR, Math.min(MAX_SIDEBAR, startWidth - (ev.clientX - startX))));
    };
    const onUp = () => {
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  return (
    <div className="flex h-screen w-screen overflow-hidden" style={{ backgroundColor: 'var(--bg-primary)' }}>
      {/* Left Sidebar */}
      <div
        style={{ width: sidebarWidth, backgroundColor: 'var(--bg-secondary)' }}
        className="flex-shrink-0 flex flex-col"
      >
        <LeftSidebar />
      </div>

      {/* Left Resize Handle */}
      <div
        className="w-1 flex-shrink-0 cursor-col-resize transition-colors hover:bg-[var(--accent)]"
        style={{ backgroundColor: 'var(--border)' }}
        onMouseDown={handleLeftResizeMouseDown}
      />

      {/* Main Content Area */}
      <div className="flex-1 flex min-w-0 overflow-hidden">
        {currentView === 'repoSettings' && settingsRepoId ? (
          <div className="flex-1 overflow-hidden" style={{ backgroundColor: 'var(--bg-primary)' }}>
            <RepoSettingsPage repositoryId={settingsRepoId} />
          </div>
        ) : (
          <>
            <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
              {isMosaicMode ? <TiledLayout /> : <TerminalPanel />}
            </div>
            {/* Right Resize Handle */}
            <div
              className="w-1 flex-shrink-0 cursor-col-resize transition-colors hover:bg-[var(--accent)]"
              style={{ backgroundColor: 'var(--border)' }}
              onMouseDown={handleRightResizeMouseDown}
            />
            <div
              style={{ width: rightSidebarWidth, backgroundColor: 'var(--bg-secondary)' }}
              className="flex-shrink-0 flex flex-col"
            >
              <RightSidebar />
            </div>
          </>
        )}
      </div>

      {pendingResumeSession && (
        <SessionResumeModal
          session={pendingResumeSession}
          onClose={() => {}}
        />
      )}

      {/* 전역 토스트 — 앱 테마와 동기화 */}
      <Toaster
        theme={theme}
        position="bottom-right"
        richColors
        closeButton
        toastOptions={{ duration: 4000 }}
      />
    </div>
  );
}
