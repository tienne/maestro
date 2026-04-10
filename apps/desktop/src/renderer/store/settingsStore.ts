import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

export type AppTheme = 'dark' | 'light' | 'system';
export type FontSize = 'sm' | 'md' | 'lg';

interface SettingsStore {
  theme: AppTheme;
  fontSize: FontSize;
  terminalFontSize: number;
  soundEnabled: boolean;

  setTheme: (theme: AppTheme) => void;
  setFontSize: (size: FontSize) => void;
  setTerminalFontSize: (size: number) => void;
  setSoundEnabled: (enabled: boolean) => void;
}

export const useSettingsStore = create<SettingsStore>()(
  persist(
    (set) => ({
      theme: 'dark',
      fontSize: 'md',
      terminalFontSize: 13,
      soundEnabled: true,

      setTheme: (theme) => set({ theme }),
      setFontSize: (size) => set({ fontSize: size }),
      setTerminalFontSize: (size) => set({ terminalFontSize: size }),
      setSoundEnabled: (enabled) => set({ soundEnabled: enabled }),
    }),
    {
      name: 'maestro-settings',
      storage: createJSONStorage(() => localStorage),
    }
  )
);
