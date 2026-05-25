/**
 * tRPC router interface definitions for Maestro
 *
 * This file defines the shared tRPC router type used by both
 * the Electron main process (server) and the renderer process (client).
 *
 * Electron IPC channel pattern: "<domain>:<action>"
 * These router definitions mirror the ipcMain.handle channels in apps/desktop/src/handlers/
 */

import { initTRPC } from '@trpc/server';
import { z } from 'zod';
import type { Workspace, Repository, Agent, Session, SessionCostSummary, TaskItem, ErrorInfo, SessionIntelligence, AgentPreset, SessionLabel, WorkspaceTemplate, WorkspaceSnapshot, WorkspaceWithHooks, Webhook, WebhookLog, ApiKey, PluginInfo, ArchiveSearchResult, CustomTheme, SettingsProfile, Project, ProjectTask } from './index';

// ── tRPC instance ─────────────────────────────────────────────────────────────

const t = initTRPC.create();

export const router = t.router;
export const publicProcedure = t.procedure;

// ── Zod Schemas ───────────────────────────────────────────────────────────────

export const RepositorySettingsSchema = z.object({
  name: z.string().optional(),
  color: z.string().optional(),
  branchPrefix: z.string().optional(),
  baseBranch: z.string().optional(),
  worktreeBasePath: z.string().optional(),
  setupScript: z.string().optional(),
  teardownScript: z.string().optional(),
});

export const CreateWorkspaceSchema = z.object({
  name: z.string().min(1),
  repositoryId: z.string().uuid(),
});

export const CreateSessionSchema = z.object({
  name: z.string().min(1),
  workspaceId: z.string().uuid(),
  agentId: z.string().uuid(),
  dependsOnSessionId: z.string().nullable().optional(),
  contextSourceSessionId: z.string().nullable().optional(),
});

export const LaunchSessionSchema = z.object({
  sessionId: z.string().uuid(),
  cols: z.number().int().positive(),
  rows: z.number().int().positive(),
});

export const CreateAgentSchema = z.object({
  name: z.string().min(1),
  command: z.string().min(1),
  args: z.array(z.string()),
  env: z.record(z.string(), z.string()),
  scriptPath: z.string().nullable().optional(),
  scriptContent: z.string().nullable().optional(),
});

export const UpdateAgentSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  command: z.string().min(1),
  args: z.array(z.string()),
  env: z.record(z.string(), z.string()),
  scriptPath: z.string().nullable().optional(),
  scriptContent: z.string().nullable().optional(),
});

export const AddRepositorySchema = z.object({
  path: z.string().min(1),
});

export const CloneRepositorySchema = z.object({
  url: z.string().url(),
  targetPath: z.string().min(1),
});

export const UpdateRepositorySchema = z.object({
  id: z.string().uuid(),
  settings: RepositorySettingsSchema,
});

export const EnvVarUpsertSchema = z.object({
  repositoryId: z.string().uuid(),
  key: z.string().min(1),
  value: z.string(),
});

export const McpAddSchema = z.object({
  name: z.string().min(1),
  url: z.string().url(),
});

export const McpToggleSchema = z.object({
  id: z.string().uuid(),
  enabled: z.boolean(),
});

export const McpUpdateStatusSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(['connected', 'offline', 'error']),
  errorMsg: z.string().nullable(),
});

export const OpenInIdeSchema = z.object({
  workspaceId: z.string().uuid(),
  ide: z.enum(['vscode', 'cursor', 'webstorm', 'zed']),
});

export const AppStateSchema = z.object({
  activeWorkspaceId: z.string().optional(),
  activeSessionId: z.string().optional(),
  sidebarWidth: z.number(),
  rightSidebarWidth: z.number(),
});

export const SidebarSchema = z.object({
  open: z.boolean(),
  side: z.enum(['left', 'right']).optional(),
});

export const TabsSchema = z.object({
  activeTab: z.string(),
  panel: z.enum(['terminal', 'git', 'mcp']).optional(),
});

export const TerminalSendSchema = z.object({
  sessionId: z.string().uuid(),
  text: z.string(),
});

export const TerminalResizeSchema = z.object({
  sessionId: z.string().uuid(),
  cols: z.number().int().positive(),
  rows: z.number().int().positive(),
});

export const GitStatusSchema = z.object({
  workspacePath: z.string().min(1),
});

export const GitDiffSchema = z.object({
  workspacePath: z.string().min(1),
  filePath: z.string().min(1),
  staged: z.boolean(),
});

export const GitCommitSchema = z.object({
  workspacePath: z.string().min(1),
  message: z.string().min(1),
});

// ── Git types (shared between router and stubs) ───────────────────────────────

export interface GitStatusFile {
  path: string;
  index: string;
  working_dir: string;
}

export interface GitStatusResult {
  current: string | null;
  tracking: string | null;
  ahead: number;
  behind: number;
  staged: GitStatusFile[];
  unstaged: GitStatusFile[];
  not_added: string[];
  conflicted: string[];
  created: string[];
  deleted: string[];
  modified: string[];
  renamed: { from: string; to: string }[];
}

export interface DiffLine {
  type: 'add' | 'remove' | 'context';
  content: string;
}

export interface DiffHunk {
  header: string;
  oldStart: number;
  newStart: number;
  lines: DiffLine[];
}

export interface BranchInfo {
  name: string;
  commit: string;
  label: string;
}

// ── Routers ───────────────────────────────────────────────────────────────────

/**
 * workspaceRouter — mirrors workspace:* IPC channels
 */
