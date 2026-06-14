/**
 * webhookRouter, apiKeyRouter, relayRouter — 원본 router.ts lines 3204-3518
 */

import { router, publicProcedure } from '../trpc';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';
import { getDatabaseManager } from '../../db/database';
import * as schema from '../../db/schema';
import { eq, desc } from 'drizzle-orm';
import { getPtyManager } from '../../services/pty-manager';
import { relayClient } from '../../main/relay-client';

// ── M6-02: webhook helpers ───────────────────────────────────────────────────

/** 웹훅 발송 (재시도 포함) — fire-and-forget 방식으로 호출 */
async function dispatchWebhook(
  webhookId: string,
  url: string,
  secret: string,
  event: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const drizzle = getDatabaseManager().drizzle;
  const body = JSON.stringify({ event, ...payload, timestamp: new Date().toISOString() });

  const delays = [1000, 2000, 4000]; // 지수 백오프
  let statusCode: number | null = null;
  let responseBody = '';

  for (let attempt = 0; attempt <= delays.length; attempt++) {
    try {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (secret) {
        const hmac = require('crypto').createHmac('sha256', secret).update(body).digest('hex');
        headers['X-Maestro-Signature'] = hmac;
      }

      const res = await fetch(url, { method: 'POST', headers, body, signal: AbortSignal.timeout(10000) });
      statusCode = res.status;
      responseBody = await res.text().catch(() => '');
      if (res.ok) { break; }
    } catch (err) {
      responseBody = String(err);
    }

    if (attempt < delays.length) {
      await new Promise((r) => setTimeout(r, delays[attempt]));
    }
  }

  // 로그 기록
  drizzle.insert(schema.webhookLogs).values({
    id: uuidv4(),
    webhookId,
    event,
    statusCode,
    responseBody: responseBody.slice(0, 2000),
  }).run();
}

/** 등록된 모든 웹훅에 이벤트 발송 */
export function emitWebhookEvent(event: string, payload: Record<string, unknown>): void {
  try {
    const drizzle = getDatabaseManager().drizzle;
    const webhooks = drizzle
      .select()
      .from(schema.webhooks)
      .where(eq(schema.webhooks.enabled, true))
      .all();

    for (const wh of webhooks) {
      const events = JSON.parse(wh.events) as string[];
      if (events.includes(event)) {
        dispatchWebhook(wh.id, wh.url, wh.secret, event, payload).catch(() => {});
      }
    }
  } catch { /* 무시 */ }
}

export const webhookRouter = router({
  list: publicProcedure.query(() => {
    const drizzle = getDatabaseManager().drizzle;
    return drizzle
      .select()
      .from(schema.webhooks)
      .orderBy(desc(schema.webhooks.createdAt))
      .all()
      .map((row) => ({
        id: row.id, url: row.url,
        events: JSON.parse(row.events) as string[],
        secret: row.secret, enabled: row.enabled, createdAt: row.createdAt,
      }));
  }),

  create: publicProcedure
    .input(z.object({
      url: z.string().url(),
      events: z.array(z.enum(['session.completed', 'session.error', 'agent.task_done', 'session.started'])),
      secret: z.string().default(''),
    }))
    .mutation(({ input }) => {
      const drizzle = getDatabaseManager().drizzle;
      const id = uuidv4();
      drizzle.insert(schema.webhooks).values({
        id,
        url: input.url,
        events: JSON.stringify(input.events),
        secret: input.secret,
      }).run();
      const [row] = drizzle.select().from(schema.webhooks).where(eq(schema.webhooks.id, id)).all();
      return { id: row.id, url: row.url, events: JSON.parse(row.events) as string[], secret: row.secret, enabled: row.enabled, createdAt: row.createdAt };
    }),

  update: publicProcedure
    .input(z.object({
      id: z.string(),
      url: z.string().url().optional(),
      events: z.array(z.enum(['session.completed', 'session.error', 'agent.task_done', 'session.started'])).optional(),
      secret: z.string().optional(),
      enabled: z.boolean().optional(),
    }))
    .mutation(({ input }) => {
      const drizzle = getDatabaseManager().drizzle;
      const updateFields: Partial<typeof schema.webhooks.$inferInsert> = {};
      if (input.url !== undefined) updateFields.url = input.url;
      if (input.events !== undefined) updateFields.events = JSON.stringify(input.events);
      if (input.secret !== undefined) updateFields.secret = input.secret;
      if (input.enabled !== undefined) updateFields.enabled = input.enabled;
      if (Object.keys(updateFields).length > 0) {
        drizzle.update(schema.webhooks).set(updateFields).where(eq(schema.webhooks.id, input.id)).run();
      }
      const [row] = drizzle.select().from(schema.webhooks).where(eq(schema.webhooks.id, input.id)).all();
      if (!row) throw new Error(`Webhook ${input.id} not found`);
      return { id: row.id, url: row.url, events: JSON.parse(row.events) as string[], secret: row.secret, enabled: row.enabled, createdAt: row.createdAt };
    }),

  delete: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(({ input }) => {
      const drizzle = getDatabaseManager().drizzle;
      drizzle.delete(schema.webhookLogs).where(eq(schema.webhookLogs.webhookId, input.id)).run();
      drizzle.delete(schema.webhooks).where(eq(schema.webhooks.id, input.id)).run();
    }),

  test: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input }) => {
      const drizzle = getDatabaseManager().drizzle;
      const [wh] = drizzle.select().from(schema.webhooks).where(eq(schema.webhooks.id, input.id)).all();
      if (!wh) throw new Error(`Webhook ${input.id} not found`);

      const body = JSON.stringify({ event: 'test', message: 'Webhook test from Maestro', timestamp: new Date().toISOString() });
      try {
        const headers: Record<string, string> = { 'Content-Type': 'application/json' };
        if (wh.secret) {
          const hmac = require('crypto').createHmac('sha256', wh.secret).update(body).digest('hex');
          headers['X-Maestro-Signature'] = hmac;
        }
        const res = await fetch(wh.url, { method: 'POST', headers, body, signal: AbortSignal.timeout(10000) });
        const resBody = await res.text().catch(() => '');
        drizzle.insert(schema.webhookLogs).values({
          id: uuidv4(), webhookId: wh.id, event: 'test', statusCode: res.status, responseBody: resBody.slice(0, 2000),
        }).run();
        return { success: res.ok, statusCode: res.status };
      } catch (err) {
        drizzle.insert(schema.webhookLogs).values({
          id: uuidv4(), webhookId: wh.id, event: 'test', statusCode: null, responseBody: String(err).slice(0, 2000),
        }).run();
        return { success: false, statusCode: null };
      }
    }),

  getLogs: publicProcedure
    .input(z.object({ webhookId: z.string(), limit: z.number().int().positive().max(100).default(20) }))
    .query(({ input }) => {
      const drizzle = getDatabaseManager().drizzle;
      return drizzle
        .select()
        .from(schema.webhookLogs)
        .where(eq(schema.webhookLogs.webhookId, input.webhookId))
        .orderBy(desc(schema.webhookLogs.createdAt))
        .limit(input.limit)
        .all()
        .map((row) => ({
          id: row.id, webhookId: row.webhookId, event: row.event,
          statusCode: row.statusCode, responseBody: row.responseBody, createdAt: row.createdAt,
        }));
    }),
});

