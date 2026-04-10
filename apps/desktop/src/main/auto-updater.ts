/**
 * Auto Updater — electron-updater 기반 자동 업데이트
 *
 * 동작 흐름:
 * 1. 앱 시작 시 + 4시간마다 GitHub Releases 체크
 * 2. 신버전 발견 → 렌더러에 'updater:available' IPC 이벤트
 * 3. 사용자 "지금 재시작" 클릭 → 'updater:install' IPC → quitAndInstall()
 */

import { autoUpdater } from 'electron-updater';
import { BrowserWindow, ipcMain } from 'electron';
import log from 'electron-log';

const CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000; // 4시간

function broadcastToRenderer(channel: string, payload?: unknown): void {
  BrowserWindow.getAllWindows().forEach((w) =>
    w.webContents.send(channel, payload)
  );
}

export function setupAutoUpdater(): void {
  // 개발 환경에서는 업데이트 건너뜀
  if (process.env['NODE_ENV'] === 'development') {
    log.info('[Updater] Skipping auto-update in development mode');
    return;
  }

  autoUpdater.logger = log;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('update-available', (info) => {
    log.info('[Updater] Update available:', info.version);
    broadcastToRenderer('updater:available', { version: info.version });
  });

  autoUpdater.on('update-downloaded', (info) => {
    log.info('[Updater] Update downloaded:', info.version);
    broadcastToRenderer('updater:downloaded', { version: info.version });
  });

  autoUpdater.on('error', (err) => {
    log.error('[Updater] Error:', err.message);
  });

  // 렌더러에서 "지금 재시작" 클릭 시 처리
  ipcMain.on('updater:install', () => {
    log.info('[Updater] Installing update and restarting...');
    autoUpdater.quitAndInstall();
  });

  // 즉시 체크 + 주기 반복
  const check = () => {
    autoUpdater.checkForUpdatesAndNotify().catch((err) => {
      log.warn('[Updater] Check failed:', err.message);
    });
  };

  check();
  setInterval(check, CHECK_INTERVAL_MS);
}
