import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { AgentWrapper, WRAPPER_MARKER, buildWrapperScript } from '../agent-wrapper';

interface ClaudeHookEntry {
  matcher: string;
  hooks: Array<{ type: string; command: string }>;
}

interface ClaudeSettings {
  hooks?: {
    UserPromptSubmit?: ClaudeHookEntry[];
    Stop?: ClaudeHookEntry[];
    [key: string]: ClaudeHookEntry[] | undefined;
  };
  _maestroMarker?: string;
  [key: string]: unknown;
}

export class ClaudeCodeWrapper extends AgentWrapper {
  private readonly settingsPath = path.join(os.homedir(), '.claude', 'settings.json');

  getAgentType(): string {
    return 'claude-code';
  }

  async injectHook(): Promise<void> {
    const settings = await this.readSettings();
    const hookScript = buildWrapperScript(this.config);
    const scriptPath = await this.writeHookScript(hookScript);

    if (!settings.hooks) {
      settings.hooks = {};
    }

    const startedEntry: ClaudeHookEntry = {
      matcher: '',
      hooks: [{ type: 'command', command: `${scriptPath} session:started` }],
    };

    const completedEntry: ClaudeHookEntry = {
      matcher: '',
      hooks: [{ type: 'command', command: `${scriptPath} session:completed` }],
    };

    settings.hooks.UserPromptSubmit = [
      ...(settings.hooks.UserPromptSubmit ?? []),
      startedEntry,
    ];

    settings.hooks.Stop = [
      ...(settings.hooks.Stop ?? []),
      completedEntry,
    ];

    settings._maestroMarker = WRAPPER_MARKER;

    await fs.writeFile(this.settingsPath, JSON.stringify(settings, null, 2), 'utf-8');
  }

  async removeHook(): Promise<void> {
    const settings = await this.readSettings();

    // 우리가 주입한 훅이 아니면 아무것도 하지 않음
    if (!settings._maestroMarker) return;

    const sessionScriptSuffix = `claude-${this.config.sessionId}.sh`;

    // UserPromptSubmit에서 이 세션의 훅만 제거
    if (settings.hooks?.UserPromptSubmit) {
      settings.hooks.UserPromptSubmit = settings.hooks.UserPromptSubmit.filter(
        (entry) => !entry.hooks.some((h) => h.command.includes(sessionScriptSuffix)),
      );
      if (settings.hooks.UserPromptSubmit.length === 0) {
        delete settings.hooks.UserPromptSubmit;
      }
    }

    // Stop에서 이 세션의 훅만 제거
    if (settings.hooks?.Stop) {
      settings.hooks.Stop = settings.hooks.Stop.filter(
        (entry) => !entry.hooks.some((h) => h.command.includes(sessionScriptSuffix)),
      );
      if (settings.hooks.Stop.length === 0) {
        delete settings.hooks.Stop;
      }
    }

    // hooks 섹션이 비어 있으면 제거
    if (settings.hooks && Object.keys(settings.hooks).length === 0) {
      delete settings.hooks;
    }

    delete settings._maestroMarker;

    await fs.writeFile(this.settingsPath, JSON.stringify(settings, null, 2), 'utf-8');

    // 훅 스크립트 파일 정리
    await this.cleanupHookScript();
  }

  private async readSettings(): Promise<ClaudeSettings> {
    try {
      const content = await fs.readFile(this.settingsPath, 'utf-8');
      return JSON.parse(content) as ClaudeSettings;
    } catch {
      return {};
    }
  }

  private async writeHookScript(script: string): Promise<string> {
    const scriptDir = path.join(os.homedir(), '.maestro', 'hooks');
    await fs.mkdir(scriptDir, { recursive: true });
    const scriptPath = path.join(scriptDir, `claude-${this.config.sessionId}.sh`);
    await fs.writeFile(scriptPath, script, { mode: 0o755 });
    return scriptPath;
  }

  private async cleanupHookScript(): Promise<void> {
    const scriptPath = path.join(
      os.homedir(),
      '.maestro',
      'hooks',
      `claude-${this.config.sessionId}.sh`,
    );
    try {
      await fs.unlink(scriptPath);
    } catch {
      // 파일이 이미 없어도 무시
    }
  }
}
