import { app, BrowserWindow, shell, ipcMain } from 'electron';
import * as path from 'path';
import log from 'electron-log';
import { is } from '@electron-toolkit/utils';
import { startHttpServer, stopHttpServer, getAuthToken } from '../services/http-server';
import { saveServerConfig, clearServerConfig } from '../services/config-store';
import { setupAutoUpdater } from './auto-updater';
import { setupDeepLink } from './deep-link';
import { setupWindowManager } from './window-manager';

let mainWindow: BrowserWindow | null = null;
let splashWindow: BrowserWindow | null = null;

function createSplashWindow(): void {
  splashWindow = new BrowserWindow({
    width: 400,
    height: 300,
    frame: false,
    transparent: true,
    resizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  splashWindow.loadFile(path.join(__dirname, 'splash.html'));
  splashWindow.center();
}

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
    trafficLightPosition: { x: 10, y: 13 },
    show: false,
  });

  mainWindow.on('ready-to-show', () => {
    // M7-05: 스플래시 닫고 메인 윈도우 표시
    if (splashWindow && !splashWindow.isDestroyed()) {
      splashWindow.close();
      splashWindow = null;
    }
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

  // M7-05: 스플래시 스크린 즉시 표시
  createSplashWindow();

  // M7-04: uncaughtException / unhandledRejection 핸들러 등록
  const { setupErrorHandlers, writeErrorLog } = await import('../services/error-logger');
  setupErrorHandlers();

  // M7-04: renderer → main 에러 전달 IPC
  ipcMain.on('renderer-error', (_event, payload: { source: string; message: string; stack?: string }) => {
    const errorStr = payload.stack ? `${payload.message}\n${payload.stack}` : payload.message;
    writeErrorLog(`renderer:${payload.source}`, errorStr);
  });

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
  setupAutoUpdater();
  setupDeepLink();
  setupWindowManager();

  // M7-03: 앱 시작 시 + 24시간마다 세션 GC 실행
  const runSessionGc = async () => {
    try {
      const { getDatabaseManager } = await import('../db/database');
      const db = getDatabaseManager().getDb();
      const cutoffDays = 30;
      const rows = db
        .prepare(
          `SELECT id FROM sessions
           WHERE status IN ('stopped', 'error')
           AND created_at < datetime('now', '-' || ? || ' days')`
        )
        .all(cutoffDays) as { id: string }[];
      if (rows.length > 0) {
        const ids = rows.map((r) => r.id);
        const placeholders = ids.map(() => '?').join(',');
        db.prepare(`UPDATE sessions SET status = 'archived' WHERE id IN (${placeholders})`).run(...ids);
        log.info(`[GC] Archived ${ids.length} stale sessions`);
      }
    } catch (e) {
      log.error('[GC] Session cleanup failed:', e);
    }
  };
  runSessionGc();
  setInterval(runSessionGc, 24 * 60 * 60 * 1000); // 24시간

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

  // 앱 종료 전 모든 활성 PTY 세션의 scrollback을 DB에 동기적으로 저장.
  // PTY kill 이전에 실행해야 메모리 버퍼가 남아있다.
  try {
    const { getPtyManager } = await import('../services/pty-manager');
    const { getDatabaseManager } = await import('../db/database');
    const ptyManager = getPtyManager();
    const db = getDatabaseManager().getDb();
    const stmt = db.prepare(`
      INSERT INTO session_scrollbacks (session_id, data, updated_at)
      VALUES (?, ?, datetime('now'))
      ON CONFLICT(session_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at
    `);
    for (const sessionId of ptyManager.getActiveSessionIds()) {
      const scrollback = ptyManager.getScrollback(sessionId);
      if (scrollback) {
        stmt.run(sessionId, scrollback);
        log.info(`[before-quit] scrollback saved for session ${sessionId}`);
      }
    }
  } catch (e) {
    log.error('[before-quit] failed to save scrollbacks:', e);
  }

  // HTTP 서버 정지 및 서버 연결 정보 파일 삭제
  await stopHttpServer();
  clearServerConfig();

  const { cleanupServices } = await import('../handlers/index');
  await cleanupServices();
});

