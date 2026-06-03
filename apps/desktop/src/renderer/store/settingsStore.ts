import { atom, getDefaultStore } from 'jotai';
import { atomWithStorage } from 'jotai/utils';
import { useAtom } from 'jotai';

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
// Base atom — localStorage 자동 persist (Zustand persist 미들웨어 대체)
// ---------------------------------------------------------------------------

export const settingsAtom = atomWithStorage<SettingsState>('maestro-settings', DEFAULT_SETTINGS);

// ---------------------------------------------------------------------------
// 개별 derived atoms (selector 성능 최적화용)
// ---------------------------------------------------------------------------

export const themeAtom = atom(
  (get) => get(settingsAtom).theme,
  (_get, set, theme: AppTheme) => set(settingsAtom, (s) => ({ ...s, theme }))
);

export const fontSizeAtom = atom(
  (get) => get(settingsAtom).fontSize,
  (_get, set, fontSize: FontSize) => set(settingsAtom, (s) => ({ ...s, fontSize }))
);

export const terminalFontSizeAtom = atom(
  (get) => get(settingsAtom).terminalFontSize,
  (_get, set, terminalFontSize: number) => set(settingsAtom, (s) => ({ ...s, terminalFontSize }))
);

export const soundEnabledAtom = atom(
  (get) => get(settingsAtom).soundEnabled,
  (_get, set, soundEnabled: boolean) => set(settingsAtom, (s) => ({ ...s, soundEnabled }))
);

export const telemetryEnabledAtom = atom(
  (get) => get(settingsAtom).telemetryEnabled,
  (_get, set, enabled: boolean) => {
    set(settingsAtom, (s) => ({ ...s, telemetryEnabled: enabled }));
    // 즉시 posthog opt-in/out
    import('../lib/telemetry').then(({ telemetry }) => telemetry.setEnabled(enabled));
  }
);

export const terminalThemeAtom = atom(
  (get) => get(settingsAtom).terminalTheme,
  (_get, set, terminalTheme: TerminalThemeName) => set(settingsAtom, (s) => ({ ...s, terminalTheme }))
);

export const terminalFontAtom = atom(
  (get) => get(settingsAtom).terminalFont,
  (_get, set, terminalFont: TerminalFontFamily) => set(settingsAtom, (s) => ({ ...s, terminalFont }))
);

export const costWarningThresholdAtom = atom(
  (get) => get(settingsAtom).costWarningThreshold,
  (_get, set, costWarningThreshold: number) => set(settingsAtom, (s) => ({ ...s, costWarningThreshold }))
);

export const scrollbackLinesAtom = atom(
  (get) => get(settingsAtom).scrollbackLines,
  (_get, set, lines: number) =>
    set(settingsAtom, (s) => ({ ...s, scrollbackLines: Math.min(20000, Math.max(1000, lines)) }))
);

export const cpuAlertThresholdAtom = atom(
  (get) => get(settingsAtom).cpuAlertThreshold,
  (_get, set, cpuAlertThreshold: number) => set(settingsAtom, (s) => ({ ...s, cpuAlertThreshold }))
);

export const memAlertThresholdMbAtom = atom(
  (get) => get(settingsAtom).memAlertThresholdMb,
  (_get, set, memAlertThresholdMb: number) => set(settingsAtom, (s) => ({ ...s, memAlertThresholdMb }))
);

export const sessionGcDaysAtom = atom(
  (get) => get(settingsAtom).sessionGcDays,
  (_get, set, sessionGcDays: number) => set(settingsAtom, (s) => ({ ...s, sessionGcDays }))
);

export const onboardingCompletedAtom = atom(
  (get) => get(settingsAtom).onboardingCompleted,
  (_get, set, onboardingCompleted: boolean) => set(settingsAtom, (s) => ({ ...s, onboardingCompleted }))
);

export const accentColorAtom = atom(
  (get) => get(settingsAtom).accentColor,
  (_get, set, accentColor: string) => {
    set(settingsAtom, (s) => ({ ...s, accentColor }));
    document.documentElement.style.setProperty('--accent', accentColor);
  }
);

export const appThemeNameAtom = atom(
  (get) => get(settingsAtom).appThemeName,
  (_get, set, appThemeName: AppThemeName) => set(settingsAtom, (s) => ({ ...s, appThemeName }))
);

export const archiveEnabledAtom = atom(
  (get) => get(settingsAtom).archiveEnabled,
  (_get, set, archiveEnabled: boolean) => set(settingsAtom, (s) => ({ ...s, archiveEnabled }))
);

