import * as fs from 'fs';

export const WRAPPER_MARKER = '# maestro-managed';

export interface WrapperHookConfig {
  eventEndpoint: string; // http://127.0.0.1:{port}/api/events
  port: number;
  authToken: string;
  sessionId: string;
  agentType: string;
}

export function buildWrapperScript(config: WrapperHookConfig): string {
  return `#!/bin/bash
${WRAPPER_MARKER}
EVENT_TYPE="\${1:-unknown}"
curl -s -X POST "http://127.0.0.1:${config.port}/api/events" \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer ${config.authToken}" \\
  -d "{\\"type\\": \\"$EVENT_TYPE\\", \\"sessionId\\": \\"${config.sessionId}\\", \\"agentType\\": \\"${config.agentType}\\"}" \\
  --connect-timeout 2 --max-time 5 || true
# end-maestro-managed
`;
}

export function injectJsonConfig(
  filePath: string,
  hookKey: string,
  hookValue: string,
  marker = WRAPPER_MARKER,
): void {
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, 'utf-8');
  } catch {
    raw = '{}';
  }

  const config = JSON.parse(raw) as Record<string, unknown>;

  // marker 메타데이터와 함께 hookKey 삽입
  config[hookKey] = hookValue;
  config[`${hookKey}.__marker`] = marker;

  fs.writeFileSync(filePath, JSON.stringify(config, null, 2), 'utf-8');
}

export function removeJsonConfig(
  filePath: string,
  hookKey: string,
  _marker = WRAPPER_MARKER,
): void {
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, 'utf-8');
  } catch {
    return;
  }

  const config = JSON.parse(raw) as Record<string, unknown>;

  delete config[hookKey];
  delete config[`${hookKey}.__marker`];

  fs.writeFileSync(filePath, JSON.stringify(config, null, 2), 'utf-8');
}

export abstract class AgentWrapper {
  protected config: WrapperHookConfig;

  constructor(config: WrapperHookConfig) {
    this.config = config;
  }

  abstract injectHook(): Promise<void>;
  abstract removeHook(): Promise<void>;
  abstract getAgentType(): string;
}
