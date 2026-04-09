/**
 * IPC 채널 일관성 테스트
 *
 * main process가 webContents.send()로 push하는 채널과
 * renderer가 onEvent()로 구독하는 채널이 일치하는지 검증한다.
 *
 * 불일치 예시: main이 'session-output'을 send하는데 renderer가 'session:output'을 listen → 데이터 못 받음
 */

import { readFileSync, readdirSync, statSync } from 'fs';
import { join } from 'path';

const SRC = join(__dirname, '..');

// ── 소스 파일 수집 ─────────────────────────────────────────────────────────────

function collectFiles(dir: string, ext: string): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === 'node_modules' || entry === 'renderer') continue;
      results.push(...collectFiles(full, ext));
    } else if (full.endsWith(ext) && !full.includes('__tests__')) {
      results.push(full);
    }
  }
  return results;
}

function collectRendererFiles(dir: string): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === 'node_modules') continue;
      results.push(...collectRendererFiles(full));
    } else if (full.endsWith('.ts') || full.endsWith('.tsx')) {
      results.push(full);
    }
  }
  return results;
}

// ── 채널명 추출 헬퍼 ───────────────────────────────────────────────────────────

function extractChannels(pattern: RegExp, files: string[]): Set<string> {
  const channels = new Set<string>();
  for (const file of files) {
    const src = readFileSync(file, 'utf-8');
    let match: RegExpExecArray | null;
    const re = new RegExp(pattern.source, 'g');
    while ((match = re.exec(src)) !== null) {
      channels.add(match[1]);
    }
  }
  return channels;
}

// ── 실제 추출 ─────────────────────────────────────────────────────────────────

const mainFiles = collectFiles(SRC, '.ts').filter(
  (f) => !f.includes('/renderer/') && !f.endsWith('.test.ts'),
);

const rendererFiles = collectRendererFiles(join(SRC, 'renderer'));

// main → renderer: webContents.send('채널명', ...)
const mainPushChannels = extractChannels(
  /\.webContents\.send\(\s*'([^']+)'/,
  mainFiles,
);

// renderer → main (listen): onEvent('채널명', ...)
const rendererListenChannels = extractChannels(
  /\.onEvent\(\s*'([^']+)'/,
  rendererFiles,
);

// ── 테스트 ─────────────────────────────────────────────────────────────────────

describe('IPC 채널 일관성', () => {
  it('main이 push하는 모든 채널을 renderer가 구독해야 한다', () => {
    const missing: string[] = [];
    for (const ch of mainPushChannels) {
      if (!rendererListenChannels.has(ch)) {
        missing.push(ch);
      }
    }
    expect(
      missing,
      `main이 send하지만 renderer가 onEvent로 듣지 않는 채널:\n  ${missing.join('\n  ')}`,
    ).toEqual([]);
  });

  it('renderer가 구독하는 모든 채널을 main이 send해야 한다', () => {
    const unused: string[] = [];
    for (const ch of rendererListenChannels) {
      if (!mainPushChannels.has(ch)) {
        unused.push(ch);
      }
    }
    expect(
      unused,
      `renderer가 onEvent로 듣지만 main이 send하지 않는 채널:\n  ${unused.join('\n  ')}`,
    ).toEqual([]);
  });

  it('채널명 목록을 출력한다 (진단용)', () => {
    // 실패 시 진단을 돕기 위한 스냅샷
    expect({
      mainPushChannels: [...mainPushChannels].sort(),
      rendererListenChannels: [...rendererListenChannels].sort(),
    }).toMatchSnapshot();
  });
});
