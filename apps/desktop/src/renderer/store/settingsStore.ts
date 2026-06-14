import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';

// ---------------------------------------------------------------------------
// Re-exports (타입/상수 하위 호환)
// ---------------------------------------------------------------------------

export type AppTheme = 'dark' | 'light' | 'system';

export const DEFAULT_INTERVIEW_SYSTEM_PROMPT = `당신은 태스크 생성을 도와주는 AI 어시스턴트입니다.
사용자의 기능 설명을 바탕으로 명확한 태스크 스펙을 만들어냅니다.

현재 프로젝트와 레포지토리 컨텍스트:
{projectName} 프로젝트 / {repositoryName} 레포지토리

규칙:
1. 스펙이 불명확하면 구체적인 질문을 통해 명확히 합니다
2. 사용자가 "태스크 만들어", "만들어", "생성해" 등의 명령을 입력하면 즉시 JSON 형식으로 태스크 필드를 생성합니다
3. JSON 생성 시 반드시 아래 형식을 사용하고 JSON 앞뒤에 TASK_JSON_START / TASK_JSON_END 마커를 붙입니다:

TASK_JSON_START
{
  "title": "태스크 제목",
  "prd": "PRD 내용 (사용자 스토리, 배경, 목적)",
  "spec": "기술 스펙 (구현 방법, 아키텍처)",
  "acceptanceCriteria": "인수 조건 (완료 기준)",
  "priority": "critical|high|medium|low",
  "referenceFiles": []
}
TASK_JSON_END`;

export type FontSize = 'sm' | 'md' | 'lg';
export type TerminalThemeName = 'default' | 'dracula' | 'solarized-dark' | 'one-dark' | 'nord';
export type TerminalFontFamily = 'JetBrains Mono' | 'Fira Code' | 'Cascadia Code' | 'Courier New';
export type AppThemeName = 'default' | 'catppuccin' | 'nord' | 'gruvbox' | 'one-dark-pro';

// ---------------------------------------------------------------------------
// 설정값 타입
// ---------------------------------------------------------------------------

interface SettingsState {
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
  /** 태스크 생성 AI 인터뷰 시스템 프롬프트 (undefined이면 DEFAULT_INTERVIEW_SYSTEM_PROMPT 사용) */
  taskCreationSystemPrompt?: string;
  /** 마지막으로 선택한 채팅 프로바이더 */
  lastChatProvider?: string;
  /** 마지막으로 선택한 채팅 모델 */
  lastChatModel?: string;
}

const DEFAULT_SETTINGS: SettingsState = {
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
  taskCreationSystemPrompt: undefined,
  lastChatProvider: undefined,
  lastChatModel: undefined,
};

// ---------------------------------------------------------------------------
// Zustand 스토어 인터페이스
// ---------------------------------------------------------------------------

interface SettingsStore extends SettingsState {
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
  setTaskCreationSystemPrompt: (prompt: string | undefined) => void;
  setLastChatProvider: (provider: string | undefined) => void;
  setLastChatModel: (model: string | undefined) => void;
}

// ---------------------------------------------------------------------------
// Zustand persist 스토어 — localStorage key 'maestro-settings' 유지 (기존 설정 보존)
// ---------------------------------------------------------------------------

export const useSettingsStore = create<SettingsStore>()(
  persist(
    (set) => ({
      ...DEFAULT_SETTINGS,

      setTheme: (theme) => set({ theme }),
      setFontSize: (fontSize) => set({ fontSize }),
      setTerminalFontSize: (terminalFontSize) => set({ terminalFontSize }),
      setSoundEnabled: (soundEnabled) => set({ soundEnabled }),
      setTelemetryEnabled: (telemetryEnabled) => {
        set({ telemetryEnabled });
        import('../lib/telemetry').then(({ telemetry }) => telemetry.setEnabled(telemetryEnabled));
      },
      setTerminalTheme: (terminalTheme) => set({ terminalTheme }),
      setTerminalFont: (terminalFont) => set({ terminalFont }),
      setCostWarningThreshold: (costWarningThreshold) => set({ costWarningThreshold }),
      setScrollbackLines: (lines) =>
        set({ scrollbackLines: Math.min(20000, Math.max(1000, lines)) }),
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
      setTaskCreationSystemPrompt: (taskCreationSystemPrompt) => set({ taskCreationSystemPrompt }),
      setLastChatProvider: (lastChatProvider) => set({ lastChatProvider }),
      setLastChatModel: (lastChatModel) => set({ lastChatModel }),
    }),
    {
      name: 'maestro-settings', // 기존 localStorage 키 유지 → 사용자 설정 보존
      storage: createJSONStorage(() => localStorage),
    }
  )
);
