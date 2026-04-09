import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { AgentWrapper, buildWrapperScript, WRAPPER_MARKER } from '../agent-wrapper';

const CODEX_HOOKS_PATH = path.join(os.homedir(), '.codex', 'hooks.json');
const MAESTRO_HOOKS_DIR = path.join(os.homedir(), '.maestro', 'hooks');
const MAESTRO_MARKER = '_maestroMarker';

interface CodexHookEntry {
  type: 'command';
  command: string;
  [MAESTRO_MARKER]?: string;
}

type CodexHooksJson = Record<string, CodexHookEntry[]>;

export class CodexWrapper extends AgentWrapper {
  getAgentType(): string {
    return 'codex';
  }

  /**
   * ~/.codex/hooks.json 에 SessionStart / Stop 훅을 주입합니다.
   * 각 훅 엔트리에 _maestroMarker 필드를 넣어 나중에 제거할 수 있게 합니다.
   */
  async injectHook(): Promise<void> {
    const scriptPath = this.writeHookScript();

    let hooks: CodexHooksJson = {};
    try {
      const raw = fs.readFileSync(CODEX_HOOKS_PATH, 'utf-8');
      hooks = JSON.parse(raw) as CodexHooksJson;
    } catch {
      // 파일이 없거나 파싱 실패 → 빈 객체로 시작
    }

    // 디렉토리가 없으면 생성
    const codexDir = path.dirname(CODEX_HOOKS_PATH);
    fs.mkdirSync(codexDir, { recursive: true });

    const sessionStartEntry: CodexHookEntry = {
      type: 'command',
      command: `${scriptPath} session:started`,
      [MAESTRO_MARKER]: this.config.sessionId,
    };

    const stopEntry: CodexHookEntry = {
      type: 'command',
      command: `${scriptPath} session:completed`,
      [MAESTRO_MARKER]: this.config.sessionId,
    };

    hooks['SessionStart'] = this.mergeHookEntries(
      hooks['SessionStart'],
      sessionStartEntry,
    );
    hooks['Stop'] = this.mergeHookEntries(hooks['Stop'], stopEntry);

    fs.writeFileSync(CODEX_HOOKS_PATH, JSON.stringify(hooks, null, 2), 'utf-8');
  }

  /**
   * _maestroMarker가 현재 sessionId와 일치하는 훅 엔트리만 제거합니다.
   */
  async removeHook(): Promise<void> {
    let hooks: CodexHooksJson = {};
    try {
      const raw = fs.readFileSync(CODEX_HOOKS_PATH, 'utf-8');
      hooks = JSON.parse(raw) as CodexHooksJson;
    } catch {
      return; // 파일이 없으면 아무것도 안 함
    }

    for (const key of ['SessionStart', 'Stop'] as const) {
      if (Array.isArray(hooks[key])) {
        hooks[key] = hooks[key].filter(
          (entry) => entry[MAESTRO_MARKER] !== this.config.sessionId,
        );
        if (hooks[key].length === 0) {
          delete hooks[key];
        }
      }
    }

    fs.writeFileSync(CODEX_HOOKS_PATH, JSON.stringify(hooks, null, 2), 'utf-8');

    // 훅 스크립트 파일 정리
    const scriptPath = this.getHookScriptPath();
    try {
      fs.unlinkSync(scriptPath);
    } catch {
      // 이미 없으면 무시
    }
  }

  /**
   * ~/.maestro/hooks/codex-{sessionId}.sh 에 훅 스크립트를 저장합니다.
   * @returns 저장된 스크립트의 절대 경로
   */
  writeHookScript(): string {
    fs.mkdirSync(MAESTRO_HOOKS_DIR, { recursive: true });

    const scriptPath = this.getHookScriptPath();
    const scriptContent = buildWrapperScript(this.config);

    fs.writeFileSync(scriptPath, scriptContent, { mode: 0o755, encoding: 'utf-8' });

    return scriptPath;
  }

  private getHookScriptPath(): string {
    return path.join(MAESTRO_HOOKS_DIR, `codex-${this.config.sessionId}.sh`);
  }

  /**
   * 기존 훅 배열에서 동일 sessionId 마커가 있으면 교체, 없으면 추가합니다.
   */
  private mergeHookEntries(
    existing: CodexHookEntry[] | undefined,
    newEntry: CodexHookEntry,
  ): CodexHookEntry[] {
    const entries: CodexHookEntry[] = Array.isArray(existing) ? [...existing] : [];

    const idx = entries.findIndex(
      (e) => e[MAESTRO_MARKER] === newEntry[MAESTRO_MARKER],
    );

    if (idx >= 0) {
      entries[idx] = newEntry; // 이미 있으면 교체 (재주입 시 idempotent)
    } else {
      entries.push(newEntry);
    }

    return entries;
  }
}

// 편의 팩토리 함수
export function createCodexWrapper(
  config: ConstructorParameters<typeof CodexWrapper>[0],
): CodexWrapper {
  return new CodexWrapper(config);
}

// 상수 re-export (테스트/다른 모듈에서 참조용)
export { CODEX_HOOKS_PATH, MAESTRO_HOOKS_DIR, MAESTRO_MARKER, WRAPPER_MARKER };
