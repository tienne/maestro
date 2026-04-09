import { app, BrowserWindow, shell } from 'electron';
import * as path from 'path';
import log from 'electron-log';
import { is } from '@electron-toolkit/utils';
import { startHttpServer, stopHttpServer, getAuthToken } from '../services/http-server';
import { saveServerConfig, clearServerConfig } from '../services/config-store';

let mainWindow: BrowserWindow | null = null;

function createWindow(): void {
  mainWindow = new BrowserWindow({
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

  mainWindow.on('ready-to-show', () => {
    mainWindow?.show();
    if (is.dev) {
      mainWindow?.webContents.openDevTools({ mode: 'detach' });
    }
  });

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url);
    return { action: 'deny' };
  });

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL']);
  } else {
    mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

export function getMainWindow(): BrowserWindow | null {
  return mainWindow;
}

app.whenReady().then(async () => {
  log.initialize();
  log.info('Maestro desktop starting...');

  const { registerTrpcHandler } = await import('../trpc/ipc');
  registerTrpcHandler();

  // HTTP 서버 시작 — CLI가 이 서버를 통해 앱을 제어한다
  try {
    const port = await startHttpServer();
    const token = getAuthToken();
    saveServerConfig(port, token);
    log.info(`[HTTP] Local HTTP server started on port ${port}`);
  } catch (err) {
    log.error('[HTTP] Failed to start HTTP server:', err);
  }

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', async () => {
  log.info('Maestro desktop shutting down...');

  // HTTP 서버 정지 및 서버 연결 정보 파일 삭제
  await stopHttpServer();
  clearServerConfig();

  const { cleanupServices } = await import('../handlers/index');
  await cleanupServices();
});

