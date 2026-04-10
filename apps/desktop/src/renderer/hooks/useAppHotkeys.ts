import { useEffect } from 'react';
import hotkeys from 'hotkeys-js';
import { useUiStore } from '../store/uiStore';
import { useSessionStore } from '../store/sessionStore';

/**
 * 앱 전역 단축키 등록.
 * AppShell에서 한 번만 호출한다.
 *
 * 터미널(xterm) 내부 포커스 중에도 xterm은 자체 이벤트를 먼저 소비하므로
 * 충돌은 발생하지 않는다.
 */
export function useAppHotkeys(onOpenCommandPalette: () => void) {
  const sessions = useSessionStore((s) => s.sessions);

  useEffect(() => {
    const prevent = (e: KeyboardEvent) => e.preventDefault();

    // ⌘K — 커맨드 팔레트
    hotkeys('command+k,ctrl+k', (e) => {
      prevent(e);
      onOpenCommandPalette();
    });

    // ⌘B — 좌측 사이드바 토글
    hotkeys('command+b,ctrl+b', (e) => {
      prevent(e);
      const { sidebarWidth, setSidebarWidth } = useUiStore.getState();
      setSidebarWidth(sidebarWidth > 0 ? 0 : 280);
    });

    // ⌘\ — 터미널 분할 (vertical)
    hotkeys('command+\\,ctrl+\\', (e) => {
      prevent(e);
      useUiStore.getState().setSplitLayout('vertical');
    });

    // ⌘Shift+\ — 터미널 분할 (horizontal)
    hotkeys('command+shift+\\,ctrl+shift+\\', (e) => {
      prevent(e);
      useUiStore.getState().setSplitLayout('horizontal');
    });

    // ⌘G — Git 패널 포커스
    hotkeys('command+g,ctrl+g', (e) => {
      prevent(e);
      useUiStore.getState().setRightPanelTab('git');
    });

    // ⌘Shift+N — 새 윈도우
    hotkeys('command+shift+n,ctrl+shift+n', (e) => {
      prevent(e);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (window as any).electron?.ipcRenderer?.send('window:new');
    });

    // ⌘1~9 — 세션 전환
    const sessionKeys = '1,2,3,4,5,6,7,8,9';
    hotkeys(`command+${sessionKeys},ctrl+${sessionKeys}`.replace(/,/g, ',command+').replace(/^/, ''), (e, handler) => {
      prevent(e);
      const num = parseInt(handler.key.replace(/[^0-9]/g, ''), 10);
      const target = useSessionStore.getState().sessions[num - 1];
      if (target) {
        useUiStore.getState().setPaneSession(0, target.id);
      }
    });

    return () => {
      hotkeys.unbind('command+k,ctrl+k');
      hotkeys.unbind('command+b,ctrl+b');
      hotkeys.unbind('command+\\,ctrl+\\');
      hotkeys.unbind('command+shift+\\,ctrl+shift+\\');
      hotkeys.unbind('command+g,ctrl+g');
      hotkeys.unbind('command+shift+n,ctrl+shift+n');
    };
  }, [onOpenCommandPalette]);

  // sessions 변경 시 세션 전환 단축키 재등록
  useEffect(() => {
    const keys = Array.from({ length: 9 }, (_, i) => `command+${i + 1},ctrl+${i + 1}`).join(',');
    hotkeys(keys, (e, handler) => {
      if (e.isComposing) return;
      e.preventDefault();
      const num = parseInt(handler.key.slice(-1), 10);
      const target = sessions[num - 1];
      if (target) {
        useUiStore.getState().setPaneSession(0, target.id);
      }
    });
    return () => {
      for (let i = 1; i <= 9; i++) {
        hotkeys.unbind(`command+${i},ctrl+${i}`);
      }
    };
  }, [sessions]);
}
