import { useEffect, useRef } from 'react';
import { useSessionStore } from '../store/sessionStore';
import { useSettingsStore } from '../store/settingsStore';
import { playSuccessSound, playErrorSound } from '../lib/notification-sound';
import type { Session } from '@maestro/shared-types';

/**
 * 세션 상태 변경(running→stopped, running→error) 시 알림음 재생.
 * settingsStore의 soundEnabled가 true일 때만 동작한다.
 */
export function useSessionSounds() {
  const sessions = useSessionStore((s) => s.sessions);
  // settingsStore에 soundEnabled가 없으면 기본 true
  const soundEnabled = useSettingsStore((s) => (s as unknown as { soundEnabled?: boolean }).soundEnabled ?? true);
  const prevStatusRef = useRef<Record<string, Session['status']>>({});

  useEffect(() => {
    if (!soundEnabled) return;

    const prev = prevStatusRef.current;

    for (const session of sessions) {
      const prevStatus = prev[session.id];
      const currStatus = session.status;

      if (prevStatus && prevStatus !== currStatus) {
        if (currStatus === 'stopped' && prevStatus === 'running') {
          playSuccessSound();
        } else if (currStatus === 'error') {
          playErrorSound();
        }
      }

      prev[session.id] = currStatus;
    }
  }, [sessions, soundEnabled]);
}