export const workspaceRouter = router({
  list: publicProcedure.query((): Workspace[] => {
    throw new Error('Not implemented — use IPC handler');
  }),

  create: publicProcedure
    .input(CreateWorkspaceSchema)
    .mutation((): Workspace => {
      throw new Error('Not implemented — use IPC handler');
    }),

  delete: publicProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation((): void => {
      throw new Error('Not implemented — use IPC handler');
    }),

  openInIde: publicProcedure
    .input(OpenInIdeSchema)
    .mutation((): { success: boolean; message: string } => {
      throw new Error('Not implemented — use IPC handler');
    }),

  // ── M5-02: Snapshot ───────────────────────────────────────────────────
  createSnapshot: publicProcedure
    .input(z.object({ workspaceId: z.string() }))
    .mutation((): WorkspaceSnapshot => {
      throw new Error('Not implemented — use IPC handler');
    }),

  listSnapshots: publicProcedure
    .input(z.object({ workspaceId: z.string() }))
    .query((): WorkspaceSnapshot[] => {
      throw new Error('Not implemented — use IPC handler');
    }),

  restoreSnapshot: publicProcedure
    .input(z.object({ snapshotId: z.string() }))
    .mutation((): { success: boolean } => {
      throw new Error('Not implemented — use IPC handler');
    }),

  // ── M5-03: Lifecycle Hooks ────────────────────────────────────────────
  updateHooks: publicProcedure
    .input(z.object({
      workspaceId: z.string(),
      hookOnSessionStart: z.string().optional(),
      hookOnAgentComplete: z.string().optional(),
      hookOnError: z.string().optional(),
    }))
    .mutation((): WorkspaceWithHooks => {
      throw new Error('Not implemented — use IPC handler');
    }),

  getHooks: publicProcedure
    .input(z.object({ workspaceId: z.string() }))
    .query((): { hookOnSessionStart: string; hookOnAgentComplete: string; hookOnError: string } => {
      throw new Error('Not implemented — use IPC handler');
    }),

  // ── M5-04: Env Sync ──────────────────────────────────────────────────
  notifyEnvChange: publicProcedure
    .input(z.object({ repositoryId: z.string() }))
    .mutation((): { notified: number } => {
      throw new Error('Not implemented — use IPC handler');
    }),

  reloadEnv: publicProcedure
    .input(z.object({ sessionId: z.string() }))
    .mutation((): { success: boolean } => {
      throw new Error('Not implemented — use IPC handler');
    }),
});

// ── M5-01: templateRouter ──────────────────────────────────────────────────

export const templateRouter = router({
  list: publicProcedure.query((): WorkspaceTemplate[] => {
    throw new Error('Not implemented — use IPC handler');
  }),

  create: publicProcedure
    .input(z.object({
      name: z.string().min(1),
      description: z.string().default(''),
      agentType: z.string().default(''),
      envVars: z.record(z.string(), z.string()).default({}),
      setupScript: z.string().default(''),
      teardownScript: z.string().default(''),
      branchPattern: z.string().default(''),
    }))
    .mutation((): WorkspaceTemplate => {
      throw new Error('Not implemented — use IPC handler');
    }),

  delete: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation((): void => {
      throw new Error('Not implemented — use IPC handler');
    }),

  applyToWorkspace: publicProcedure
    .input(z.object({ templateId: z.string(), workspaceId: z.string() }))
    .mutation((): { success: boolean } => {
      throw new Error('Not implemented — use IPC handler');
    }),
});

/**
 * sessionRouter — mirrors session:* IPC channels
 */
