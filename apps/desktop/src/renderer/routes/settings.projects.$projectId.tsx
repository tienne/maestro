import { createFileRoute } from '@tanstack/react-router';
import { AppShell } from '../components/layout/AppShell';
import { useUiStore } from '../store/uiStore';
import { useEffect } from 'react';

function SettingsProjectRoute() {
  const { projectId } = Route.useParams();
  const openRepoSettings = useUiStore((s) => s.openRepoSettings);

  useEffect(() => {
    // 프로젝트(레포) ID를 받아 레포지토리 설정 섹션으로 이동
    openRepoSettings(projectId);
  }, [projectId]); // eslint-disable-line react-hooks/exhaustive-deps

  return <AppShell />;
}

export const Route = createFileRoute('/settings/projects/$projectId')({
  component: SettingsProjectRoute,
});
