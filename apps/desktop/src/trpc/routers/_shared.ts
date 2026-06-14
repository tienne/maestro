/**
 * 공유 row mappers + 유틸
 * 원본 router.ts lines 59-215 에서 추출.
 */

import * as net from 'net';
import type { Workspace, Agent, Repository, EnvVar } from '@maestro/shared-types';

// ── Row mappers ───────────────────────────────────────────────────────────────

export function rowToWorkspace(row: Record<string, unknown>): Workspace {
  return {
    id: row.id as string,
    name: row.name as string,
    repositoryId: row.repository_id as string,
    branch: row.branch as string,
    worktreePath: row.worktree_path as string,
    createdAt: row.created_at as string,
  };
}

export interface SessionRow {
  id: string;
  name: string;
  workspace_id: string;
  agent_id: string;
  status: string;
  pid: number | null;
  created_at: string;
  is_favorite?: number;
  depends_on_session_id?: string | null;
  context_source_session_id?: string | null;
  last_exit_code?: number | null;
  // drizzle ORM camelCase aliases
  workspaceId?: string;
  agentId?: string;
  createdAt?: string;
  isFavorite?: boolean | number;
  dependsOnSessionId?: string | null;
  contextSourceSessionId?: string | null;
  lastExitCode?: number | null;
}

export function rowToSession(row: SessionRow) {
  return {
    id: row.id,
    name: row.name,
    workspaceId: row.workspaceId ?? row.workspace_id,
    agentId: row.agentId ?? row.agent_id,
    status: row.status as 'running' | 'stopped' | 'error' | 'pending' | 'blocked',
    pid: row.pid,
    createdAt: row.createdAt ?? row.created_at,
    isFavorite: Boolean(row.isFavorite ?? row.is_favorite),
    dependsOnSessionId: row.dependsOnSessionId ?? row.depends_on_session_id ?? null,
    contextSourceSessionId: row.contextSourceSessionId ?? row.context_source_session_id ?? null,
    lastExitCode: row.lastExitCode ?? row.last_exit_code ?? null,
  };
}

export interface PresetRow {
  id: string;
  name: string;
  agent_id: string;
  workspace_id: string;
  initial_command: string;
  env_vars: string;
  created_at: string;
}

export function rowToPreset(row: PresetRow) {
  return {
    id: row.id,
    name: row.name,
    agentId: row.agent_id,
    workspaceId: row.workspace_id,
    initialCommand: row.initial_command,
    envVars: JSON.parse(row.env_vars) as Record<string, string>,
    createdAt: row.created_at,
  };
}

export interface LabelRow {
  session_id: string;
  label_name: string;
  label_color: string;
}

export function rowToLabel(row: LabelRow) {
  return {
    sessionId: row.session_id,
    labelName: row.label_name,
    labelColor: row.label_color,
  };
}

export function rowToAgent(row: Record<string, unknown>): Agent {
  return {
    id: row.id as string,
    name: row.name as string,
    command: row.command as string,
    args: JSON.parse(row.args as string) as string[],
    env: JSON.parse(row.env as string) as Record<string, string>,
    isBuiltIn: Boolean(row.is_built_in),
    scriptPath: (row.script_path as string) ?? null,
    scriptContent: (row.script_content as string) ?? null,
  };
}

export function rowToRepo(row: Record<string, unknown>): Repository {
  return {
    id: row.id as string,
    name: row.name as string,
    path: row.path as string,
    color: row.color as string,
    branchPrefix: row.branch_prefix as string,
    baseBranch: row.base_branch as string,
    worktreeBasePath: row.worktree_base_path as string,
    setupScript: row.setup_script as string,
    teardownScript: row.teardown_script as string,
    createdAt: row.created_at as string,
  };
}

export function rowToEnvVar(row: Record<string, unknown>): EnvVar {
  return {
    id: row.id as string,
    repositoryId: row.repository_id as string,
    key: row.key as string,
    value: row.value as string,
  };
}

export interface McpServerRow {
  id: string;
  name: string;
  url: string;
  enabled: number;
  status: string;
  error_msg: string | null;
  created_at: string;
}

export function rowToMcpServer(row: McpServerRow) {
  return {
    id: row.id,
    name: row.name,
    url: row.url,
    enabled: Boolean(row.enabled),
    status: row.status as 'connected' | 'offline' | 'error',
    errorMsg: row.error_msg,
    createdAt: row.created_at,
  };
}

export function checkSocketConnection(host: string, port: number, timeout = 3000): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(timeout);
    socket.on('connect', () => { socket.destroy(); resolve(true); });
    socket.on('error', () => { socket.destroy(); resolve(false); });
    socket.on('timeout', () => { socket.destroy(); resolve(false); });
    socket.connect(port, host);
  });
}
