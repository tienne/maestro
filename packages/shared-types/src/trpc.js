"use strict";
/**
 * tRPC router interface definitions for Maestro
 *
 * This file defines the shared tRPC router type used by both
 * the Electron main process (server) and the renderer process (client).
 *
 * Electron IPC channel pattern: "<domain>:<action>"
 * These router definitions mirror the ipcMain.handle channels in apps/desktop/src/handlers/
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.appRouter = exports.mcpRouter = exports.gitRouter = exports.panesRouter = exports.uiRouter = exports.repositoryRouter = exports.agentRouter = exports.sessionRouter = exports.workspaceRouter = exports.GitCommitSchema = exports.GitDiffSchema = exports.GitStatusSchema = exports.TerminalResizeSchema = exports.TerminalSendSchema = exports.TabsSchema = exports.SidebarSchema = exports.AppStateSchema = exports.McpUpdateStatusSchema = exports.McpToggleSchema = exports.McpAddSchema = exports.EnvVarUpsertSchema = exports.UpdateRepositorySchema = exports.CloneRepositorySchema = exports.AddRepositorySchema = exports.UpdateAgentSchema = exports.CreateAgentSchema = exports.LaunchSessionSchema = exports.CreateSessionSchema = exports.CreateWorkspaceSchema = exports.RepositorySettingsSchema = exports.publicProcedure = exports.router = void 0;
const server_1 = require("@trpc/server");
const zod_1 = require("zod");
// ── tRPC instance ─────────────────────────────────────────────────────────────
const t = server_1.initTRPC.create();
exports.router = t.router;
exports.publicProcedure = t.procedure;
// ── Zod Schemas ───────────────────────────────────────────────────────────────
exports.RepositorySettingsSchema = zod_1.z.object({
    name: zod_1.z.string().optional(),
    color: zod_1.z.string().optional(),
    branchPrefix: zod_1.z.string().optional(),
    baseBranch: zod_1.z.string().optional(),
    worktreeBasePath: zod_1.z.string().optional(),
    setupScript: zod_1.z.string().optional(),
    teardownScript: zod_1.z.string().optional(),
});
exports.CreateWorkspaceSchema = zod_1.z.object({
    name: zod_1.z.string().min(1),
    repositoryId: zod_1.z.string().uuid(),
});
exports.CreateSessionSchema = zod_1.z.object({
    name: zod_1.z.string().min(1),
    workspaceId: zod_1.z.string().uuid(),
    agentId: zod_1.z.string().uuid(),
});
exports.LaunchSessionSchema = zod_1.z.object({
    sessionId: zod_1.z.string().uuid(),
    cols: zod_1.z.number().int().positive(),
    rows: zod_1.z.number().int().positive(),
});
exports.CreateAgentSchema = zod_1.z.object({
    name: zod_1.z.string().min(1),
    command: zod_1.z.string().min(1),
    args: zod_1.z.array(zod_1.z.string()),
    env: zod_1.z.record(zod_1.z.string(), zod_1.z.string()),
});
exports.UpdateAgentSchema = zod_1.z.object({
    id: zod_1.z.string().uuid(),
    name: zod_1.z.string().min(1),
    command: zod_1.z.string().min(1),
    args: zod_1.z.array(zod_1.z.string()),
    env: zod_1.z.record(zod_1.z.string(), zod_1.z.string()),
});
exports.AddRepositorySchema = zod_1.z.object({
    path: zod_1.z.string().min(1),
});
exports.CloneRepositorySchema = zod_1.z.object({
    url: zod_1.z.string().url(),
    targetPath: zod_1.z.string().min(1),
});
exports.UpdateRepositorySchema = zod_1.z.object({
    id: zod_1.z.string().uuid(),
    settings: exports.RepositorySettingsSchema,
});
exports.EnvVarUpsertSchema = zod_1.z.object({
    repositoryId: zod_1.z.string().uuid(),
    key: zod_1.z.string().min(1),
    value: zod_1.z.string(),
});
exports.McpAddSchema = zod_1.z.object({
    name: zod_1.z.string().min(1),
    url: zod_1.z.string().url(),
});
exports.McpToggleSchema = zod_1.z.object({
    id: zod_1.z.string().uuid(),
    enabled: zod_1.z.boolean(),
});
exports.McpUpdateStatusSchema = zod_1.z.object({
    id: zod_1.z.string().uuid(),
    status: zod_1.z.enum(['connected', 'offline', 'error']),
    errorMsg: zod_1.z.string().nullable(),
});
exports.AppStateSchema = zod_1.z.object({
    activeWorkspaceId: zod_1.z.string().optional(),
    activeSessionId: zod_1.z.string().optional(),
    sidebarWidth: zod_1.z.number(),
    rightSidebarWidth: zod_1.z.number(),
});
exports.SidebarSchema = zod_1.z.object({
    open: zod_1.z.boolean(),
    side: zod_1.z.enum(['left', 'right']).optional(),
});
exports.TabsSchema = zod_1.z.object({
    activeTab: zod_1.z.string(),
    panel: zod_1.z.enum(['terminal', 'git', 'mcp']).optional(),
});
exports.TerminalSendSchema = zod_1.z.object({
    sessionId: zod_1.z.string().uuid(),
    text: zod_1.z.string(),
});
exports.TerminalResizeSchema = zod_1.z.object({
    sessionId: zod_1.z.string().uuid(),
    cols: zod_1.z.number().int().positive(),
    rows: zod_1.z.number().int().positive(),
});
exports.GitStatusSchema = zod_1.z.object({
    workspacePath: zod_1.z.string().min(1),
});
exports.GitDiffSchema = zod_1.z.object({
    workspacePath: zod_1.z.string().min(1),
    filePath: zod_1.z.string().min(1),
    staged: zod_1.z.boolean(),
});
exports.GitCommitSchema = zod_1.z.object({
    workspacePath: zod_1.z.string().min(1),
    message: zod_1.z.string().min(1),
});
// ── Routers ───────────────────────────────────────────────────────────────────
/**
 * workspaceRouter — mirrors workspace:* IPC channels
 */
