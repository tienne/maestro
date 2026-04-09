/**
 * ipcLink — tRPC v11 호환 Electron IPC 링크
 *
 * electron-trpc@0.7.x의 ipcLink는 tRPC v10 런타임 API(r.transformer.serialize)를 사용하나
 * tRPC v11에서는 링크 런타임이 {}이라 r.transformer가 undefined. 이 파일이 대체한다.
 *
 * 프로토콜:
 *   renderer → main:  { method: 'request', operation: { id, type, path, input, context } }
 *   main → renderer:  { id, result: { type: 'data', data } }  |  { id, error: { code, message } }
 *   renderer → main:  { id, method: 'subscription.stop' }
 */

import type { AnyTRPCRouter } from '@trpc/server';
import type { TRPCLink, Operation, TRPCClientRuntime } from '@trpc/client';
import { observable } from '@trpc/server/observable';
import { TRPCClientError } from '@trpc/client';

const CHANNEL = 'electron-trpc';

type ElectronTRPC = {
  sendMessage: (msg: unknown) => void;
  onMessage: (handler: (msg: unknown) => void) => void;
};

type PendingEntry = {
  callbacks: {
    next(msg: unknown): void;
    error(err: unknown): void;
    complete(): void;
  };
  type: Operation['type'];
};

function getElectronTRPC(): ElectronTRPC {
  const et = (globalThis as Record<string, unknown>).electronTRPC as ElectronTRPC | undefined;
  if (!et) throw new Error('[ipcLink] electronTRPC not found — check preload exposeElectronTRPC()');
  return et;
}

class IPCBridge {
  private readonly pending = new Map<string | number, PendingEntry>();
  private readonly et: ElectronTRPC;

  constructor() {
    this.et = getElectronTRPC();
    this.et.onMessage((raw) => this.onMessage(raw as Record<string, unknown>));
  }

  private onMessage(msg: Record<string, unknown>) {
    const id = msg['id'] as string | number | undefined;
    if (id == null) return;
    const entry = this.pending.get(id);
    if (!entry) return;
    entry.callbacks.next(msg);
    if ('result' in msg && (msg['result'] as Record<string, unknown>)?.['type'] === 'stopped') {
      entry.callbacks.complete();
    }
  }

  request(op: Operation, callbacks: PendingEntry['callbacks']): () => void {
    this.pending.set(op.id, { callbacks, type: op.type });
    this.et.sendMessage({ method: 'request', operation: op });

    return () => {
      const entry = this.pending.get(op.id);
      if (!entry) return;
      this.pending.delete(op.id);
      entry.callbacks.complete();
      if (entry.type === 'subscription') {
        this.et.sendMessage({ id: op.id, method: 'subscription.stop' });
      }
    };
  }
}

let _bridge: IPCBridge | null = null;
function getBridge(): IPCBridge {
  if (!_bridge) _bridge = new IPCBridge();
  return _bridge;
}

export function ipcLink<TRouter extends AnyTRPCRouter>(): TRPCLink<TRouter> {
  return (_runtime: TRPCClientRuntime) => {
    const bridge = getBridge();
    return ({ op }) =>
      observable((observer) => {
        const unsub = bridge.request(op, {
          next(raw) {
            const msg = raw as Record<string, unknown>;
            if ('error' in msg) {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              observer.error(TRPCClientError.from(msg as any));
              return;
            }
            const result = msg['result'] as Record<string, unknown> | undefined;
            if (result && 'data' in result) {
              observer.next({ result: result as Parameters<typeof observer.next>[0]['result'] });
              if (op.type !== 'subscription') observer.complete();
            }
          },
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          error(err) { observer.error(err as any); },
          complete() { observer.complete(); },
        });
        return unsub;
      });
  };
}
