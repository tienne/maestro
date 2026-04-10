/**
 * 멀티 윈도우 매니저.
 * 각 BrowserWindow 인스턴스를 풀로 관리하며 새 윈도우 생성/닫기를 처리한다.
 * M9-01: 윈도우 번호 표시 + 독립적 탭 세트 지원.
 */

import { BrowserWindow, shell, ipcMain } from 'electron';
import * as path from 'path';
import { is } from '@electron-toolkit/utils';
import log from 'electron-log';

const windows = new Set<BrowserWindow>();
let windowCounter = 1; // 메인 윈도우가 Window 1

function getNextWindowNumber(): number {
  windowCounter += 1;
  return windowCounter;
}

function updateWindowTitles(): void {
  const allWins = Array.from(windows);
  if (allWins.length <= 1) {
    // 윈도우가 1개면 번호 불필요
    for (const win of allWins) {
      if (!win.isDestroyed()) win.setTitle('Maestro');
    }
  } else {
    // 여러 윈도우일 때 번호 표시
    for (const win of allWins) {
      if (!win.isDestroyed()) {
        const num = (win as BrowserWindow & { _windowNumber?: number })._windowNumber ?? 1;
        win.setTitle(`Maestro - Window ${num}`);
      }
    }
  }
}

function createNewWindow(): BrowserWindow {
  const windowNumber = getNextWindowNumber();

  const win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1024,
    minHeight: 600,
    title: `Maestro - Window ${windowNumber}`,
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
    },
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 10, y: 13 },
    show: false,
  });

  // 윈도우 번호 저장 (타이틀 업데이트용)
  (win as BrowserWindow & { _windowNumber?: number })._windowNumber = windowNumber;

  win.on('ready-to-show', () => win.show());

  win.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url);
    return { action: 'deny' };
  });

  // 윈도우 번호를 렌더러에 전달 (독립적 UI 상태용)
  win.webContents.on('did-finish-load', () => {
    win.webContents.send('window:number', windowNumber);
  });

  win.on('closed', () => {
    windows.delete(win);
    log.info(`[WindowManager] Window ${windowNumber} closed. Total: ${windows.size}`);
    updateWindowTitles();
  });

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL']);
  } else {
    win.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  windows.add(win);
  log.info(`[WindowManager] Window ${windowNumber} created. Total: ${windows.size}`);
  updateWindowTitles();
  return win;
}

export function setupWindowManager(): void {
  // ⌘Shift+N → 새 윈도우 (렌더러에서 요청)
  ipcMain.on('window:new', () => {
    createNewWindow();
  });

  // 윈도우 수 조회
  ipcMain.handle('window:count', () => {
    return windows.size + 1; // +1 for main window
  });

  log.info('[WindowManager] Initialized');
}

export function getAllWindows(): BrowserWindow[] {
  return Array.from(windows);
}

export function getWindowCount(): number {
  return windows.size + 1; // +1 for main window
}
