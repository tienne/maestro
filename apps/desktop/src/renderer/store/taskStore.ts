import { create } from 'zustand';
import type { ProjectTask } from '@maestro/shared-types';

interface TaskStore {
  tasks: ProjectTask[];
  selectedTaskId: string | null;
  isLoading: boolean;

  setTasks: (tasks: ProjectTask[]) => void;
  selectTask: (id: string | null) => void;
  addTask: (task: ProjectTask) => void;
  updateTask: (task: ProjectTask) => void;
  removeTask: (id: string) => void;
  getTaskById: (id: string) => ProjectTask | undefined;
  getChildTasks: (parentTaskId: string) => ProjectTask[];
}

export const useTaskStore = create<TaskStore>((set, get) => ({
  tasks: [],
  selectedTaskId: null,
  isLoading: false,

  setTasks: (tasks) => set({ tasks }),

  selectTask: (id) => set({ selectedTaskId: id }),

  addTask: (task) =>
    set((s) => ({ tasks: [task, ...s.tasks] })),

  updateTask: (task) =>
    set((s) => ({
      tasks: s.tasks.map((t) => (t.id === task.id ? task : t)),
    })),

  removeTask: (id) =>
    set((s) => ({
      tasks: s.tasks.filter((t) => t.id !== id),
      selectedTaskId: s.selectedTaskId === id ? null : s.selectedTaskId,
    })),

  getTaskById: (id) => get().tasks.find((t) => t.id === id),

  getChildTasks: (parentTaskId) =>
    get().tasks.filter((t) => t.parentTaskId === parentTaskId),
}));
