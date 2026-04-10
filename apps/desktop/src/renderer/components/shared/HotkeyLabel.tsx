const isMac = navigator.platform.toUpperCase().includes('MAC');

/**
 * 단축키 표기 컴포넌트.
 * macOS: ⌘ / 그 외: Ctrl
 * 예) <HotkeyLabel keys={['cmd', 'k']} /> → "⌘K"
 */
export function HotkeyLabel({ keys }: { keys: string[] }) {
  const formatted = keys.map((k) => {
    switch (k.toLowerCase()) {
      case 'cmd':
      case 'command':
        return isMac ? '⌘' : 'Ctrl';
      case 'shift':
        return '⇧';
      case 'alt':
      case 'option':
        return isMac ? '⌥' : 'Alt';
      case 'ctrl':
        return isMac ? '⌃' : 'Ctrl';
      default:
        return k.toUpperCase();
    }
  });

  return (
    <span className="inline-flex items-center gap-0.5 font-mono text-[10px] opacity-60">
      {formatted.join('')}
    </span>
  );
}
