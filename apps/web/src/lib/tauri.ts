import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type {
  Repository,
  Workspace,
  Agent,
  Session,
  SessionOutputPayload,
  SessionStatusPayload,
} from '@maestro/shared-types';

// ── Repository ────────────────────────────────────────────────────────────────
export const repositoryList = () => invoke<Repository[]>('repository_list');
export const repositoryAdd = (path: string) => invoke<Repository>('repository_add', { path });
export const repositoryRemove = (id: string) => invoke<void>('repository_remove', { id });

// ── Workspace ─────────────────────────────────────────────────────────────────
export const workspaceList = () => invoke<Workspace[]>('workspace_list');
export const workspaceCreate = (name: string, repositoryId: string, branch: string) =>
  invoke<Workspace>('workspace_create', { name, repositoryId, branch });
export const workspaceDelete = (id: string) => invoke<void>('workspace_delete', { id });

// ── Agent ─────────────────────────────────────────────────────────────────────
export const agentList = () => invoke<Agent[]>('agent_list');
export const agentCreate = (name: string, command: string, args: string[], env: Record<string, string>) =>
  invoke<Agent>('agent_create', { name, command, args, env });
export const agentUpdate = (id: string, name: string, command: string, args: string[], env: Record<string, string>) =>
  invoke<Agent>('agent_update', { id, name, command, args, env });
export const agentDelete = (id: string) => invoke<void>('agent_delete', { id });

// ── Session ───────────────────────────────────────────────────────────────────
export const sessionList = (workspaceId: string) =>
  invoke<Session[]>('session_list', { workspaceId });
export const sessionListAll = () => invoke<Session[]>('session_list_all');
export const sessionStart = (name: string, workspaceId: string, agentId: string) =>
  invoke<Session>('session_start', { name, workspaceId, agentId });
export const sessionStop = (sessionId: string) => invoke<void>('session_stop', { sessionId });
export const sessionSendInput = (sessionId: string, text: string) =>
  invoke<void>('session_send_input', { sessionId, text });
export const sessionUpdateStatus = (sessionId: string, status: string) =>
  invoke<void>('session_update_status', { sessionId, status });

// ── Git ───────────────────────────────────────────────────────────────────────
export interface GitFileStatus {
  path: string;
  staged: boolean;
  status: string;
}

export const gitStatus = (workspacePath: string) =>
  invoke<GitFileStatus[]>('git_status', { workspacePath });
export const gitDiff = (workspacePath: string, filePath: string, staged: boolean) =>
  invoke<string>('git_diff', { workspacePath, filePath, staged });
export const gitStageAll = (workspacePath: string) =>
  invoke<void>('git_stage_all', { workspacePath });
export const gitCommit = (workspacePath: string, message: string) =>
  invoke<string>('git_commit', { workspacePath, message });

export interface FsEntry {
  name: string;
  path: string;
  isDir: boolean;
}
export const fsReadDir = (dirPath: string) =>
  invoke<FsEntry[]>('fs_read_dir', { dirPath });

// ── AppState ──────────────────────────────────────────────────────────────────
export interface UiAppState {
  activeWorkspaceId?: string;
  activeSessionId?: string;
  sidebarWidth: number;
  rightSidebarWidth: number;
}

export const appStateLoad = () => invoke<UiAppState>('app_state_load');
export const appStateSave = (state: UiAppState) => invoke<void>('app_state_save', { state });

// ── Events ────────────────────────────────────────────────────────────────────
export const onSessionOutput = (
  handler: (payload: SessionOutputPayload) => void
): Promise<UnlistenFn> =>
  listen<SessionOutputPayload>('session-output', (e) => handler(e.payload));

export const onSessionStatus = (
  handler: (payload: SessionStatusPayload) => void
): Promise<UnlistenFn> =>
  listen<SessionStatusPayload>('session-status', (e) => handler(e.payload));
