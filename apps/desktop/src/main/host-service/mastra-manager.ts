/**
 * MastraManager — Mastra AI 프레임워크 싱글톤 관리자
 *
 * host-service child process(Node.js) 안에서 실행된다.
 * Electron API는 사용 불가.
 *
 * 역할:
 * - Mastra 인스턴스 초기화 (InMemoryStore 기반)
 * - workspaceId별 Agent 생성 및 캐싱
 * - Anthropic 크레덴셜을 주입해 스트리밍 응답 생성
 */

import { Mastra } from '@mastra/core';
import { Agent } from '@mastra/core/agent';
import { InMemoryStore } from '@mastra/core/storage';
import { MockMemory } from '@mastra/core/memory';
import { resolveAnthropicCredential } from './credential';
import { createModel, DEFAULT_MODEL, type ModelConfig } from './ai-providers';
import { workspaceTools } from './tools/workspace-tools';
import { taskExecutionWorkflow } from './workflows/task-execution-workflow';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface AgentConfig {
  /** Agent를 식별하는 ID (workspaceId와 동일하게 사용해도 됨) */
  id: string;
  /** 사용자에게 보여지는 Agent 이름 */
  name: string;
  /** Agent 행동을 가이드하는 시스템 프롬프트 */
  instructions: string;
  /**
   * 사용할 모델 설정.
   * ModelConfig({ provider, model, apiKey? })를 전달하거나,
   * 레거시 호환용으로 'anthropic/...' 형식의 문자열도 허용 (deprecated).
   *
   * 미제공 시 DEFAULT_MODEL(Anthropic claude-sonnet-4-6) 사용.
   */
  modelConfig?: ModelConfig;
  /**
   * @deprecated modelConfig를 사용하세요.
   * 레거시 문자열 모델 ID (e.g. 'anthropic/claude-sonnet-4.6').
   * modelConfig가 없을 때만 참조됩니다.
   */
  modelId?: string;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

// ── MastraManager ─────────────────────────────────────────────────────────────

export class MastraManager {
  private static instance: MastraManager;

  private mastra: Mastra | null = null;
  private storage: InMemoryStore | null = null;
  private workspaceAgents: Map<string, Agent> = new Map();
  private initialized = false;

  // 싱글톤
  static getInstance(): MastraManager {
    if (!MastraManager.instance) {
      MastraManager.instance = new MastraManager();
    }
    return MastraManager.instance;
  }

  /**
   * Mastra 인스턴스 초기화.
   * 이미 초기화된 경우 즉시 반환(idempotent).
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    this.storage = new InMemoryStore({ id: 'mastra-host-service' });

    this.mastra = new Mastra({
      storage: this.storage,
      workflows: {
        'task-execution': taskExecutionWorkflow,
      },
    });

    this.initialized = true;
    console.log('[mastra-manager] Mastra 초기화 완료 (InMemoryStore)');
  }

  /**
   * workspaceId에 해당하는 Agent를 반환한다.
   * 없으면 config를 사용해 생성하고 Map에 저장한다.
   *
   * @param workspaceId 워크스페이스 식별자 (캐싱 키)
   * @param config      Agent 생성 설정
   */
  async getOrCreateAgent(workspaceId: string, config: AgentConfig): Promise<Agent> {
    if (!this.initialized) {
      await this.initialize();
    }

    const cached = this.workspaceAgents.get(workspaceId);
    if (cached) return cached;

    // Anthropic 크레덴셜 탐색 (Anthropic provider일 때만 활용)
    const credential = await resolveAnthropicCredential();

    // modelConfig 우선, 없으면 레거시 modelId에서 파싱, 최종 fallback은 DEFAULT_MODEL
    const modelConfig: ModelConfig = config.modelConfig ?? parseLegacyModelId(config.modelId);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const model: any = createModel(
      modelConfig,
      // Anthropic provider일 때만 credential을 주입
      modelConfig.provider === 'anthropic' ? credential : null,
    );

    const memory = new MockMemory({
      enableMessageHistory: true,
      enableWorkingMemory: false,
    });

    const agent = new Agent({
      id: config.id,
      name: config.name,
      instructions: config.instructions,
      model,
      memory,
      tools: workspaceTools,
    });

    this.workspaceAgents.set(workspaceId, agent);
    console.log(`[mastra-manager] Agent 생성: workspaceId=${workspaceId}, name=${config.name}`);
    return agent;
  }

  /**
   * workspaceId에 해당하는 Agent를 제거한다.
   */
  async destroyAgent(workspaceId: string): Promise<void> {
    const removed = this.workspaceAgents.delete(workspaceId);
    if (removed) {
      console.log(`[mastra-manager] Agent 제거: workspaceId=${workspaceId}`);
    }
  }

  /**
   * Agent를 통해 스트리밍 응답을 생성한다.
   *
   * @param workspaceId  캐싱된 Agent를 찾을 키
   * @param messages     대화 히스토리 (role + content)
   * @param agentConfig  Agent가 없을 때 새로 생성할 설정 (선택)
   * @returns            텍스트 청크를 emit하는 ReadableStream<string>
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async streamChat(
    workspaceId: string,
    messages: ChatMessage[],
    agentConfig?: AgentConfig,
  ): Promise<import('node:stream/web').ReadableStream<string>> {
    if (!this.initialized) {
      await this.initialize();
    }

    let agent = this.workspaceAgents.get(workspaceId);

    if (!agent) {
      if (!agentConfig) {
        throw new Error(
          `[mastra-manager] workspaceId="${workspaceId}"에 해당하는 Agent가 없습니다. agentConfig를 제공하거나 getOrCreateAgent()를 먼저 호출하세요.`,
        );
      }
      agent = await this.getOrCreateAgent(workspaceId, agentConfig);
    }

    // Mastra Agent.stream()은 MessageListInput을 받는다.
    // ChatMessage[]는 { role, content } 형식으로 CoreMessage-호환이다.
    const result = await agent.stream(messages);

    // MastraModelOutput.textStream은 node:stream/web의 ReadableStream<string>을 반환한다
    return result.textStream as import('node:stream/web').ReadableStream<string>;
  }

  /**
   * 현재 캐시된 workspaceId 목록을 반환한다.
   */
  listWorkspaceIds(): string[] {
    return Array.from(this.workspaceAgents.keys());
  }

  /**
   * Mastra 인스턴스와 모든 Agent를 초기화한다.
   * 프로세스 종료 전 cleanup에 사용.
   */
  async destroy(): Promise<void> {
    this.workspaceAgents.clear();
    this.mastra = null;
    this.storage = null;
    this.initialized = false;
    console.log('[mastra-manager] MastraManager 종료');
  }
}

// 싱글톤 export
export const mastraManager = MastraManager.getInstance();

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * 레거시 'provider/model' 형식 문자열을 ModelConfig로 변환한다.
 *
 * - 'anthropic/claude-sonnet-4.6'  → { provider: 'anthropic', model: 'claude-sonnet-4-6' }
 * - 'openai/gpt-4o'                → { provider: 'openai',    model: 'gpt-4o' }
 * - undefined / 알 수 없는 형식     → DEFAULT_MODEL
 *
 * @deprecated AgentConfig.modelConfig를 사용하세요.
 */
function parseLegacyModelId(modelId?: string): ModelConfig {
  if (!modelId) return DEFAULT_MODEL;

  const slashIdx = modelId.indexOf('/');
  if (slashIdx === -1) return DEFAULT_MODEL;

  const providerPart = modelId.slice(0, slashIdx).toLowerCase();
  const modelPart = modelId.slice(slashIdx + 1);

  if (providerPart === 'anthropic' || providerPart === 'openai') {
    return {
      provider: providerPart as 'anthropic' | 'openai',
      // Mastra 형식에서 쓰이는 점(.) 버전 표기를 대시(-)로 정규화
      model: modelPart.replace(/\./g, '-'),
    };
  }

  return DEFAULT_MODEL;
}
