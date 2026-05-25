/**
 * TeamsWatcher — Claude Code Teams 서브에이전트 spawn 감지 서비스
 *
 * PTY 출력 스트림을 라인 단위로 분석하여
 * Claude Code가 서브에이전트를 spawn할 때 나타나는 패턴을 감지한다.
 *
 * PtyManager는 세션당 단일 onOutput 핸들러만 허용하므로,
 * 이 서비스는 독립 EventEmitter 방식으로 구현한다:
 * - router.ts의 기존 onOutput 콜백 내부에서 processOutput()을 호출하도록 연결
 * - 감지 이벤트는 콜백(onSpawn) 방식으로 외부에 전달
 */

import log from 'electron-log';

// ─── 감지 패턴 ─────────────────────────────────────────────────────────────

/**
 * Claude Code Teams가 서브에이전트를 시작할 때 PTY 출력에 나타나는 패턴 목록.
 * 각 패턴에는 선택적 캡처 그룹(index 1)으로 태스크 설명을 추출할 수 있다.
 */
const SPAWN_PATTERNS: RegExp[] = [
  /spawning\s+(?:sub-?)?agent(?:\s+(?:for|to)\s+(.+))?/i,
  /starting\s+(?:sub-?)?agent(?:\s+(?:for|to)\s+(.+))?/i,
  /launching\s+(?:sub-?)?agent(?:\s+(?:for|to)\s+(.+))?/i,
  /\[claude\s+code\s+teams?\]/i,
  /subagent\s+started(?:\s*:\s*(.+))?/i,
  /\[agent:\s*([^\]]+)\]/i, // [agent: task-description]
  /spawning\s+new\s+claude\s+instance(?:\s+(?:for|to)\s+(.+))?/i,
  /sub-?task\s+agent\s+started(?:\s*:\s*(.+))?/i,
];

// ─── 공개 타입 ─────────────────────────────────────────────────────────────

export interface SpawnedAgentInfo {
  /** 감지된 태스크 설명 — 패턴에서 추출하거나 원본 라인에서 파싱한 값 */
  taskDescription: string;
  /** 매칭된 원본 출력 라인 (ANSI 이스케이프 제거 후) */
  rawLine: string;
  /** 감지 시각 (ISO 8601) */
  detectedAt: string;
}

export type SpawnCallback = (sessionId: string, info: SpawnedAgentInfo) => void;

// ─── 헬퍼 ──────────────────────────────────────────────────────────────────

/**
 * ANSI 이스케이프 시퀀스 제거.
 * PTY 출력에는 색상/커서 코드가 포함되어 있으므로 패턴 매칭 전에 제거한다.
 */
function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '').replace(/\x1b\][^\x07]*\x07/g, '');
}

/**
 * 단일 출력 라인에서 서브에이전트 spawn 정보를 추출한다.
 *
 * @returns SpawnedAgentInfo — 패턴이 매칭된 경우
 * @returns null — 매칭 없음
 */
export function detectSubagentSpawn(outputLine: string): SpawnedAgentInfo | null {
  const cleaned = stripAnsi(outputLine).trim();
  if (!cleaned) return null;

  for (const pattern of SPAWN_PATTERNS) {
    const match = cleaned.match(pattern);
    if (match) {
      // 첫 번째 캡처 그룹이 있으면 태스크 설명으로 사용, 없으면 라인 전체
      const taskDescription = (match[1] ?? cleaned).trim();
      return {
        taskDescription,
        rawLine: cleaned,
        detectedAt: new Date().toISOString(),
      };
    }
  }

  return null;
}

// ─── TeamsWatcher 클래스 ───────────────────────────────────────────────────

/**
 * 세션별 서브에이전트 spawn 감지 관리자.
 *
 * 사용 예시 (router.ts의 onOutput 콜백 내부):
 * ```ts
 * ptyManager.onOutput(sessionId, (sid, data) => {
 *   teamsWatcher.processOutput(sid, data);  // ← 이 줄 추가
 *   // ... 기존 코드
 * });
 * ```
 *
 * 세션 종료 시 반드시 detachFromSession()을 호출해 콜백을 해제해야 한다.
 */
