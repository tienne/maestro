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

// ── AI Agent Editor: Project & Task ──────────────────────────────────────────

export type ProjectTaskStatus = 'pending' | 'in_progress' | 'completed' | 'cancelled';
export type ProjectTaskPriority = 'critical' | 'high' | 'medium' | 'low';
export type ProjectTaskCreatedBy = 'human' | 'agent';

export interface Project {
  id: string;
  name: string;
  description?: string;
  repositoryId?: string;
  createdAt: number;
  updatedAt: number;
}

export interface ProjectTask {
  id: string;
  projectId: string;
  parentTaskId?: string;
  title: string;
  prd?: string;
  spec?: string;
  referenceFiles?: string[];
  acceptanceCriteria?: string;
  priority: ProjectTaskPriority;
  assignedAgentId?: string;
  status: ProjectTaskStatus;
  createdBy: ProjectTaskCreatedBy;
  workspaceId?: string;
  createdAt: number;
  updatedAt: number;
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
// trpc.ts는 @trpc/server를 사용하므로 renderer에서 직접 import 불가
// AppRouter 타입만 type-only re-export — 런타임에 trpc.ts 코드가 로드되지 않음
export type { AppRouter, ProcessMetrics } from './trpc';

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

// ── Chat Multi-Provider ───────────────────────────────────────────────────────

export type ChatProvider = 'anthropic' | 'openai' | 'google';

export type ChatProviderStatus = 'disconnected' | 'connecting' | 'connected' | 'expired';

export interface ChatModel {
  id: string;
  provider: ChatProvider;
  displayName: string;
  contextWindow: number;
}

export const CHAT_MODELS: ChatModel[] = [
  { id: 'claude-opus-4-5-20251101', provider: 'anthropic', displayName: 'Claude Opus 4.5', contextWindow: 200000 },
  { id: 'claude-sonnet-4-5-20251022', provider: 'anthropic', displayName: 'Claude Sonnet 4.5', contextWindow: 200000 },
  { id: 'claude-haiku-4-5-20251001', provider: 'anthropic', displayName: 'Claude Haiku 4.5', contextWindow: 200000 },
  { id: 'gpt-4o', provider: 'openai', displayName: 'GPT-4o', contextWindow: 128000 },
  { id: 'gpt-4o-mini', provider: 'openai', displayName: 'GPT-4o mini', contextWindow: 128000 },
  { id: 'o4-mini', provider: 'openai', displayName: 'o4-mini', contextWindow: 200000 },
  { id: 'o3', provider: 'openai', displayName: 'o3', contextWindow: 200000 },
  { id: 'gemini-2.5-pro', provider: 'google', displayName: 'Gemini 2.5 Pro', contextWindow: 1000000 },
  { id: 'gemini-2.5-flash', provider: 'google', displayName: 'Gemini 2.5 Flash', contextWindow: 1000000 },
  { id: 'gemini-2.0-flash', provider: 'google', displayName: 'Gemini 2.0 Flash', contextWindow: 1000000 },
];

export interface ChatSession {
  id: string;
  workspaceId: string;
  provider: ChatProvider;
  model: string;
  createdAt: string;
  updatedAt: string;
}

export type ChatRole = 'user' | 'assistant';

export interface ChatMessage {
  id: string;
  sessionId: string;
  role: ChatRole;
  content: string;
  provider: ChatProvider;
  model: string;
  createdAt: string;
}
