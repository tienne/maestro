/**
 * claudeRouter, chatRouter — 원본 router.ts lines 4148-4389
 */

import { router, publicProcedure, TRPCError } from '../trpc';
import { z } from 'zod';
import { observable } from '@trpc/server/observable';
import { v4 as uuidv4 } from 'uuid';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { getDatabaseManager } from '../../db/database';
import Anthropic from '@anthropic-ai/sdk';

const execFileAsync = promisify(execFile);

type ChatMessage = { role: 'user' | 'assistant'; content: string };

async function callViaCLI(messages: ChatMessage[], systemPrompt: string): Promise<string> {
  // 시스템 프롬프트 + 이전 대화 기록을 단일 프롬프트로 조합
  const parts: string[] = [`<system>\n${systemPrompt}\n</system>`];

  if (messages.length > 1) {
    parts.push('\n<conversation_history>');
    for (const m of messages.slice(0, -1)) {
      parts.push(`${m.role === 'user' ? 'Human' : 'Assistant'}: ${m.content}`);
    }
    parts.push('</conversation_history>');
  }

  const last = messages[messages.length - 1];
  if (last) parts.push(`\n${last.content}`);

  const prompt = parts.join('\n');

  const { stdout } = await execFileAsync(
    'claude',
    ['--print', '--model', 'claude-sonnet-4-6', prompt],
    { timeout: 120_000, maxBuffer: 10 * 1024 * 1024 },
  );
  return stdout.trim();
}

const claudeRouter = router({
  chat: publicProcedure
    .input(
      z.object({
        messages: z.array(
          z.object({
            role: z.enum(['user', 'assistant']),
            content: z.string(),
          })
        ),
        systemPrompt: z.string(),
      })
    )
    .mutation(async ({ input }) => {
      const apiKey = process.env.ANTHROPIC_API_KEY;

      // API 키 있으면 SDK 직접 호출, 없으면 Claude Code CLI로 폴백
      if (apiKey) {
        const client = new Anthropic({ apiKey });
        try {
          const response = await client.messages.create({
            model: 'claude-sonnet-4-6',
            max_tokens: 8096,
            system: input.systemPrompt,
            messages: input.messages,
          });
          const textBlock = response.content.find((block) => block.type === 'text');
          return { content: textBlock ? textBlock.text : '' };
        } catch (err) {
          if (err instanceof Anthropic.APIError) {
            throw new TRPCError({
              code: 'INTERNAL_SERVER_ERROR',
              message: `Anthropic API 오류: ${err.message}`,
              cause: err,
            });
          }
          throw new TRPCError({
            code: 'INTERNAL_SERVER_ERROR',
            message: 'Claude API 호출 중 오류가 발생했습니다',
            cause: err,
          });
        }
      }

      // Claude Code CLI 폴백
      try {
        const content = await callViaCLI(input.messages, input.systemPrompt);
        return { content };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        const isNotFound = msg.includes('ENOENT') || msg.includes('not found');
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: isNotFound
            ? 'Claude Code CLI를 찾을 수 없습니다. ANTHROPIC_API_KEY를 설정하거나 Claude Code를 설치해주세요.'
            : `Claude CLI 호출 오류: ${msg}`,
          cause: err,
        });
      }
    }),
});

// ── chatRouter (M12) — 멀티 프로바이더 AI 채팅 ──────────────────────────────────

