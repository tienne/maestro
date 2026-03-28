import { create } from 'zustand';
import type { Agent } from '@maestro/shared-types';
import * as tauri from '@/lib/tauri';

interface AgentStore {
  agents: Agent[];

  loadAll: () => Promise<void>;
  createAgent: (name: string, command: string, args: string[], env: Record<string, string>) => Promise<Agent>;
  updateAgent: (id: string, name: string, command: string, args: string[], env: Record<string, string>) => Promise<Agent>;
  deleteAgent: (id: string) => Promise<void>;
}

export const useAgentStore = create<AgentStore>((set) => ({
  agents: [],

  loadAll: async () => {
    const agents = await tauri.agentList();
    set({ agents });
  },

  createAgent: async (name, command, args, env) => {
    const agent = await tauri.agentCreate(name, command, args, env);
    set((s) => ({ agents: [...s.agents, agent] }));
    return agent;
  },

  updateAgent: async (id, name, command, args, env) => {
    const agent = await tauri.agentUpdate(id, name, command, args, env);
    set((s) => ({ agents: s.agents.map((a) => (a.id === id ? agent : a)) }));
    return agent;
  },

  deleteAgent: async (id) => {
    await tauri.agentDelete(id);
    set((s) => ({ agents: s.agents.filter((a) => a.id !== id) }));
  },
}));
