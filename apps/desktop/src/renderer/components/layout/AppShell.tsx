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
import { UpdateBanner } from '../UpdateBanner';
import { ErrorBoundary } from 'react-error-boundary';
import { ErrorFallback } from '../ErrorFallback';

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
    <div className="flex flex-col h-screen w-screen overflow-hidden" style={{ backgroundColor: 'var(--bg-primary)' }}>
      <UpdateBanner />

      {/* 메인 레이아웃 (가로 3열) */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Left Sidebar */}
        <div
          style={{ width: sidebarWidth, backgroundColor: 'var(--bg-secondary)' }}
          className="flex-shrink-0 flex flex-col"
        >
          <ErrorBoundary FallbackComponent={(props) => <ErrorFallback {...props} panelName="사이드바" />}>
            <LeftSidebar />
          </ErrorBoundary>
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
              <ErrorBoundary FallbackComponent={(props) => <ErrorFallback {...props} panelName="터미널" />}>
                {isMosaicMode ? <TiledLayout /> : <TerminalPanel />}
              </ErrorBoundary>
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
              <ErrorBoundary FallbackComponent={(props) => <ErrorFallback {...props} panelName="Git 패널" />}>
                <RightSidebar />
              </ErrorBoundary>
            </div>
          </>
        )}
        </div>
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
