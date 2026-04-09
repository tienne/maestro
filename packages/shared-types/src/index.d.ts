export type SessionStatus = 'running' | 'stopped' | 'error';
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
export interface AppState {
    activeWorkspaceId?: string;
    activeSessionId?: string;
    sidebarWidth: number;
    rightSidebarWidth: number;
}
export interface SessionOutputPayload {
    sessionId: string;
    data: string;
}
export interface SessionStatusPayload {
    sessionId: string;
    status: SessionStatus;
}
//# sourceMappingURL=index.d.ts.map