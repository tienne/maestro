/**
 * Session Intelligence — PTY 출력 파싱을 통한 세션 메트릭 수집
 *
 * F-M3-01: 토큰/비용 추적
 * F-M3-02: 작업 진행률 감지
 * F-M3-04: 에러 패턴 분류
 * F-M3-05: 완료 감지
 */

import log from 'electron-log';
import type {
  TaskItem,
  TaskStatus,
  ErrorInfo,
  ErrorType,
  SessionCostSummary,
} from '@maestro/shared-types';

// ── 토큰 비용 모델 (Claude 기준 기본값) ───────────────────────────────────────

const COST_PER_INPUT_TOKEN = 3.0 / 1_000_000; // $3 per 1M input tokens
const COST_PER_OUTPUT_TOKEN = 15.0 / 1_000_000; // $15 per 1M output tokens

// ── ANSI 이스케이프 시퀀스 제거 ────────────────────────────────────────────────

function stripAnsi(str: string): string {
  // eslint-disable-next-line no-control-regex
  return str.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '').replace(/\x1b\][^\x07]*\x07/g, '');
}

// ── 세션별 인텔리전스 상태 ─────────────────────────────────────────────────────

interface IntelligenceState {
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCostUsd: number;
  tasks: TaskItem[];
  lastError: ErrorInfo | null;
  completedAt: number | null;
  exitCode: number | null;
  startedAt: number | null;
  /** 줄 단위 버퍼 — PTY 데이터는 chunk로 오므로 줄을 모아야 함 */
  lineBuffer: string;
}

export type IntelligenceChangeHandler = (sessionId: string) => void;

export class SessionIntelligenceManager {
  private states = new Map<string, IntelligenceState>();
  private changeHandlers = new Set<IntelligenceChangeHandler>();

  /** 상태 변경 구독 */
  onChange(handler: IntelligenceChangeHandler): () => void {
    this.changeHandlers.add(handler);
    return () => this.changeHandlers.delete(handler);
  }

  private notify(sessionId: string): void {
    for (const h of this.changeHandlers) {
      try { h(sessionId); } catch { /* ignore */ }
    }
  }

  private getOrCreate(sessionId: string): IntelligenceState {
    let state = this.states.get(sessionId);
    if (!state) {
      state = {
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalCostUsd: 0,
        tasks: [],
        lastError: null,
        completedAt: null,
        exitCode: null,
        startedAt: Date.now(),
        lineBuffer: '',
      };
      this.states.set(sessionId, state);
    }
    return state;
  }

  /** 세션 시작 시 호출 */
  startSession(sessionId: string): void {
    this.states.delete(sessionId);
    this.getOrCreate(sessionId);
  }

  /** PTY stdout 데이터 수신 시 호출 */
  feedData(sessionId: string, data: string): void {
    const state = this.getOrCreate(sessionId);
    const text = state.lineBuffer + data;
    const lines = text.split(/\r?\n/);

    // 마지막 요소는 아직 완성되지 않은 줄일 수 있으므로 버퍼에 보관
    state.lineBuffer = lines.pop() ?? '';

    let changed = false;

    for (const rawLine of lines) {
      const line = stripAnsi(rawLine).trim();
      if (!line) continue;

      if (this.parseCostLine(sessionId, state, line)) changed = true;
      if (this.parseTaskLine(sessionId, state, line)) changed = true;
      if (this.parseErrorLine(sessionId, state, line)) changed = true;
    }

    if (changed) {
      this.notify(sessionId);
    }
  }

  /** PTY 프로세스 종료 시 호출 */
  handleExit(sessionId: string, exitCode: number | undefined): void {
    const state = this.getOrCreate(sessionId);
    state.completedAt = Date.now();
    state.exitCode = exitCode ?? null;
    this.notify(sessionId);
  }

