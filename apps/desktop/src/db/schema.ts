/**
 * Drizzle ORM 스키마 정의
 *
 * database.ts의 CREATE TABLE 문을 drizzle-orm/sqlite-core로 변환.
 * app_state 테이블은 lowdb로 이전 예정이므로 제외.
 *
 * 마이그레이션 순서 반영:
 *   초기: repositories, env_vars, workspaces, agents, sessions,
 *         mcp_servers, session_scrollbacks, prompt_history,
 *         tiled_layouts, panes
 *   M3:   session_costs
 *   M4:   agent_presets, session_labels
 *         sessions: depends_on_session_id, context_source_session_id
 *   M5:   workspace_templates, workspace_snapshots
 *         workspaces: hook_on_session_start, hook_on_agent_complete, hook_on_error
 *   M6:   webhooks, webhook_logs, api_keys
 *   M7:   sessions: last_exit_code
 *   M9:   session_archives
 *   M10:  plugins
 *         agents: script_path, script_content
 *   M11:  projects, tasks
 *         workspaces: task_id
 *         sessions: is_favorite (M2)
 */

import {
  sqliteTable,
  text,
  integer,
  real,
  primaryKey,
  uniqueIndex,
  index,
} from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';
import type { InferSelectModel, InferInsertModel } from 'drizzle-orm';

// ── repositories ────────────────────────────────────────────────────────────

export const repositories = sqliteTable('repositories', {
  id:                text('id').primaryKey(),
  name:              text('name').notNull(),
  path:              text('path').notNull().unique(),
  color:             text('color').notNull().default('#6366f1'),
  branchPrefix:      text('branch_prefix').notNull().default(''),
  baseBranch:        text('base_branch').notNull().default('main'),
  worktreeBasePath:  text('worktree_base_path').notNull().default(''),
  setupScript:       text('setup_script').notNull().default(''),
  teardownScript:    text('teardown_script').notNull().default(''),
  createdAt:         text('created_at').notNull().default(sql`(datetime('now'))`),
});

export type Repository       = InferSelectModel<typeof repositories>;
export type NewRepository    = InferInsertModel<typeof repositories>;

// ── env_vars ────────────────────────────────────────────────────────────────

export const envVars = sqliteTable(
  'env_vars',
  {
    id:           text('id').primaryKey(),
    repositoryId: text('repository_id').notNull().references(() => repositories.id, { onDelete: 'cascade' }),
    key:          text('key').notNull(),
    value:        text('value').notNull(),
  },
  (t) => [
    uniqueIndex('env_vars_repository_key_uq').on(t.repositoryId, t.key),
  ],
);

export type EnvVar    = InferSelectModel<typeof envVars>;
export type NewEnvVar = InferInsertModel<typeof envVars>;

// ── projects (M11) ──────────────────────────────────────────────────────────

export const projects = sqliteTable('projects', {
  id:           text('id').primaryKey(),
  name:         text('name').notNull(),
  description:  text('description'),
  repositoryId: text('repository_id').references(() => repositories.id, { onDelete: 'set null' }),
  createdAt:    integer('created_at').notNull(),
  updatedAt:    integer('updated_at').notNull(),
});

export type Project    = InferSelectModel<typeof projects>;
export type NewProject = InferInsertModel<typeof projects>;

// ── tasks (M11) ─────────────────────────────────────────────────────────────

export const tasks = sqliteTable(
  'tasks',
  {
    id:                 text('id').primaryKey(),
    projectId:          text('project_id').notNull().references(() => projects.id, { onDelete: 'cascade' }),
    parentTaskId:       text('parent_task_id').references((): ReturnType<typeof text> => tasks.id, { onDelete: 'set null' }),
    title:              text('title').notNull(),
    prd:                text('prd'),
    spec:               text('spec'),
    referenceFiles:     text('reference_files'),
    acceptanceCriteria: text('acceptance_criteria'),
    priority:           text('priority').notNull().default('medium'),
    assignedAgentId:    text('assigned_agent_id'),
    status:             text('status').notNull().default('pending'),
    createdBy:          text('created_by').notNull().default('human'),
    workspaceId:        text('workspace_id'),
    createdAt:          integer('created_at').notNull(),
    updatedAt:          integer('updated_at').notNull(),
  },
  (t) => [
    index('idx_tasks_project').on(t.projectId),
    index('idx_tasks_status').on(t.projectId, t.status),
  ],
);

export type Task    = InferSelectModel<typeof tasks>;
export type NewTask = InferInsertModel<typeof tasks>;

// ── workspaces ──────────────────────────────────────────────────────────────
// M5 컬럼(hook_*), M11 컬럼(task_id) 포함