export const sessionRouter = router({
  list: publicProcedure
    .input(z.object({ workspaceId: z.string().uuid() }))
    .query(() => {
      throw new Error('Not implemented — use IPC handler');
    }),

  listAll: publicProcedure.query(() => {
    throw new Error('Not implemented — use IPC handler');
  }),

  create: publicProcedure
    .input(CreateSessionSchema)
    .mutation(() => {
      throw new Error('Not implemented — use IPC handler');
    }),

  launch: publicProcedure
    .input(LaunchSessionSchema)
    .mutation(() => {
      throw new Error('Not implemented — use IPC handler');
    }),

  stop: publicProcedure
    .input(z.object({ sessionId: z.string().uuid() }))
    .mutation(() => {
      throw new Error('Not implemented — use IPC handler');
    }),

  delete: publicProcedure
    .input(z.object({ sessionId: z.string().uuid() }))
    .mutation(() => {
      throw new Error('Not implemented — use IPC handler');
    }),

  sendInput: publicProcedure
    .input(TerminalSendSchema)
    .mutation(() => {
      throw new Error('Not implemented — use IPC handler');
    }),

  resize: publicProcedure
    .input(TerminalResizeSchema)
    .mutation(() => {
      throw new Error('Not implemented — use IPC handler');
    }),

  getLast: publicProcedure.query(() => {
    throw new Error('Not implemented — use IPC handler');
  }),

  setLastActive: publicProcedure
    .input(z.object({ sessionId: z.string().uuid() }))
    .mutation(() => {
      throw new Error('Not implemented — use IPC handler');
    }),

  resume: publicProcedure
    .input(z.object({ sessionId: z.string().uuid(), restart: z.boolean().optional() }))
    .mutation(() => {
      throw new Error('Not implemented — use IPC handler');
    }),

  updateStatus: publicProcedure
    .input(z.object({ sessionId: z.string().uuid(), status: z.string() }))
    .mutation(() => {
      throw new Error('Not implemented — use IPC handler');
    }),

  getPorts: publicProcedure
    .input(z.object({ sessionId: z.string() }))
    .query((): number[] => {
      throw new Error('Not implemented — use IPC handler');
    }),

  openPort: publicProcedure
    .input(z.object({ port: z.number().int().min(1).max(65535) }))
    .mutation(() => {
      throw new Error('Not implemented — use IPC handler');
    }),

  getScrollback: publicProcedure
    .input(z.object({ sessionId: z.string() }))
    .query((): string => {
      throw new Error('Not implemented — use IPC handler');
    }),

  broadcast: publicProcedure
    .input(z.object({ sessionIds: z.array(z.string()).min(1), text: z.string().min(1) }))
    .mutation(() => {
      throw new Error('Not implemented — use IPC handler');
    }),

  savePrompt: publicProcedure
    .input(z.object({ sessionId: z.string(), text: z.string().min(1) }))
    .mutation(() => {
      throw new Error('Not implemented — use IPC handler');
    }),

  getPromptHistory: publicProcedure
    .input(z.object({ sessionId: z.string(), limit: z.number().int().positive().max(100).optional() }))
    .query((): Array<{ id: string; text: string; created_at: string }> => {
      throw new Error('Not implemented — use IPC handler');
    }),

  rename: publicProcedure
    .input(z.object({ sessionId: z.string(), name: z.string().min(1).max(30) }))
    .mutation((): Session => {
      throw new Error('Not implemented — use IPC handler');
    }),

  setFavorite: publicProcedure
    .input(z.object({ sessionId: z.string(), favorite: z.boolean() }))
    .mutation((): Session => {
      throw new Error('Not implemented — use IPC handler');
    }),

  // ── M3-01: 세션 비용 조회 ─────────────────────────────────────────────
  getCost: publicProcedure
    .input(z.object({ sessionId: z.string() }))
    .query((): SessionCostSummary => {
      throw new Error('Not implemented — use IPC handler');
    }),

  // ── M3-02: 작업 진행률 조회 ───────────────────────────────────────────
  getTasks: publicProcedure
    .input(z.object({ sessionId: z.string() }))
    .query((): TaskItem[] => {
      throw new Error('Not implemented — use IPC handler');
    }),

  // ── M3-04: 에러 정보 조회 ────────────────────────────────────────────
  getLastError: publicProcedure
    .input(z.object({ sessionId: z.string() }))
    .query((): ErrorInfo | null => {
      throw new Error('Not implemented — use IPC handler');
    }),

  // ── M3: 세션 인텔리전스 전체 조회 ────────────────────────────────────
  getIntelligence: publicProcedure
    .input(z.object({ sessionId: z.string() }))
    .query((): SessionIntelligence | null => {
      throw new Error('Not implemented — use IPC handler');
    }),

  // ── M3: 인텔리전스 실시간 구독 ───────────────────────────────────────
  subscribeIntelligence: publicProcedure
    .input(z.object({ sessionId: z.string() }))
    .subscription(() => {
      throw new Error('Not implemented — use IPC handler');
    }),

  // ── M4-01: 파이프라인 의존성 설정 ────────────────────────────────────
  setPipeline: publicProcedure
    .input(z.object({ sessionId: z.string(), dependsOnSessionId: z.string().nullable() }))
    .mutation((): Session => {
      throw new Error('Not implemented — use IPC handler');
    }),

  // ── M4-02: 컨텍스트 소스 설정 ────────────────────────────────────────
  setContextSource: publicProcedure
    .input(z.object({ sessionId: z.string(), contextSourceSessionId: z.string().nullable() }))
    .mutation((): Session => {
      throw new Error('Not implemented — use IPC handler');
    }),

  getContextOutput: publicProcedure
    .input(z.object({ sessionId: z.string(), lines: z.number().int().positive().max(200).default(100) }))
    .query((): string => {
      throw new Error('Not implemented — use IPC handler');
    }),

  // ── M4-03: 일괄 제어 ────────────────────────────────────────────────
  stopAll: publicProcedure.mutation((): { stopped: number } => {
    throw new Error('Not implemented — use IPC handler');
  }),

  restartAllErrors: publicProcedure.mutation((): { restarted: number } => {
    throw new Error('Not implemented — use IPC handler');
  }),

  // ── M4-05: 라벨 관리 ────────────────────────────────────────────────
  addLabel: publicProcedure
    .input(z.object({ sessionId: z.string(), labelName: z.string().min(1).max(20), labelColor: z.string() }))
    .mutation((): SessionLabel => {
      throw new Error('Not implemented — use IPC handler');
    }),

  removeLabel: publicProcedure
    .input(z.object({ sessionId: z.string(), labelName: z.string() }))
    .mutation((): void => {
      throw new Error('Not implemented — use IPC handler');
    }),

  getLabels: publicProcedure
    .input(z.object({ sessionId: z.string() }))
    .query((): SessionLabel[] => {
      throw new Error('Not implemented — use IPC handler');
    }),

  listByLabel: publicProcedure
    .input(z.object({ labelName: z.string() }))
    .query((): Session[] => {
      throw new Error('Not implemented — use IPC handler');
    }),

  // ── M7-03: 세션 자동 정리 (GC) ──────────────────────────────────────
  gc: publicProcedure
    .input(z.object({ dryRun: z.boolean().default(true) }))
    .mutation((): { archivedCount: number; archivedIds: string[] } => {
      throw new Error('Not implemented — use IPC handler');
    }),

  archive: publicProcedure
    .input(z.object({ sessionId: z.string() }))
    .mutation((): { success: boolean } => {
      throw new Error('Not implemented — use IPC handler');
    }),

  // ── M9-02: 세션 내보내기 ────────────────────────────────────────────────
  export: publicProcedure
    .input(z.object({
      sessionId: z.string(),
      format: z.enum(['html', 'txt', 'json']),
      includeTimestamp: z.boolean().default(true),
      includeAnsi: z.boolean().default(false),
    }))
    .mutation((): { success: boolean; filePath: string } => {
      throw new Error('Not implemented — use IPC handler');
    }),

  // ── M9-04: 세션 아카이브 검색 ──────────────────────────────────────────
  searchArchive: publicProcedure
    .input(z.object({ query: z.string().min(1) }))
    .query((): ArchiveSearchResult[] => {
      throw new Error('Not implemented — use IPC handler');
    }),
});

