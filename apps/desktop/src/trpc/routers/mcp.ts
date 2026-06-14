/**
 * mcpRouter — 원본 router.ts lines 2845-2956
 */

import { router, publicProcedure } from '../trpc';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { getDatabaseManager } from '../../db/database';
import * as schema from '../../db/schema';
import { eq, asc } from 'drizzle-orm';
import { checkSocketConnection } from './_shared';

export const mcpRouter = router({
  list: publicProcedure.query(() => {
    const drizzle = getDatabaseManager().drizzle;
    return drizzle
      .select()
      .from(schema.mcpServers)
      .orderBy(asc(schema.mcpServers.createdAt))
      .all()
      .map((row) => ({
        id: row.id, name: row.name, url: row.url,
        enabled: row.enabled, status: row.status as 'connected' | 'offline' | 'error',
        errorMsg: row.errorMsg, createdAt: row.createdAt,
      }));
  }),

  add: publicProcedure
    .input(z.object({ name: z.string().min(1), url: z.string().url() }))
    .mutation(({ input }) => {
      const drizzle = getDatabaseManager().drizzle;
      const id = uuidv4();
      drizzle.insert(schema.mcpServers).values({ id, name: input.name, url: input.url }).run();
      const [row] = drizzle.select().from(schema.mcpServers).where(eq(schema.mcpServers.id, id)).all();
      return {
        id: row.id, name: row.name, url: row.url,
        enabled: row.enabled, status: row.status as 'connected' | 'offline' | 'error',
        errorMsg: row.errorMsg, createdAt: row.createdAt,
      };
    }),

  delete: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(({ input }) => {
      const drizzle = getDatabaseManager().drizzle;
      drizzle.delete(schema.mcpServers).where(eq(schema.mcpServers.id, input.id)).run();
    }),

  toggle: publicProcedure
    .input(z.object({ id: z.string(), enabled: z.boolean() }))
    .mutation(({ input }) => {
      const drizzle = getDatabaseManager().drizzle;
      drizzle.update(schema.mcpServers)
        .set({ enabled: input.enabled })
        .where(eq(schema.mcpServers.id, input.id))
        .run();
      const [row] = drizzle.select().from(schema.mcpServers).where(eq(schema.mcpServers.id, input.id)).all();
      return {
        id: row.id, name: row.name, url: row.url,
        enabled: row.enabled, status: row.status as 'connected' | 'offline' | 'error',
        errorMsg: row.errorMsg, createdAt: row.createdAt,
      };
    }),

  updateStatus: publicProcedure
    .input(
      z.object({
        id: z.string(),
        status: z.enum(['connected', 'offline', 'error']),
        errorMsg: z.string().nullable(),
      })
    )
    .mutation(({ input }) => {
      const drizzle = getDatabaseManager().drizzle;
      drizzle.update(schema.mcpServers)
        .set({ status: input.status, errorMsg: input.errorMsg })
        .where(eq(schema.mcpServers.id, input.id))
        .run();
      const [row] = drizzle.select().from(schema.mcpServers).where(eq(schema.mcpServers.id, input.id)).all();
      return {
        id: row.id, name: row.name, url: row.url,
        enabled: row.enabled, status: row.status as 'connected' | 'offline' | 'error',
        errorMsg: row.errorMsg, createdAt: row.createdAt,
      };
    }),

  checkServers: publicProcedure.mutation(async () => {
    const drizzle = getDatabaseManager().drizzle;
    const servers = drizzle
      .select()
      .from(schema.mcpServers)
      .where(eq(schema.mcpServers.enabled, true))
      .all();

    const results = await Promise.all(
      servers.map(async (server) => {
        try {
          const url = new URL(server.url);
          const host = url.hostname;
          const port = parseInt(url.port || '80', 10);
          const connected = await checkSocketConnection(host, port);
          const status = connected ? 'connected' : 'offline';
          drizzle.update(schema.mcpServers)
            .set({ status, errorMsg: null })
            .where(eq(schema.mcpServers.id, server.id))
            .run();
        } catch (err) {
          drizzle.update(schema.mcpServers)
            .set({ status: 'error', errorMsg: String(err) })
            .where(eq(schema.mcpServers.id, server.id))
            .run();
        }
        const [row] = drizzle.select().from(schema.mcpServers).where(eq(schema.mcpServers.id, server.id)).all();
        return {
          id: row.id, name: row.name, url: row.url,
          enabled: row.enabled, status: row.status as 'connected' | 'offline' | 'error',
          errorMsg: row.errorMsg, createdAt: row.createdAt,
        };
      })
    );

    return results;
  }),
});
