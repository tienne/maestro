import { create } from 'zustand';
import type { Repository, Workspace } from '@maestro/shared-types';
import * as tauri from '@/lib/tauri';

interface WorkspaceStore {
  repositories: Repository[];
  workspaces: Workspace[];
  activeWorkspaceId: string | null;

  loadAll: () => Promise<void>;
  addRepository: (path: string) => Promise<Repository>;
  removeRepository: (id: string) => Promise<void>;
  createWorkspace: (name: string, repositoryId: string, branch: string) => Promise<Workspace>;
  deleteWorkspace: (id: string) => Promise<void>;
  setActiveWorkspace: (id: string | null) => void;
}

export const useWorkspaceStore = create<WorkspaceStore>((set, get) => ({
  repositories: [],
  workspaces: [],
  activeWorkspaceId: null,

  loadAll: async () => {
    const [repositories, workspaces] = await Promise.all([
      tauri.repositoryList(),
      tauri.workspaceList(),
    ]);
    set({ repositories, workspaces });
  },

  addRepository: async (path) => {
    const repo = await tauri.repositoryAdd(path);
    set((s) => ({ repositories: [repo, ...s.repositories] }));
    return repo;
  },

  removeRepository: async (id) => {
    await tauri.repositoryRemove(id);
    set((s) => ({
      repositories: s.repositories.filter((r) => r.id !== id),
      workspaces: s.workspaces.filter((w) => w.repositoryId !== id),
    }));
  },

  createWorkspace: async (name, repositoryId, branch) => {
    const workspace = await tauri.workspaceCreate(name, repositoryId, branch);
    set((s) => ({ workspaces: [workspace, ...s.workspaces] }));
    return workspace;
  },

  deleteWorkspace: async (id) => {
    await tauri.workspaceDelete(id);
    set((s) => ({
      workspaces: s.workspaces.filter((w) => w.id !== id),
      activeWorkspaceId: s.activeWorkspaceId === id ? null : s.activeWorkspaceId,
    }));
  },

  setActiveWorkspace: (id) => set({ activeWorkspaceId: id }),
}));
