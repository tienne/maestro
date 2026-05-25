import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { useEffect, useRef } from 'react';
import { AppShell } from '../components/layout/AppShell';
import { trpc } from '../lib/trpc';
import type { AppState, Workspace } from '@maestro/shared-types';

function IndexRoute() {
  const navigate = useNavigate();
  const hasNavigated = useRef(false);

  const appStateQuery = trpc.ui.loadState.useQuery();
  const workspaceQuery = trpc.workspace.list.useQuery(undefined, {
    enabled: appStateQuery.isSuccess && !(appStateQuery.data as AppState | null)?.activeWorkspaceId,
  });

  useEffect(() => {
    if (hasNavigated.current) return;

    const appState = appStateQuery.data as AppState | null | undefined;

    // 마지막 활성 workspace로 바로 이동
    if (appState?.activeWorkspaceId) {
      hasNavigated.current = true;
      void navigate({
        to: '/workspace/$workspaceId',
        params: { workspaceId: appState.activeWorkspaceId },
        replace: true,
      });
      return;
    }

    // activeWorkspaceId 없으면 첫 번째 workspace로 이동
    const workspaces = workspaceQuery.data as Workspace[] | null | undefined;
    if (appStateQuery.isSuccess && workspaces && workspaces.length > 0) {
      hasNavigated.current = true;
      void navigate({
        to: '/workspace/$workspaceId',
        params: { workspaceId: workspaces[0].id },
        replace: true,
      });
    }
  }, [
    appStateQuery.data,
    appStateQuery.isSuccess,
    workspaceQuery.data,
    navigate,
  ]);

  return <AppShell />;
}

export const Route = createFileRoute('/')({
  component: IndexRoute,
});
