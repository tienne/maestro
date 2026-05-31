import { Suspense, lazy } from 'react';
import { ErrorBoundary } from 'react-error-boundary';
import { ErrorFallback } from '../ErrorFallback';
import { TerminalPanel } from '../terminal/TerminalPanel';
import { useLayoutStore } from '../../store/layoutStore';

const TiledLayout = lazy(() => import('./TiledLayout').then((m) => ({ default: m.TiledLayout })));

function LazyFallback() {
  return (
    <div className="flex items-center justify-center h-full w-full" style={{ color: 'var(--text-muted)' }}>
      <span className="text-xs">Loading...</span>
    </div>
  );
}

export function CenterPanel() {
  const { mosaicState } = useLayoutStore();

  if (mosaicState !== null) {
    return (
      <ErrorBoundary FallbackComponent={(props) => <ErrorFallback {...props} panelName="터미널" />}>
        <Suspense fallback={<LazyFallback />}>
          <TiledLayout />
        </Suspense>
      </ErrorBoundary>
    );
  }

  return (
    <ErrorBoundary FallbackComponent={(props) => <ErrorFallback {...props} panelName="터미널" />}>
      <TerminalPanel taskWorkspaceId={null} />
    </ErrorBoundary>
  );
}
