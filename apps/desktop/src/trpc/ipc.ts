/**
 * tRPC IPC Bridge — Electron Main Process (tRPC v11 호환)
 *
 * electron-trpc@0.7.x의 createIPCHandler는 tRPC v10 내부 API를 사용:
 *   - te() 함수가 proc._def['mutation'] 으로 타입 체크 → v11에서 undefined
 *   - n.getErrorShape() 미존재 → TypeError
 * 이 파일이 tRPC v11의 올바른 API로 대체한다.
 *
 * 프로토콜:
 *   renderer → main:  { method: 'request', operation: { id, type, path, input, context } }
 *   main → renderer:  { id, result: { type: 'data', data } }  |  { id, error: { code, message } }
 *   renderer → main:  { id, method: 'subscription.stop' }
 */

import { ipcMain } from 'electron';
import { observable } from '@trpc/server/observable';
import superjson from 'superjson';
import { appRouter } from './router';
import type { AppRouter } from './router';

const CHANNEL = 'electron-trpc';

// JSON-RPC 숫자 에러 코드 — electron-trpc renderer의 TRPCClientError.from()이
// error.code를 숫자로 기대해야 정상 파싱됨 (문자열이면 "Unknown error"로 폴백)
const TRPC_ERROR_CODES: Record<string, number> = {
  PARSE_ERROR: -32700,
  BAD_REQUEST: -32600,
  INTERNAL_SERVER_ERROR: -32603,
  NOT_FOUND: -32004,
  METHOD_NOT_SUPPORTED: -32005,
  TIMEOUT: -32008,
  CONFLICT: -32009,
  PRECONDITION_FAILED: -32012,
  PAYLOAD_TOO_LARGE: -32013,
  UNPROCESSABLE_CONTENT: -32022,
  TOO_MANY_REQUESTS: -32029,
  CLIENT_CLOSED_REQUEST: -32099,
  UNAUTHORIZED: -32001,
  FORBIDDEN: -32003,
};

type OperationType = 'query' | 'mutation' | 'subscription';

interface Operation {
  id: string | number;
  type: OperationType;
  path: string;
  input?: unknown;
  context?: Record<string, unknown>;
}

interface Message {
  method?: 'request' | 'subscription.stop';
  id?: string | number;
  operation?: Operation;
}

const subscriptions = new Map<string, { unsubscribe(): void }>();

async function handleRequest(
  event: Electron.IpcMainEvent,
  op: Operation,
): Promise<void> {
  const { id, type, path } = op;
  // ipc-link가 superjson.serialize()로 직렬화한 input을 역직렬화
  const input = op.input != null
    ? superjson.deserialize(op.input as Parameters<typeof superjson.deserialize>[0])
    : op.input;

  const reply = (data: unknown) => {
    if (!event.sender.isDestroyed()) {
      event.sender.send(CHANNEL, data);
    }
  };

  const replyError = (code: string, message: string) => {
    reply({
      id,
      error: {
        code: TRPC_ERROR_CODES[code] ?? TRPC_ERROR_CODES['INTERNAL_SERVER_ERROR'],
        message,
        data: { code, httpStatus: 500, path },
      },
    });
  };

  try {
    // tRPC v11: procedures는 dot-notation 평탄 맵
    const proc = (appRouter._def.procedures as Record<string, unknown>)[path] as
      | { _def: { type: string }; (opts: unknown): unknown }
      | undefined;

    if (!proc) return replyError('NOT_FOUND', `No "${type}"-procedure on path "${path}"`);
    if (proc._def.type !== type) return replyError('NOT_FOUND', `No "${type}"-procedure on path "${path}"`);

    if (type === 'subscription') {
      // 구독 처리
      const result = await (proc as (opts: unknown) => unknown)({
        ctx: {},
        path,
        type,
        getRawInput: async () => input,
      });

      if (
        !result ||
        typeof result !== 'object' ||
        typeof (result as Record<string, unknown>)['subscribe'] !== 'function'
      ) {
        return replyError('INTERNAL_SERVER_ERROR', `Subscription "${path}" did not return an observable`);
      }

      const obs = result as ReturnType<typeof observable>;
      const subKey = String(id);
      const sub = obs.subscribe({
        next(data) { reply({ id, result: { type: 'data', data: superjson.serialize(data) } }); },
        error(err) { replyError('INTERNAL_SERVER_ERROR', err instanceof Error ? err.message : String(err)); subscriptions.delete(subKey); },
        complete() { reply({ id, result: { type: 'stopped' } }); subscriptions.delete(subKey); },
      });
      subscriptions.set(subKey, sub);
      return;
    }

    // query / mutation 처리
    const data = await (proc as (opts: unknown) => Promise<unknown>)({
      ctx: {},
      path,
      type,
      getRawInput: async () => input,
    });

    reply({ id, result: { type: 'data', data: superjson.serialize(data) } });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    const code = (err as Record<string, unknown>)?.['code'] ?? 'INTERNAL_SERVER_ERROR';
    replyError(String(code), message);
  }
}

export function registerTrpcHandler(): void {
  ipcMain.on(CHANNEL, (event, message: Message) => {
    // 구독 중단 요청
    if (message.method === 'subscription.stop' && message.id != null) {
      const sub = subscriptions.get(String(message.id));
      if (sub) { sub.unsubscribe(); subscriptions.delete(String(message.id)); }
      return;
    }

    if (message.method !== 'request' || !message.operation) return;
    handleRequest(event, message.operation).catch(console.error);
  });
}

export { appRouter };
export type { AppRouter } from './router';
