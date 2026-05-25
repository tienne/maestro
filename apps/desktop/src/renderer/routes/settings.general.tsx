import { createFileRoute } from '@tanstack/react-router';
import { AppShell } from '../components/layout/AppShell';
import { useUiStore } from '../store/uiStore';
import { useEffect } from 'react';

function SettingsGeneralRoute() {
  const openSettings = useUiStore((s) => s.openSettings);

  useEffect(() => {
    // 일반 설정 라우트: 외관 섹션으로 설정 페이지 열기
    openSettings('appearance');
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  return <AppShell />;
}

export const Route = createFileRoute('/settings/general')({
  component: SettingsGeneralRoute,
});