export class TeamsWatcher {
  /**
   * sessionId → spawn 이벤트 콜백 매핑.
   * 세션당 여러 리스너가 붙을 수 있도록 배열로 관리.
   */
  private readonly listeners = new Map<string, SpawnCallback[]>();

  /**
   * 세션별 라인 버퍼 — PTY 데이터는 줄 단위로 오지 않을 수 있으므로
   * 개행 문자를 기준으로 누적한 뒤 완성된 라인만 분석한다.
   */
  private readonly lineBuffers = new Map<string, string>();

  // ── 세션 연결/해제 ──────────────────────────────────────────────────────

  /**
   * 세션에 spawn 감지 콜백을 등록한다.
   * 같은 sessionId에 여러 번 호출하면 콜백이 추가된다.
   */
  attachToSession(sessionId: string, onSpawn: SpawnCallback): void {
    const existing = this.listeners.get(sessionId) ?? [];
    this.listeners.set(sessionId, [...existing, onSpawn]);
    log.info(`[TeamsWatcher] Attached to session ${sessionId} (total listeners: ${existing.length + 1})`);
  }

  /**
   * 세션의 특정 콜백을 제거한다.
   * onSpawn을 생략하면 해당 세션의 모든 콜백과 버퍼를 제거한다.
   */
  detachFromSession(sessionId: string, onSpawn?: SpawnCallback): void {
    if (!onSpawn) {
      this.listeners.delete(sessionId);
      this.lineBuffers.delete(sessionId);
      log.info(`[TeamsWatcher] Detached all listeners from session ${sessionId}`);
      return;
    }

    const existing = this.listeners.get(sessionId) ?? [];
    const updated = existing.filter((cb) => cb !== onSpawn);
    if (updated.length === 0) {
      this.listeners.delete(sessionId);
      this.lineBuffers.delete(sessionId);
    } else {
      this.listeners.set(sessionId, updated);
    }
    log.info(`[TeamsWatcher] Detached one listener from session ${sessionId} (remaining: ${updated.length})`);
  }

  // ── 출력 처리 ────────────────────────────────────────────────────────────

  /**
   * PTY 출력 청크를 수신하여 라인 단위로 분석한다.
   * router.ts의 onOutput 콜백에서 호출한다.
   *
   * @param sessionId - 세션 ID
   * @param data - PTY raw 출력 (여러 줄 또는 부분 줄 포함 가능)
   */
  processOutput(sessionId: string, data: string): void {
    // 이 세션에 리스너가 없으면 처리 불필요
    if (!this.listeners.has(sessionId)) return;

    // 이전 청크의 잔여 버퍼와 합산
    const buffer = (this.lineBuffers.get(sessionId) ?? '') + data;
    const parts = buffer.split('\n');

    // 마지막 요소는 개행 없이 끝난 불완전 라인 — 다음 청크를 기다림
    this.lineBuffers.set(sessionId, parts[parts.length - 1] ?? '');

    // 완성된 라인들만 분석
    const completedLines = parts.slice(0, -1);
    for (const line of completedLines) {
      const info = detectSubagentSpawn(line);
      if (info) {
        log.info(`[TeamsWatcher] Subagent spawn detected in session ${sessionId}: "${info.taskDescription}"`);
        const callbacks = this.listeners.get(sessionId) ?? [];
        for (const cb of callbacks) {
          try {
            cb(sessionId, info);
          } catch (err) {
            log.error(`[TeamsWatcher] Spawn callback error for session ${sessionId}:`, err);
          }
        }
      }
    }
  }

  // ── 상태 조회 ────────────────────────────────────────────────────────────

  /** 현재 감지가 활성화된 세션 ID 목록 */
  getWatchedSessionIds(): string[] {
    return Array.from(this.listeners.keys());
  }

  /** 세션에 등록된 콜백 수 */
  listenerCount(sessionId: string): number {
    return this.listeners.get(sessionId)?.length ?? 0;
  }
}

// ─── 싱글톤 ────────────────────────────────────────────────────────────────

export const teamsWatcher = new TeamsWatcher();
