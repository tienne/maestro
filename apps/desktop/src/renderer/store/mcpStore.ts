import { create } from 'zustand';

export interface McpServer {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
  status: string;
  errorMsg?: string | null;
}

interface McpStore {
  servers: McpServer[];

  setServers: (servers: McpServer[]) => void;
  addServer: (server: McpServer) => void;
  updateServer: (server: McpServer) => void;
  removeServer: (id: string) => void;
}

export const useMcpStore = create<McpStore>((set) => ({
  servers: [],

  setServers: (servers) => set({ servers }),
  addServer: (server) => set((s) => ({ servers: [...s.servers, server] })),
  updateServer: (server) =>
    set((s) => ({ servers: s.servers.map((srv) => (srv.id === server.id ? server : srv)) })),
  removeServer: (id) =>
    set((s) => ({ servers: s.servers.filter((srv) => srv.id !== id) })),
}));