  /** 세션 인텔리전스 상태 조회 */
  getState(sessionId: string): {
    costs: SessionCostSummary;
    tasks: TaskItem[];
    lastError: ErrorInfo | null;
    completedAt: number | null;
    exitCode: number | null;
    startedAt: number | null;
  } | null {
    const state = this.states.get(sessionId);
    if (!state) return null;

    return {
      costs: {
        sessionId,
        totalInputTokens: state.totalInputTokens,
        totalOutputTokens: state.totalOutputTokens,
        totalCostUsd: state.totalCostUsd,
      },
      tasks: [...state.tasks],
      lastError: state.lastError,
      completedAt: state.completedAt,
      exitCode: state.exitCode,
      startedAt: state.startedAt,
    };
  }

  /** 세션 상태 삭제 */
  clearSession(sessionId: string): void {
    this.states.delete(sessionId);
  }

  // ── 비용 파싱 (F-M3-01) ─────────────────────────────────────────────────────

  private parseCostLine(
    sessionId: string,
    state: IntelligenceState,
    line: string,
  ): boolean {
    // Pattern 1: Claude Code JSON usage output
    // "usage":{"input_tokens":1234,"output_tokens":567}
    const usageMatch = line.match(
      /"usage"\s*:\s*\{\s*"input_tokens"\s*:\s*(\d+)\s*,\s*"output_tokens"\s*:\s*(\d+)/,
    );
    if (usageMatch) {
      const input = parseInt(usageMatch[1], 10);
      const output = parseInt(usageMatch[2], 10);
      state.totalInputTokens += input;
      state.totalOutputTokens += output;
      state.totalCostUsd += input * COST_PER_INPUT_TOKEN + output * COST_PER_OUTPUT_TOKEN;
      this.persistCostEntry(sessionId, input, output);
      return true;
    }

    // Pattern 2: "Cost: $0.0234" 형태
    const costMatch = line.match(/Cost:\s*\$?([\d.]+)/i);
    if (costMatch) {
      const cost = parseFloat(costMatch[1]);
      if (!isNaN(cost) && cost > 0) {
        // 증분이 아닌 누적 값일 수 있으므로, 이전 값보다 크면 교체
        if (cost > state.totalCostUsd) {
          state.totalCostUsd = cost;
          return true;
        }
      }
    }

    // Pattern 3: "Tokens: 1234 input, 567 output" 형태
    const tokensMatch = line.match(/Tokens?:\s*(\d[\d,]*)\s*input\s*,\s*(\d[\d,]*)\s*output/i);
    if (tokensMatch) {
      const input = parseInt(tokensMatch[1].replace(/,/g, ''), 10);
      const output = parseInt(tokensMatch[2].replace(/,/g, ''), 10);
      if (input > state.totalInputTokens || output > state.totalOutputTokens) {
        state.totalInputTokens = input;
        state.totalOutputTokens = output;
        state.totalCostUsd = input * COST_PER_INPUT_TOKEN + output * COST_PER_OUTPUT_TOKEN;
        return true;
      }
    }

    // Pattern 4: Claude Code "Total cost: $X.XX" (최종 요약)
    const totalCostMatch = line.match(/Total\s+cost:\s*\$?([\d.]+)/i);
    if (totalCostMatch) {
      const cost = parseFloat(totalCostMatch[1]);
      if (!isNaN(cost) && cost > 0) {
        state.totalCostUsd = cost;
        return true;
      }
    }

    // Pattern 5: Claude Code "Total tokens: 1234" (최종 요약)
    const totalTokensMatch = line.match(/Total\s+tokens?:\s*(\d[\d,]*)/i);
    if (totalTokensMatch) {
      const total = parseInt(totalTokensMatch[1].replace(/,/g, ''), 10);
      if (total > state.totalInputTokens + state.totalOutputTokens) {
        // 구분 불가 시 input으로 분류
        state.totalInputTokens = total;
        state.totalCostUsd = total * COST_PER_INPUT_TOKEN;
        return true;
      }
    }

    return false;
  }

  // ── 작업 감지 (F-M3-02) ──────────────────────────────────────────────────────

  private parseTaskLine(
    _sessionId: string,
    state: IntelligenceState,
    line: string,
  ): boolean {
    // TodoWrite 출력 패턴: 이모지 + 작업명
    // 완료: ✅ 또는 [x]
    // 진행 중: 🔄 또는 [-]
    // 대기: ⏳ 또는 [ ]

    let status: TaskStatus | null = null;
    let name = '';

    // 이모지 패턴
    if (line.includes('\u2705') || line.match(/^\s*✅/)) {
      status = 'done';
      name = line.replace(/^\s*✅\s*/, '').trim();
    } else if (line.includes('\uD83D\uDD04') || line.match(/^\s*🔄/)) {
      status = 'in_progress';
      name = line.replace(/^\s*🔄\s*/, '').trim();
    } else if (line.includes('\u23F3') || line.match(/^\s*⏳/)) {
      status = 'pending';
      name = line.replace(/^\s*⏳\s*/, '').trim();
    }

    // 체크박스 패턴: [x] task name, [ ] task name, [-] task name
    if (!status) {
      const checkboxMatch = line.match(/^\s*-?\s*\[([ xX\-])\]\s+(.+)/);
      if (checkboxMatch) {
        const mark = checkboxMatch[1].toLowerCase();
        name = checkboxMatch[2].trim();
        if (mark === 'x') status = 'done';
        else if (mark === '-') status = 'in_progress';
        else status = 'pending';
      }
    }

    if (status && name) {
      // 기존 같은 이름의 작업이 있으면 상태 업데이트
      const existing = state.tasks.find(
        (t) => t.name.toLowerCase() === name.toLowerCase(),
      );
      if (existing) {
        if (existing.status !== status) {
          existing.status = status;
          return true;
        }
        return false;
      }
      state.tasks.push({ name, status });
      return true;
    }

    return false;
  }

  // ── 에러 감지 (F-M3-04) ──────────────────────────────────────────────────────

  private parseErrorLine(
    _sessionId: string,
    state: IntelligenceState,
    line: string,
  ): boolean {
    let type: ErrorType | null = null;
    let message = '';

    // API Error / rate limit
    if (/API\s*Error/i.test(line) || /rate\s*limit/i.test(line) || /429/i.test(line)) {
      type = 'API';
      message = line;
    }
    // Git Error
    else if (/^fatal:\s/i.test(line) || (/^error:\s/i.test(line) && /git/i.test(line))) {
      type = 'GIT';
      message = line;
    }
    // Permission Error
    else if (/Permission\s+denied/i.test(line) || /EACCES/i.test(line)) {
      type = 'PERM';
      message = line;
    }
    // Build/Runtime Error
    else if (
      /^(TypeError|ReferenceError|SyntaxError|Error):/i.test(line) ||
      /\bFAILED\b/.test(line) ||
      /\bCompilation\s+failed/i.test(line) ||
      /\bbuild\s+failed/i.test(line)
    ) {
      type = 'BUILD';
      message = line;
    }

    if (type) {
      state.lastError = {
        type,
        message: message.slice(0, 500), // 최대 500자
        timestamp: Date.now(),
      };
      return true;
    }

    return false;
  }

  // ── DB 영속화 ────────────────────────────────────────────────────────────────

  private persistCostEntry(
    sessionId: string,
    inputTokens: number,
    outputTokens: number,
  ): void {
    try {
      const { getDatabaseManager } = require('../db/database') as typeof import('../db/database');
      const db = getDatabaseManager().getDb();
      const cost = inputTokens * COST_PER_INPUT_TOKEN + outputTokens * COST_PER_OUTPUT_TOKEN;
      db.prepare(
        `INSERT INTO session_costs (id, session_id, input_tokens, output_tokens, cost_usd)
         VALUES (?, ?, ?, ?, ?)`,
      ).run(crypto.randomUUID(), sessionId, inputTokens, outputTokens, cost);
    } catch (err) {
      log.warn('[SessionIntelligence] Failed to persist cost entry:', err);
    }
  }
}

// ── Singleton ──────────────────────────────────────────────────────────────────

let instance: SessionIntelligenceManager | null = null;

export function getSessionIntelligence(): SessionIntelligenceManager {
  if (!instance) {
    instance = new SessionIntelligenceManager();
  }
  return instance;
}