/**
 * agentRouter — mirrors agent:* IPC channels
 */
export const agentRouter = router({
  list: publicProcedure.query(() => {
    throw new Error('Not implemented — use IPC handler');
  }),

  create: publicProcedure
    .input(CreateAgentSchema)
    .mutation(() => {
      throw new Error('Not implemented — use IPC handler');
    }),

  update: publicProcedure
    .input(UpdateAgentSchema)
    .mutation(() => {
      throw new Error('Not implemented — use IPC handler');
    }),

  delete: publicProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(() => {
      throw new Error('Not implemented — use IPC handler');
    }),
});

/**
 * repositoryRouter — mirrors repository:* and env-var:* IPC channels
 */
export const repositoryRouter = router({
  list: publicProcedure.query(() => {
    throw new Error('Not implemented — use IPC handler');
  }),

  add: publicProcedure
    .input(AddRepositorySchema)
    .mutation(() => {
      throw new Error('Not implemented — use IPC handler');
    }),

  clone: publicProcedure
    .input(CloneRepositorySchema)
    .mutation(() => {
      throw new Error('Not implemented — use IPC handler');
    }),

  update: publicProcedure
    .input(UpdateRepositorySchema)
    .mutation(() => {
      throw new Error('Not implemented — use IPC handler');
    }),

  delete: publicProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(() => {
      throw new Error('Not implemented — use IPC handler');
    }),

  envVar: router({
    list: publicProcedure
      .input(z.object({ repositoryId: z.string().uuid() }))
      .query(() => {
        throw new Error('Not implemented — use IPC handler');
      }),

    upsert: publicProcedure
      .input(EnvVarUpsertSchema)
      .mutation(() => {
        throw new Error('Not implemented — use IPC handler');
      }),

    delete: publicProcedure
      .input(z.object({ id: z.string().uuid() }))
      .mutation(() => {
        throw new Error('Not implemented — use IPC handler');
      }),
  }),
});

/**
 * uiRouter — app state and UI preferences (mirrors app-state:* IPC channels)
 */
export const uiRouter = router({
  focus: publicProcedure
    .input(z.object({ target: z.string() }))
    .mutation(() => {
      throw new Error('Not implemented — use IPC handler');
    }),

  sidebar: publicProcedure
    .input(SidebarSchema)
    .mutation(() => {
      throw new Error('Not implemented — use IPC handler');
    }),

  tabs: publicProcedure
    .input(TabsSchema)
    .mutation(() => {
      throw new Error('Not implemented — use IPC handler');
    }),

  loadState: publicProcedure.query(() => {
    throw new Error('Not implemented — use IPC handler');
  }),

  saveState: publicProcedure
    .input(AppStateSchema)
    .mutation(() => {
      throw new Error('Not implemented — use IPC handler');
    }),
});

/**
 * panesRouter — terminal I/O operations (mirrors session:send-input, session:resize)
 */
export const panesRouter = router({
  terminalSend: publicProcedure
    .input(TerminalSendSchema)
    .mutation(() => {
      throw new Error('Not implemented — use IPC handler');
    }),

  terminalRead: publicProcedure
    .input(z.object({ sessionId: z.string().uuid() }))
    .query(() => {
      throw new Error('Not implemented — use IPC handler');
    }),
});

/**
 * gitRouter — git operations
 */
