/**
 * 멀티 윈도우 매니저.
 * 각 BrowserWindow 인스턴스를 풀로 관리하며 새 윈도우 생성/닫기를 처리한다.
 */

import { BrowserWindow, shell, ipcMain } from 'electron';
import * as path from 'path';
import { is } from '@electron-toolkit/utils';
import log from 'electron-log';

const windows = new Set<BrowserWindow>();

function createNewWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 600,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
    },
    titleBarStyle: 'hiddenInset',
    show: false,
  });

  win.on('ready-to-show', () => win.show());

  win.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url);
    return { action: 'deny' };
  });

  win.on('closed', () => {
    windows.delete(win);
    log.info(`[WindowManager] Window closed. Total: ${windows.size}`);
  });

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL']);
  } else {
    win.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  windows.add(win);
  log.info(`[WindowManager] New window created. Total: ${windows.size}`);
  return win;
}

export function setupWindowManager(): void {
  // ⌘Shift+N → 새 윈도우 (렌더러에서 요청)
  ipcMain.on('window:new', () => {
    createNewWindow();
  });

  log.info('[WindowManager] Initialized');
}

export function getAllWindows(): BrowserWindow[] {
  return Array.from(windows);
}
