import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { AgentWrapper, buildWrapperScript, WRAPPER_MARKER } from '../agent-wrapper';

const GEMINI_SETTINGS_PATH = path.join(os.homedir(), '.gemini', 'settings.json');
const MAESTRO_HOOKS_DIR = path.join(os.homedir(), '.maestro', 'hooks');

interface GeminiHookEntry {
  type: 'command';
  command: string;
  _maestroMarker?: string;
}

interface GeminiHooks {
  BeforeAgent?: GeminiHookEntry[];
  AfterAgent?: GeminiHookEntry[];
  AfterTool?: GeminiHookEntry[];
}

interface GeminiSettings {
  hooks?: GeminiHooks;
  [key: string]: unknown;
}

export class GeminiWrapper extends AgentWrapper {
  getAgentType(): string {
    return 'gemini';
  }

  private get hookScriptPath(): string {
    return path.join(MAESTRO_HOOKS_DIR, `gemini-${this.config.sessionId}.sh`);
  }

  private readSettings(): GeminiSettings {
    try {
      const raw = fs.readFileSync(GEMINI_SETTINGS_PATH, 'utf-8');
      return JSON.parse(raw) as GeminiSettings;
    } catch {
      return {};
    }
  }

  private writeSettings(settings: GeminiSettings): void {
    const dir = path.dirname(GEMINI_SETTINGS_PATH);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(GEMINI_SETTINGS_PATH, JSON.stringify(settings, null, 2), 'utf-8');
  }

  writeHookScript(): void {
    fs.mkdirSync(MAESTRO_HOOKS_DIR, { recursive: true });

    const script = buildWrapperScript({
      ...this.config,
      agentType: this.getAgentType(),
    });

    fs.writeFileSync(this.hookScriptPath, script, { encoding: 'utf-8', mode: 0o755 });
  }

  async injectHook(): Promise<void> {
    this.writeHookScript();

    const settings = this.readSettings();
    settings.hooks = settings.hooks ?? {};

    const makeEntry = (event: string): GeminiHookEntry => ({
      type: 'command',
      command: `${this.hookScriptPath} ${event}`,
      _maestroMarker: WRAPPER_MARKER,
    });

    // BeforeAgent → session:started
    const beforeList: GeminiHookEntry[] = (settings.hooks.BeforeAgent ?? []).filter(
      (e) => e._maestroMarker !== WRAPPER_MARKER,
    );
    beforeList.push(makeEntry('session:started'));
    settings.hooks.BeforeAgent = beforeList;

    // AfterAgent → session:completed
    const afterList: GeminiHookEntry[] = (settings.hooks.AfterAgent ?? []).filter(
      (e) => e._maestroMarker !== WRAPPER_MARKER,
    );
    afterList.push(makeEntry('session:completed'));
    settings.hooks.AfterAgent = afterList;

    this.writeSettings(settings);
  }

  async removeHook(): Promise<void> {
    const settings = this.readSettings();

    if (settings.hooks) {
      const filterOut = (list: GeminiHookEntry[] = []): GeminiHookEntry[] =>
        list.filter((e) => e._maestroMarker !== WRAPPER_MARKER);

      settings.hooks.BeforeAgent = filterOut(settings.hooks.BeforeAgent);
      settings.hooks.AfterAgent = filterOut(settings.hooks.AfterAgent);
      settings.hooks.AfterTool = filterOut(settings.hooks.AfterTool);

      // 빈 배열은 키 제거
      for (const key of ['BeforeAgent', 'AfterAgent', 'AfterTool'] as const) {
        if (settings.hooks[key]?.length === 0) {
          delete settings.hooks[key];
        }
      }

      if (Object.keys(settings.hooks).length === 0) {
        delete settings.hooks;
      }
    }

    this.writeSettings(settings);

    // 훅 스크립트 파일 제거
    try {
      fs.unlinkSync(this.hookScriptPath);
    } catch {
      // 파일이 없어도 무시
    }
  }
}