export const gitRouter = router({
  // ── 실시간 상태 구독 (chokidar 기반) ─────────────────────────────────────
  watchStatus: publicProcedure
    .input(z.object({ repoPath: z.string().min(1) }))
    .subscription(() => {
      throw new Error('Not implemented — use IPC handler');
    }),

  // ── 상태 스냅샷 조회 ──────────────────────────────────────────────────────
  status: publicProcedure
    .input(z.object({ repoPath: z.string().min(1) }))
    .query((): GitStatusResult => {
      throw new Error('Not implemented — use IPC handler');
    }),

  // ── Stage / Unstage ───────────────────────────────────────────────────────
  stage: publicProcedure
    .input(z.object({ repoPath: z.string().min(1), filePath: z.string().min(1) }))
    .mutation(() => {
      throw new Error('Not implemented — use IPC handler');
    }),

  unstage: publicProcedure
    .input(z.object({ repoPath: z.string().min(1), filePath: z.string().min(1) }))
    .mutation(() => {
      throw new Error('Not implemented — use IPC handler');
    }),

  stageAll: publicProcedure
    .input(z.object({ repoPath: z.string().min(1) }))
    .mutation(() => {
      throw new Error('Not implemented — use IPC handler');
    }),

  unstageAll: publicProcedure
    .input(z.object({ repoPath: z.string().min(1) }))
    .mutation(() => {
      throw new Error('Not implemented — use IPC handler');
    }),

  // ── Commit ────────────────────────────────────────────────────────────────
  commit: publicProcedure
    .input(z.object({ repoPath: z.string().min(1), message: z.string().min(1) }))
    .mutation(() => {
      throw new Error('Not implemented — use IPC handler');
    }),

  // ── Remote sync ───────────────────────────────────────────────────────────
  push: publicProcedure
    .input(z.object({ repoPath: z.string().min(1), remote: z.string().optional(), branch: z.string().optional() }))
    .mutation(() => {
      throw new Error('Not implemented — use IPC handler');
    }),

  pull: publicProcedure
    .input(z.object({ repoPath: z.string().min(1), remote: z.string().optional(), branch: z.string().optional() }))
    .mutation(() => {
      throw new Error('Not implemented — use IPC handler');
    }),

  // ── Branch ────────────────────────────────────────────────────────────────
  branches: publicProcedure
    .input(z.object({ repoPath: z.string().min(1) }))
    .query((): { current: string | null; branches: BranchInfo[] } => {
      throw new Error('Not implemented — use IPC handler');
    }),

  checkout: publicProcedure
    .input(z.object({ repoPath: z.string().min(1), branch: z.string().min(1) }))
    .mutation(() => {
      throw new Error('Not implemented — use IPC handler');
    }),

  // ── Diff ──────────────────────────────────────────────────────────────────
  fileDiff: publicProcedure
    .input(z.object({ repoPath: z.string().min(1), filePath: z.string().min(1), staged: z.boolean().optional() }))
    .query((): { raw: string; hunks: DiffHunk[] } => {
      throw new Error('Not implemented — use IPC handler');
    }),

  // ── 기존 호환 유지 ────────────────────────────────────────────────────────
  diff: publicProcedure
    .input(GitDiffSchema)
    .query(() => {
      throw new Error('Not implemented — use IPC handler');
    }),

  getDiff: publicProcedure
    .input(z.object({ workspacePath: z.string().min(1) }))
    .query(() => {
      throw new Error('Not implemented — use IPC handler');
    }),

  readDir: publicProcedure
    .input(z.object({ dirPath: z.string().min(1) }))
    .query((): Array<{ name: string; path: string; isDir: boolean }> => {
      throw new Error('Not implemented — use IPC handler');
    }),

  // ── F-M1-01: Commit History ─────────────────────────────────────────────
  getHistory: publicProcedure
    .input(z.object({
      repoPath: z.string().min(1),
      limit: z.number().int().positive().max(200).default(50),
    }))
    .query((): Array<{ hash: string; shortHash: string; message: string; author: string; date: string; refs: string; graph: string }> => {
      throw new Error('Not implemented — use IPC handler');
    }),

  showCommit: publicProcedure
    .input(z.object({
      repoPath: z.string().min(1),
      commitHash: z.string().min(1),
    }))
    .query((): { raw: string; hunks: DiffHunk[] } => {
      throw new Error('Not implemented — use IPC handler');
    }),

  // ── F-M1-02: Stash Management ──────────────────────────────────────────
  stashList: publicProcedure
    .input(z.object({ repoPath: z.string().min(1) }))
    .query((): Array<{ index: number; message: string; ref: string }> => {
      throw new Error('Not implemented — use IPC handler');
    }),

  stashPush: publicProcedure
    .input(z.object({
      repoPath: z.string().min(1),
      message: z.string().optional(),
    }))
    .mutation((): string => {
      throw new Error('Not implemented — use IPC handler');
    }),

  stashPop: publicProcedure
    .input(z.object({
      repoPath: z.string().min(1),
      index: z.number().int().min(0).default(0),
    }))
    .mutation((): string => {
      throw new Error('Not implemented — use IPC handler');
    }),

  stashDrop: publicProcedure
    .input(z.object({
      repoPath: z.string().min(1),
      index: z.number().int().min(0).default(0),
    }))
    .mutation((): string => {
      throw new Error('Not implemented — use IPC handler');
    }),

  // ── F-M1-03: Fetch & Remote Branch Tracking ────────────────────────────
  fetch: publicProcedure
    .input(z.object({ repoPath: z.string().min(1) }))
    .mutation((): { success: boolean } => {
      throw new Error('Not implemented — use IPC handler');
    }),

  getBranchStatus: publicProcedure
    .input(z.object({ repoPath: z.string().min(1) }))
    .query((): { current: string; ahead: number; behind: number; tracking: string | null } => {
      throw new Error('Not implemented — use IPC handler');
    }),

  // ── F-M1-04: Git Reset & Revert ────────────────────────────────────────
  reset: publicProcedure
    .input(z.object({
      repoPath: z.string().min(1),
      commitHash: z.string().min(1),
      mode: z.enum(['soft', 'mixed', 'hard']),
    }))
    .mutation((): string => {
      throw new Error('Not implemented — use IPC handler');
    }),

  revert: publicProcedure
    .input(z.object({
      repoPath: z.string().min(1),
      commitHash: z.string().min(1),
    }))
    .mutation((): string => {
      throw new Error('Not implemented — use IPC handler');
    }),

  discardAll: publicProcedure
    .input(z.object({ repoPath: z.string().min(1) }))
    .mutation((): string => {
      throw new Error('Not implemented — use IPC handler');
    }),

  // ── F-M1-05: Blame ─────────────────────────────────────────────────────
  blame: publicProcedure
    .input(z.object({
      repoPath: z.string().min(1),
      filePath: z.string().min(1),
    }))
    .query((): Array<{ lineNumber: number; commitHash: string; shortHash: string; author: string; date: string; message: string; content: string }> => {
      throw new Error('Not implemented — use IPC handler');
    }),

  // ── F-M1-06: Tag Management ───────────────────────────────────────────
  listTags: publicProcedure
    .input(z.object({ repoPath: z.string().min(1) }))
    .query((): Array<{ name: string; hash: string; message: string; isAnnotated: boolean; date: string }> => {
      throw new Error('Not implemented — use IPC handler');
    }),

  createTag: publicProcedure
    .input(z.object({
      repoPath: z.string().min(1),
      name: z.string().min(1),
      message: z.string().optional(),
      annotated: z.boolean().default(true),
    }))
    .mutation((): string => {
      throw new Error('Not implemented — use IPC handler');
    }),

  deleteTag: publicProcedure
    .input(z.object({
      repoPath: z.string().min(1),
      name: z.string().min(1),
    }))
    .mutation((): string => {
      throw new Error('Not implemented — use IPC handler');
    }),

  pushTags: publicProcedure
    .input(z.object({ repoPath: z.string().min(1) }))
    .mutation((): string => {
      throw new Error('Not implemented — use IPC handler');
    }),

  // ── F-M1-07: Cherry-pick ─────────────────────────────────────────────
  cherryPick: publicProcedure
    .input(z.object({
      repoPath: z.string().min(1),
      commitHash: z.string().min(1),
    }))
    .mutation((): { success: boolean; conflicts: string[] } => {
      throw new Error('Not implemented — use IPC handler');
    }),

  cherryPickAbort: publicProcedure
    .input(z.object({ repoPath: z.string().min(1) }))
    .mutation((): string => {
      throw new Error('Not implemented — use IPC handler');
    }),

  // ── F-M1-08: Squash Commits ──────────────────────────────────────────
  getRecentCommits: publicProcedure
    .input(z.object({
      repoPath: z.string().min(1),
      count: z.number().int().positive().max(50),
    }))
    .query((): Array<{ hash: string; shortHash: string; message: string }> => {
      throw new Error('Not implemented — use IPC handler');
    }),

  squashCommits: publicProcedure
    .input(z.object({
      repoPath: z.string().min(1),
      count: z.number().int().positive().max(50),
      message: z.string().min(1),
    }))
    .mutation((): string => {
      throw new Error('Not implemented — use IPC handler');
    }),

  // ── Merge ────────────────────────────────────────────────────────────────
  merge: publicProcedure
    .input(z.object({
      workspaceId: z.string().uuid(),
      strategy: z.enum(['squash', 'rebase', 'merge']),
    }))
    .mutation((): { success: boolean; message: string } => {
      throw new Error('Not implemented — use IPC handler');
    }),
});

