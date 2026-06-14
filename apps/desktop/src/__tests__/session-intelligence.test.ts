/**
 * SessionIntelligenceManager 단위 테스트
 *
 * PTY 출력 파싱 로직(ANSI 제거, 토큰/비용, 태스크, 에러)을 검증한다.
 * PTY 인스턴스에 의존하는 I/O 부분은 feedData()를 통해 간접 테스트한다.
 */

import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';

// ── 외부 의존성 mock ───────────────────────────────────────────────────────────

vi.mock('electron-log', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// DB 영속화(persistCostEntry)가 호출되어도 실패하지 않도록 mock
vi.mock('../db/database', () => ({
  getDatabaseManager: vi.fn(() => ({
    drizzle: {
      insert: vi.fn(() => ({
        values: vi.fn(() => ({ run: vi.fn() })),
      })),
    },
  })),
}));

vi.mock('../db/schema', () => ({
  sessionCosts: {},
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn(),
}));

// ── 테스트 대상 import ─────────────────────────────────────────────────────────

import { SessionIntelligenceManager } from '../services/session-intelligence';

// ── 헬퍼 ─────────────────────────────────────────────────────────────────────

function makeManager() {
  return new SessionIntelligenceManager();
}

// ── 테스트 ─────────────────────────────────────────────────────────────────────

describe('SessionIntelligenceManager', () => {
  let mgr: SessionIntelligenceManager;

  beforeEach(() => {
    vi.clearAllMocks();
    mgr = makeManager();
  });

  // ── ANSI 코드 제거 ────────────────────────────────────────────────────────

  describe('ANSI 코드 제거 (stripAnsi 간접 테스트)', () => {
    it('ANSI 색상 코드가 포함된 줄을 정상 파싱한다', () => {
      // "\x1b[32m✅\x1b[0m Task done" → "✅ Task done" → done 상태로 파싱
      const ansiLine = '\x1b[32m✅\x1b[0m Task done';

      mgr.startSession('s1');
      mgr.feedData('s1', ansiLine + '\n');

      const state = mgr.getState('s1');
      expect(state?.tasks).toHaveLength(1);
      expect(state?.tasks[0]).toMatchObject({ name: 'Task done', status: 'done' });
    });

    it('OSC 이스케이프 시퀀스(터미널 타이틀)를 제거한다', () => {
      // OSC: "\x1b]0;window-title\x07" + cost 텍스트
      const oscLine = '\x1b]0;myterminal\x07Cost: $0.05';

      mgr.startSession('s1');
      mgr.feedData('s1', oscLine + '\n');

      const state = mgr.getState('s1');
      // OSC 제거 후 "Cost: $0.05" 가 파싱돼야 한다
      expect(state?.costs.totalCostUsd).toBeGreaterThan(0);
    });

    it('ANSI가 없는 일반 텍스트는 그대로 처리한다', () => {
      mgr.startSession('s1');
      mgr.feedData('s1', 'Permission denied: /etc/secret\n');

      const state = mgr.getState('s1');
      expect(state?.lastError?.type).toBe('PERM');
    });
  });

  // ── 토큰/비용 파싱 ────────────────────────────────────────────────────────

  describe('토큰/비용 파싱 (parseCostLine)', () => {
    it('JSON usage 패턴에서 토큰을 누적한다', () => {
      mgr.startSession('s1');
      mgr.feedData('s1', '"usage":{"input_tokens":1000,"output_tokens":500}\n');

      const state = mgr.getState('s1');
      expect(state?.costs.totalInputTokens).toBe(1000);
      expect(state?.costs.totalOutputTokens).toBe(500);
      // 비용: 1000 * 3/1e6 + 500 * 15/1e6
      expect(state?.costs.totalCostUsd).toBeCloseTo(1000 * 3e-6 + 500 * 15e-6, 8);
    });

    it('여러 usage 블록이 오면 누적한다', () => {
      mgr.startSession('s1');
      mgr.feedData('s1', '"usage":{"input_tokens":1000,"output_tokens":200}\n');
      mgr.feedData('s1', '"usage":{"input_tokens":500,"output_tokens":100}\n');

      const state = mgr.getState('s1');
      expect(state?.costs.totalInputTokens).toBe(1500);
      expect(state?.costs.totalOutputTokens).toBe(300);
    });

    it('"Cost: $X.XX" 패턴에서 비용이 더 클 때만 교체한다', () => {
      mgr.startSession('s1');
      mgr.feedData('s1', 'Cost: $0.02\n');
      mgr.feedData('s1', 'Cost: $0.05\n'); // 더 크므로 교체
      mgr.feedData('s1', 'Cost: $0.01\n'); // 더 작으므로 무시

      const state = mgr.getState('s1');
      expect(state?.costs.totalCostUsd).toBeCloseTo(0.05);
    });

    it('"Tokens: X input, Y output" 패턴을 파싱한다', () => {
      mgr.startSession('s1');
      mgr.feedData('s1', 'Tokens: 2,000 input, 800 output\n');

      const state = mgr.getState('s1');
      expect(state?.costs.totalInputTokens).toBe(2000);
      expect(state?.costs.totalOutputTokens).toBe(800);
    });

    it('"Total cost: $X.XX" 패턴이 누적값을 교체한다', () => {
      mgr.startSession('s1');
      mgr.feedData('s1', '"usage":{"input_tokens":100,"output_tokens":50}\n');
      mgr.feedData('s1', 'Total cost: $1.23\n');

      const state = mgr.getState('s1');
      expect(state?.costs.totalCostUsd).toBeCloseTo(1.23);
    });

    it('비용이 0이거나 NaN인 줄은 무시한다', () => {
      mgr.startSession('s1');
      mgr.feedData('s1', 'Cost: $0\n');
      mgr.feedData('s1', 'Cost: $abc\n');

      const state = mgr.getState('s1');
      expect(state?.costs.totalCostUsd).toBe(0);
    });
  });

  // ── 태스크 감지 ───────────────────────────────────────────────────────────

  describe('태스크 감지 (parseTaskLine)', () => {
    it('✅ 이모지로 완료 태스크를 감지한다', () => {
      mgr.startSession('s1');
      mgr.feedData('s1', '✅ Write unit tests\n');

      expect(mgr.getState('s1')?.tasks).toContainEqual({
        name: 'Write unit tests',
        status: 'done',
      });
    });

    it('🔄 이모지로 진행 중 태스크를 감지한다', () => {
      mgr.startSession('s1');
      mgr.feedData('s1', '🔄 Running migrations\n');

      expect(mgr.getState('s1')?.tasks).toContainEqual({
        name: 'Running migrations',
        status: 'in_progress',
      });
    });

    it('⏳ 이모지로 대기 중 태스크를 감지한다', () => {
      mgr.startSession('s1');
      mgr.feedData('s1', '⏳ Deploy to production\n');

      expect(mgr.getState('s1')?.tasks).toContainEqual({
        name: 'Deploy to production',
        status: 'pending',
      });
    });

    it('[x] 체크박스 패턴으로 완료 태스크를 감지한다', () => {
      mgr.startSession('s1');
      mgr.feedData('s1', '- [x] Install dependencies\n');

      expect(mgr.getState('s1')?.tasks).toContainEqual({
        name: 'Install dependencies',
        status: 'done',
      });
    });

    it('[-] 체크박스 패턴으로 진행 중 태스크를 감지한다', () => {
      mgr.startSession('s1');
      mgr.feedData('s1', '- [-] Build project\n');

      expect(mgr.getState('s1')?.tasks).toContainEqual({
        name: 'Build project',
        status: 'in_progress',
      });
    });

    it('[ ] 체크박스 패턴으로 대기 중 태스크를 감지한다', () => {
      mgr.startSession('s1');
      mgr.feedData('s1', '- [ ] Run tests\n');

      expect(mgr.getState('s1')?.tasks).toContainEqual({
        name: 'Run tests',
        status: 'pending',
      });
    });

    it('같은 이름의 태스크 상태가 업데이트된다', () => {
      mgr.startSession('s1');
      mgr.feedData('s1', '⏳ Write tests\n');
      mgr.feedData('s1', '🔄 Write tests\n');
      mgr.feedData('s1', '✅ Write tests\n');

      const state = mgr.getState('s1');
      expect(state?.tasks).toHaveLength(1);
      expect(state?.tasks[0].status).toBe('done');
    });

    it('같은 상태로 재전송되면 tasks 배열이 중복되지 않는다', () => {
      mgr.startSession('s1');
      mgr.feedData('s1', '✅ Write tests\n');
      mgr.feedData('s1', '✅ Write tests\n'); // 동일 상태 재전송

      const state = mgr.getState('s1');
      expect(state?.tasks).toHaveLength(1);
    });
  });

  // ── 에러 감지 ────────────────────────────────────────────────────────────

  describe('에러 감지 (parseErrorLine)', () => {
    it('API Error 패턴을 감지한다', () => {
      mgr.startSession('s1');
      mgr.feedData('s1', 'API Error: 500 Internal Server Error\n');

      expect(mgr.getState('s1')?.lastError).toMatchObject({
        type: 'API',
        message: expect.stringContaining('API Error'),
      });
    });

    it('rate limit 패턴을 감지한다', () => {
      mgr.startSession('s1');
      mgr.feedData('s1', 'rate limit exceeded for model claude-3\n');

      expect(mgr.getState('s1')?.lastError?.type).toBe('API');
    });

    it('HTTP 429 코드를 API 에러로 감지한다', () => {
      mgr.startSession('s1');
      mgr.feedData('s1', 'Request failed with status 429\n');

      expect(mgr.getState('s1')?.lastError?.type).toBe('API');
    });

    it('git fatal 에러를 GIT 타입으로 감지한다', () => {
      mgr.startSession('s1');
      mgr.feedData('s1', 'fatal: not a git repository\n');

      expect(mgr.getState('s1')?.lastError?.type).toBe('GIT');
    });

    it('Permission denied를 PERM 타입으로 감지한다', () => {
      mgr.startSession('s1');
      mgr.feedData('s1', 'Permission denied (publickey).\n');

      expect(mgr.getState('s1')?.lastError?.type).toBe('PERM');
    });

    it('EACCES를 PERM 타입으로 감지한다', () => {
      mgr.startSession('s1');
      mgr.feedData('s1', 'Error: EACCES: permission denied, open \'/etc/passwd\'\n');

      expect(mgr.getState('s1')?.lastError?.type).toBe('PERM');
    });

    it('TypeError: 를 BUILD 타입으로 감지한다', () => {
      mgr.startSession('s1');
      mgr.feedData('s1', 'TypeError: Cannot read property \'foo\' of undefined\n');

      expect(mgr.getState('s1')?.lastError?.type).toBe('BUILD');
    });

    it('Compilation failed를 BUILD 타입으로 감지한다', () => {
      mgr.startSession('s1');
      mgr.feedData('s1', 'Compilation failed. See above for details.\n');

      expect(mgr.getState('s1')?.lastError?.type).toBe('BUILD');
    });

    it('에러 메시지를 최대 500자로 자른다', () => {
      const longMessage = 'TypeError: ' + 'x'.repeat(600);
      mgr.startSession('s1');
      mgr.feedData('s1', longMessage + '\n');

      const errMsg = mgr.getState('s1')?.lastError?.message ?? '';
      expect(errMsg.length).toBeLessThanOrEqual(500);
    });

    it('에러 없는 일반 출력은 lastError를 null로 유지한다', () => {
      mgr.startSession('s1');
      mgr.feedData('s1', 'Everything looks good\n');
      mgr.feedData('s1', 'Build succeeded in 3.2s\n');

      expect(mgr.getState('s1')?.lastError).toBeNull();
    });
  });

  // ── 세션 생명주기 ─────────────────────────────────────────────────────────

  describe('세션 생명주기', () => {
    it('startSession이 상태를 초기화한다', () => {
      mgr.startSession('s1');
      mgr.feedData('s1', '"usage":{"input_tokens":1000,"output_tokens":500}\n');

      // 재시작
      mgr.startSession('s1');
      const state = mgr.getState('s1');
      expect(state?.costs.totalInputTokens).toBe(0);
      expect(state?.costs.totalCostUsd).toBe(0);
      expect(state?.tasks).toHaveLength(0);
    });

    it('handleExit이 exitCode와 completedAt을 기록한다', () => {
      mgr.startSession('s1');
      mgr.handleExit('s1', 0);

      const state = mgr.getState('s1');
      expect(state?.exitCode).toBe(0);
      expect(state?.completedAt).not.toBeNull();
    });

    it('handleExit에 undefined exitCode를 전달하면 null로 기록한다', () => {
      mgr.startSession('s1');
      mgr.handleExit('s1', undefined);

      expect(mgr.getState('s1')?.exitCode).toBeNull();
    });

    it('clearSession 후 getState가 null을 반환한다', () => {
      mgr.startSession('s1');
      mgr.clearSession('s1');

      expect(mgr.getState('s1')).toBeNull();
    });

    it('존재하지 않는 sessionId로 getState를 호출하면 null을 반환한다', () => {
      expect(mgr.getState('nonexistent')).toBeNull();
    });

    it('onChange 핸들러가 데이터 변경 시 호출된다', () => {
      const handler = vi.fn();
      mgr.onChange(handler);

      mgr.startSession('s1');
      mgr.feedData('s1', '"usage":{"input_tokens":100,"output_tokens":50}\n');

      expect(handler).toHaveBeenCalledWith('s1');
    });

    it('onChange 핸들러 등록 해제 후 호출되지 않는다', () => {
      const handler = vi.fn();
      const unsubscribe = mgr.onChange(handler);
      unsubscribe();

      mgr.startSession('s1');
      mgr.feedData('s1', '"usage":{"input_tokens":100,"output_tokens":50}\n');

      expect(handler).not.toHaveBeenCalled();
    });
  });

  // ── 줄 버퍼링 ────────────────────────────────────────────────────────────

  describe('줄 버퍼링 (chunk 분할 입력)', () => {
    it('줄이 두 chunk로 나뉘어 와도 하나의 줄로 처리한다', () => {
      mgr.startSession('s1');
      // 두 chunk로 분할: 첫 chunk에 newline 없음
      mgr.feedData('s1', '✅ Partial ta');
      mgr.feedData('s1', 'sk name\n');

      expect(mgr.getState('s1')?.tasks).toContainEqual({
        name: 'Partial task name',
        status: 'done',
      });
    });

    it('여러 줄이 한 chunk로 와도 각각 파싱한다', () => {
      mgr.startSession('s1');
      mgr.feedData('s1', '✅ Task A\n✅ Task B\n✅ Task C\n');

      const tasks = mgr.getState('s1')?.tasks ?? [];
      expect(tasks).toHaveLength(3);
    });

    it('빈 줄은 무시된다', () => {
      mgr.startSession('s1');
      mgr.feedData('s1', '\n\n\n');

      const state = mgr.getState('s1');
      expect(state?.tasks).toHaveLength(0);
      expect(state?.lastError).toBeNull();
    });
  });
});