// ── M6-03: apiKeyRouter ──────────────────────────────────────────────────────

export const apiKeyRouter = router({
  get: publicProcedure.query(() => {
    const drizzle = getDatabaseManager().drizzle;
    const [row] = drizzle
      .select()
      .from(schema.apiKeys)
      .orderBy(desc(schema.apiKeys.createdAt))
      .limit(1)
      .all();
    return row ? { id: row.id, key: row.key, name: row.name, createdAt: row.createdAt } : null;
  }),

  generate: publicProcedure
    .input(z.object({ name: z.string().default('Default') }))
    .mutation(({ input }) => {
      const drizzle = getDatabaseManager().drizzle;
      const id = uuidv4();
      const key = uuidv4();
      drizzle.delete(schema.apiKeys).run(); // 기존 키 모두 제거 (단일 키 정책)
      drizzle.insert(schema.apiKeys).values({ id, key, name: input.name }).run();
      const [row] = drizzle.select().from(schema.apiKeys).where(eq(schema.apiKeys.id, id)).all();
      return { id: row.id, key: row.key, name: row.name, createdAt: row.createdAt };
    }),

  revoke: publicProcedure
    .input(z.object({ id: z.string() }))
    .mutation(({ input }) => {
      const drizzle = getDatabaseManager().drizzle;
      drizzle.delete(schema.apiKeys).where(eq(schema.apiKeys.id, input.id)).run();
    }),
});

// ── M6-05 / M11-03: relayRouter ──────────────────────────────────────────────

// onInputMessage 핸들러: 모바일에서 받은 session:input → 로컬 PTY로 포워딩
relayClient.onInputMessage = (sessionId: string, data: string) => {
  try {
    getPtyManager().write(sessionId, data);
  } catch {
    // 존재하지 않는 세션 ID는 무시
  }
};

export const relayRouter = router({
  getStatus: publicProcedure.query(() => {
    return { status: relayClient.status, latencyMs: null };
  }),

  getSessions: publicProcedure.query(() => {
    const drizzle = getDatabaseManager().drizzle;
    const sessions = drizzle
      .select({ id: schema.sessions.id, name: schema.sessions.name, createdAt: schema.sessions.createdAt })
      .from(schema.sessions)
      .orderBy(desc(schema.sessions.createdAt))
      .limit(50)
      .all();
    const result = sessions.map((s) => ({ id: s.id, name: s.name, createdAt: s.createdAt }));
    // 세션 목록을 모바일 클라이언트에 브로드캐스트
    relayClient.broadcastSessions(result);
    return result;
  }),

  sendInput: publicProcedure
    .input(z.object({ sessionId: z.string().min(1), text: z.string() }))
    .mutation(({ input }) => {
      getPtyManager().write(input.sessionId, input.text);
      return { success: true };
    }),

  connect: publicProcedure
    .input(z.object({ token: z.string().min(1) }))
    .mutation(({ input }) => {
      const url = process.env['RELAY_SERVER_URL'] ?? 'ws://localhost:3001';
      relayClient.connect(input.token, url);
      return { success: true };
    }),

  disconnect: publicProcedure.mutation(() => {
    relayClient.disconnect();
    return { success: true };
  }),
});
