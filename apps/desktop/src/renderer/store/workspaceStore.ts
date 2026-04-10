import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { Repository, Workspace } from '@maestro/shared-types';

interface WorkspaceStore {
  repositories: Repository[];
  workspaces: Workspace[];
  activeWorkspaceId: string | null;
  /** M8-04: 사이드바 레포 순서 (persist) */
  repoOrder: string[];

  setRepositories: (repos: Repository[]) => void;
  setWorkspaces: (workspaces: Workspace[]) => void;
  addRepository: (repo: Repository) => void;
  removeRepository: (id: string) => void;
  addWorkspace: (workspace: Workspace) => void;
  removeWorkspace: (id: string) => void;
  setActiveWorkspace: (id: string | null) => void;
  setRepoOrder: (order: string[]) => void;
}

export const useWorkspaceStore = create<WorkspaceStore>()(
  persist(
    (set) => ({
      repositories: [],
      workspaces: [],
      activeWorkspaceId: null,
      repoOrder: [],

      setRepositories: (repositories) => set({ repositories }),
      setWorkspaces: (workspaces) => set({ workspaces }),

      addRepository: (repo) =>
        set((s) => ({ repositories: [repo, ...s.repositories] })),

      removeRepository: (id) =>
        set((s) => ({
          repositories: s.repositories.filter((r) => r.id !== id),
          workspaces: s.workspaces.filter((w) => w.repositoryId !== id),
          repoOrder: s.repoOrder.filter((rid) => rid !== id),
        })),

      addWorkspace: (workspace) =>
        set((s) => ({ workspaces: [workspace, ...s.workspaces] })),

      removeWorkspace: (id) =>
        set((s) => ({
          workspaces: s.workspaces.filter((w) => w.id !== id),
          activeWorkspaceId: s.activeWorkspaceId === id ? null : s.activeWorkspaceId,
        })),

      setActiveWorkspace: (id) => set({ activeWorkspaceId: id }),
      setRepoOrder: (repoOrder) => set({ repoOrder }),
    }),
    {
      name: 'maestro-workspace',
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ repoOrder: s.repoOrder }),
    }
  )
);