exports.workspaceRouter = (0, exports.router)({
    list: exports.publicProcedure.query(() => {
        throw new Error('Not implemented — use IPC handler');
    }),
    create: exports.publicProcedure
        .input(exports.CreateWorkspaceSchema)
        .mutation(() => {
        throw new Error('Not implemented — use IPC handler');
    }),
    delete: exports.publicProcedure
        .input(zod_1.z.object({ id: zod_1.z.string().uuid() }))
        .mutation(() => {
        throw new Error('Not implemented — use IPC handler');
    }),
});
/**
 * sessionRouter — mirrors session:* IPC channels
 */
exports.sessionRouter = (0, exports.router)({
    list: exports.publicProcedure
        .input(zod_1.z.object({ workspaceId: zod_1.z.string().uuid() }))
        .query(() => {
        throw new Error('Not implemented — use IPC handler');
    }),
    listAll: exports.publicProcedure.query(() => {
        throw new Error('Not implemented — use IPC handler');
    }),
    create: exports.publicProcedure
        .input(exports.CreateSessionSchema)
        .mutation(() => {
        throw new Error('Not implemented — use IPC handler');
    }),
    launch: exports.publicProcedure
        .input(exports.LaunchSessionSchema)
        .mutation(() => {
        throw new Error('Not implemented — use IPC handler');
    }),
    stop: exports.publicProcedure
        .input(zod_1.z.object({ sessionId: zod_1.z.string().uuid() }))
        .mutation(() => {
        throw new Error('Not implemented — use IPC handler');
    }),
    delete: exports.publicProcedure
        .input(zod_1.z.object({ sessionId: zod_1.z.string().uuid() }))
        .mutation(() => {
        throw new Error('Not implemented — use IPC handler');
    }),
    sendInput: exports.publicProcedure
        .input(exports.TerminalSendSchema)
        .mutation(() => {
        throw new Error('Not implemented — use IPC handler');
    }),
    resize: exports.publicProcedure
        .input(exports.TerminalResizeSchema)
        .mutation(() => {
        throw new Error('Not implemented — use IPC handler');
    }),
    getLast: exports.publicProcedure.query(() => {
        throw new Error('Not implemented — use IPC handler');
    }),
    setLastActive: exports.publicProcedure
        .input(zod_1.z.object({ sessionId: zod_1.z.string().uuid() }))
        .mutation(() => {
        throw new Error('Not implemented — use IPC handler');
    }),
    resume: exports.publicProcedure
        .input(zod_1.z.object({ sessionId: zod_1.z.string().uuid() }))
        .mutation(() => {
        throw new Error('Not implemented — use IPC handler');
    }),
    updateStatus: exports.publicProcedure
        .input(zod_1.z.object({ sessionId: zod_1.z.string().uuid(), status: zod_1.z.string() }))
        .mutation(() => {
        throw new Error('Not implemented — use IPC handler');
    }),
});
/**
 * agentRouter — mirrors agent:* IPC channels
 */
