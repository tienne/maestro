import { useTheme } from '../ThemeProvider';

interface Props {
  onClose: () => void;
}

export function SettingsModal({ onClose }: Props) {
  const { theme, fontSize, setTheme, setFontSize } = useTheme();

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      onClick={onClose}
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60" />

      {/* Modal */}
      <div
        className="relative rounded-xl shadow-2xl w-[400px] p-6 flex flex-col gap-6"
        style={{
          backgroundColor: 'var(--bg-panel)',
          border: '1px solid var(--border)',
          color: 'var(--text-primary)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>
            설정
          </h2>
          <button
            onClick={onClose}
            className="w-7 h-7 flex items-center justify-center rounded-md transition-colors"
            style={{ color: 'var(--text-secondary)' }}
            onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--bg-hover)')}
            onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
          >
            ×
          </button>
        </div>

        {/* Theme Section */}
        <section className="flex flex-col gap-3">
          <h3 className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>
            테마
          </h3>
          <div className="flex flex-col gap-2">
            {(
              [
                { value: 'dark', label: 'Dracula 다크', desc: '어두운 배경, 보라/시안 포인트' },
                { value: 'light', label: 'Notion 라이트', desc: '오프화이트 배경, 따뜻한 톤' },
              ] as const
            ).map(({ value, label, desc }) => (
              <label
                key={value}
                className="flex items-center gap-3 p-3 rounded-lg cursor-pointer transition-colors"
                style={{
                  backgroundColor: theme === value ? 'var(--bg-active)' : 'var(--bg-secondary)',
                  border: `1px solid ${theme === value ? 'var(--accent)' : 'var(--border)'}`,
                }}
              >
                <input
                  type="radio"
                  name="theme"
                  value={value}
                  checked={theme === value}
                  onChange={() => setTheme(value)}
                  className="sr-only"
                />
                <span
                  className="w-4 h-4 rounded-full border-2 flex-shrink-0 flex items-center justify-center"
                  style={{
                    borderColor: theme === value ? 'var(--accent)' : 'var(--border)',
                    backgroundColor: theme === value ? 'var(--accent)' : 'transparent',
                  }}
                >
                  {theme === value && (
                    <span className="w-1.5 h-1.5 rounded-full bg-white" />
                  )}
                </span>
                <div className="flex flex-col">
                  <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                    {label}
                  </span>
                  <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                    {desc}
                  </span>
                </div>
              </label>
            ))}
          </div>
        </section>

        {/* Font Size Section */}
        <section className="flex flex-col gap-3">
          <h3 className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>
            폰트 크기
          </h3>
          <div
            className="flex rounded-lg overflow-hidden"
            style={{ border: '1px solid var(--border)' }}
          >
            {(
              [
                { value: 'small', label: '소', size: '12px' },
                { value: 'medium', label: '중', size: '14px' },
                { value: 'large', label: '대', size: '16px' },
              ] as const
            ).map(({ value, label, size }, i) => (
              <button
                key={value}
                onClick={() => setFontSize(value)}
                className="flex-1 py-2 text-sm flex flex-col items-center gap-0.5 transition-colors"
                style={{
                  backgroundColor: fontSize === value ? 'var(--accent)' : 'var(--bg-secondary)',
                  color: fontSize === value ? '#fff' : 'var(--text-secondary)',
                  borderRight: i < 2 ? '1px solid var(--border)' : undefined,
                  fontWeight: fontSize === value ? 700 : 400,
                }}
              >
                <span style={{ fontSize: size }}>{label}</span>
                <span className="text-xs opacity-70">{size}</span>
              </button>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
