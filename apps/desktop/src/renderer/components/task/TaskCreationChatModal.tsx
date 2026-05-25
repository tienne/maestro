/**
 * TaskCreationChatModal — AI 채팅으로 태스크를 생성하는 모달
 *
 * 미인증 → 로그인 안내 UI 표시
 * 인증됨 → host-service HTTP tRPC로 멀티턴 채팅
 * session.sendMessage 호출 후 500ms 간격 session.getDisplayState 폴링
 * displayState.currentMessage = 실시간 스트리밍 텍스트
 * displayState.isRunning === false 가 되면 폴링 중단
 * 최종 메시지에서 TASK_JSON_START/END 파싱 → trpc.projectTask.create 호출
 */

import { useState, useRef, useEffect, useCallback } from 'react';
import { trpc } from '../../lib/trpc';
import { useTaskStore } from '../../store/taskStore';
import { useAnthropicAuthStore } from '../../store/anthropicAuthStore';
import { useSettingsStore, DEFAULT_INTERVIEW_SYSTEM_PROMPT } from '../../store/settingsStore';
import { getHostServiceClient } from '../../lib/host-trpc';

// ── 타입 ──────────────────────────────────────────────────────────────────────

interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
}

interface Props {
  projectId: string;
  projectName: string;
  repositoryName: string;
  onClose: () => void;
}

// ── 헬퍼 ──────────────────────────────────────────────────────────────────────

function makeId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function parseTaskJson(content: string): Record<string, unknown> | null {
  const start = content.indexOf('TASK_JSON_START');
  const end = content.indexOf('TASK_JSON_END');
  if (start === -1 || end === -1 || end <= start) return null;

  const raw = content.slice(start + 'TASK_JSON_START'.length, end).trim();
  try {
    return JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
}

// ── 점 세 개 로딩 애니메이션 ───────────────────────────────────────────────────

function TypingIndicator() {
  return (
    <div
      className="flex items-end gap-1 px-3 py-2 rounded-lg self-start max-w-[80%]"
      style={{ backgroundColor: 'var(--bg-secondary)' }}
    >
      <span
        className="w-1.5 h-1.5 rounded-full animate-bounce"
        style={{ backgroundColor: 'var(--text-muted)', animationDelay: '0ms' }}
      />
      <span
        className="w-1.5 h-1.5 rounded-full animate-bounce"
        style={{ backgroundColor: 'var(--text-muted)', animationDelay: '150ms' }}
      />
      <span
        className="w-1.5 h-1.5 rounded-full animate-bounce"
        style={{ backgroundColor: 'var(--text-muted)', animationDelay: '300ms' }}
      />
    </div>
  );
}

// ── 메시지 버블 ───────────────────────────────────────────────────────────────

function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === 'user';
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className="px-3 py-2 rounded-lg text-xs leading-relaxed max-w-[80%] whitespace-pre-wrap break-words"
        style={
          isUser
            ? { backgroundColor: 'var(--accent)', color: '#fff' }
            : { backgroundColor: 'var(--bg-secondary)', color: 'var(--text-primary)' }
        }
      >
        {message.content}
      </div>
    </div>
  );
}

// ── 미인증 뷰 ─────────────────────────────────────────────────────────────────

