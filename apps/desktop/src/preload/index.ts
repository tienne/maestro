import { contextBridge, ipcRenderer } from 'electron';
import { electronAPI } from '@electron-toolkit/preload';
import { exposeElectronTRPC } from 'electron-trpc/main';

// electron-trpc IPC 브릿지 노출 — renderer의 ipcLink()가 이를 통해 통신
exposeElectronTRPC();

contextBridge.exposeInMainWorld('electron', electronAPI);

contextBridge.exposeInMainWorld('electronAPI', {
  /** M7-04: renderer 에러를 main process에 전달하여 파일 로그에 기록 */
  reportError: (source: string, message: string, stack?: string) =>
    ipcRenderer.send('renderer-error', { source, message, stack }),

  invoke: (channel: string, args?: Record<string, unknown>) =>
    ipcRenderer.invoke(channel, args),

  /** Fire-and-forget IPC — 응답을 기다리지 않음 (PTY 입력 등 레이턴시 민감 경로) */
  send: (channel: string, args?: unknown) => ipcRenderer.send(channel, args),

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
