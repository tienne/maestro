import { useState, useCallback, useEffect, lazy, Suspense } from 'react';
import { useAppInit, useAutoSaveState, useAutoSaveLayout } from '../../hooks/useAppInit';
import { useAppHotkeys } from '../../hooks/useAppHotkeys';
import { useDeepLink } from '../../hooks/useDeepLink';
import { useSessionSounds } from '../../hooks/useSessionSounds';
import { LeftSidebar } from '../sidebar/LeftSidebar';
import { CenterPanel } from './CenterPanel';
import { CommandPalette } from '../modals/CommandPalette';
import { ShortcutsModal } from '../modals/ShortcutsModal';
import { OnboardingWizard } from '../onboarding/OnboardingWizard';
import { useUiStore } from '../../store/uiStore';
import { useSettingsStore } from '../../store/settingsStore';
import { useRepositoryStore } from '../../store/repositoryStore';
import { UpdateBanner } from '../UpdateBanner';
import { TitleBar } from './TitleBar';
import { ErrorBoundary } from 'react-error-boundary';
import { ErrorFallback } from '../ErrorFallback';

// M7-05: 무거운 컴포넌트들 lazy import
const RightSidebar = lazy(() => import('../git-panel/RightSidebar').then((m) => ({ default: m.RightSidebar })));
const SettingsPage = lazy(() => import('../settings/SettingsPage').then((m) => ({ default: m.SettingsPage })));

function LazyFallback() {
  return (
    <div className="flex items-center justify-center h-full w-full" style={{ color: 'var(--text-muted)' }}>
      <span className="text-xs">Loading...</span>
    </div>
  );
}

const MIN_SIDEBAR = 160;
const MAX_SIDEBAR = 520;

export function AppShell() {
  useAppInit();
  useAutoSaveState();
  useAutoSaveLayout();

  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const openCommandPalette = useCallback(() => setCommandPaletteOpen(true), []);
  useAppHotkeys(openCommandPalette);
  useDeepLink();
  useSessionSounds();

  // M8-01: 온보딩 판단 — 레포 0개 + onboardingCompleted=false
  const onboardingCompleted = useSettingsStore((s) => s.onboardingCompleted);
  const repositories = useRepositoryStore((s) => s.repositories);
  useEffect(() => {
    if (!onboardingCompleted && repositories.length === 0) {
      setShowOnboarding(true);
    }
  }, [onboardingCompleted, repositories.length]);

  // M8-05: 앱 테마 및 액센트 컬러 적용
  const appThemeName = useSettingsStore((s) => s.appThemeName);
  const accentColor = useSettingsStore((s) => s.accentColor);
  useEffect(() => {
    const html = document.documentElement;
    if (appThemeName === 'default') {
      html.removeAttribute('data-theme');
    } else {
      html.setAttribute('data-theme', appThemeName);
    }
  }, [appThemeName]);

  useEffect(() => {
    document.documentElement.style.setProperty('--accent', accentColor);
  }, [accentColor]);

  // M8-03: ? 키로 단축키 모달 토글
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // 입력 필드나 textarea에서는 무시
      const tag = (e.target as HTMLElement).tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      if (e.key === '?' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        setShortcutsOpen((prev) => !prev);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  const {
    sidebarWidth,
    rightSidebarWidth,
    currentView,
    settingsSection,
    setSidebarWidth,
    setRightSidebarWidth,
  } = useUiStore();

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
      <TitleBar />
      <UpdateBanner />

      {/* 메인 레이아웃 (가로 3열) */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Left Sidebar — 설정 페이지에서는 숨김 */}
        {currentView !== 'settings' && (
          <>
            <div
              style={{ width: sidebarWidth, backgroundColor: 'var(--bg-secondary)' }}
              className="flex-shrink-0 flex flex-col"
            >
              <ErrorBoundary FallbackComponent={(props) => <ErrorFallback {...props} panelName="사이드바" />}>
                <LeftSidebar />
              </ErrorBoundary>
            </div>
            <div
              className="w-1 flex-shrink-0 cursor-col-resize transition-colors hover:bg-[var(--accent)]"
              style={{ backgroundColor: 'var(--border)' }}
              onMouseDown={handleLeftResizeMouseDown}
            />
          </>
        )}

        {/* Main Content Area */}
        <div className="flex-1 flex min-w-0 overflow-hidden">
        {currentView === 'settings' ? (
          <div className="flex-1 overflow-hidden" style={{ backgroundColor: 'var(--bg-primary)' }}>
            <Suspense fallback={<LazyFallback />}>
              <SettingsPage initialSection={(settingsSection as any) ?? 'appearance'} />
            </Suspense>
          </div>
        ) : (
          <>
            <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
              <ErrorBoundary FallbackComponent={(props) => <ErrorFallback {...props} panelName="메인 패널" />}>
                <CenterPanel />
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
                <Suspense fallback={<LazyFallback />}>
                  <RightSidebar />
                </Suspense>
              </ErrorBoundary>
            </div>
          </>
        )}
        </div>
      </div>

      <CommandPalette
        open={commandPaletteOpen}
        onClose={() => setCommandPaletteOpen(false)}
      />

      {/* M8-03: 단축키 치트시트 모달 */}
      {shortcutsOpen && (
        <ShortcutsModal onClose={() => setShortcutsOpen(false)} />
      )}

      {/* M8-01: 온보딩 위자드 */}
      {showOnboarding && (
        <OnboardingWizard onClose={() => setShowOnboarding(false)} />
      )}
    </div>
  );
}
