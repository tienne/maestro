/**
 * tRPC 공유 인스턴스 — 모든 도메인 라우터가 이 파일에서 import한다.
 */

import { initTRPC, TRPCError } from '@trpc/server';
import superjson from 'superjson';
import { exec as execCb } from 'child_process';
import { promisify } from 'util';

export const execAsync = promisify(execCb);

// ── Script validation helper ──────────────────────────────────────────────────

export function validateScript(script: string, label: string): void {
  if (typeof script !== 'string' || script.trim() === '') {
    throw new TRPCError({ code: 'BAD_REQUEST', message: `${label} must be a non-empty string` });
  }
  if (script.length > 2000) {
    throw new TRPCError({ code: 'BAD_REQUEST', message: `${label} exceeds maximum length of 2000 characters` });
  }
}

// ── tRPC instance ─────────────────────────────────────────────────────────────

const t = initTRPC.create({ transformer: superjson });

export { TRPCError };
export const router = t.router;
export const publicProcedure = t.procedure;
export { t };