/**
 * mcpRouter — MCP server management (mirrors mcp:* IPC channels)
 */
/**
 * layoutRouter — tiled layout persistence (tiled_layouts table)
 */
export const layoutRouter = router({
  get: publicProcedure
    .input(z.object({ workspaceId: z.string() }))
    .query(() => {
      throw new Error('Not implemented — use IPC handler');
    }),

  save: publicProcedure
    .input(z.object({ workspaceId: z.string(), mosaicState: z.any() }))
    .mutation(() => {
      throw new Error('Not implemented — use IPC handler');
    }),
});

export const mcpRouter = router({
  list: publicProcedure.query(() => {
    throw new Error('Not implemented — use IPC handler');
  }),

  add: publicProcedure
    .input(McpAddSchema)
    .mutation(() => {
      throw new Error('Not implemented — use IPC handler');
    }),

  delete: publicProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(() => {
      throw new Error('Not implemented — use IPC handler');
    }),

  toggle: publicProcedure
    .input(McpToggleSchema)
    .mutation(() => {
      throw new Error('Not implemented — use IPC handler');
    }),

  updateStatus: publicProcedure
    .input(McpUpdateStatusSchema)
    .mutation(() => {
      throw new Error('Not implemented — use IPC handler');
    }),

  checkServers: publicProcedure.mutation(() => {
    throw new Error('Not implemented — use IPC handler');
  }),
});

// ── M4-04: presetRouter ──────────────────────────────────────────────────────

export const presetRouter = router({
  list: publicProcedure.query((): AgentPreset[] => {
    throw new Error('Not implemented — use IPC handler');
  }),

  create: publicProcedure
    .input(z.object({
      name: z.string().min(1),
      agentId: z.string(),
      workspaceId: z.string(),
      initialCommand: z.string().default(''),
      envVars: z.record(z.string(), z.string()).default({}),
    }))
    .mutation((): AgentPreset => {
      throw new Error('Not implemented — use IPC handler');
    }),

  update: publicProcedure
    .input(z.object({
      id: z.string(),
      name: z.string().min(1).optional(),
      agentId: z.string().optional(),
      workspaceId: z.string().optional(),
      initialCommand: z.string().optional(),
      envVars: z.record(z.string(), z.string()).optional(),
    }))
    .mutation((): AgentPreset => {
      throw new Error('Not implemented — use IPC handler');
    }),

  delete: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation((): void => {
      throw new Error('Not implemented — use IPC handler');
    }),

  launch: publicProcedure
    .input(z.object({ presetId: z.string(), cols: z.number().int().positive(), rows: z.number().int().positive() }))
    .mutation((): Session => {
      throw new Error('Not implemented — use IPC handler');
    }),
});

// ── claudeRouter ─────────────────────────────────────────────────────────────

export const claudeRouter = router({
  chat: publicProcedure
    .input(
      z.object({
        messages: z.array(
          z.object({
            role: z.enum(['user', 'assistant']),
            content: z.string(),
          })
        ),
        systemPrompt: z.string(),
      })
    )
    .mutation((): { content: string } => {
      throw new Error('Not implemented — use IPC handler');
    }),
});

// ── Root app router ───────────────────────────────────────────────────────────

/**
 * appRouter — root tRPC router combining all sub-routers
 *
 * Hierarchy:
 *   appRouter
 *   ├── workspace  (workspaceRouter)
 *   ├── session    (sessionRouter)
 *   ├── agent      (agentRouter)
 *   ├── repository (repositoryRouter + envVar sub-router)
 *   ├── ui         (uiRouter)
 *   ├── panes      (panesRouter)
 *   ├── git        (gitRouter)
 *   └── mcp        (mcpRouter)
 */
export const dialogRouter = router({
  openDirectory: publicProcedure.mutation(async (): Promise<string | null> => null),
});

export const appStateRouter = router({
  get: publicProcedure.query(async () => null as unknown),
  set: publicProcedure.input(z.object({ key: z.string(), value: z.unknown() })).mutation(async () => {}),
});

