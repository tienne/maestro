import { createFileRoute } from '@tanstack/react-router';
import { AppShell } from '../components/layout/AppShell';
import { useUiStore } from '../store/uiStore';
import { useWorkspaceStore } from '../store/workspaceStore';
import { useEffect } from 'react';

function WorkspaceRoute() {
  const { workspaceId } = Route.useParams();
  const setCurrentView = useUiStore((s) => s.setCurrentView);
  const setActiveWorkspace = useWorkspaceStore((s) => s.setActiveWorkspace);

  useEffect(() => {
    // 워크스페이스 라우트: 터미널 뷰로 전환 + 활성 워크스페이스 동기화
    setCurrentView('terminal');
    setActiveWorkspace(workspaceId);
  }, [workspaceId, setCurrentView, setActiveWorkspace]);

  return <AppShell />;
}

export const Route = createFileRoute('/workspace/$workspaceId')({
  component: WorkspaceRoute,
});
