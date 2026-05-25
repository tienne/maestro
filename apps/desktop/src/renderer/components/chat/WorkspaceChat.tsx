/**
 * WorkspaceChat — @assistant-ui/react 기반 AI 채팅 패널
 *
 * useLocalRuntime + ChatModelAdapter 패턴으로 trpc.claude.chat.mutate를
 * assistant-ui 런타임에 연결한다.
 *
 * ThreadPrimitive로 메시지 목록/입력 UI를 직접 구성.
 * 기존 터미널 UI를 건드리지 않도록 독립 컴포넌트로 분리.
 */

import { useRef, useMemo } from 'react';
import {
  AssistantRuntimeProvider,
  useLocalRuntime,
  ThreadPrimitive,
  ComposerPrimitive,
  MessagePrimitive,
  type ChatModelAdapter,
  type ChatModelRunOptions,
} from '@assistant-ui/react';
import { trpc } from '../../lib/trpc';

// ── tRPC 기반 ChatModelAdapter ────────────────────────────────────────────────

/**
 * useTrpcChatAdapter — trpc.claude.chat.mutate를 ChatModelAdapter.run에 연결.
 *
 * trpc 뮤테이션 함수는 매 렌더에서 안정적인 레퍼런스가 아닐 수 있어 ref로 보관하고,
 * adapter 객체 자체는 useMemo로 안정화한다.
 */
function useTrpcChatAdapter(): ChatModelAdapter {
  const chatMutation = trpc.claude.chat.useMutation();
  const mutateRef = useRef(chatMutation.mutateAsync);
  mutateRef.current = chatMutation.mutateAsync;

  return useMemo<ChatModelAdapter>(
    () => ({
      async run(options: ChatModelRunOptions) {
        const { messages, abortSignal } = options;

        // ThreadMessage 배열 → claude.chat 입력 형식으로 변환
        const chatMessages = messages
          .filter((m) => m.role === 'user' || m.role === 'assistant')
          .map((m) => {
            const textPart = (m.content as Array<{ type: string; text?: string }>).find(
              (p) => p.type === 'text',
            );
            return {
              role: m.role as 'user' | 'assistant',
              content: textPart?.text ?? '',
            };
          })
          .filter((m) => m.content.length > 0);

        if (abortSignal.aborted) throw new Error('Aborted');

        const result = await mutateRef.current({
          messages: chatMessages,
          systemPrompt:
            'You are a helpful AI assistant integrated into Maestro, a developer workspace tool. Help the user with coding tasks, debugging, and project management.',
        });

        return {
          content: [{ type: 'text' as const, text: result.content }],
        };
      },
    }),
    [],
  );
}

// ── 메시지 컴포넌트들 ──────────────────────────────────────────────────────────

function UserMessage() {
  return (
    <MessagePrimitive.Root className="flex justify-end mb-3">
      <div
        className="px-3 py-2 rounded-lg text-xs leading-relaxed max-w-[80%] whitespace-pre-wrap break-words"
        style={{ backgroundColor: 'var(--accent)', color: '#fff' }}
      >
        <MessagePrimitive.Content />
      </div>
    </MessagePrimitive.Root>
  );
}

function AssistantMessage() {
  return (
    <MessagePrimitive.Root className="flex justify-start mb-3">
      <div
        className="px-3 py-2 rounded-lg text-xs leading-relaxed max-w-[80%] whitespace-pre-wrap break-words"
        style={{
          backgroundColor: 'var(--bg-secondary)',
          color: 'var(--text-primary)',
        }}
      >
        <MessagePrimitive.Content />
      </div>
    </MessagePrimitive.Root>
  );
}

// ── 입력창 ───────────────────────────────────────────────────────────────────

function ChatComposer() {
  return (
    <div
      className="flex-shrink-0 px-3 py-2 flex gap-2 items-end"
      style={{ borderTop: '1px solid var(--border)' }}
    >
      <ComposerPrimitive.Input
        placeholder="메시지를 입력하세요... (Enter로 전송)"
        className="flex-1 rounded px-3 py-2 text-xs outline-none resize-none leading-5 min-h-[36px] max-h-[120px]"
        style={{
          backgroundColor: 'var(--bg-secondary)',
          color: 'var(--text-primary)',
          border: '1px solid var(--border)',
        }}
        onFocus={(e) => (e.currentTarget.style.borderColor = 'var(--accent)')}
        onBlur={(e) => (e.currentTarget.style.borderColor = 'var(--border)')}
      />

      {/* 실행 중 취소 버튼 */}
      <ComposerPrimitive.Cancel asChild>
        <button
          className="flex-shrink-0 w-9 h-9 rounded flex items-center justify-center transition-colors"
          style={{ backgroundColor: 'rgba(248,113,113,0.15)', color: '#f87171' }}
          aria-label="중단"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
            <rect x="4" y="4" width="16" height="16" rx="2" />
          </svg>
        </button>
      </ComposerPrimitive.Cancel>

      {/* 전송 버튼 */}
      <ComposerPrimitive.Send asChild>
        <button
          className="flex-shrink-0 w-9 h-9 rounded flex items-center justify-center transition-colors"
          style={{ backgroundColor: 'var(--accent)', color: '#fff' }}
          aria-label="전송"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <line x1="22" y1="2" x2="11" y2="13" />
            <polygon points="22 2 15 22 11 13 2 9 22 2" />
          </svg>
        </button>
      </ComposerPrimitive.Send>
    </div>
  );
}

// ── 빈 상태 ──────────────────────────────────────────────────────────────────

function EmptyState() {
  return (
    <ThreadPrimitive.Empty>
      <div className="flex flex-col items-center justify-center h-full gap-3 py-8 text-center px-4">
        <div className="text-3xl opacity-15" style={{ color: 'var(--text-muted)' }}>
          AI
        </div>
        <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
          궁금한 것이 있으면 물어보세요.
          <br />
          코딩, 디버깅, 프로젝트 관리를 도와드립니다.
        </div>
      </div>
    </ThreadPrimitive.Empty>
  );
}

// ── WorkspaceChatInner (런타임 초기화 후 렌더) ────────────────────────────────

function WorkspaceChatInner() {
  return (
    <div className="flex flex-col h-full min-h-0" style={{ backgroundColor: 'var(--bg-primary)' }}>
      {/* 헤더 */}
      <div
        className="flex-shrink-0 flex items-center px-3 py-2"
        style={{ borderBottom: '1px solid var(--border)' }}
      >
        <span className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>
          AI 채팅
        </span>
      </div>

      {/* 메시지 목록 */}
      <ThreadPrimitive.Viewport className="flex-1 overflow-y-auto px-3 py-3">
        <EmptyState />
        <ThreadPrimitive.Messages
          components={{
            UserMessage,
            AssistantMessage,
          }}
        />
      </ThreadPrimitive.Viewport>

      {/* 입력창 */}
      <ChatComposer />
    </div>
  );
}

// ── WorkspaceChat (public export) ─────────────────────────────────────────────

interface WorkspaceChatProps {
  workspaceId: string;
}

export function WorkspaceChat({ workspaceId: _workspaceId }: WorkspaceChatProps) {
  const adapter = useTrpcChatAdapter();
  const runtime = useLocalRuntime(adapter);

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <WorkspaceChatInner />
    </AssistantRuntimeProvider>
  );
}
