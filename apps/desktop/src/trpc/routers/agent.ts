/**
 * agentRouter — 원본 router.ts lines 2090-2210
 */

import { router, publicProcedure } from '../trpc';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { getDatabaseManager } from '../../db/database';
import * as schema from '../../db/schema';
import { eq, asc, desc } from 'drizzle-orm';

export const agentRouter = router({
  list: publicProcedure.query(() => {
    const drizzle = getDatabaseManager().drizzle;
    return drizzle
      .select()
      .from(schema.agents)
      .orderBy(desc(schema.agents.isBuiltIn), asc(schema.agents.name))
      .all()
      .map((row) => ({
        id: row.id,
        name: row.name,
        command: row.command,
        args: JSON.parse(row.args) as string[],
        env: JSON.parse(row.env) as Record<string, string>,
        isBuiltIn: row.isBuiltIn,
        scriptPath: row.scriptPath ?? null,
        scriptContent: row.scriptContent ?? null,
      }));
  }),

  create: publicProcedure
    .input(
      z.object({
        name: z.string().min(1),
        command: z.string().min(1),
        args: z.array(z.string()),
        env: z.record(z.string(), z.string()),
        scriptPath: z.string().nullable().optional(),
        scriptContent: z.string().nullable().optional(),
      })
    )
    .mutation(({ input }) => {
      const drizzle = getDatabaseManager().drizzle;
      const id = uuidv4();
      drizzle.insert(schema.agents).values({
        id,
        name: input.name,
        command: input.command,
        args: JSON.stringify(input.args),
        env: JSON.stringify(input.env),
        isBuiltIn: false,
        scriptPath: input.scriptPath ?? null,
        scriptContent: input.scriptContent ?? null,
      }).run();
      const [row] = drizzle.select().from(schema.agents).where(eq(schema.agents.id, id)).all();
      return {
        id: row.id,
        name: row.name,
        command: row.command,
        args: JSON.parse(row.args) as string[],
        env: JSON.parse(row.env) as Record<string, string>,
        isBuiltIn: row.isBuiltIn,
        scriptPath: row.scriptPath ?? null,
        scriptContent: row.scriptContent ?? null,
      };
    }),

  update: publicProcedure
    .input(
      z.object({
        id: z.string(),
        name: z.string().min(1),
        command: z.string().min(1),
        args: z.array(z.string()),
        env: z.record(z.string(), z.string()),
        scriptPath: z.string().nullable().optional(),
        scriptContent: z.string().nullable().optional(),
      })
    )
    .mutation(({ input }) => {
      const drizzle = getDatabaseManager().drizzle;
      const [agent] = drizzle
        .select({ isBuiltIn: schema.agents.isBuiltIn })
        .from(schema.agents)
        .where(eq(schema.agents.id, input.id))
        .all();

      if (!agent) throw new Error(`Agent ${input.id} not found`);
      if (agent.isBuiltIn) throw new Error('Cannot modify built-in agents');

      drizzle.update(schema.agents)
        .set({
          name: input.name,
          command: input.command,
          args: JSON.stringify(input.args),
          env: JSON.stringify(input.env),
          scriptPath: input.scriptPath ?? null,
          scriptContent: input.scriptContent ?? null,
        })
        .where(eq(schema.agents.id, input.id))
        .run();

      const [row] = drizzle.select().from(schema.agents).where(eq(schema.agents.id, input.id)).all();
      return {
        id: row.id,
        name: row.name,
        command: row.command,
        args: JSON.parse(row.args) as string[],
        env: JSON.parse(row.env) as Record<string, string>,
        isBuiltIn: row.isBuiltIn,
        scriptPath: row.scriptPath ?? null,
        scriptContent: row.scriptContent ?? null,
      };
    }),

  delete: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(({ input }) => {
      const drizzle = getDatabaseManager().drizzle;
      const [agent] = drizzle
        .select({ isBuiltIn: schema.agents.isBuiltIn })
        .from(schema.agents)
        .where(eq(schema.agents.id, input.id))
        .all();

      if (!agent) throw new Error(`Agent ${input.id} not found`);
      if (agent.isBuiltIn) throw new Error('Cannot delete built-in agents');

      drizzle.delete(schema.agents).where(eq(schema.agents.id, input.id)).run();
    }),
});
