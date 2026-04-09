import { contextBridge, ipcRenderer } from 'electron';
import { electronAPI } from '@electron-toolkit/preload';
import { exposeElectronTRPC } from 'electron-trpc/main';

// electron-trpc IPC 브릿지 노출 — renderer의 ipcLink()가 이를 통해 통신
exposeElectronTRPC();

contextBridge.exposeInMainWorld('electron', electronAPI);

contextBridge.exposeInMainWorld('electronAPI', {
  invoke: (channel: string, args?: Record<string, unknown>) =>
    ipcRenderer.invoke(channel, args),

  onEvent: (channel: string, handler: (payload: unknown) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: unknown) =>
      handler(payload);
    ipcRenderer.on(channel, listener);
    return () => ipcRenderer.removeListener(channel, listener);
  },

  offEvent: (channel: string) => {
    ipcRenderer.removeAllListeners(channel);
  },
});
