import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

export type AppTheme = 'dark' | 'light' | 'system';
export type FontSize = 'sm' | 'md' | 'lg';

interface SettingsStore {
  theme: AppTheme;
  fontSize: FontSize;
  terminalFontSize: number;
  soundEnabled: boolean;
  telemetryEnabled: boolean;

  setTheme: (theme: AppTheme) => void;
  setFontSize: (size: FontSize) => void;
  setTerminalFontSize: (size: number) => void;
  setSoundEnabled: (enabled: boolean) => void;
  setTelemetryEnabled: (enabled: boolean) => void;
}

export const useSettingsStore = create<SettingsStore>()(
  persist(
    (set) => ({
      theme: 'dark',
      fontSize: 'md',
      terminalFontSize: 13,
      soundEnabled: true,
      telemetryEnabled: false, // 옵트인 방식 — 기본 비활성화

      setTheme: (theme) => set({ theme }),
      setFontSize: (size) => set({ fontSize: size }),
      setTerminalFontSize: (size) => set({ terminalFontSize: size }),
      setSoundEnabled: (enabled) => set({ soundEnabled: enabled }),
      setTelemetryEnabled: (enabled) => {
        set({ telemetryEnabled: enabled });
        // 즉시 posthog opt-in/out
        import('../lib/telemetry').then(({ telemetry }) => telemetry.setEnabled(enabled));
      },
    }),
    {
      name: 'maestro-settings',
      storage: createJSONStorage(() => localStorage),
    }
  )
);
