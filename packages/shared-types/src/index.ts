// Shared TypeScript types between web frontend and any tooling

export type SessionStatus = 'pending' | 'running' | 'stopped' | 'error';

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
}

export interface Session {
  id: string;
  name: string;
  workspaceId: string;
  agentId: string;
  status: SessionStatus;
  pid?: number;
  createdAt: string;
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

// tRPC router types and Zod schemas
export * from './trpc';

// Electron IPC event payloads
export interface SessionOutputPayload {
  sessionId: string;
  data: string;
}

export interface SessionStatusPayload {
  sessionId: string;
  status: SessionStatus;
}
