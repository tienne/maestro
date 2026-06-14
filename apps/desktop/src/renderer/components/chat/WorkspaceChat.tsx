/**
 * WorkspaceChat — 멀티 프로바이더 AI 채팅 패널
 *
 * - ModelSelector로 프로바이더(Anthropic/OpenAI/Google) 및 모델 선택
 * - trpc.chat.stream.useSubscription으로 스트리밍 응답 수신
 * - trpc.chat.getOrCreateSession / listMessages로 세션 및 이력 관리
 * - chatProviderStore로 OAuth 인증 상태 관리
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import { skipToken } from '@tanstack/react-query';
import { trpc } from '../../lib/trpc';
import { ModelSelector } from './ModelSelector';
import { handleOAuthResult, getAccessToken } from '../../store/chatProviderStore';
import { useSettingsStore } from '../../store/settingsStore';
import { CHAT_MODELS, type ChatProvider, type ChatMessage } from '@maestro/shared-types';

// ── 스트리밍 입력 타입 (실제 chatRouter.stream input과 일치) ─────────────────────

interface StreamInput {
  sessionId: string;
  provider: ChatProvider;
  model: string;
  messages: Array<{ role: 'user' | 'assistant'; content: string }>;
  accessToken: string;
}

// ── 스트리밍 이벤트 타입 ────────────────────────────────────────────────────────

interface StreamDelta {
  type: 'delta';
  text: string;
}

interface StreamDone {
  type: 'done';
  fullText: string;
}

interface StreamError {
  type: 'error';
  message: string;
}

type StreamEvent = StreamDelta | StreamDone | StreamError;

// ── 기본 모델 fallback ──────────────────────────────────────────────────────────

const DEFAULT_PROVIDER: ChatProvider = 'anthropic';
const DEFAULT_MODEL = CHAT_MODELS.find((m) => m.provider === 'anthropic')?.id ?? 'claude-sonnet-4-5-20251022';

// tRPC subscription은 skipToken 미지원 — enabled 패턴용 더미 입력값
const NOOP_STREAM_INPUT: StreamInput = {
  sessionId: '__noop__',
  provider: 'anthropic',
  model: '',
  messages: [],
  accessToken: '',
};

// ── 메시지 버블 컴포넌트들 ─────────────────────────────────────────────────────

function UserBubble({ content }: { content: string }) {
  return (
    <div className="flex justify-end mb-3">
      <div
        className="px-3 py-2 rounded-lg text-xs leading-relaxed max-w-[80%] whitespace-pre-wrap break-words"
        style={{ backgroundColor: 'var(--accent)', color: '#fff' }}
      >
        {content}
      </div>
    </div>
  );
}

function AssistantBubble({ content }: { content: string }) {
  return (
    <div className="flex justify-start mb-3">
      <div
        className="px-3 py-2 rounded-lg text-xs leading-relaxed max-w-[80%] whitespace-pre-wrap break-words"
        style={{
          backgroundColor: 'var(--bg-secondary)',
          color: 'var(--text-primary)',
          border: '1px solid var(--border)',
        }}
      >
        {content}
      </div>
    </div>
  );
}

function StreamingBubble({ text }: { text: string }) {
  return (
    <div className="flex justify-start mb-3">
      <div
        className="px-3 py-2 rounded-lg text-xs leading-relaxed max-w-[80%] whitespace-pre-wrap break-words"
        style={{
          backgroundColor: 'var(--bg-secondary)',
          color: 'var(--text-primary)',
          border: '1px solid var(--border)',
        }}
      >
        {text}
        <span
          className="inline-block w-1.5 h-3 ml-0.5 animate-pulse"
          style={{ backgroundColor: 'var(--accent)' }}
        />
      </div>
    </div>
  );
}

// ── 빈 상태 ──────────────────────────────────────────────────────────────────

function EmptyState() {
  return (
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
  );
}

// ── WorkspaceChat (public export) ─────────────────────────────────────────────

interface WorkspaceChatProps {
  workspaceId: string;
}

export function WorkspaceChat({ workspaceId }: WorkspaceChatProps) {
  // ── 프로바이더/모델 상태 (settingsStore 연동) ─────────────────────────────────
  const savedProvider = useSettingsStore((s) => s.lastChatProvider);
  const setSavedProvider = useSettingsStore((s) => s.setLastChatProvider);
  const savedModel = useSettingsStore((s) => s.lastChatModel);
  const setSavedModel = useSettingsStore((s) => s.setLastChatModel);

  const [selectedProvider, setSelectedProvider] = useState<ChatProvider>(
    (savedProvider as ChatProvider | undefined) ?? DEFAULT_PROVIDER
  );
  const [selectedModel, setSelectedModel] = useState<string>(savedModel ?? DEFAULT_MODEL);

  // ── 채팅 세션 ─────────────────────────────────────────────────────────────────
  const [chatSessionId, setChatSessionId] = useState<string | null>(null);

  // ── 메시지 & 스트리밍 상태 ────────────────────────────────────────────────────
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [streamingText, setStreamingText] = useState<string>('');
  const [streamInput, setStreamInput] = useState<StreamInput | null>(null);
  const [inputText, setInputText] = useState('');
  const [isSending, setIsSending] = useState(false);

  // ── 스크롤 ────────────────────────────────────────────────────────────────────
  const viewportRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = useCallback(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, streamingText, scrollToBottom]);

  // ── tRPC — 채팅 세션 조회 또는 생성 ──────────────────────────────────────────────
  const getOrCreateSessionMutation = trpc.chat.getOrCreateSession.useMutation({
    onSuccess: (session) => {
      setChatSessionId(session.id);
    },
  });

  // ── tRPC — 메시지 목록 조회 ────────────────────────────────────────────────────
  const { data: historyMessages } = trpc.chat.listMessages.useQuery(
    chatSessionId ? { sessionId: chatSessionId, limit: 100 } : skipToken
  );

  useEffect(() => {
    if (historyMessages) {
      setMessages(historyMessages);
    }
  }, [historyMessages]);

  // ── tRPC — 스트리밍 subscription ──────────────────────────────────────────────
  // useSubscription은 skipToken 미지원 — 더미 입력값 + enabled 패턴 사용
  trpc.chat.stream.useSubscription(streamInput ?? NOOP_STREAM_INPUT, {
    enabled: streamInput !== null,
    onData(data: unknown) {
      const event = data as StreamEvent;
      if (event.type === 'delta') {
        setStreamingText((prev) => prev + event.text);
      } else if (event.type === 'done') {
        const assistantMessage: ChatMessage = {
          id: crypto.randomUUID(),
          sessionId: chatSessionId ?? '',
          role: 'assistant',
          content: event.fullText,
          provider: selectedProvider,
          model: selectedModel,
          createdAt: new Date().toISOString(),
        };
        setMessages((prev) => [...prev, assistantMessage]);
        setStreamingText('');
        setStreamInput(null);
        setIsSending(false);
      } else if (event.type === 'error') {
        setStreamingText('');
        setStreamInput(null);
        setIsSending(false);
        console.error('Chat stream error:', event.message);
      }
    },
    onError(error) {
      setStreamingText('');
      setStreamInput(null);
      setIsSending(false);
      console.error('Chat subscription error:', error);
    },
  });

  // ── OAuth 결과 IPC 이벤트 수신 ────────────────────────────────────────────────
  useEffect(() => {
    const cleanup = window.electronAPI?.onEvent(
      'chat:oauth:result',
      (payload: unknown) => {
        const p = payload as { provider: ChatProvider; success: boolean };
        handleOAuthResult(p.provider, p.success);
      }
    );
    return () => {
      if (typeof cleanup === 'function') cleanup();
    };
  }, []);

  // ── 프로바이더/모델 선택 핸들러 ────────────────────────────────────────────────
  const handleProviderModelSelect = useCallback(
    (provider: ChatProvider, modelId: string) => {
      setSelectedProvider(provider);
      setSelectedModel(modelId);
      setSavedProvider(provider);
      setSavedModel(modelId);
      // 프로바이더 변경 시 세션 초기화
      setChatSessionId(null);
      setMessages([]);
      setStreamingText('');
      setStreamInput(null);
    },
    [setSavedProvider, setSavedModel]
  );

  // ── 메시지 전송 ────────────────────────────────────────────────────────────────
  const handleSend = useCallback(async () => {
    const text = inputText.trim();
    if (!text || isSending) return;

    setInputText('');
    setIsSending(true);

    // 세션이 없으면 조회 또는 생성
    let activeSessionId = chatSessionId;
    if (!activeSessionId) {
      try {
        const session = await getOrCreateSessionMutation.mutateAsync({
          workspaceId,
          provider: selectedProvider,
          model: selectedModel,
        });
        activeSessionId = session.id;
        setChatSessionId(session.id);
      } catch (err) {
        console.error('Failed to get or create chat session:', err);
        setIsSending(false);
        return;
      }
    }

    // 사용자 메시지를 로컬 상태에 즉시 추가
    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      sessionId: activeSessionId,
      role: 'user',
      content: text,
      provider: selectedProvider,
      model: selectedModel,
      createdAt: new Date().toISOString(),
    };
    const nextMessages = [...messages, userMessage];
    setMessages(nextMessages);

    // accessToken 획득
    let accessToken = '';
    try {
      if (selectedProvider === 'anthropic') {
        // anthropic은 Electron 네이티브 인증 — 빈 토큰으로 서버가 처리
        accessToken = '';
      } else {
        accessToken = (await getAccessToken(selectedProvider)) ?? '';
      }
    } catch {
      // 토큰 획득 실패 시 빈 문자열로 진행 (서버에서 오류 응답)
    }

    // subscription 활성화 (실제 chatRouter.stream input shape에 맞게)
    setStreamInput({
      sessionId: activeSessionId,
      provider: selectedProvider,
      model: selectedModel,
      messages: nextMessages.map((m) => ({ role: m.role, content: m.content })),
      accessToken,
    });
  }, [
    inputText,
    isSending,
    chatSessionId,
    messages,
    workspaceId,
    selectedProvider,
    selectedModel,
    getOrCreateSessionMutation,
  ]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        void handleSend();
      }
    },
    [handleSend]
  );

  // ── 렌더 ──────────────────────────────────────────────────────────────────────

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

      {/* 모델 선택 */}
      <ModelSelector
        selectedProvider={selectedProvider}
        selectedModel={selectedModel}
        onSelect={handleProviderModelSelect}
      />

      {/* 메시지 목록 */}
      <div
        ref={viewportRef}
        className="flex-1 overflow-y-auto px-3 py-3 min-h-0"
      >
        {messages.length === 0 && !streamingText && <EmptyState />}

        {messages.map((msg) =>
          msg.role === 'user' ? (
            <UserBubble key={msg.id} content={msg.content} />
          ) : (
            <AssistantBubble key={msg.id} content={msg.content} />
          )
        )}

        {streamingText && <StreamingBubble text={streamingText} />}

        <div ref={bottomRef} />
      </div>

      {/* 입력창 */}
      <div
        className="flex-shrink-0 px-3 py-2 flex gap-2 items-end"
        style={{ borderTop: '1px solid var(--border)' }}
      >
        <textarea
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="메시지를 입력하세요... (Enter로 전송, Shift+Enter 줄바꿈)"
          disabled={isSending}
          rows={1}
          className="flex-1 rounded px-3 py-2 text-xs outline-none resize-none leading-5 min-h-[36px] max-h-[120px] disabled:opacity-50"
          style={{
            backgroundColor: 'var(--bg-secondary)',
            color: 'var(--text-primary)',
            border: '1px solid var(--border)',
          }}
          onFocus={(e) => (e.currentTarget.style.borderColor = 'var(--accent)')}
          onBlur={(e) => (e.currentTarget.style.borderColor = 'var(--border)')}
        />

        {/* 전송 중 취소 버튼 */}
        {isSending && (
          <button
            onClick={() => {
              setStreamInput(null);
              setStreamingText('');
              setIsSending(false);
            }}
            className="flex-shrink-0 w-9 h-9 rounded flex items-center justify-center transition-colors"
            style={{ backgroundColor: 'rgba(248,113,113,0.15)', color: '#f87171' }}
            aria-label="중단"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
              <rect x="4" y="4" width="16" height="16" rx="2" />
            </svg>
          </button>
        )}

        {/* 전송 버튼 */}
        {!isSending && (
          <button
            onClick={() => void handleSend()}
            disabled={!inputText.trim()}
            className="flex-shrink-0 w-9 h-9 rounded flex items-center justify-center transition-colors disabled:opacity-40"
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
        )}
      </div>
    </div>
  );
}
