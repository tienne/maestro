/**
 * AI Provider Factory
 *
 * Anthropic / OpenAI 모델 인스턴스를 생성하는 팩토리 모듈.
 * host-service child process(Node.js) 안에서만 실행된다.
 *
 * 우선순위:
 * 1. config에 직접 전달된 apiKey
 * 2. resolveAnthropicCredential() — 3단계 탐색 (Claude config → Keychain → auth.json)
 * 3. 환경 변수 ANTHROPIC_API_KEY / OPENAI_API_KEY
 */

import { createAnthropic } from '@ai-sdk/anthropic';
import { createOpenAI } from '@ai-sdk/openai';
import type { AnthropicCredential } from './credential';

// ── Types ─────────────────────────────────────────────────────────────────────

export type AIProvider = 'anthropic' | 'openai';

export interface ModelConfig {
  /** AI 프로바이더 */
  provider: AIProvider;
  /**
   * 프로바이더별 모델 ID.
   * - Anthropic: 'claude-sonnet-4-6', 'claude-opus-4-5', 'claude-3-5-haiku-20241022' 등
   * - OpenAI:    'gpt-4o', 'gpt-4o-mini', 'o1-mini' 등
   */
  model: string;
  /**
   * API 키 (선택).
   * 미제공 시 provider별 환경 변수(ANTHROPIC_API_KEY / OPENAI_API_KEY)를 자동 탐색.
   * Anthropic의 경우 resolveAnthropicCredential()도 거친다.
   */
  apiKey?: string;
}

// ── Defaults ──────────────────────────────────────────────────────────────────

export const DEFAULT_MODEL: ModelConfig = {
  provider: 'anthropic',
  model: 'claude-sonnet-4-6',
};

// ── Factory ───────────────────────────────────────────────────────────────────

/**
 * ModelConfig를 받아 AI SDK 모델 인스턴스를 반환한다.
 *
 * Anthropic의 경우 credential 파라미터를 통해 OAuth 토큰을 주입할 수 있다.
 * credential이 없으면 config.apiKey → ANTHROPIC_API_KEY 환경 변수 순으로 사용.
 *
 * @param config      모델 설정
 * @param credential  Anthropic OAuth/API 크레덴셜 (Anthropic provider 전용, 선택)
 */
export function createModel(
  config: ModelConfig,
  credential?: AnthropicCredential | null,
// eslint-disable-next-line @typescript-eslint/no-explicit-any
): any {
  if (config.provider === 'anthropic') {
    return createAnthropicModel(config, credential ?? null);
  }
  return createOpenAIModel(config);
}

// ── Internal helpers ──────────────────────────────────────────────────────────

function createAnthropicModel(
  config: ModelConfig,
  credential: AnthropicCredential | null,
// eslint-disable-next-line @typescript-eslint/no-explicit-any
): any {
  // 우선순위: credential > config.apiKey > 환경 변수
  const apiKey =
    credential?.access ??
    config.apiKey ??
    process.env['ANTHROPIC_API_KEY'];

  const isOAuth = credential?.type === 'oauth';

  const provider = createAnthropic({
    ...(apiKey ? { apiKey } : {}),
    ...(isOAuth ? { baseURL: 'https://api.anthropic.com/v1' } : {}),
  });

  return provider(config.model);
}

function createOpenAIModel(
  config: ModelConfig,
// eslint-disable-next-line @typescript-eslint/no-explicit-any
): any {
  // 우선순위: config.apiKey > 환경 변수
  const apiKey = config.apiKey ?? process.env['OPENAI_API_KEY'];

  const provider = createOpenAI({
    ...(apiKey ? { apiKey } : {}),
  });

  return provider(config.model);
}
