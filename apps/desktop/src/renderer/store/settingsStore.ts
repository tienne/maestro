import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

export type AppTheme = 'dark' | 'light' | 'system';
export type FontSize = 'sm' | 'md' | 'lg';
export type TerminalThemeName = 'default' | 'dracula' | 'solarized-dark' | 'one-dark' | 'nord';
export type TerminalFontFamily = 'JetBrains Mono' | 'Fira Code' | 'Cascadia Code' | 'Courier New';
export type AppThemeName = 'default' | 'catppuccin' | 'nord' | 'gruvbox' | 'one-dark-pro';

interface SettingsStore {
  theme: AppTheme;
  fontSize: FontSize;
  terminalFontSize: number;
  soundEnabled: boolean;
  telemetryEnabled: boolean;
  terminalTheme: TerminalThemeName;
  terminalFont: TerminalFontFamily;
  /** M3-01: 세션 비용 경고 임계값 (USD). 초과 시 토스트 알림 */
  costWarningThreshold: number;
  /** M7-01: 터미널 scrollback 라인 수 (기본 5000, 최대 20000) */
  scrollbackLines: number;
  /** M7-02: CPU 사용률 경고 임계값 (%) */
  cpuAlertThreshold: number;
  /** M7-02: 메모리 사용량 경고 임계값 (MB) */
  memAlertThresholdMb: number;
  /** M7-03: 세션 자동 정리 주기 (일) */
  sessionGcDays: number;
  /** M8-01: 온보딩 완료 여부 */
  onboardingCompleted: boolean;
  /** M8-05: 액센트 컬러 */
  accentColor: string;
  /** M8-05: 앱 테마 (내장 테마) */
  appThemeName: AppThemeName;
  /** M9-04: 세션 아카이브 자동 저장 */
  archiveEnabled: boolean;
  /** M10-03: 커스텀 테마 CSS 변수 */
  customThemeVariables: Record<string, string>;
  /** M10-03: 커스텀 테마 이름 */
  customThemeName: string;

  setTheme: (theme: AppTheme) => void;
  setFontSize: (size: FontSize) => void;
  setTerminalFontSize: (size: number) => void;
  setSoundEnabled: (enabled: boolean) => void;
  setTelemetryEnabled: (enabled: boolean) => void;
  setTerminalTheme: (theme: TerminalThemeName) => void;
  setTerminalFont: (font: TerminalFontFamily) => void;
  setCostWarningThreshold: (threshold: number) => void;
  setScrollbackLines: (lines: number) => void;
  setCpuAlertThreshold: (threshold: number) => void;
  setMemAlertThresholdMb: (threshold: number) => void;
  setSessionGcDays: (days: number) => void;
  setOnboardingCompleted: (completed: boolean) => void;
  setAccentColor: (color: string) => void;
  setAppThemeName: (name: AppThemeName) => void;
  setArchiveEnabled: (enabled: boolean) => void;
  setCustomThemeVariables: (variables: Record<string, string>) => void;
  setCustomThemeName: (name: string) => void;
  applyCustomTheme: (variables: Record<string, string>) => void;
}

export const useSettingsStore = create<SettingsStore>()(
  persist(
    (set) => ({
      theme: 'dark',
      fontSize: 'md',
      terminalFontSize: 13,
      soundEnabled: true,
      telemetryEnabled: false, // 옵트인 방식 — 기본 비활성화
      terminalTheme: 'default',
      terminalFont: 'Courier New',
      costWarningThreshold: 5, // $5 기본값
      scrollbackLines: 5000,
      cpuAlertThreshold: 80,
      memAlertThresholdMb: 2048,
      sessionGcDays: 30,
      onboardingCompleted: false,
      accentColor: '#e07850',
      appThemeName: 'default',
      archiveEnabled: true,
      customThemeVariables: {},
      customThemeName: '',

      setTheme: (theme) => set({ theme }),
      setFontSize: (size) => set({ fontSize: size }),
      setTerminalFontSize: (size) => set({ terminalFontSize: size }),
      setSoundEnabled: (enabled) => set({ soundEnabled: enabled }),
      setTelemetryEnabled: (enabled) => {
        set({ telemetryEnabled: enabled });
        // 즉시 posthog opt-in/out
        import('../lib/telemetry').then(({ telemetry }) => telemetry.setEnabled(enabled));
      },
      setTerminalTheme: (terminalTheme) => set({ terminalTheme }),
      setTerminalFont: (terminalFont) => set({ terminalFont }),
      setCostWarningThreshold: (costWarningThreshold) => set({ costWarningThreshold }),
      setScrollbackLines: (scrollbackLines) => set({ scrollbackLines: Math.min(20000, Math.max(1000, scrollbackLines)) }),
      setCpuAlertThreshold: (cpuAlertThreshold) => set({ cpuAlertThreshold }),
      setMemAlertThresholdMb: (memAlertThresholdMb) => set({ memAlertThresholdMb }),
      setSessionGcDays: (sessionGcDays) => set({ sessionGcDays }),
      setOnboardingCompleted: (onboardingCompleted) => set({ onboardingCompleted }),
      setAccentColor: (accentColor) => {
        set({ accentColor });
        document.documentElement.style.setProperty('--accent', accentColor);
      },
      setAppThemeName: (appThemeName) => set({ appThemeName }),
      setArchiveEnabled: (archiveEnabled) => set({ archiveEnabled }),
      setCustomThemeVariables: (customThemeVariables) => set({ customThemeVariables }),
      setCustomThemeName: (customThemeName) => set({ customThemeName }),
      applyCustomTheme: (variables) => {
        for (const [key, value] of Object.entries(variables)) {
          document.documentElement.style.setProperty(key, value);
        }
        set({ customThemeVariables: variables });
      },
    }),
    {
      name: 'maestro-settings',
      storage: createJSONStorage(() => localStorage),
    }
  )
);
