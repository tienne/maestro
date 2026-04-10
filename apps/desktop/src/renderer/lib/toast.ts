/**
 * Maestro notify helper — OS 알림(Web Notifications API) 기반
 * Electron 렌더러는 권한 요청 없이 알림 사용 가능.
 * soundEnabled 설정에 따라 silent 옵션 자동 적용.
 */
import { useSettingsStore } from '../store/settingsStore';

function osNotify(title: string, body?: string): void {
  const { soundEnabled } = useSettingsStore.getState();
  new window.Notification(title, {
    body,
    silent: !soundEnabled,
  });
}

export const toast = {
  success: (msg: string, description?: string) => osNotify(msg, description),
  error: (msg: string, description?: string) => osNotify(msg, description),
  info: (msg: string, description?: string) => osNotify(msg, description),
  // OS 알림은 loading 상태를 지원하지 않음 — no-op
  loading: (_msg: string) => undefined,
  dismiss: (_id?: string | number) => undefined,
};