export const workspaces = sqliteTable('workspaces', {
  id:                  text('id').primaryKey(),
  name:                text('name').notNull(),
  repositoryId:        text('repository_id').notNull().references(() => repositories.id, { onDelete: 'cascade' }),
  branch:              text('branch').notNull(),
  worktreePath:        text('worktree_path').notNull(),
  createdAt:           text('created_at').notNull().default(sql`(datetime('now'))`),
  // M5: lifecycle hooks
  hookOnSessionStart:  text('hook_on_session_start').notNull().default(''),
  hookOnAgentComplete: text('hook_on_agent_complete').notNull().default(''),
  hookOnError:         text('hook_on_error').notNull().default(''),
  // M11: task 연결
  taskId:              text('task_id').references(() => tasks.id, { onDelete: 'set null' }),
});

export type Workspace    = InferSelectModel<typeof workspaces>;
export type NewWorkspace = InferInsertModel<typeof workspaces>;

// ── agents ──────────────────────────────────────────────────────────────────
// M10 컬럼(script_path, script_content) 포함

export const agents = sqliteTable('agents', {
  id:            text('id').primaryKey(),
  name:          text('name').notNull(),
  command:       text('command').notNull(),
  /** JSON 직렬화된 문자열 배열 */
  args:          text('args').notNull().default('[]'),
  /** JSON 직렬화된 객체 */
  env:           text('env').notNull().default('{}'),
  isBuiltIn:     integer('is_built_in', { mode: 'boolean' }).notNull().default(false),
  // M10: 커스텀 에이전트 스크립트
  scriptPath:    text('script_path'),
  scriptContent: text('script_content'),
});

export type Agent    = InferSelectModel<typeof agents>;
export type NewAgent = InferInsertModel<typeof agents>;

// ── sessions ─────────────────────────────────────────────────────────────────
// M2 컬럼(is_favorite), M4 컬럼(depends_on_session_id, context_source_session_id),
// M7 컬럼(last_exit_code) 포함

