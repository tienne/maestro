import { create } from 'zustand';
import type { Repository, Workspace } from '@maestro/shared-types';

interface WorkspaceStore {
  repositories: Repository[];
  workspaces: Workspace[];
  activeWorkspaceId: string | null;

  setRepositories: (repos: Repository[]) => void;
  setWorkspaces: (workspaces: Workspace[]) => void;
  addRepository: (repo: Repository) => void;
  removeRepository: (id: string) => void;
  addWorkspace: (workspace: Workspace) => void;
  removeWorkspace: (id: string) => void;
  setActiveWorkspace: (id: string | null) => void;
}

export const useWorkspaceStore = create<WorkspaceStore>((set) => ({
  repositories: [],
  workspaces: [],
  activeWorkspaceId: null,

  setRepositories: (repositories) => set({ repositories }),
  setWorkspaces: (workspaces) => set({ workspaces }),

  addRepository: (repo) =>
    set((s) => ({ repositories: [repo, ...s.repositories] })),

  removeRepository: (id) =>
    set((s) => ({
      repositories: s.repositories.filter((r) => r.id !== id),
      workspaces: s.workspaces.filter((w) => w.repositoryId !== id),
    })),

  addWorkspace: (workspace) =>
    set((s) => ({ workspaces: [workspace, ...s.workspaces] })),

  removeWorkspace: (id) =>
    set((s) => ({
      workspaces: s.workspaces.filter((w) => w.id !== id),
      activeWorkspaceId: s.activeWorkspaceId === id ? null : s.activeWorkspaceId,
    })),

  setActiveWorkspace: (id) => set({ activeWorkspaceId: id }),
}));
