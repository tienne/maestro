/**
 * M10-03: 테마 커스터마이저.
 * CSS 변수를 직접 편집하고 즉시 미리보기할 수 있다.
 * 테마를 .maestro-theme.json으로 내보내기/가져오기 지원.
 */

import { useState, useEffect } from 'react';
import { useSettingsStore } from '../../store/settingsStore';
import { trpc } from '../../lib/trpc';
import { toast } from '../../lib/toast';

const DEFAULT_VARIABLES: Record<string, string> = {
  '--bg-primary': '#1e1e2e',
  '--bg-secondary': '#181825',
  '--bg-panel': '#1e1e2e',
  '--bg-hover': '#313244',
  '--bg-active': '#45475a',
  '--accent': '#e07850',
  '--text-primary': '#cdd6f4',
  '--text-secondary': '#a6adc8',
  '--text-muted': '#6c7086',
  '--border': '#313244',
  '--tab-active-bg': '#1e1e2e',
  '--tab-active-text': '#cdd6f4',
  '--tab-inactive-bg': '#181825',
  '--tab-inactive-text': '#6c7086',
};

export function ThemeEditor() {
  const { customThemeVariables, customThemeName, applyCustomTheme, setCustomThemeName } = useSettingsStore();
  const [variables, setVariables] = useState<Record<string, string>>(() => {
    // 기존 커스텀 변수가 있으면 그걸로, 없으면 현재 computed 값으로 초기화
    if (Object.keys(customThemeVariables).length > 0) {
      return { ...DEFAULT_VARIABLES, ...customThemeVariables };
    }
    const computed: Record<string, string> = {};
    const style = getComputedStyle(document.documentElement);
    for (const key of Object.keys(DEFAULT_VARIABLES)) {
      computed[key] = style.getPropertyValue(key).trim() || DEFAULT_VARIABLES[key];
    }
    return computed;
  });
  const [themeName, setThemeName] = useState(customThemeName || 'My Custom Theme');

  const exportThemeMutation = trpc.theme.export.useMutation({
    onSuccess: (result) => {
      if (result.success) {
        toast.success(`Theme exported to ${result.filePath}`);
      }
    },
    onError: (err) => toast.error(`Export failed: ${err.message}`),
  });

  const importThemeMutation = trpc.theme.import.useMutation({
    onSuccess: (result) => {
      if (result) {
        setVariables({ ...DEFAULT_VARIABLES, ...result.variables });
        setThemeName(result.name);
        applyCustomTheme(result.variables);
        setCustomThemeName(result.name);
        toast.success(`Theme "${result.name}" imported`);
      }
    },
    onError: (err) => toast.error(`Import failed: ${err.message}`),
  });

  const handleColorChange = (key: string, value: string) => {
    setVariables((prev) => ({ ...prev, [key]: value }));
    document.documentElement.style.setProperty(key, value);
  };

  const handleApply = () => {
    applyCustomTheme(variables);
    setCustomThemeName(themeName);
    toast.success('Theme applied');
  };

  const handleReset = () => {
    for (const key of Object.keys(variables)) {
      document.documentElement.style.removeProperty(key);
    }
    setVariables(DEFAULT_VARIABLES);
    applyCustomTheme({});
    setCustomThemeName('');
    toast.success('Theme reset to default');
  };

  // 변수 이름을 표시용 라벨로 변환
  const toLabel = (key: string) => key.replace(/^--/, '').replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

  return (
    <div className="flex flex-col gap-4 max-w-lg">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
          Theme Editor
        </h3>
        <div className="flex gap-2">
          <button
            onClick={() => importThemeMutation.mutate()}
            className="text-xs px-3 py-1.5 rounded"
            style={{ color: 'var(--text-secondary)', backgroundColor: 'var(--bg-primary)', border: '1px solid var(--border)' }}
          >
            Import Theme
          </button>
          <button
            onClick={() => exportThemeMutation.mutate({ name: themeName, variables })}
            className="text-xs px-3 py-1.5 rounded"
            style={{ color: 'var(--text-secondary)', backgroundColor: 'var(--bg-primary)', border: '1px solid var(--border)' }}
          >
            Export Theme
          </button>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <label className="text-xs" style={{ color: 'var(--text-secondary)' }}>Theme Name</label>
        <input
          value={themeName}
          onChange={(e) => setThemeName(e.target.value)}
          className="flex-1 text-xs rounded px-2 py-1.5 outline-none border"
          style={{ backgroundColor: 'var(--bg-primary)', color: 'var(--text-primary)', borderColor: 'var(--border)' }}
        />
      </div>

      <div className="grid grid-cols-2 gap-3">
        {Object.entries(variables).map(([key, value]) => (
          <label key={key} className="flex items-center gap-2">
            <input
              type="color"
              value={value}
              onChange={(e) => handleColorChange(key, e.target.value)}
              className="w-8 h-8 rounded cursor-pointer border-0"
              style={{ backgroundColor: value }}
            />
            <div className="flex flex-col">
              <span className="text-[11px] font-medium" style={{ color: 'var(--text-primary)' }}>
                {toLabel(key)}
              </span>
              <span className="text-[10px] font-mono" style={{ color: 'var(--text-muted)' }}>
                {value}
              </span>
            </div>
          </label>
        ))}
      </div>

      {/* Preview */}
      <div
        className="rounded-lg p-4 border"
        style={{ backgroundColor: variables['--bg-primary'], borderColor: variables['--border'] }}
      >
        <span className="text-xs font-semibold" style={{ color: variables['--text-primary'] }}>
          Preview
        </span>
        <div className="flex gap-2 mt-2">
          <div
            className="rounded px-3 py-1.5 text-xs"
            style={{ backgroundColor: variables['--accent'], color: '#fff' }}
          >
            Accent Button
          </div>
          <div
            className="rounded px-3 py-1.5 text-xs border"
            style={{
              backgroundColor: variables['--bg-secondary'],
              color: variables['--text-secondary'],
              borderColor: variables['--border'],
            }}
          >
            Secondary
          </div>
        </div>
        <div className="mt-2 text-[11px]" style={{ color: variables['--text-muted'] }}>
          Muted text preview
        </div>
      </div>

      <div className="flex gap-2 justify-end">
        <button
          onClick={handleReset}
          className="text-xs px-3 py-1.5 rounded"
          style={{ color: 'var(--text-secondary)', backgroundColor: 'var(--bg-primary)', border: '1px solid var(--border)' }}
        >
          Reset to Default
        </button>
        <button
          onClick={handleApply}
          className="text-xs px-3 py-1.5 rounded text-white"
          style={{ backgroundColor: 'var(--accent)' }}
        >
          Apply Theme
        </button>
      </div>
    </div>
  );
}