exports.agentRouter = (0, exports.router)({
    list: exports.publicProcedure.query(() => {
        throw new Error('Not implemented — use IPC handler');
    }),
    create: exports.publicProcedure
        .input(exports.CreateAgentSchema)
        .mutation(() => {
        throw new Error('Not implemented — use IPC handler');
    }),
    update: exports.publicProcedure
        .input(exports.UpdateAgentSchema)
        .mutation(() => {
        throw new Error('Not implemented — use IPC handler');
    }),
    delete: exports.publicProcedure
        .input(zod_1.z.object({ id: zod_1.z.string().uuid() }))
        .mutation(() => {
        throw new Error('Not implemented — use IPC handler');
    }),
});
/**
 * repositoryRouter — mirrors repository:* and env-var:* IPC channels
 */
exports.repositoryRouter = (0, exports.router)({
    list: exports.publicProcedure.query(() => {
        throw new Error('Not implemented — use IPC handler');
    }),
    add: exports.publicProcedure
        .input(exports.AddRepositorySchema)
        .mutation(() => {
        throw new Error('Not implemented — use IPC handler');
    }),
    clone: exports.publicProcedure
        .input(exports.CloneRepositorySchema)
        .mutation(() => {
        throw new Error('Not implemented — use IPC handler');
    }),
    update: exports.publicProcedure
        .input(exports.UpdateRepositorySchema)
        .mutation(() => {
        throw new Error('Not implemented — use IPC handler');
    }),
    delete: exports.publicProcedure
        .input(zod_1.z.object({ id: zod_1.z.string().uuid() }))
        .mutation(() => {
        throw new Error('Not implemented — use IPC handler');
    }),
    envVar: (0, exports.router)({
        list: exports.publicProcedure
            .input(zod_1.z.object({ repositoryId: zod_1.z.string().uuid() }))
            .query(() => {
            throw new Error('Not implemented — use IPC handler');
        }),
        upsert: exports.publicProcedure
            .input(exports.EnvVarUpsertSchema)
            .mutation(() => {
            throw new Error('Not implemented — use IPC handler');
        }),
        delete: exports.publicProcedure
            .input(zod_1.z.object({ id: zod_1.z.string().uuid() }))
            .mutation(() => {
            throw new Error('Not implemented — use IPC handler');
        }),
    }),
});
/**
 * uiRouter — app state and UI preferences (mirrors app-state:* IPC channels)
 */
