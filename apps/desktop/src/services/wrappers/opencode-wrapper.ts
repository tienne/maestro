import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';
import { AgentWrapper, WRAPPER_MARKER, buildWrapperScript, WrapperHookConfig } from '../agent-wrapper';

export class OpenCodeWrapper extends AgentWrapper {
  private readonly configDir: string;

  constructor(config: WrapperHookConfig) {
    super(config);
    // OPENCODE_CONFIG_DIR — 세션별 격리된 config 디렉토리
    this.configDir = path.join(os.homedir(), '.maestro', 'opencode', config.sessionId);
  }

  getAgentType(): string { return 'opencode'; }

  async injectHook(): Promise<void> {
    // ~/.maestro/opencode/{sessionId}/ 디렉토리 생성
    await fs.mkdir(this.configDir, { recursive: true });

    // 훅 스크립트 작성
    const hookScript = buildWrapperScript(this.config);
    const scriptPath = path.join(this.configDir, 'hook.sh');
    await fs.writeFile(scriptPath, hookScript, { mode: 0o755 });

    // OpenCode config.json 작성 (훅 포함)
    const config = {
      hooks: {
        start: `${scriptPath} session:started`,
        exit: `${scriptPath} session:completed`,
      },
      _maestroMarker: WRAPPER_MARKER,
    };
    await fs.writeFile(
      path.join(this.configDir, 'config.json'),
      JSON.stringify(config, null, 2)
    );
  }

  async removeHook(): Promise<void> {
    // 세션별 config 디렉토리 전체 삭제
    await fs.rm(this.configDir, { recursive: true, force: true });
  }

  // 세션 시작 시 OPENCODE_CONFIG_DIR 환경변수를 이 값으로 설정
  getEnvVars(): Record<string, string> {
    return { OPENCODE_CONFIG_DIR: this.configDir };
  }
}
