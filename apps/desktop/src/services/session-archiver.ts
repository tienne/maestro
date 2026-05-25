/**
 * M9-04: 세션 아카이브 서비스.
 * 세션 종료 시 출력을 ~/.maestro/sessions/<id>.log 파일로 자동 저장한다.
 */

import * as fs from 'fs';
import * as path from 'path';
import { app } from 'electron';
import log from 'electron-log';
import { eq } from 'drizzle-orm';
import { getDatabaseManager } from '../db/database';
import * as schema from '../db/schema';

const ARCHIVE_DIR = path.join(app.getPath('home'), '.maestro', 'sessions');

function ensureArchiveDir(): void {
  if (!fs.existsSync(ARCHIVE_DIR)) {
    fs.mkdirSync(ARCHIVE_DIR, { recursive: true });
  }
}

/**
 * 세션의 scrollback 내용을 아카이브 파일로 저장한다.
 * ANSI 코드를 제거하여 순수 텍스트로 저장.
 */
export function archiveSession(sessionId: string): void {
  try {
    const drizzle = getDatabaseManager().drizzle;

    // 세션 정보 조회
    const [session] = drizzle
      .select({ id: schema.sessions.id, name: schema.sessions.name, createdAt: schema.sessions.createdAt })
      .from(schema.sessions)
      .where(eq(schema.sessions.id, sessionId))
      .all();

    if (!session) {
      log.warn(`[Archiver] Session ${sessionId} not found, skipping archive`);
      return;
    }

    // scrollback 데이터 추출
    const [scrollback] = drizzle
      .select({ data: schema.sessionScrollbacks.data })
      .from(schema.sessionScrollbacks)
      .where(eq(schema.sessionScrollbacks.sessionId, sessionId))
      .all();

    if (!scrollback?.data) {
      log.info(`[Archiver] No scrollback data for session ${sessionId}, skipping`);
      return;
    }

    ensureArchiveDir();

    // ANSI 코드 제거
    const clean = scrollback.data
      .replace(/\x1B\[[0-9;]*[A-Za-z]/g, '')
      .replace(/\x1B\][^\x07]*\x07/g, '');

    const logPath = path.join(ARCHIVE_DIR, `${sessionId}.log`);
    const header = `# Session: ${session.name}\n# ID: ${session.id}\n# Created: ${session.createdAt}\n# Archived: ${new Date().toISOString()}\n\n`;

    fs.writeFileSync(logPath, header + clean, 'utf-8');

    // DB에 아카이브 레코드 추가
    drizzle.insert(schema.sessionArchives)
      .values({
        sessionId,
        sessionName: session.name,
        logPath,
      })
      .onConflictDoUpdate({
        target: schema.sessionArchives.sessionId,
        set: { sessionName: session.name, logPath },
      })
      .run();

    log.info(`[Archiver] Session ${sessionId} archived to ${logPath}`);
  } catch (err) {
    log.error(`[Archiver] Failed to archive session ${sessionId}:`, err);
  }
}

export function getArchiveDir(): string {
  return ARCHIVE_DIR;
}
