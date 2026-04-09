import { AgentWrapper, WrapperHookConfig } from '../agent-wrapper';
import { ClaudeCodeWrapper } from './claude-code-wrapper';
import { GeminiWrapper } from './gemini-wrapper';
import { CodexWrapper } from './codex-wrapper';
import { OpenCodeWrapper } from './opencode-wrapper';

export { ClaudeCodeWrapper } from './claude-code-wrapper';
export { GeminiWrapper } from './gemini-wrapper';
export { CodexWrapper } from './codex-wrapper';
export { OpenCodeWrapper } from './opencode-wrapper';

/**
 * agentType에 맞는 AgentWrapper 인스턴스를 생성해 반환한다.
 * 지원하지 않는 타입이면 Error를 던진다.
 */
export function createWrapper(agentType: string, config: WrapperHookConfig): AgentWrapper {
  switch (agentType) {
    case 'claude-code':
      return new ClaudeCodeWrapper(config);
    case 'gemini':
      return new GeminiWrapper(config);
    case 'codex':
      return new CodexWrapper(config);
    case 'opencode':
      return new OpenCodeWrapper(config);
    default:
      throw new Error(`Unknown agent type: ${agentType}`);
  }
}
