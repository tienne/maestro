import { TRPCError } from '@trpc/server';
import { createAnthropic } from '@ai-sdk/anthropic';
import { streamText } from 'ai';
import { resolveAnthropicCredential } from './credential';
import type { ChatMessage, DisplayState, SessionState } from './types';

// AbortController를 sessionId로 관리하는 별도 Map
const controllers = new Map<string, AbortController>();

function getOrCreateSession(sessions: Map<string, SessionState>, sessionId: string): SessionState {
  let session = sessions.get(sessionId);
  if (!session) {
    session = {
      sessionId,
      messages: [],
      isRunning: false,
      currentPartial: '',
    };
    sessions.set(sessionId, session);
  }
  return session;
}

export class ChatRuntimeService {
  private sessions = new Map<string, SessionState>();

  async sendMessage(sessionId: string, content: string, systemPrompt?: string): Promise<void> {
    const credential = await resolveAnthropicCredential();
    if (!credential) {
      throw new TRPCError({
        code: 'UNAUTHORIZED',
        message: 'Anthropic 크레덴셜을 찾을 수 없습니다. Claude CLI 설정 또는 API 키를 확인해주세요.',
      });
    }

    const session = getOrCreateSession(this.sessions, sessionId);

    if (session.isRunning) {
      throw new TRPCError({
        code: 'CONFLICT',
        message: '이미 메시지를 처리 중입니다. 완료 후 다시 시도해주세요.',
      });
    }

    // 사용자 메시지를 히스토리에 추가
    const userMessage: ChatMessage = {
      role: 'user',
      content,
      timestamp: Date.now(),
    };
    session.messages.push(userMessage);
    session.isRunning = true;
    session.currentPartial = '';

    // AbortController 생성
    const controller = new AbortController();
    controllers.set(sessionId, controller);

    try {
      const anthropic = createAnthropic({
        apiKey: credential.access,
        ...(credential.type === 'oauth'
          ? { baseURL: 'https://api.anthropic.com/v1' }
          : {}),
      });

      // AI SDK 메시지 히스토리 형식으로 변환 (사용자 메시지 포함)
      const history = session.messages.map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      }));

      const result = streamText({
        model: anthropic('claude-sonnet-4-6'),
        system: systemPrompt,
        messages: history,
        abortSignal: controller.signal,
      });

      let partial = '';
      for await (const delta of result.textStream) {
        partial += delta;
        session.currentPartial = partial;
      }

      const fullText = await result.text;

      // AI 응답을 히스토리에 추가
      const assistantMessage: ChatMessage = {
        role: 'assistant',
        content: fullText,
        timestamp: Date.now(),
      };
      session.messages.push(assistantMessage);
    } catch (err) {
      // AbortError는 stop() 호출에 의한 정상 중단
      if (
        err instanceof Error &&
        (err.name === 'AbortError' || err.message.includes('abort'))
      ) {
        // currentPartial이 있으면 부분 응답을 저장
        if (session.currentPartial) {
          const partialMessage: ChatMessage = {
            role: 'assistant',
            content: session.currentPartial + ' [중단됨]',
            timestamp: Date.now(),
          };
          session.messages.push(partialMessage);
        }
      } else {
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: err instanceof Error ? err.message : '알 수 없는 오류가 발생했습니다.',
          cause: err,
        });
      }
    } finally {
      session.isRunning = false;
      session.currentPartial = '';
      controllers.delete(sessionId);
    }
  }

  getDisplayState(sessionId: string): DisplayState {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return {
        isRunning: false,
        currentMessage: null,
        messages: [],
      };
    }

    return {
      isRunning: session.isRunning,
      currentMessage: session.isRunning && session.currentPartial
        ? session.currentPartial
        : null,
      messages: [...session.messages],
    };
  }

  listMessages(sessionId: string): ChatMessage[] {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return [];
    }
    return [...session.messages];
  }

  stop(sessionId: string): void {
    const controller = controllers.get(sessionId);
    if (controller) {
      controller.abort();
    }

    // isRunning 상태도 즉시 반영
    const session = this.sessions.get(sessionId);
    if (session) {
      session.isRunning = false;
    }
  }
}

// 싱글톤 인스턴스
export const chatRuntime = new ChatRuntimeService();