export const customThemeVariablesAtom = atom(
  (get) => get(settingsAtom).customThemeVariables,
  (_get, set, customThemeVariables: Record<string, string>) =>
    set(settingsAtom, (s) => ({ ...s, customThemeVariables }))
);

export const customThemeNameAtom = atom(
  (get) => get(settingsAtom).customThemeName,
  (_get, set, customThemeName: string) => set(settingsAtom, (s) => ({ ...s, customThemeName }))
);

export const taskCreationSystemPromptAtom = atom(
  (get) => get(settingsAtom).taskCreationSystemPrompt,
  (_get, set, taskCreationSystemPrompt: string | undefined) =>
    set(settingsAtom, (s) => ({ ...s, taskCreationSystemPrompt }))
);

export const lastChatProviderAtom = atom(
  (get) => get(settingsAtom).lastChatProvider,
  (_get, set, lastChatProvider: string | undefined) =>
    set(settingsAtom, (s) => ({ ...s, lastChatProvider }))
);

export const lastChatModelAtom = atom(
  (get) => get(settingsAtom).lastChatModel,
  (_get, set, lastChatModel: string | undefined) =>
    set(settingsAtom, (s) => ({ ...s, lastChatModel }))
);

// ---------------------------------------------------------------------------
// Jotai store instance — .getState() 호환용
// ---------------------------------------------------------------------------

const jotaiStore = getDefaultStore();

// ---------------------------------------------------------------------------
// Zustand 호환 스토어 인터페이스
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

function buildSnapshot(s: SettingsState): SettingsStore {
  return {
    ...s,
    setTheme: (theme) => jotaiStore.set(themeAtom, theme),
    setFontSize: (size) => jotaiStore.set(fontSizeAtom, size),
    setTerminalFontSize: (size) => jotaiStore.set(terminalFontSizeAtom, size),
    setSoundEnabled: (enabled) => jotaiStore.set(soundEnabledAtom, enabled),
    setTelemetryEnabled: (enabled) => jotaiStore.set(telemetryEnabledAtom, enabled),
    setTerminalTheme: (theme) => jotaiStore.set(terminalThemeAtom, theme),
    setTerminalFont: (font) => jotaiStore.set(terminalFontAtom, font),
    setCostWarningThreshold: (threshold) => jotaiStore.set(costWarningThresholdAtom, threshold),
    setScrollbackLines: (lines) => jotaiStore.set(scrollbackLinesAtom, lines),
    setCpuAlertThreshold: (threshold) => jotaiStore.set(cpuAlertThresholdAtom, threshold),
    setMemAlertThresholdMb: (threshold) => jotaiStore.set(memAlertThresholdMbAtom, threshold),
    setSessionGcDays: (days) => jotaiStore.set(sessionGcDaysAtom, days),
    setOnboardingCompleted: (completed) => jotaiStore.set(onboardingCompletedAtom, completed),
    setAccentColor: (color) => jotaiStore.set(accentColorAtom, color),
    setAppThemeName: (name) => jotaiStore.set(appThemeNameAtom, name),
    setArchiveEnabled: (enabled) => jotaiStore.set(archiveEnabledAtom, enabled),
    setCustomThemeVariables: (variables) => jotaiStore.set(customThemeVariablesAtom, variables),
    setCustomThemeName: (name) => jotaiStore.set(customThemeNameAtom, name),
    setTaskCreationSystemPrompt: (prompt) => jotaiStore.set(taskCreationSystemPromptAtom, prompt),
    setLastChatProvider: (provider) => jotaiStore.set(lastChatProviderAtom, provider),
    setLastChatModel: (model) => jotaiStore.set(lastChatModelAtom, model),
    applyCustomTheme: (variables) => {
      for (const [key, value] of Object.entries(variables)) {
        document.documentElement.style.setProperty(key, value);
      }
      jotaiStore.set(customThemeVariablesAtom, variables);
    },
  };
}

/** 기존 `useSettingsStore((s) => s.field)` selector 패턴 호환 */
export function useSettingsStore(): SettingsStore;
export function useSettingsStore<T>(selector: (state: SettingsStore) => T): T;
export function useSettingsStore<T>(selector?: (state: SettingsStore) => T): SettingsStore | T {
  const [settings] = useAtom(settingsAtom);
  const snapshot = buildSnapshot(settings);
  if (selector) return selector(snapshot);
  return snapshot;
}

/** 기존 `useSettingsStore.getState()` 패턴 호환 */
useSettingsStore.getState = (): SettingsStore => {
  const settings = jotaiStore.get(settingsAtom);
  return buildSnapshot(settings);
};