exports.uiRouter = (0, exports.router)({
    focus: exports.publicProcedure
        .input(zod_1.z.object({ target: zod_1.z.string() }))
        .mutation(() => {
        throw new Error('Not implemented — use IPC handler');
    }),
    sidebar: exports.publicProcedure
        .input(exports.SidebarSchema)
        .mutation(() => {
        throw new Error('Not implemented — use IPC handler');
    }),
    tabs: exports.publicProcedure
        .input(exports.TabsSchema)
        .mutation(() => {
        throw new Error('Not implemented — use IPC handler');
    }),
    loadState: exports.publicProcedure.query(() => {
        throw new Error('Not implemented — use IPC handler');
    }),
    saveState: exports.publicProcedure
        .input(exports.AppStateSchema)
        .mutation(() => {
        throw new Error('Not implemented — use IPC handler');
    }),
});
/**
 * panesRouter — terminal I/O operations (mirrors session:send-input, session:resize)
 */
exports.panesRouter = (0, exports.router)({
    terminalSend: exports.publicProcedure
        .input(exports.TerminalSendSchema)
        .mutation(() => {
        throw new Error('Not implemented — use IPC handler');
    }),
    terminalRead: exports.publicProcedure
        .input(zod_1.z.object({ sessionId: zod_1.z.string().uuid() }))
        .query(() => {
        throw new Error('Not implemented — use IPC handler');
    }),
});
/**
 * gitRouter — git operations (mirrors git:* IPC channels)
 */
exports.gitRouter = (0, exports.router)({
    status: exports.publicProcedure
        .input(exports.GitStatusSchema)
        .query(() => {
        throw new Error('Not implemented — use IPC handler');
    }),
    diff: exports.publicProcedure
        .input(exports.GitDiffSchema)
        .query(() => {
        throw new Error('Not implemented — use IPC handler');
    }),
    getDiff: exports.publicProcedure
        .input(zod_1.z.object({ workspacePath: zod_1.z.string().min(1) }))
        .query(() => {
        throw new Error('Not implemented — use IPC handler');
    }),
    stageAll: exports.publicProcedure
        .input(zod_1.z.object({ workspacePath: zod_1.z.string().min(1) }))
        .mutation(() => {
        throw new Error('Not implemented — use IPC handler');
    }),
    commit: exports.publicProcedure
        .input(exports.GitCommitSchema)
        .mutation(() => {
        throw new Error('Not implemented — use IPC handler');
    }),
    readDir: exports.publicProcedure
        .input(zod_1.z.object({ dirPath: zod_1.z.string().min(1) }))
        .query(() => {
        throw new Error('Not implemented — use IPC handler');
    }),
});
/**
 * mcpRouter — MCP server management (mirrors mcp:* IPC channels)
 */
exports.mcpRouter = (0, exports.router)({
    list: exports.publicProcedure.query(() => {
        throw new Error('Not implemented — use IPC handler');
    }),
    add: exports.publicProcedure
        .input(exports.McpAddSchema)
        .mutation(() => {
        throw new Error('Not implemented — use IPC handler');
    }),
    delete: exports.publicProcedure
        .input(zod_1.z.object({ id: zod_1.z.string().uuid() }))
        .mutation(() => {
        throw new Error('Not implemented — use IPC handler');
    }),
    toggle: exports.publicProcedure
        .input(exports.McpToggleSchema)
        .mutation(() => {
        throw new Error('Not implemented — use IPC handler');
    }),
    updateStatus: exports.publicProcedure
        .input(exports.McpUpdateStatusSchema)
        .mutation(() => {
        throw new Error('Not implemented — use IPC handler');
    }),
    checkServers: exports.publicProcedure.mutation(() => {
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
exports.appRouter = (0, exports.router)({
    workspace: exports.workspaceRouter,
    session: exports.sessionRouter,
    agent: exports.agentRouter,
    repository: exports.repositoryRouter,
    ui: exports.uiRouter,
    panes: exports.panesRouter,
    git: exports.gitRouter,
    mcp: exports.mcpRouter,
});
//# sourceMappingURL=trpc.js.map