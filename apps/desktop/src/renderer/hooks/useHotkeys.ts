import { useEffect } from 'react';
import hotkeys from 'hotkeys-js';

type HotkeyHandler = (e: KeyboardEvent) => void;

/**
 * 전역 단축키 등록 훅.
 * - IME 조합 중(isComposing)에는 핸들러를 실행하지 않는다.
 * - 마운트 해제 시 자동으로 단축키를 해제한다.
 */
export function useHotkeys(key: string, handler: HotkeyHandler, deps: unknown[] = []) {
  useEffect(() => {
    const wrapped = (e: KeyboardEvent) => {
      if (e.isComposing) return;
      handler(e);
    };
    hotkeys(key, wrapped);
    return () => {
      hotkeys.unbind(key, wrapped);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}
