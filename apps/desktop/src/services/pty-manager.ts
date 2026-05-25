import * as pty from 'node-pty';
import log from 'electron-log';

export interface PtySession {
  pty: pty.IPty;
  sessionId: string;
}

export type PtyOutputHandler = (sessionId: string, data: string) => void;
export type PtyExitHandler = (sessionId: string, exitCode: number | undefined) => void;

// 세션당 최대 스크롤백 버퍼 크기 (200 KB)
const MAX_SCROLLBACK_BYTES = 200 * 1024;

export class PtyManager {
  private sessions = new Map<string, pty.IPty>();
  private outputHandlers = new Map<string, PtyOutputHandler>();
  private exitHandlers = new Map<string, PtyExitHandler>();
  /** 세션별 순환 스크롤백 버퍼 — PTY exit 시 DB에 저장하기 위해 유지 */
  private scrollbacks = new Map<string, string>();

  onOutput(sessionId: string, handler: PtyOutputHandler): void {
    this.outputHandlers.set(sessionId, handler);
  }

  onExit(sessionId: string, handler: PtyExitHandler): void {
    this.exitHandlers.set(sessionId, handler);
  }

  removeOutput(sessionId: string): void {
    this.outputHandlers.delete(sessionId);
  }

  removeExit(sessionId: string): void {
    this.exitHandlers.delete(sessionId);
  }

  create(
    sessionId: string,
    command: string,
    args: string[],
    env: Record<string, string>,
    cwd: string,
    cols = 120,
    rows = 40
  ): pty.IPty {
    if (this.sessions.has(sessionId)) {
      this.kill(sessionId);
    }

    const merged: Record<string, string> = {
      ...process.env as Record<string, string>,
      ...env,
      TERM: 'xterm-256color',
    };

    const ptyProcess = pty.spawn(command, args, {
      name: 'xterm-256color',
      cols,
      rows,
      cwd,
      env: merged,
    });

    ptyProcess.onData((data) => {
      // 스크롤백 버퍼에 누적 (초과 시 앞부분 잘라냄)
      const current = (this.scrollbacks.get(sessionId) ?? '') + data;
      this.scrollbacks.set(
        sessionId,
        current.length > MAX_SCROLLBACK_BYTES
          ? current.slice(current.length - MAX_SCROLLBACK_BYTES)
          : current
      );

      const h = this.outputHandlers.get(sessionId);
      if (h) h(sessionId, data);
    });

    ptyProcess.onExit(({ exitCode }) => {
      log.info(`PTY session ${sessionId} exited with code ${exitCode}`);
      // 이 PTY가 여전히 현재 세션의 활성 PTY인 경우에만 처리.
      // 이전 PTY가 kill된 후 exit 이벤트가 늦게 도착해도
      // 새로 생성된 PTY를 map에서 실수로 삭제하지 않는다.
      if (this.sessions.get(sessionId) === ptyProcess) {
        this.sessions.delete(sessionId);
        const h = this.exitHandlers.get(sessionId);
        if (h) h(sessionId, exitCode);
      }
    });

    this.sessions.set(sessionId, ptyProcess);
    log.info(`PTY session ${sessionId} created (pid=${ptyProcess.pid})`);
    return ptyProcess;
  }

  write(sessionId: string, data: string): void {
    const p = this.sessions.get(sessionId);
    if (!p) return;
    p.write(data);
  }

  resize(sessionId: string, cols: number, rows: number): void {
    const p = this.sessions.get(sessionId);
    if (!p) return;
    p.resize(cols, rows);
  }

  kill(sessionId: string): void {
    const p = this.sessions.get(sessionId);
    if (!p) return;
    try {
      p.kill();
    } catch {
      // 이미 종료된 경우 무시
    }
    this.sessions.delete(sessionId);
    log.info(`PTY session ${sessionId} killed`);
  }

  /** 세션 스크롤백 버퍼 반환 (최대 200KB) */
  getScrollback(sessionId: string): string {
    return this.scrollbacks.get(sessionId) ?? '';
  }

  /** 스크롤백 버퍼를 외부에서 주입 (DB 복원용) */
  setScrollback(sessionId: string, data: string): void {
    this.scrollbacks.set(sessionId, data);
  }

  /** 스크롤백 버퍼 제거 */
  clearScrollback(sessionId: string): void {
    this.scrollbacks.delete(sessionId);
  }

  killAll(): void {
    for (const id of this.sessions.keys()) {
      this.kill(id);
    }
  }

  getPid(sessionId: string): number | undefined {
    return this.sessions.get(sessionId)?.pid;
  }

  isAlive(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }

  /** 현재 살아있는 세션 ID 목록 */
  getActiveSessionIds(): string[] {
    return Array.from(this.sessions.keys());
  }
}

let instance: PtyManager | null = null;

export function getPtyManager(): PtyManager {
  if (!instance) {
    instance = new PtyManager();
  }
  return instance;
}
