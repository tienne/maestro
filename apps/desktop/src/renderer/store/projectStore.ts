import { create } from 'zustand';
import type { Project } from '@maestro/shared-types';

interface ProjectStore {
  projects: Project[];
  selectedProjectId: string | null;
  isLoading: boolean;

  setProjects: (projects: Project[]) => void;
  selectProject: (id: string | null) => void;
  addProject: (project: Project) => void;
  updateProject: (project: Project) => void;
  removeProject: (id: string) => void;
}

export const useProjectStore = create<ProjectStore>((set) => ({
  projects: [],
  selectedProjectId: null,
  isLoading: false,

  setProjects: (projects) => set({ projects }),

  selectProject: (id) => set({ selectedProjectId: id }),

  addProject: (project) =>
    set((s) => ({ projects: [project, ...s.projects] })),

  updateProject: (project) =>
    set((s) => ({
      projects: s.projects.map((p) => (p.id === project.id ? project : p)),
    })),

  removeProject: (id) =>
    set((s) => ({
      projects: s.projects.filter((p) => p.id !== id),
      selectedProjectId: s.selectedProjectId === id ? null : s.selectedProjectId,
    })),
}));