export const sessions = sqliteTable('sessions', {
  id:                      text('id').primaryKey(),
  name:                    text('name').notNull(),
  workspaceId:             text('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  agentId:                 text('agent_id').notNull().references(() => agents.id),
  status:                  text('status').notNull().default('stopped'),
  pid:                     integer('pid'),
  createdAt:               text('created_at').notNull().default(sql`(datetime('now'))`),
  // M2: 즐겨찾기
  isFavorite:              integer('is_favorite', { mode: 'boolean' }).notNull().default(false),
  // M4: 파이프라인
  dependsOnSessionId:      text('depends_on_session_id'),
  contextSourceSessionId:  text('context_source_session_id'),
  // M7: 성능
  lastExitCode:            integer('last_exit_code'),
});

export type Session    = InferSelectModel<typeof sessions>;
export type NewSession = InferInsertModel<typeof sessions>;

// ── mcp_servers ──────────────────────────────────────────────────────────────

export const mcpServers = sqliteTable('mcp_servers', {
  id:        text('id').primaryKey(),
  name:      text('name').notNull(),
  url:       text('url').notNull().unique(),
  enabled:   integer('enabled', { mode: 'boolean' }).notNull().default(true),
  status:    text('status').notNull().default('offline'),
  errorMsg:  text('error_msg'),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
});

export type McpServer    = InferSelectModel<typeof mcpServers>;
export type NewMcpServer = InferInsertModel<typeof mcpServers>;

// ── session_scrollbacks ───────────────────────────────────────────────────────

export const sessionScrollbacks = sqliteTable('session_scrollbacks', {
  sessionId: text('session_id').primaryKey(),
  data:      text('data').notNull().default(''),
  updatedAt: text('updated_at').notNull().default(sql`(datetime('now'))`),
});

export type SessionScrollback    = InferSelectModel<typeof sessionScrollbacks>;
export type NewSessionScrollback = InferInsertModel<typeof sessionScrollbacks>;

// ── prompt_history ────────────────────────────────────────────────────────────

export const promptHistory = sqliteTable(
  'prompt_history',
  {
    id:        text('id').primaryKey(),
    sessionId: text('session_id').notNull(),
    text:      text('text').notNull(),
    createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  },
  (t) => [
    index('idx_prompt_history_session').on(t.sessionId, t.createdAt),
  ],
);

export type PromptHistory    = InferSelectModel<typeof promptHistory>;
export type NewPromptHistory = InferInsertModel<typeof promptHistory>;

// ── tiled_layouts ─────────────────────────────────────────────────────────────

export const tiledLayouts = sqliteTable('tiled_layouts', {
  id:          text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
  mosaicState: text('mosaic_state').notNull().default('{}'),
  updatedAt:   text('updated_at').notNull().default(sql`(datetime('now'))`),
});

export type TiledLayout    = InferSelectModel<typeof tiledLayouts>;
export type NewTiledLayout = InferInsertModel<typeof tiledLayouts>;

// ── panes ─────────────────────────────────────────────────────────────────────

export const panes = sqliteTable('panes', {
  id:        text('id').primaryKey(),
  layoutId:  text('layout_id').notNull().references(() => tiledLayouts.id, { onDelete: 'cascade' }),
  type:      text('type').notNull().default('terminal'),
  sessionId: text('session_id').references(() => sessions.id, { onDelete: 'set null' }),
  position:  text('position').notNull().default('{}'),
});

export type Pane    = InferSelectModel<typeof panes>;
export type NewPane = InferInsertModel<typeof panes>;

// ── session_costs (M3) ────────────────────────────────────────────────────────

export const sessionCosts = sqliteTable(
  'session_costs',
  {
    id:           text('id').primaryKey(),
    sessionId:    text('session_id').notNull(),
    inputTokens:  integer('input_tokens').notNull().default(0),
    outputTokens: integer('output_tokens').notNull().default(0),
    costUsd:      real('cost_usd').notNull().default(0),
    createdAt:    text('created_at').notNull().default(sql`(datetime('now'))`),
  },
  (t) => [
    index('idx_session_costs_session').on(t.sessionId),
  ],
);

export type SessionCost    = InferSelectModel<typeof sessionCosts>;
export type NewSessionCost = InferInsertModel<typeof sessionCosts>;

// ── agent_presets (M4) ────────────────────────────────────────────────────────

export const agentPresets = sqliteTable('agent_presets', {
  id:             text('id').primaryKey(),
  name:           text('name').notNull(),
  agentId:        text('agent_id').notNull(),
  workspaceId:    text('workspace_id').notNull(),
  initialCommand: text('initial_command').notNull().default(''),
  /** JSON 직렬화된 env vars 객체 */
  envVars:        text('env_vars').notNull().default('{}'),
  createdAt:      text('created_at').notNull().default(sql`(datetime('now'))`),
});

export type AgentPreset    = InferSelectModel<typeof agentPresets>;
export type NewAgentPreset = InferInsertModel<typeof agentPresets>;

// ── session_labels (M4) ───────────────────────────────────────────────────────

export const sessionLabels = sqliteTable(
  'session_labels',
  {
    sessionId:  text('session_id').notNull(),
    labelName:  text('label_name').notNull(),
    labelColor: text('label_color').notNull().default('#6366f1'),
  },
  (t) => [
    primaryKey({ columns: [t.sessionId, t.labelName] }),
  ],
);

export type SessionLabel    = InferSelectModel<typeof sessionLabels>;
export type NewSessionLabel = InferInsertModel<typeof sessionLabels>;

// ── workspace_templates (M5) ──────────────────────────────────────────────────

export const workspaceTemplates = sqliteTable('workspace_templates', {
  id:             text('id').primaryKey(),
  name:           text('name').notNull(),
  description:    text('description').notNull().default(''),
  agentType:      text('agent_type').notNull().default(''),
  /** JSON 직렬화된 env vars 객체 */
  envVars:        text('env_vars').notNull().default('{}'),
  setupScript:    text('setup_script').notNull().default(''),
  teardownScript: text('teardown_script').notNull().default(''),
  branchPattern:  text('branch_pattern').notNull().default(''),
  createdAt:      text('created_at').notNull().default(sql`(datetime('now'))`),
});

export type WorkspaceTemplate    = InferSelectModel<typeof workspaceTemplates>;
export type NewWorkspaceTemplate = InferInsertModel<typeof workspaceTemplates>;

// ── workspace_snapshots (M5) ──────────────────────────────────────────────────

export const workspaceSnapshots = sqliteTable(
  'workspace_snapshots',
  {
    id:          text('id').primaryKey(),
    workspaceId: text('workspace_id').notNull().references(() => workspaces.id, { onDelete: 'cascade' }),
    /** JSON 직렬화된 env vars 객체 */
    envVars:     text('env_vars').notNull().default('{}'),
    gitHead:     text('git_head').notNull().default(''),
    setupScript: text('setup_script').notNull().default(''),
    createdAt:   text('created_at').notNull().default(sql`(datetime('now'))`),
  },
  (t) => [
    index('idx_workspace_snapshots_ws').on(t.workspaceId, t.createdAt),
  ],
);

export type WorkspaceSnapshot    = InferSelectModel<typeof workspaceSnapshots>;
export type NewWorkspaceSnapshot = InferInsertModel<typeof workspaceSnapshots>;

// ── webhooks (M6) ─────────────────────────────────────────────────────────────

export const webhooks = sqliteTable('webhooks', {
  id:        text('id').primaryKey(),
  url:       text('url').notNull(),
  /** JSON 직렬화된 이벤트 타입 배열 */
  events:    text('events').notNull().default('[]'),
  secret:    text('secret').notNull().default(''),
  enabled:   integer('enabled', { mode: 'boolean' }).notNull().default(true),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
});

export type Webhook    = InferSelectModel<typeof webhooks>;
export type NewWebhook = InferInsertModel<typeof webhooks>;

// ── webhook_logs (M6) ─────────────────────────────────────────────────────────

export const webhookLogs = sqliteTable(
  'webhook_logs',
  {
    id:           text('id').primaryKey(),
    webhookId:    text('webhook_id').notNull(),
    event:        text('event').notNull(),
    statusCode:   integer('status_code'),
    responseBody: text('response_body').notNull().default(''),
    createdAt:    text('created_at').notNull().default(sql`(datetime('now'))`),
  },
  (t) => [
    index('idx_webhook_logs_webhook').on(t.webhookId, t.createdAt),
  ],
);

export type WebhookLog    = InferSelectModel<typeof webhookLogs>;
export type NewWebhookLog = InferInsertModel<typeof webhookLogs>;

// ── api_keys (M6) ─────────────────────────────────────────────────────────────

export const apiKeys = sqliteTable('api_keys', {
  id:        text('id').primaryKey(),
  key:       text('key').notNull().unique(),
  name:      text('name').notNull().default('Default'),
  createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
});

export type ApiKey    = InferSelectModel<typeof apiKeys>;
export type NewApiKey = InferInsertModel<typeof apiKeys>;

// ── session_archives (M9) ─────────────────────────────────────────────────────

export const sessionArchives = sqliteTable(
  'session_archives',
  {
    sessionId:   text('session_id').primaryKey(),
    sessionName: text('session_name').notNull().default(''),
    logPath:     text('log_path').notNull(),
    archivedAt:  text('archived_at').notNull().default(sql`(datetime('now'))`),
  },
  (t) => [
    index('idx_session_archives_date').on(t.archivedAt),
  ],
);

export type SessionArchive    = InferSelectModel<typeof sessionArchives>;
export type NewSessionArchive = InferInsertModel<typeof sessionArchives>;

// ── plugins (M10) ─────────────────────────────────────────────────────────────

export const plugins = sqliteTable('plugins', {
  id:       text('id').primaryKey(),
  name:     text('name').notNull(),
  version:  text('version').notNull().default('0.0.0'),
  path:     text('path').notNull().unique(),
  enabled:  integer('enabled', { mode: 'boolean' }).notNull().default(true),
  loadedAt: text('loaded_at').notNull().default(sql`(datetime('now'))`),
});

export type Plugin    = InferSelectModel<typeof plugins>;
export type NewPlugin = InferInsertModel<typeof plugins>;

// ── chat_sessions (M12) ───────────────────────────────────────────────────────

export const chatSessions = sqliteTable(
  'chat_sessions',
  {
    id:          text('id').primaryKey(),
    workspaceId: text('workspace_id').notNull(),
    provider:    text('provider').notNull(), // 'anthropic' | 'openai' | 'google'
    model:       text('model').notNull(),
    createdAt:   text('created_at').notNull().default(sql`(datetime('now'))`),
    updatedAt:   text('updated_at').notNull().default(sql`(datetime('now'))`),
  },
  (t) => [
    index('idx_chat_sessions_workspace').on(t.workspaceId),
  ],
);

export type ChatSession    = InferSelectModel<typeof chatSessions>;
export type NewChatSession = InferInsertModel<typeof chatSessions>;

// ── chat_messages (M12) ───────────────────────────────────────────────────────

export const chatMessages = sqliteTable(
  'chat_messages',
  {
    id:        text('id').primaryKey(),
    sessionId: text('session_id').notNull().references(() => chatSessions.id, { onDelete: 'cascade' }),
    role:      text('role').notNull(), // 'user' | 'assistant'
    content:   text('content').notNull(),
    provider:  text('provider').notNull(),
    model:     text('model').notNull(),
    createdAt: text('created_at').notNull().default(sql`(datetime('now'))`),
  },
  (t) => [
    index('idx_chat_messages_session').on(t.sessionId, t.createdAt),
  ],
);

export type ChatMessage    = InferSelectModel<typeof chatMessages>;
export type NewChatMessage = InferInsertModel<typeof chatMessages>;
