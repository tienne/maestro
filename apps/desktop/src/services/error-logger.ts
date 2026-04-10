/**
 * M7-04: 에러 로그 서비스
 *
 * 에러 발생 시 ~/.maestro/logs/error-YYYY-MM-DD.log 파일에 기록.
 * uncaughtException, unhandledRejection, renderer 에러를 모두 수집.
 */

import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';
import log from 'electron-log';

function getLogsDir(): string {
  const dir = path.join(app.getPath('home'), '.maestro', 'logs');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function getLogFilePath(): string {
  const date = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  return path.join(getLogsDir(), `error-${date}.log`);
}

export function writeErrorLog(source: string, error: unknown): void {
  try {
    const timestamp = new Date().toISOString();
    const message = error instanceof Error
      ? `${error.message}\n${error.stack ?? ''}`
      : String(error);
    const line = `[${timestamp}] [${source}] ${message}\n\n`;
    fs.appendFileSync(getLogFilePath(), line, 'utf-8');
  } catch (e) {
    log.error('[ErrorLogger] Failed to write error log:', e);
  }
}

export function getLogsFolder(): string {
  return getLogsDir();
}

/**
 * main process에 uncaughtException / unhandledRejection 핸들러를 등록한다.
 * 앱 시작 시 한 번만 호출.
 */
export function setupErrorHandlers(): void {
  process.on('uncaughtException', (error) => {
    writeErrorLog('uncaughtException', error);
    log.error('[uncaughtException]', error);
  });

  process.on('unhandledRejection', (reason) => {
    writeErrorLog('unhandledRejection', reason);
    log.error('[unhandledRejection]', reason);
  });
}