function UnauthenticatedView({
  projectName,
  onClose,
  onLogin,
  isLoggingIn,
}: {
  projectName: string;
  onClose: () => void;
  onLogin: () => void;
  isLoggingIn: boolean;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ backgroundColor: 'rgba(0,0,0,0.6)' }}
      onClick={onClose}
    >
      <div
        className="flex flex-col rounded-lg border overflow-hidden"
        style={{
          width: '640px',
          maxHeight: '80vh',
          backgroundColor: 'var(--bg-primary)',
          borderColor: 'var(--border)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* 헤더 */}
        <div
          className="flex-shrink-0 flex items-center justify-between px-4 py-3"
          style={{ borderBottom: '1px solid var(--border)' }}
        >
          <div className="flex flex-col gap-0.5">
            <h2 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
              AI로 태스크 생성
            </h2>
            <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
              {projectName}
            </span>
          </div>
          <button
            onClick={onClose}
            className="text-xl leading-none w-7 h-7 flex items-center justify-center rounded transition-colors"
            style={{ color: 'var(--text-muted)' }}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = 'var(--text-primary)';
              e.currentTarget.style.backgroundColor = 'var(--bg-hover)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = 'var(--text-muted)';
              e.currentTarget.style.backgroundColor = 'transparent';
            }}
            aria-label="닫기"
          >
            ×
          </button>
        </div>

        {/* 중앙 콘텐츠 */}
        <div className="flex-1 flex flex-col items-center justify-center gap-4 px-8 py-12">
          {/* 잠금 아이콘 */}
          <div
            className="w-14 h-14 rounded-full flex items-center justify-center"
            style={{ backgroundColor: 'var(--bg-secondary)' }}
          >
            <svg
              width="28"
              height="28"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              style={{ color: 'var(--text-muted)' }}
            >
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
          </div>

          <div className="flex flex-col items-center gap-1 text-center">
            <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
              Anthropic 계정 연결이 필요합니다
            </span>
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
              AI 채팅으로 태스크를 생성하려면 Anthropic 계정으로 로그인하세요.
            </span>
          </div>

          <button
            onClick={onLogin}
            disabled={isLoggingIn}
            className="px-4 py-2 rounded text-xs font-medium transition-colors"
            style={{
              backgroundColor: 'var(--accent)',
              color: '#fff',
              opacity: isLoggingIn ? 0.7 : 1,
            }}
            onMouseEnter={(e) => {
              if (!isLoggingIn) e.currentTarget.style.opacity = '0.85';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.opacity = isLoggingIn ? '0.7' : '1';
            }}
          >
            {isLoggingIn ? '로그인 중...' : 'OAuth로 로그인'}
          </button>
        </div>

        {/* 하단 액션 바 */}
        <div
          className="flex-shrink-0 flex items-center justify-end px-4 py-2"
          style={{ borderTop: '1px solid var(--border)' }}
        >
          <button
            onClick={onClose}
            className="text-xs px-3 py-1.5 rounded transition-colors"
            style={{ color: 'var(--text-secondary)' }}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = 'var(--text-primary)';
              e.currentTarget.style.backgroundColor = 'var(--bg-hover)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = 'var(--text-secondary)';
              e.currentTarget.style.backgroundColor = 'transparent';
            }}
          >
            취소
          </button>
        </div>
      </div>
    </div>
  );
}

// ── TaskCreationChatModal (main) ──────────────────────────────────────────────

