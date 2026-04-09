import { create } from 'zustand';
import type { Repository, EnvVar } from '@maestro/shared-types';

interface RepositoryStore {
  repositories: Repository[];
  envVars: Record<string, EnvVar[]>; // keyed by repositoryId

  setRepositories: (repos: Repository[]) => void;
  addRepository: (repo: Repository) => void;
  updateRepository: (repo: Repository) => void;
  removeRepository: (id: string) => void;
  setEnvVars: (repositoryId: string, vars: EnvVar[]) => void;
  addOrUpdateEnvVar: (repositoryId: string, envVar: EnvVar) => void;
  removeEnvVar: (id: string, repositoryId: string) => void;
}

export const useRepositoryStore = create<RepositoryStore>((set) => ({
  repositories: [],
  envVars: {},

  setRepositories: (repositories) => set({ repositories }),

  addRepository: (repo) =>
    set((s) => ({ repositories: [repo, ...s.repositories] })),

  updateRepository: (repo) =>
    set((s) => ({
      repositories: s.repositories.map((r) => (r.id === repo.id ? repo : r)),
    })),

  removeRepository: (id) =>
    set((s) => ({
      repositories: s.repositories.filter((r) => r.id !== id),
      envVars: Object.fromEntries(
        Object.entries(s.envVars).filter(([k]) => k !== id),
      ),
    })),

  setEnvVars: (repositoryId, vars) =>
    set((s) => ({ envVars: { ...s.envVars, [repositoryId]: vars } })),

  addOrUpdateEnvVar: (repositoryId, envVar) =>
    set((s) => {
      const current = s.envVars[repositoryId] ?? [];
      const exists = current.some((v) => v.id === envVar.id);
      return {
        envVars: {
          ...s.envVars,
          [repositoryId]: exists
            ? current.map((v) => (v.id === envVar.id ? envVar : v))
            : [...current, envVar],
        },
      };
    }),

  removeEnvVar: (id, repositoryId) =>
    set((s) => ({
      envVars: {
        ...s.envVars,
        [repositoryId]: (s.envVars[repositoryId] ?? []).filter((v) => v.id !== id),
      },
    })),
}));

