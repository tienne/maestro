import { initTRPC } from '@trpc/server';
import { z } from 'zod';
import superjson from 'superjson';
import type { DisplayState, ChatMessage } from './types';
import { chatRuntime } from './chat-runtime';

const t = initTRPC.create({ transformer: superjson });

const router = t.router;
const publicProcedure = t.procedure;

const sessionRouter = router({
  sendMessage: publicProcedure
    .input(
      z.object({
        sessionId: z.string(),
        content: z.string(),
        systemPrompt: z.string().optional(),
        cwd: z.string().optional(),
      })
    )
    .mutation(async ({ input }): Promise<{ success: boolean }> => {
      await chatRuntime.sendMessage(input.sessionId, input.content, input.systemPrompt);
      return { success: true };
    }),

  getDisplayState: publicProcedure
    .input(
      z.object({
        sessionId: z.string(),
        cwd: z.string().optional(),
      })
    )
    .query(({ input }): DisplayState => {
      return chatRuntime.getDisplayState(input.sessionId);
    }),

  listMessages: publicProcedure
    .input(
      z.object({
        sessionId: z.string(),
        cwd: z.string().optional(),
      })
    )
    .query(({ input }): ChatMessage[] => {
      return chatRuntime.listMessages(input.sessionId);
    }),

  stop: publicProcedure
    .input(z.object({ sessionId: z.string() }))
    .mutation(({ input }): { success: boolean } => {
      chatRuntime.stop(input.sessionId);
      return { success: true };
    }),
});

export const appRouter = router({
  health: publicProcedure.query(() => ({ status: 'ok' as const })),
  session: sessionRouter,
});

export type AppRouter = typeof appRouter;