export function TaskCreationChatModal({ projectId, projectName, repositoryName, onClose }: Props) {
  const { status, isLoading: authLoading, openOAuth } = useAnthropicAuthStore();
  const addTask = useTaskStore((s) => s.addTask);
  const taskCreationSystemPrompt = useSettingsStore((s) => s.taskCreationSystemPrompt);

  // Settings에서 커스텀 프롬프트를 읽고, {projectName}/{repositoryName} 치환
  const resolvedSystemPrompt = (taskCreationSystemPrompt ?? DEFAULT_INTERVIEW_SYSTEM_PROMPT)
    .replace(/\{projectName\}/g, projectName)
    .replace(/\{repositoryName\}/g, repositoryName);

  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: 'welcome',
      role: 'assistant',
      content: `안녕하세요! **${projectName}** 프로젝트의 새 태스크를 만들어 드릴게요.\n\n만들고 싶은 기능이나 작업을 자유롭게 설명해주세요. 스펙이 명확해지면 "태스크 만들어"라고 입력해주세요.`,
    },
  ]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [streamingContent, setStreamingContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const lastUserMessageRef = useRef<string>('');
  // 컴포넌트 마운트 시 고정 sessionId
  const sessionIdRef = useRef<string>(makeId());
  // polling 중단용 플래그
  const pollingActiveRef = useRef<boolean>(false);

  const createTaskMutation = trpc.projectTask.create.useMutation();

  // 메시지 추가 시 맨 아래 스크롤
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading, streamingContent]);

  // ESC 키 닫기
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  // 언마운트 시 polling 중단
  useEffect(() => {
    return () => {
      pollingActiveRef.current = false;
    };
  }, []);

  // 중단 버튼 핸들러
  const handleStop = useCallback(async () => {
    pollingActiveRef.current = false;
    try {
      const client = await getHostServiceClient();
      await client.session.stop.mutate({ sessionId: sessionIdRef.current });
    } catch {
      // 중단 실패는 무시
    }
    setIsLoading(false);
    setStreamingContent(null);
  }, []);

  // 전송 로직
  const sendMessage = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || isLoading) return;

      const userMsg: ChatMessage = { id: makeId(), role: 'user', content: trimmed };
      setMessages((prev) => [...prev, userMsg]);
      setInput('');
      setIsLoading(true);
      setError(null);
      lastUserMessageRef.current = trimmed;

      // textarea 높이 초기화
      if (textareaRef.current) {
        textareaRef.current.style.height = 'auto';
      }

      try {
        const client = await getHostServiceClient();

        // sendMessage 호출 (프로젝트 컨텍스트가 주입된 system prompt 포함)
        await client.session.sendMessage.mutate({
          sessionId: sessionIdRef.current,
          content: trimmed,
          systemPrompt: resolvedSystemPrompt,
        });

        // 500ms 간격 polling
        let finalContent = '';
        pollingActiveRef.current = true;

        const poll = async () => {
          while (pollingActiveRef.current) {
            const state = await client.session.getDisplayState.query({
              sessionId: sessionIdRef.current,
            });

            // 스트리밍 중 currentMessage를 별도 state로 표시
            if (state.currentMessage) {
              finalContent = state.currentMessage;
              setStreamingContent(state.currentMessage);
            }

            if (!state.isRunning) {
              // 완료 — 마지막 assistant 메시지를 messages에 추가
              const msgs = state.messages as Array<{ role: string; content: string }>;
              const lastMsg = msgs[msgs.length - 1];
              if (lastMsg?.role === 'assistant') {
                finalContent = lastMsg.content;
                setMessages((prev) => [
                  ...prev,
                  { id: makeId(), role: 'assistant', content: lastMsg.content },
                ]);
              }
              setStreamingContent(null);
              pollingActiveRef.current = false;
              break;
            }

            await new Promise<void>((r) => setTimeout(r, 500));
          }
        };

        await poll();

        // TASK_JSON 파싱
        const parsed = parseTaskJson(finalContent);
        if (parsed) {
          await createTaskMutation
            .mutateAsync({
              projectId,
              title: String(parsed.title ?? ''),
              prd: parsed.prd !== undefined ? String(parsed.prd) : undefined,
              spec: parsed.spec !== undefined ? String(parsed.spec) : undefined,
              acceptanceCriteria:
                parsed.acceptanceCriteria !== undefined
                  ? String(parsed.acceptanceCriteria)
                  : undefined,
              priority: (
                ['critical', 'high', 'medium', 'low'].includes(String(parsed.priority))
                  ? parsed.priority
                  : 'medium'
              ) as 'critical' | 'high' | 'medium' | 'low',
              referenceFiles: Array.isArray(parsed.referenceFiles)
                ? (parsed.referenceFiles as string[])
                : [],
              createdBy: 'agent',
            })
            .then((newTask) => {
              addTask(newTask);
              onClose();
            });
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
        setStreamingContent(null);
      } finally {
        setIsLoading(false);
        pollingActiveRef.current = false;
      }
    },
    [isLoading, projectId, createTaskMutation, addTask, onClose]
  );

  // 다시 시도
  const handleRetry = useCallback(() => {
    setError(null);
    if (lastUserMessageRef.current) {
      void sendMessage(lastUserMessageRef.current);
    }
  }, [sendMessage]);

  // 키보드 이벤트 (Enter=전송, Shift+Enter=줄바꿈)
  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void sendMessage(input);
    }
  };

  // textarea 자동 높이 조절 (최대 4줄)
  const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    const el = e.currentTarget;
    el.style.height = 'auto';
    const lineHeight = 20;
    const maxHeight = lineHeight * 4 + 16; // 4줄 + padding
    el.style.height = `${Math.min(el.scrollHeight, maxHeight)}px`;
  };

  const canSend = input.trim().length > 0 && !isLoading;

  // ── 미인증 뷰 ────────────────────────────────────────────────────────────────
  if (status === 'checking') {
    return (
      <div
        className="fixed inset-0 z-50 flex items-center justify-center"
        style={{ backgroundColor: 'rgba(0,0,0,0.6)' }}
        onClick={onClose}
      >
        <div
          className="flex flex-col items-center justify-center gap-3 rounded-lg border p-8"
          style={{
            width: '640px',
            backgroundColor: 'var(--bg-primary)',
            borderColor: 'var(--border)',
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <svg
            className="animate-spin"
            width="24"
            height="24"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            style={{ color: 'var(--text-muted)' }}
          >
            <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
          </svg>
          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
            인증 상태 확인 중...
          </span>
        </div>
      </div>
    );
  }

  if (status === 'unauthenticated' || status === 'expired') {
    return (
      <UnauthenticatedView
        projectName={projectName}
        onClose={onClose}
        onLogin={() => void openOAuth()}
        isLoggingIn={authLoading}
      />
    );
  }

  // ── 채팅 뷰 ──────────────────────────────────────────────────────────────────
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ backgroundColor: 'rgba(0,0,0,0.6)' }}
      onClick={onClose}
    >
      {/* 모달 패널 */}
      <div
        className="flex flex-col rounded-lg border overflow-hidden"
        style={{
          width: '640px',
          maxHeight: '80vh',
          backgroundColor: 'var(--bg-primary)',
          borderColor: 'var(--border)',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── 헤더 ────────────────────────────────────────────────────────── */}
        <div
          className="flex-shrink-0 flex items-center justify-between px-4 py-3"
          style={{ borderBottom: '1px solid var(--border)' }}
        >
          <div className="flex flex-col gap-0.5">
            <h2 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
              AI로 태스크 생성
            </h2>
            <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
              {projectName}
            </span>
          </div>
          <div className="flex items-center gap-2">
            {/* 중단 버튼 (로딩 중에만 표시) */}
            {isLoading && (
              <button
                onClick={() => void handleStop()}
                className="text-xs px-2.5 py-1 rounded flex items-center gap-1.5 transition-colors"
                style={{
                  backgroundColor: 'rgba(248,113,113,0.1)',
                  color: '#f87171',
                  border: '1px solid rgba(248,113,113,0.3)',
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.backgroundColor = 'rgba(248,113,113,0.2)';
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.backgroundColor = 'rgba(248,113,113,0.1)';
                }}
                aria-label="중단"
              >
                <svg
                  width="10"
                  height="10"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                >
                  <rect x="4" y="4" width="16" height="16" rx="2" />
                </svg>
                중단
              </button>
            )}
            <button
              onClick={onClose}
              className="text-xl leading-none w-7 h-7 flex items-center justify-center rounded transition-colors"
              style={{ color: 'var(--text-muted)' }}
              onMouseEnter={(e) => {
                e.currentTarget.style.color = 'var(--text-primary)';
                e.currentTarget.style.backgroundColor = 'var(--bg-hover)';
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.color = 'var(--text-muted)';
                e.currentTarget.style.backgroundColor = 'transparent';
              }}
              aria-label="닫기"
            >
              ×
            </button>
          </div>
        </div>

        {/* ── 메시지 목록 ──────────────────────────────────────────────────── */}
        <div className="flex-1 overflow-y-auto px-4 py-3 flex flex-col gap-3">

          {messages.map((msg) => (
            <MessageBubble key={msg.id} message={msg} />
          ))}

          {/* 스트리밍 중 부분 텍스트 표시, 아니면 TypingIndicator */}
          {streamingContent ? (
            <MessageBubble
              message={{ id: '__streaming__', role: 'assistant', content: streamingContent }}
            />
          ) : isLoading ? (
            <TypingIndicator />
          ) : null}

          {error && (
            <div
              className="rounded px-3 py-2 text-xs flex flex-col gap-2"
              style={{
                backgroundColor: 'rgba(248,113,113,0.1)',
                border: '1px solid rgba(248,113,113,0.3)',
                color: '#f87171',
              }}
            >
              <span>{error}</span>
              <button
                onClick={handleRetry}
                className="self-start px-2 py-1 rounded text-[11px] font-medium transition-colors"
                style={{
                  backgroundColor: 'rgba(248,113,113,0.15)',
                  color: '#f87171',
                  border: '1px solid rgba(248,113,113,0.3)',
                }}
                onMouseEnter={(e) =>
                  (e.currentTarget.style.backgroundColor = 'rgba(248,113,113,0.25)')
                }
                onMouseLeave={(e) =>
                  (e.currentTarget.style.backgroundColor = 'rgba(248,113,113,0.15)')
                }
              >
                다시 시도
              </button>
            </div>
          )}

          <div ref={messagesEndRef} />
        </div>

        {/* ── 입력 영역 ────────────────────────────────────────────────────── */}
        <div
          className="flex-shrink-0 px-4 py-3 flex gap-2 items-end"
          style={{ borderTop: '1px solid var(--border)' }}
        >
          <textarea
            ref={textareaRef}
            value={input}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            placeholder="기능을 설명하세요... (Enter로 전송, Shift+Enter로 줄바꿈)"
            rows={1}
            className="flex-1 rounded px-3 py-2 text-xs outline-none resize-none leading-5 transition-colors"
            style={{
              backgroundColor: 'var(--bg-secondary)',
              color: 'var(--text-primary)',
              border: '1px solid var(--border)',
              minHeight: '36px',
            }}
            onFocus={(e) => (e.currentTarget.style.borderColor = 'var(--accent)')}
            onBlur={(e) => (e.currentTarget.style.borderColor = 'var(--border)')}
          />

          {/* 전송 버튼 */}
          <button
            onClick={() => void sendMessage(input)}
            disabled={!canSend}
            className="flex-shrink-0 w-9 h-9 rounded flex items-center justify-center transition-colors"
            style={{
              backgroundColor: canSend ? 'var(--accent)' : 'var(--bg-hover)',
              color: canSend ? '#fff' : 'var(--text-muted)',
              opacity: canSend ? 1 : 0.5,
            }}
            aria-label="전송"
          >
            {isLoading ? (
              // 스피너
              <svg
                className="animate-spin"
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.5"
              >
                <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
              </svg>
            ) : (
              // 전송 아이콘
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
            )}
          </button>
        </div>

        {/* ── 하단 액션 바 ─────────────────────────────────────────────────── */}
        <div
          className="flex-shrink-0 flex items-center justify-between px-4 py-2"
          style={{ borderTop: '1px solid var(--border)' }}
        >
          <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
            태스크 생성 완료 시 자동으로 저장됩니다
          </span>
          <button
            onClick={onClose}
            className="text-xs px-3 py-1.5 rounded transition-colors"
            style={{ color: 'var(--text-secondary)' }}
            onMouseEnter={(e) => {
              e.currentTarget.style.color = 'var(--text-primary)';
              e.currentTarget.style.backgroundColor = 'var(--bg-hover)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.color = 'var(--text-secondary)';
              e.currentTarget.style.backgroundColor = 'transparent';
            }}
          >
            취소
          </button>
        </div>
      </div>
    </div>
  );
}
