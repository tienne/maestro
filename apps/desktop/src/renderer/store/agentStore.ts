import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { Agent } from '@maestro/shared-types';

interface AgentStore {
  agents: Agent[];
  lastSelectedAgentId: string | null;

  setAgents: (agents: Agent[]) => void;
  addAgent: (agent: Agent) => void;
  updateAgent: (agent: Agent) => void;
  removeAgent: (id: string) => void;
  setLastSelectedAgentId: (id: string | null) => void;
}

export const useAgentStore = create<AgentStore>()(
  persist(
    (set) => ({
      agents: [],
      lastSelectedAgentId: null,

      setAgents: (agents) => set({ agents }),
      addAgent: (agent) => set((s) => ({ agents: [...s.agents, agent] })),
      updateAgent: (agent) =>
        set((s) => ({ agents: s.agents.map((a) => (a.id === agent.id ? agent : a)) })),
      removeAgent: (id) => set((s) => ({ agents: s.agents.filter((a) => a.id !== id) })),
      setLastSelectedAgentId: (id) => set({ lastSelectedAgentId: id }),
    }),
    {
      name: 'maestro-agents',
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ lastSelectedAgentId: s.lastSelectedAgentId }),
    }
  )
);
