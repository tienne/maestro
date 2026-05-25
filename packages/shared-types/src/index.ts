// Shared TypeScript types between web frontend and any tooling

// ── M11: Auth ────────────────────────────────────────────────────────────────

export interface AuthUser {
  id: string;
  email: string;
  user_metadata: Record<string, unknown>;
}

export type SessionStatus = 'pending' | 'running' | 'stopped' | 'error' | 'blocked';

export type AgentType = 'claude-code' | 'gemini' | 'codex' | 'opencode';

export interface Repository {
  id: string;
  name: string;
  path: string;
  color: string;
  branchPrefix: string;
  baseBranch: string;
  worktreeBasePath: string;
  setupScript: string;
  teardownScript: string;
  createdAt: string;
}

export interface EnvVar {
  id: string;
  repositoryId: string;
  key: string;
  value: string;
}

export interface Workspace {
  id: string;
  name: string;
  repositoryId: string;
  branch: string;
  worktreePath: string;
  createdAt: string;
}

export interface Agent {
  id: string;
  name: string;
  command: string;
  args: string[];
  env: Record<string, string>;
  isBuiltIn: boolean;
  /** M10-02: 커스텀 스크립트 경로 (Script 타입 에이전트) */
  scriptPath?: string | null;
  /** M10-02: 인라인 스크립트 내용 */
  scriptContent?: string | null;
}

export interface Session {
  id: string;
  name: string;
  workspaceId: string;
  agentId: string;
  status: SessionStatus;
  pid?: number;
  createdAt: string;
  isFavorite?: boolean;
  /** F-M4-01: 선행 세션 ID (파이프라인 의존성) */
  dependsOnSessionId?: string | null;
  /** F-M4-02: 컨텍스트 소스 세션 ID */
  contextSourceSessionId?: string | null;
  /** M7-04: 마지막 PTY exit code (비정상 종료 시 표시용) */
  lastExitCode?: number | null;
}

// ── M4: Agent Preset ──────────────────────────────────────────────────────────

export interface AgentPreset {
  id: string;
  name: string;
  agentId: string;
  workspaceId: string;
  initialCommand: string;
  envVars: Record<string, string>;
  createdAt: string;
}

// ── M4: Session Label ──────────────────────────────────────────────────────────

export interface SessionLabel {
  sessionId: string;
  labelName: string;
  labelColor: string;
}

export interface TiledLayout {
  id: string;
  workspaceId: string;
  /** JSON-serialized mosaic tree state */
  mosaicState: string;
  updatedAt: string;
}

export type PaneType = 'terminal' | 'browser' | 'editor';

export interface Pane {
  id: string;
  layoutId: string;
  type: PaneType;
  sessionId?: string | null;
  /** JSON-serialized position/size hints */
  position: string;
}

export interface AppState {
  activeWorkspaceId?: string;
  activeSessionId?: string;
  sidebarWidth: number;
  rightSidebarWidth: number;
}

// ── M3: AI Session Intelligence ─────────────────────────────────────────────

export interface CostEntry {
  sessionId: string;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  createdAt: string;
}

export interface SessionCostSummary {
  sessionId: string;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCostUsd: number;
}

export type TaskStatus = 'done' | 'in_progress' | 'pending';

export interface TaskItem {
  name: string;
  status: TaskStatus;
}

export type ErrorType = 'API' | 'GIT' | 'BUILD' | 'PERM' | 'UNKNOWN';

export interface ErrorInfo {
  type: ErrorType;
  message: string;
  timestamp: number;
}

export interface SessionIntelligence {
  costs: SessionCostSummary;
  tasks: TaskItem[];
  lastError: ErrorInfo | null;
  completedAt: number | null;
  exitCode: number | null;
  startedAt: number | null;
}

// ── M5: Workspace Automation ───────────────────────────────────────────────

export interface WorkspaceTemplate {
  id: string;
  name: string;
  description: string;
  agentType: string;
  envVars: Record<string, string>;
  setupScript: string;
  teardownScript: string;
  branchPattern: string;
  createdAt: string;
}

export interface WorkspaceSnapshot {
  id: string;
  workspaceId: string;
  envVars: Record<string, string>;
  gitHead: string;
  setupScript: string;
  createdAt: string;
}

export interface WorkspaceWithHooks extends Workspace {
  hookOnSessionStart: string;
  hookOnAgentComplete: string;
  hookOnError: string;
}

// IDE deep-linking types
export type IdeType = 'vscode' | 'cursor' | 'webstorm' | 'zed';

export const IDE_LABELS: Record<IdeType, string> = {
  vscode: 'VS Code',
  cursor: 'Cursor',
  webstorm: 'WebStorm',
  zed: 'Zed',
};

// tRPC router types and Zod schemas
export * from './trpc';

// ── M6: Remote Control & API ─────────────────────────────────────────────

export type WebhookEvent = 'session.completed' | 'session.error' | 'agent.task_done' | 'session.started';

export interface Webhook {
  id: string;
  url: string;
  events: WebhookEvent[];
  secret: string;
  enabled: boolean;
  createdAt: string;
}

export interface WebhookLog {
  id: string;
  webhookId: string;
  event: string;
  statusCode: number | null;
  responseBody: string;
  createdAt: string;
}

export interface ApiKey {
  id: string;
  key: string;
  name: string;
  createdAt: string;
}

export type RelayStatus = 'connected' | 'connecting' | 'disconnected';

// ── M9: Multi-Window & Sharing ─────────────────────────────────────────────

export type ExportFormat = 'html' | 'txt' | 'json';

export interface SessionExportOptions {
  sessionId: string;
  format: ExportFormat;
  includeTimestamp: boolean;
  includeAnsi: boolean;
}

export interface SettingsProfile {
  agents: Agent[];
  mcpServers: Array<{ name: string; url: string; enabled: boolean }>;
  theme: string;
  accentColor: string;
  terminalTheme: string;
  terminalFont: string;
  appThemeName: string;
}

export interface ArchiveSearchResult {
  sessionId: string;
  sessionName: string;
  date: string;
  matchingLines: Array<{ lineNumber: number; content: string }>;
}

// ── M10: Plugins & Extensions ──────────────────────────────────────────────

export interface PluginManifest {
  name: string;
  version: string;
  entry: string;
}

export interface PluginInfo {
  id: string;
  name: string;
  version: string;
  path: string;
  enabled: boolean;
  loadedAt: string;
}

export interface CustomTheme {
  name: string;
  variables: Record<string, string>;
}

export type TelemetryEventName = 'session_created' | 'feature_used' | 'app_started';

// Electron IPC event payloads
export interface SessionOutputPayload {
  sessionId: string;
  data: string;
}

export interface SessionStatusPayload {
  sessionId: string;
  status: SessionStatus;
}