export const shellRouter = router({
  openPath: publicProcedure
    .input(z.object({ filePath: z.string().min(1) }))
    .mutation(async () => {}),

  readFile: publicProcedure
    .input(z.object({ filePath: z.string().min(1) }))
    .query((): { content: string; exists: boolean } => {
      throw new Error('Not implemented — use IPC handler');
    }),

  writeFile: publicProcedure
    .input(z.object({ filePath: z.string().min(1), content: z.string() }))
    .mutation((): { success: boolean } => {
      throw new Error('Not implemented — use IPC handler');
    }),
});

// ── M7-04: systemRouter ─────────────────────────────────────────────────────

export const systemRouter = router({
  openLogsFolder: publicProcedure.mutation((): { path: string } => {
    throw new Error('Not implemented — use IPC handler');
  }),
});

export interface ProcessMetrics {
  sessionId: string;
  pid: number;
  cpu: number;
  memory: number;
}

export const resourceRouter = router({
  subscribe: publicProcedure.subscription(() => {
    throw new Error('Not implemented — use IPC handler');
  }),
  register: publicProcedure
    .input(z.object({ sessionId: z.string(), pid: z.number().int().positive() }))
    .mutation(async () => {}),
  unregister: publicProcedure
    .input(z.object({ sessionId: z.string() }))
    .mutation(async () => {}),
});

export const fileRouter = router({
  watchMarkdown: publicProcedure
    .input(z.object({ filePath: z.string().min(1) }))
    .subscription(() => {
      throw new Error('Not implemented — use IPC handler');
    }),

  readMarkdown: publicProcedure
    .input(z.object({ filePath: z.string().min(1) }))
    .query((): { content: string; exists: boolean } => {
      throw new Error('Not implemented — use IPC handler');
    }),
});

// ── AI Agent Editor: Project & Task Schemas ──────────────────────────────────

export const CreateProjectSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  repositoryId: z.string().optional(),
});

export const UpdateProjectSchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().optional(),
  repositoryId: z.string().optional(),
});

export const CreateTaskSchema_AI = z.object({
  projectId: z.string(),
  parentTaskId: z.string().optional(),
  title: z.string().min(1),
  prd: z.string().optional(),
  spec: z.string().optional(),
  referenceFiles: z.array(z.string()).optional(),
  acceptanceCriteria: z.string().optional(),
  priority: z.enum(['critical', 'high', 'medium', 'low']).default('medium'),
  assignedAgentId: z.string().optional(),
  createdBy: z.enum(['human', 'agent']).default('human'),
});

export const UpdateTaskSchema_AI = z.object({
  title: z.string().min(1).optional(),
  prd: z.string().optional(),
  spec: z.string().optional(),
  referenceFiles: z.array(z.string()).optional(),
  acceptanceCriteria: z.string().optional(),
  priority: z.enum(['critical', 'high', 'medium', 'low']).optional(),
  assignedAgentId: z.string().optional(),
  status: z.enum(['pending', 'in_progress', 'completed', 'cancelled']).optional(),
  workspaceId: z.string().optional(),
});

// ── AI Agent Editor: projectRouter ──────────────────────────────────────────

export const projectRouter = router({
  list: publicProcedure.query((): Project[] => {
    throw new Error('Not implemented — use IPC handler');
  }),

  get: publicProcedure
    .input(z.object({ id: z.string() }))
    .query((): Project | null => {
      throw new Error('Not implemented — use IPC handler');
    }),

  create: publicProcedure
    .input(CreateProjectSchema)
    .mutation((): Project => {
      throw new Error('Not implemented — use IPC handler');
    }),

  update: publicProcedure
    .input(z.object({ id: z.string(), data: UpdateProjectSchema }))
    .mutation((): Project => {
      throw new Error('Not implemented — use IPC handler');
    }),

  delete: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation((): void => {
      throw new Error('Not implemented — use IPC handler');
    }),
});

// ── AI Agent Editor: taskRouter ──────────────────────────────────────────────

export const projectTaskRouter = router({
  list: publicProcedure
    .input(z.object({ projectId: z.string() }))
    .query((): ProjectTask[] => {
      throw new Error('Not implemented — use IPC handler');
    }),

  listChildren: publicProcedure
    .input(z.object({ parentTaskId: z.string() }))
    .query((): ProjectTask[] => {
      throw new Error('Not implemented — use IPC handler');
    }),

  get: publicProcedure
    .input(z.object({ id: z.string() }))
    .query((): ProjectTask | null => {
      throw new Error('Not implemented — use IPC handler');
    }),

  create: publicProcedure
    .input(CreateTaskSchema_AI)
    .mutation((): ProjectTask => {
      throw new Error('Not implemented — use IPC handler');
    }),

  update: publicProcedure
    .input(z.object({ id: z.string(), data: UpdateTaskSchema_AI }))
    .mutation((): ProjectTask => {
      throw new Error('Not implemented — use IPC handler');
    }),

  delete: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation((): void => {
      throw new Error('Not implemented — use IPC handler');
    }),

  // Task 실행: workspace 자동 생성 + PTY 세션 생성
  run: publicProcedure
    .input(z.object({
      taskId: z.string(),
      agentId: z.string().optional(),
      cols: z.number().int().positive().default(220),
      rows: z.number().int().positive().default(50),
    }))
    .mutation((): { workspace: Workspace; session: Session } => {
      throw new Error('Not implemented — use IPC handler');
    }),
});

// ── M6-02: webhookRouter ────────────────────────────────────────────────────

