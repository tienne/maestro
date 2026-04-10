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
import type { Workspace, Repository, Agent, Session } from './index';

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
});

export const UpdateAgentSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1),
  command: z.string().min(1),
  args: z.array(z.string()),
  env: z.record(z.string(), z.string()),
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
    .input(z.object({ sessionId: z.string().uuid() }))
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
    .query(() => {
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