export const chatRouter = router({
  // 워크스페이스의 채팅 세션 조회 또는 생성
  getOrCreateSession: publicProcedure
    .input(z.object({
      workspaceId: z.string(),
      provider: z.enum(['anthropic', 'openai', 'google']),
      model: z.string(),
    }))
    .mutation(({ input }) => {
      const db = getDatabaseManager().getDb();
      const existing = db.prepare(
        `SELECT * FROM chat_sessions WHERE workspace_id = ? AND provider = ? AND model = ? ORDER BY updated_at DESC LIMIT 1`,
      ).get(input.workspaceId, input.provider, input.model) as {
        id: string; workspace_id: string; provider: string; model: string; created_at: string; updated_at: string
      } | undefined;
      if (existing) {
        return {
          id: existing.id,
          workspaceId: existing.workspace_id,
          provider: existing.provider as import('@maestro/shared-types').ChatProvider,
          model: existing.model,
          createdAt: existing.created_at,
          updatedAt: existing.updated_at,
        };
      }
      const id = uuidv4();
      const now = new Date().toISOString();
      db.prepare(
        `INSERT INTO chat_sessions (id, workspace_id, provider, model, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
      ).run(id, input.workspaceId, input.provider, input.model, now, now);
      return {
        id,
        workspaceId: input.workspaceId,
        provider: input.provider as import('@maestro/shared-types').ChatProvider,
        model: input.model,
        createdAt: now,
        updatedAt: now,
      };
    }),

  listMessages: publicProcedure
    .input(z.object({ sessionId: z.string(), limit: z.number().default(50) }))
    .query(({ input }) => {
      const db = getDatabaseManager().getDb();
      const rows = db.prepare(
        `SELECT * FROM chat_messages WHERE session_id = ? ORDER BY created_at ASC LIMIT ?`,
      ).all(input.sessionId, input.limit) as Array<{
        id: string; session_id: string; role: string; content: string; provider: string; model: string; created_at: string
      }>;
      return rows.map((r) => ({
        id: r.id,
        sessionId: r.session_id,
        role: r.role as 'user' | 'assistant',
        content: r.content,
        provider: r.provider as import('@maestro/shared-types').ChatProvider,
        model: r.model,
        createdAt: r.created_at,
      }));
    }),

  clearSession: publicProcedure
    .input(z.object({ sessionId: z.string() }))
    .mutation(({ input }) => {
      const db = getDatabaseManager().getDb();
      db.prepare(`DELETE FROM chat_messages WHERE session_id = ?`).run(input.sessionId);
      return { success: true };
    }),

  stream: publicProcedure
    .input(z.object({
      sessionId: z.string(),
      provider: z.enum(['anthropic', 'openai', 'google']),
      model: z.string(),
      messages: z.array(z.object({ role: z.enum(['user', 'assistant']), content: z.string() })),
      accessToken: z.string(),
    }))
    .subscription(({ input }) => {
      return observable<
        | { type: 'delta'; text: string }
        | { type: 'done'; fullText: string }
        | { type: 'error'; message: string }
      >((emit) => {
        const db = getDatabaseManager().getDb();

        // 마지막 user 메시지 DB 저장
        const lastMsg = input.messages[input.messages.length - 1];
        if (lastMsg?.role === 'user') {
          db.prepare(
            `INSERT INTO chat_messages (id, session_id, role, content, provider, model, created_at) VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`,
          ).run(uuidv4(), input.sessionId, 'user', lastMsg.content, input.provider, input.model);
        }

        let aborted = false;
        let fullText = '';

        const run = async (): Promise<void> => {
          try {
            const { streamText } = await import('ai');
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            let providerInstance: any;

            if (input.provider === 'anthropic') {
              const { createAnthropic } = await import('@ai-sdk/anthropic');
              providerInstance = createAnthropic({ apiKey: input.accessToken });
            } else if (input.provider === 'openai') {
              const { createOpenAI } = await import('@ai-sdk/openai');
              providerInstance = createOpenAI({ apiKey: input.accessToken });
            } else {
              const { createGoogleGenerativeAI } = await import('@ai-sdk/google');
              providerInstance = createGoogleGenerativeAI({ apiKey: input.accessToken });
            }

            const result = streamText({
              model: providerInstance(input.model),
              messages: input.messages,
            });

            for await (const delta of result.textStream) {
              if (aborted) break;
              fullText += delta;
              emit.next({ type: 'delta', text: delta });
            }

            if (!aborted) {
              // assistant 응답 DB 저장
              db.prepare(
                `INSERT INTO chat_messages (id, session_id, role, content, provider, model, created_at) VALUES (?, ?, ?, ?, ?, ?, datetime('now'))`,
              ).run(uuidv4(), input.sessionId, 'assistant', fullText, input.provider, input.model);
              // session updated_at 갱신
              db.prepare(`UPDATE chat_sessions SET updated_at = datetime('now') WHERE id = ?`).run(input.sessionId);
              emit.next({ type: 'done', fullText });
              emit.complete();
            }
          } catch (err) {
            emit.next({ type: 'error', message: err instanceof Error ? err.message : String(err) });
            emit.complete();
          }
        };

        void run();
        return () => { aborted = true; };
      });
    }),
});

export { claudeRouter };
