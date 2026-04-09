/**
 * Config Store — 서버 연결 정보 영속화
 *
 * CLI가 데스크탑 앱 HTTP 서버에 연결하기 위해 필요한 포트와 인증 토큰을
 * ~/.maestro/server.json 에 저장한다.
 *
 * CLI는 이 파일을 읽어 서버 URL과 Authorization 헤더를 구성한다.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import log from 'electron-log';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ServerConfig {
  port: number;
  token: string;
  pid: number;
  startedAt: string;
}

// ── Paths ─────────────────────────────────────────────────────────────────────

const CONFIG_DIR = path.join(os.homedir(), '.maestro');
const CONFIG_FILE = path.join(CONFIG_DIR, 'server.json');

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * 서버 연결 정보를 ~/.maestro/server.json 에 기록한다.
 * CLI가 이 파일을 읽어 서버 URL과 토큰을 획득한다.
 */
export function saveServerConfig(port: number, token: string): void {
  try {
    if (!fs.existsSync(CONFIG_DIR)) {
      fs.mkdirSync(CONFIG_DIR, { recursive: true });
    }

    const config: ServerConfig = {
      port,
      token,
      pid: process.pid,
      startedAt: new Date().toISOString(),
    };

    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), { mode: 0o600 });
    log.info(`[ConfigStore] Server config saved → ${CONFIG_FILE} (port: ${port})`);
  } catch (err) {
    log.error('[ConfigStore] Failed to save server config:', err);
  }
}

/**
 * 앱 종료 시 서버 연결 정보 파일을 삭제한다.
 */
export function clearServerConfig(): void {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      fs.unlinkSync(CONFIG_FILE);
      log.info('[ConfigStore] Server config cleared');
    }
  } catch (err) {
    log.error('[ConfigStore] Failed to clear server config:', err);
  }
}

/**
 * 현재 저장된 서버 연결 정보를 읽는다.
 * 파일이 없거나 파싱 실패 시 null 반환.
 */
export function readServerConfig(): ServerConfig | null {
  try {
    if (!fs.existsSync(CONFIG_FILE)) {
      return null;
    }
    const raw = fs.readFileSync(CONFIG_FILE, 'utf-8');
    return JSON.parse(raw) as ServerConfig;
  } catch (err) {
    log.error('[ConfigStore] Failed to read server config:', err);
    return null;
  }
}