export const webhookRouter = router({
  list: publicProcedure.query((): Webhook[] => {
    throw new Error('Not implemented — use IPC handler');
  }),

  create: publicProcedure
    .input(z.object({
      url: z.string().url(),
      events: z.array(z.enum(['session.completed', 'session.error', 'agent.task_done', 'session.started'])),
      secret: z.string().default(''),
    }))
    .mutation((): Webhook => {
      throw new Error('Not implemented — use IPC handler');
    }),

  update: publicProcedure
    .input(z.object({
      id: z.string(),
      url: z.string().url().optional(),
      events: z.array(z.enum(['session.completed', 'session.error', 'agent.task_done', 'session.started'])).optional(),
      secret: z.string().optional(),
      enabled: z.boolean().optional(),
    }))
    .mutation((): Webhook => {
      throw new Error('Not implemented — use IPC handler');
    }),

  delete: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation((): void => {
      throw new Error('Not implemented — use IPC handler');
    }),

  test: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation((): { success: boolean; statusCode: number | null } => {
      throw new Error('Not implemented — use IPC handler');
    }),

  getLogs: publicProcedure
    .input(z.object({ webhookId: z.string(), limit: z.number().int().positive().max(100).default(20) }))
    .query((): WebhookLog[] => {
      throw new Error('Not implemented — use IPC handler');
    }),
});

// ── M6-03: apiKeyRouter ─────────────────────────────────────────────────────

export const apiKeyRouter = router({
  get: publicProcedure.query((): ApiKey | null => {
    throw new Error('Not implemented — use IPC handler');
  }),

  generate: publicProcedure
    .input(z.object({ name: z.string().default('Default') }))
    .mutation((): ApiKey => {
      throw new Error('Not implemented — use IPC handler');
    }),

  revoke: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation((): void => {
      throw new Error('Not implemented — use IPC handler');
    }),
});

// ── M6-05: relayRouter ──────────────────────────────────────────────────────

export const relayRouter = router({
  getStatus: publicProcedure.query((): { status: string; latencyMs: number | null } => {
    throw new Error('Not implemented — use IPC handler');
  }),

  connect: publicProcedure.mutation((): { success: boolean } => {
    throw new Error('Not implemented — use IPC handler');
  }),

  disconnect: publicProcedure.mutation((): { success: boolean } => {
    throw new Error('Not implemented — use IPC handler');
  }),
});

// ── M10-01: pluginRouter ────────────────────────────────────────────────────

export const pluginRouter = router({
  list: publicProcedure.query((): PluginInfo[] => {
    throw new Error('Not implemented — use IPC handler');
  }),

  load: publicProcedure
    .input(z.object({ pluginPath: z.string().min(1) }))
    .mutation((): PluginInfo => {
      throw new Error('Not implemented — use IPC handler');
    }),

  unload: publicProcedure
    .input(z.object({ pluginId: z.string() }))
    .mutation((): void => {
      throw new Error('Not implemented — use IPC handler');
    }),
});

// ── M9-03: profileRouter ───────────────────────────────────────────────────

export const profileRouter = router({
  export: publicProcedure.mutation((): { success: boolean; filePath: string } => {
    throw new Error('Not implemented — use IPC handler');
  }),

  import: publicProcedure
    .input(z.object({ mode: z.enum(['merge', 'overwrite']) }))
    .mutation((): { success: boolean } => {
      throw new Error('Not implemented — use IPC handler');
    }),
});

// ── M10-03: themeRouter ────────────────────────────────────────────────────

export const themeRouter = router({
  export: publicProcedure
    .input(z.object({ name: z.string().min(1), variables: z.record(z.string(), z.string()) }))
    .mutation((): { success: boolean; filePath: string } => {
      throw new Error('Not implemented — use IPC handler');
    }),

  import: publicProcedure.mutation((): CustomTheme | null => {
    throw new Error('Not implemented — use IPC handler');
  }),
});

export const appRouter = router({
  workspace: workspaceRouter,
  session: sessionRouter,
  agent: agentRouter,
  repository: repositoryRouter,
  ui: uiRouter,
  panes: panesRouter,
  layout: layoutRouter,
  git: gitRouter,
  mcp: mcpRouter,
  dialog: dialogRouter,
  appState: appStateRouter,
  shell: shellRouter,
  system: systemRouter,
  resource: resourceRouter,
  file: fileRouter,
  preset: presetRouter,
  template: templateRouter,
  webhook: webhookRouter,
  apiKey: apiKeyRouter,
  relay: relayRouter,
  plugin: pluginRouter,
  profile: profileRouter,
  theme: themeRouter,
  project: projectRouter,
  projectTask: projectTaskRouter,
  claude: claudeRouter,
});

// ── Type exports ──────────────────────────────────────────────────────────────

/** Root router type — use this on the client side for type inference */
export type AppRouter = typeof appRouter;

export type WorkspaceRouter = typeof workspaceRouter;
export type SessionRouter = typeof sessionRouter;
export type AgentRouter = typeof agentRouter;
export type RepositoryRouter = typeof repositoryRouter;
export type UiRouter = typeof uiRouter;
export type PanesRouter = typeof panesRouter;
export type LayoutRouter = typeof layoutRouter;
export type GitRouter = typeof gitRouter;
export type McpRouter = typeof mcpRouter;
export type PresetRouter = typeof presetRouter;
export type TemplateRouter = typeof templateRouter;
export type WebhookRouter = typeof webhookRouter;
export type ApiKeyRouter = typeof apiKeyRouter;
export type RelayRouter = typeof relayRouter;
export type PluginRouter = typeof pluginRouter;
export type ProfileRouter = typeof profileRouter;
export type ThemeRouter = typeof themeRouter;
export type ProjectRouter = typeof projectRouter;
export type ProjectTaskRouter = typeof projectTaskRouter;
export type ClaudeRouter = typeof claudeRouter;
