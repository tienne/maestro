/**
 * sessionRouter — 원본 router.ts lines 657-1749
 */

import { router, publicProcedure, execAsync } from '../trpc';
import { z } from 'zod';
import { observable } from '@trpc/server/observable';
import * as path from 'path';
import * as fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { dialog, shell } from 'electron';
import { getDatabaseManager } from '../../db/database';
import * as schema from '../../db/schema';
import { eq, desc, and, inArray, sql as drizzleSql } from 'drizzle-orm';
import { getPtyManager } from '../../services/pty-manager';
import { getListeningPorts } from '../../services/port-scanner';
import { getSessionIntelligence } from '../../services/session-intelligence';
import { getMainWindow } from '../../main';
import { getServerPort, getAuthToken } from '../../services/http-server';
import { createWrapper } from '../../services/wrappers';
import type { WrapperHookConfig } from '../../services/agent-wrapper';
import { teamsWatcher } from '../../services/teams-watcher';
import { attachSubagentHandler } from '../../services/subagent-handler';
import { AppStateService } from '../../services/app-state-service';
import { emitWebhookEvent } from './integration';
import { rowToSession, type SessionRow } from './_shared';

export const sessionRouter = router({
  list: publicProcedure
    .input(z.object({ workspaceId: z.string() }))
    .query(({ input }) => {
      const drizzle = getDatabaseManager().drizzle;
      return drizzle
        .select()
        .from(schema.sessions)
        .where(eq(schema.sessions.workspaceId, input.workspaceId))
        .orderBy(desc(schema.sessions.createdAt))
        .all()
        .map((r) => rowToSession(r as unknown as SessionRow));
    }),

  listAll: publicProcedure.query(() => {
    const drizzle = getDatabaseManager().drizzle;
    return drizzle
      .select()
      .from(schema.sessions)
      .orderBy(desc(schema.sessions.createdAt))
      .all()
      .map((r) => rowToSession(r as unknown as SessionRow));
  }),

  create: publicProcedure
    .input(
      z.object({
        name: z.string().min(1),
        workspaceId: z.string(),
        agentId: z.string(),
        dependsOnSessionId: z.string().nullable().optional(),
        contextSourceSessionId: z.string().nullable().optional(),
      })
    )
    .mutation(({ input }) => {
      const drizzle = getDatabaseManager().drizzle;
      const { name, workspaceId, agentId } = input;

      const [workspace] = drizzle
        .select()
        .from(schema.workspaces)
        .where(eq(schema.workspaces.id, workspaceId))
        .all();
      if (!workspace) throw new Error(`Workspace ${workspaceId} not found`);

      const [agent] = drizzle
        .select()
        .from(schema.agents)
        .where(eq(schema.agents.id, agentId))
        .all();
      if (!agent) throw new Error(`Agent ${agentId} not found`);

      const id = uuidv4();
      // M4-01: 의존성이 있고 선행 세션이 아직 완료되지 않았으면 'pending' 대신 'blocked'
      const hasDeps = Boolean(input.dependsOnSessionId);
      let initialStatus: 'pending' | 'blocked' = 'pending';
      if (hasDeps) {
        const [dep] = drizzle
          .select({ status: schema.sessions.status })
          .from(schema.sessions)
          .where(eq(schema.sessions.id, input.dependsOnSessionId!))
          .all();
        if (dep && dep.status !== 'stopped') {
          initialStatus = 'blocked';
        }
      }

      drizzle.insert(schema.sessions).values({
        id,
        name,
        workspaceId,
        agentId,
        status: initialStatus,
        pid: null,
        dependsOnSessionId: input.dependsOnSessionId ?? null,
        contextSourceSessionId: input.contextSourceSessionId ?? null,
      }).run();

      const [inserted] = drizzle
        .select()
        .from(schema.sessions)
        .where(eq(schema.sessions.id, id))
        .all();
      return rowToSession(inserted as unknown as SessionRow);
    }),

  launch: publicProcedure
    .input(
      z.object({
        sessionId: z.string(),
        cols: z.number().int().positive(),
        rows: z.number().int().positive(),
      })
    )
    .mutation(async ({ input }) => {
      const drizzle = getDatabaseManager().drizzle;
      const rawDb = getDatabaseManager().getDb();
      const ptyManager = getPtyManager();
      const { sessionId, cols, rows } = input;

      const [session] = drizzle
        .select()
        .from(schema.sessions)
        .where(eq(schema.sessions.id, sessionId))
        .all();
      if (!session) throw new Error(`Session ${sessionId} not found`);

      // 이미 launch된 세션에 중복 요청이 오면 무시 (Strict Mode 이중 호출 방어)
      if (session.status !== 'pending') {
        return rowToSession(session as unknown as SessionRow);
      }

      const [workspace] = drizzle
        .select()
        .from(schema.workspaces)
        .where(eq(schema.workspaces.id, session.workspaceId))
        .all();
      if (!workspace) throw new Error(`Workspace ${session.workspaceId} not found`);

      const [agent] = drizzle
        .select()
        .from(schema.agents)
        .where(eq(schema.agents.id, session.agentId))
        .all();
      if (!agent) throw new Error(`Agent ${session.agentId} not found`);

      // JOIN 쿼리 — raw SQL 유지
      interface EnvVarRow { key: string; value: string; }
      const envVarRows = rawDb
        .prepare(
          `SELECT ev.key, ev.value FROM env_vars ev
           JOIN repositories r ON r.id = ev.repository_id
           JOIN workspaces w ON w.repository_id = r.id
           WHERE w.id = ?`
        )
        .all(session.workspaceId) as EnvVarRow[];

      const repoEnv: Record<string, string> = {};
      for (const row of envVarRows) {
        repoEnv[row.key] = row.value;
      }

      const agentArgs: string[] = JSON.parse(agent.args);
      const agentEnv: Record<string, string> = JSON.parse(agent.env);
      const mergedEnv = { ...repoEnv, ...agentEnv };

      // 에이전트 타입을 agent.name 기준으로 결정 (built-in 에이전트의 경우)
      const agentName = agent.name.toLowerCase();
      const agentType = agentName.includes('claude')
        ? 'claude-code'
        : agentName.includes('gemini')
          ? 'gemini'
          : agentName.includes('codex')
            ? 'codex'
            : agentName.includes('opencode')
              ? 'opencode'
              : null;

      const port = getServerPort();
      let wrapperInjected = false;

      if (agentType && port > 0) {
        try {
          const wrapperConfig: WrapperHookConfig = {
            eventEndpoint: `http://127.0.0.1:${port}/api/events`,
            port,
            authToken: getAuthToken(),
            sessionId,
            agentType,
          };
          const wrapper = createWrapper(agentType, wrapperConfig);
          await wrapper.injectHook();
          wrapperInjected = true;
        } catch (err) {
          // 훅 주입 실패는 세션 시작을 막지 않음 (non-fatal)
          console.error('[Router] Failed to inject wrapper hook:', err);
        }
      }

      // M3: 세션 인텔리전스 시작
      const intelligence = getSessionIntelligence();
      intelligence.startSession(sessionId);

      // M5-03: lifecycle hook 조회
      const [wsHooksRow] = drizzle
        .select({
          hookOnSessionStart: schema.workspaces.hookOnSessionStart,
          hookOnAgentComplete: schema.workspaces.hookOnAgentComplete,
          hookOnError: schema.workspaces.hookOnError,
        })
        .from(schema.workspaces)
        .where(eq(schema.workspaces.id, session.workspaceId))
        .all();
      const wsHooks = wsHooksRow ? {
        hook_on_session_start: wsHooksRow.hookOnSessionStart,
        hook_on_agent_complete: wsHooksRow.hookOnAgentComplete,
        hook_on_error: wsHooksRow.hookOnError,
      } : undefined;

      const ptyProcess = ptyManager.create(
        sessionId,
        agent.command,
        agentArgs,
        mergedEnv,
        workspace.worktreePath,
        cols,
        rows
      );

      // M5-03: onSessionStart 훅 실행
      if (wsHooks?.hook_on_session_start?.trim()) {
        execAsync(wsHooks.hook_on_session_start, { cwd: workspace.worktreePath })
          .then(() => {
            const win = getMainWindow();
            if (win && !win.isDestroyed()) {
              win.webContents.send('hook-result', { sessionId, hook: 'onSessionStart', success: true });
            }
          })
          .catch((err: unknown) => {
            const win = getMainWindow();
            if (win && !win.isDestroyed()) {
              win.webContents.send('hook-result', { sessionId, hook: 'onSessionStart', success: false, error: String(err) });
            }
          });
      }

      // M11: Task 기반 세션인 경우 서브에이전트 spawn 핸들러 연결
      if (workspace.taskId) {
        const [taskRow] = drizzle
          .select({ projectId: schema.tasks.projectId })
          .from(schema.tasks)
          .where(eq(schema.tasks.id, workspace.taskId))
          .all();
        if (taskRow) {
          attachSubagentHandler(sessionId, workspace.taskId, taskRow.projectId);
        }
      }

      ptyManager.onOutput(sessionId, (sid, data) => {
        // Teams: 서브에이전트 spawn 감지
        teamsWatcher.processOutput(sid, data);

        // M3: PTY 출력을 인텔리전스 매니저에 전달
        intelligence.feedData(sid, data);

        // M5-03: onError 훅 — 에러 패턴 감지 시 실행
        if (wsHooks?.hook_on_error?.trim()) {
          const errorPatterns = ['Error:', 'error:', 'FATAL', 'panic:', 'Traceback'];
          if (errorPatterns.some((p) => data.includes(p))) {
            execAsync(wsHooks.hook_on_error, { cwd: workspace.worktreePath })
              .then(() => {
                const win = getMainWindow();
                if (win && !win.isDestroyed()) {
                  win.webContents.send('hook-result', { sessionId: sid, hook: 'onError', success: true });
                }
              })
              .catch(() => { /* 무시 */ });
          }
        }

        const win = getMainWindow();
        if (win && !win.isDestroyed()) {
          win.webContents.send('session-output', { sessionId: sid, data });
        }
      });

      ptyManager.onExit(sessionId, (sid, exitCode) => {
        ptyManager.removeOutput(sid);
        ptyManager.removeExit(sid);

        // Teams: 세션 종료 시 감지 해제
        teamsWatcher.detachFromSession(sid);

        // M3: 완료 감지
        intelligence.handleExit(sid, exitCode);
        const status = exitCode === 0 ? 'stopped' : 'error';
        // M7-04: exit code를 DB에 저장
        drizzle.update(schema.sessions)
          .set({ status, pid: null, lastExitCode: exitCode ?? null })
          .where(eq(schema.sessions.id, sid))
          .run();

        // M7-04: 비정상 종료 시 에러 로그 기록
        if (exitCode !== 0 && exitCode !== undefined) {
          import('../../services/error-logger').then(({ writeErrorLog }) => {
            writeErrorLog('pty-exit', `Session ${sid} exited with code ${exitCode}`);
          }).catch(() => { /* 무시 */ });
        }

        // M6-02: 웹훅 이벤트 발송
        const webhookEvent = exitCode === 0 ? 'session.completed' : 'session.error';
        emitWebhookEvent(webhookEvent, { sessionId: sid, exitCode });

        // M5-03: onAgentComplete 훅 (exit 0일 때만 실행)
        if (exitCode === 0 && wsHooks?.hook_on_agent_complete?.trim()) {
          execAsync(wsHooks.hook_on_agent_complete, { cwd: workspace.worktreePath })
            .then(() => {
              const hWin = getMainWindow();
              if (hWin && !hWin.isDestroyed()) {
                hWin.webContents.send('hook-result', { sessionId: sid, hook: 'onAgentComplete', success: true });
              }
            })
            .catch((err: unknown) => {
              const hWin = getMainWindow();
              if (hWin && !hWin.isDestroyed()) {
                hWin.webContents.send('hook-result', { sessionId: sid, hook: 'onAgentComplete', success: false, error: String(err) });
              }
            });
        }

        // 스크롤백 버퍼 DB 저장 (세션 재개 시 복원)
        const scrollback = ptyManager.getScrollback(sid);
        if (scrollback) {
          drizzle.insert(schema.sessionScrollbacks)
            .values({ sessionId: sid, data: scrollback })
            .onConflictDoUpdate({
              target: schema.sessionScrollbacks.sessionId,
              set: { data: scrollback },
            })
            .run();
        }

        // M9-04: 세션 아카이브 자동 저장
        import('../../services/session-archiver').then(({ archiveSession }) => {
          archiveSession(sid);
        }).catch(() => { /* 무시 */ });

        const win = getMainWindow();
        if (win && !win.isDestroyed()) {
          win.webContents.send('session-status', { sessionId: sid, status });
        }

        // M4-01: 의존성 체인 — 후속 세션 자동 시작/블록
        const dependents = drizzle
          .select()
          .from(schema.sessions)
          .where(eq(schema.sessions.dependsOnSessionId, sid))
          .all();
        for (const dep of dependents) {
          if (exitCode === 0) {
            // 선행 세션 성공 → 의존 세션을 pending으로 변경 (XTerminal onReady → launch 흐름)
            drizzle.update(schema.sessions).set({ status: 'pending' }).where(eq(schema.sessions.id, dep.id)).run();
            if (win && !win.isDestroyed()) {
              win.webContents.send('session-status', { sessionId: dep.id, status: 'pending' });
            }
          } else {
            // 선행 세션 실패 → blocked
            drizzle.update(schema.sessions).set({ status: 'blocked' }).where(eq(schema.sessions.id, dep.id)).run();
            if (win && !win.isDestroyed()) {
              win.webContents.send('session-status', { sessionId: dep.id, status: 'blocked' });
            }
          }
        }

        // PTY 종료 시 wrapper 훅 제거
        if (wrapperInjected && agentType && port > 0) {
          const wrapperConfig: WrapperHookConfig = {
            eventEndpoint: `http://127.0.0.1:${port}/api/events`,
            port,
            authToken: getAuthToken(),
            sessionId: sid,
            agentType,
          };
          createWrapper(agentType, wrapperConfig)
            .removeHook()
            .catch((err: unknown) => {
              console.error('[Router] Failed to remove wrapper hook on exit:', err);
            });
        }
      });

      drizzle.update(schema.sessions)
        .set({ status: 'running', pid: ptyProcess.pid as number })
        .where(eq(schema.sessions.id, sessionId))
        .run();

      // M6-02: 세션 시작 웹훅 이벤트 발송
      emitWebhookEvent('session.started', { sessionId });

      // M4-02: 컨텍스트 소스 세션이 있으면 출력을 stdin에 주입
      if (session.contextSourceSessionId) {
        const srcScrollback = ptyManager.getScrollback(session.contextSourceSessionId);
        let contextData = srcScrollback;
        if (!contextData) {
          const [srcRow] = drizzle
            .select({ data: schema.sessionScrollbacks.data })
            .from(schema.sessionScrollbacks)
            .where(eq(schema.sessionScrollbacks.sessionId, session.contextSourceSessionId))
            .all();
          contextData = srcRow?.data ?? '';
        }
        if (contextData) {
          const lines = contextData.split('\n').slice(-100).join('\n').slice(0, 4000);
          if (lines.trim()) {
            setTimeout(() => {
              try {
                ptyManager.write(sessionId, lines + '\r');
              } catch { /* 무시 */ }
            }, 300);
          }
        }
      }

      void AppStateService.getInstance().set({ lastSessionId: sessionId });

      const [finalSession] = drizzle
        .select()
        .from(schema.sessions)
        .where(eq(schema.sessions.id, sessionId))
        .all();
      return rowToSession(finalSession as unknown as SessionRow);
    }),

  stop: publicProcedure
    .input(z.object({ sessionId: z.string() }))
    .mutation(async ({ input }) => {
      const drizzle = getDatabaseManager().drizzle;
      const ptyManager = getPtyManager();
      const { sessionId } = input;

      // 세션에 연결된 에이전트 정보 조회 (wrapper 훅 제거용)
      const [session] = drizzle
        .select()
        .from(schema.sessions)
        .where(eq(schema.sessions.id, sessionId))
        .all();

      if (ptyManager.isAlive(sessionId)) {
        ptyManager.kill(sessionId);
      }
      drizzle.update(schema.sessions)
        .set({ status: 'stopped', pid: null })
        .where(eq(schema.sessions.id, sessionId))
        .run();

      // wrapper 훅 제거 (세션 정보가 있을 때만)
      if (session) {
        const [agent] = drizzle
          .select()
          .from(schema.agents)
          .where(eq(schema.agents.id, session.agentId))
          .all();

        if (agent) {
          const agentName = agent.name.toLowerCase();
          const agentType = agentName.includes('claude')
            ? 'claude-code'
            : agentName.includes('gemini')
              ? 'gemini'
              : agentName.includes('codex')
                ? 'codex'
                : agentName.includes('opencode')
                  ? 'opencode'
                  : null;

          const port = getServerPort();
          if (agentType && port > 0) {
            try {
              const wrapperConfig: WrapperHookConfig = {
                eventEndpoint: `http://127.0.0.1:${port}/api/events`,
                port,
                authToken: getAuthToken(),
                sessionId,
                agentType,
              };
              await createWrapper(agentType, wrapperConfig).removeHook();
            } catch (err) {
              console.error('[Router] Failed to remove wrapper hook on stop:', err);
            }
          }
        }
      }
    }),

  delete: publicProcedure
    .input(z.object({ sessionId: z.string() }))
    .mutation(({ input }) => {
      const drizzle = getDatabaseManager().drizzle;
      const ptyManager = getPtyManager();
      const { sessionId } = input;
      if (ptyManager.isAlive(sessionId)) {
        ptyManager.kill(sessionId);
      }
      drizzle.delete(schema.sessions).where(eq(schema.sessions.id, sessionId)).run();
    }),

  sendInput: publicProcedure
    .input(z.object({ sessionId: z.string(), text: z.string() }))
    .mutation(({ input }) => {
      getPtyManager().write(input.sessionId, input.text);
    }),

  resize: publicProcedure
    .input(
      z.object({
        sessionId: z.string(),
        cols: z.number().int().positive(),
        rows: z.number().int().positive(),
      })
    )
    .mutation(({ input }) => {
      getPtyManager().resize(input.sessionId, input.cols, input.rows);
    }),

  getLast: publicProcedure.query(() => {
    const lastId = AppStateService.getInstance().get().lastSessionId;
    if (!lastId) return null;

    const drizzle = getDatabaseManager().drizzle;
    const [session] = drizzle
      .select()
      .from(schema.sessions)
      .where(eq(schema.sessions.id, lastId))
      .all();

    return session ? rowToSession(session as unknown as SessionRow) : null;
  }),

  setLastActive: publicProcedure
    .input(z.object({ sessionId: z.string() }))
    .mutation(async ({ input }) => {
      await AppStateService.getInstance().set({ lastSessionId: input.sessionId });
    }),

  resume: publicProcedure
    .input(z.object({ sessionId: z.string(), restart: z.boolean().optional() }))
    .mutation(({ input }) => {
      const drizzle = getDatabaseManager().drizzle;
      const ptyManager = getPtyManager();
      const { sessionId, restart } = input;

      const [session] = drizzle
        .select()
        .from(schema.sessions)
        .where(eq(schema.sessions.id, sessionId))
        .all();
      if (!session) throw new Error(`Session ${sessionId} not found`);

      if (ptyManager.isAlive(sessionId)) {
        ptyManager.onOutput(sessionId, (sid, data) => {
          // Teams: 서브에이전트 spawn 감지 (resume 시에도 유지)
          teamsWatcher.processOutput(sid, data);

          const win = getMainWindow();
          if (win && !win.isDestroyed()) {
            win.webContents.send('session-output', { sessionId: sid, data });
          }
        });
      }

      // restart=true: PTY가 없는 상태에서 재시작 — 'pending'으로 리셋해
      // XTerminal의 onReady → session.launch 흐름을 다시 타게 한다.
      if (restart && !ptyManager.isAlive(sessionId)) {
        drizzle.update(schema.sessions)
          .set({ status: 'pending', pid: null })
          .where(eq(schema.sessions.id, sessionId))
          .run();
      }

      void AppStateService.getInstance().set({ lastSessionId: sessionId });

      const [updated] = drizzle
        .select()
        .from(schema.sessions)
        .where(eq(schema.sessions.id, sessionId))
        .all();
      return rowToSession(updated as unknown as SessionRow);
    }),

  updateStatus: publicProcedure
    .input(z.object({ sessionId: z.string(), status: z.string() }))
    .mutation(({ input }) => {
      const drizzle = getDatabaseManager().drizzle;
      drizzle.update(schema.sessions)
        .set({ status: input.status })
        .where(eq(schema.sessions.id, input.sessionId))
        .run();
    }),

  getPorts: publicProcedure
    .input(z.object({ sessionId: z.string() }))
    .query(async ({ input }) => {
      const drizzle = getDatabaseManager().drizzle;
      const [session] = drizzle
        .select()
        .from(schema.sessions)
        .where(eq(schema.sessions.id, input.sessionId))
        .all();

      if (!session || !session.pid || session.status !== 'running') {
        return [];
      }

      return getListeningPorts(session.pid);
    }),

  openPort: publicProcedure
    .input(z.object({ port: z.number().int().min(1).max(65535) }))
    .mutation(async ({ input }) => {
      await shell.openExternal(`http://localhost:${input.port}`);
    }),

  getScrollback: publicProcedure
    .input(z.object({ sessionId: z.string() }))
    .query(({ input }) => {
      const drizzle = getDatabaseManager().drizzle;
      // 먼저 메모리 버퍼에서 확인 (현재 세션이 실행 중이면 최신 버퍼 반환)
      const live = getPtyManager().getScrollback(input.sessionId);
      if (live) return live;

      // 메모리에 없으면 DB에서 조회 (이전에 종료된 세션)
      const [row] = drizzle
        .select({ data: schema.sessionScrollbacks.data })
        .from(schema.sessionScrollbacks)
        .where(eq(schema.sessionScrollbacks.sessionId, input.sessionId))
        .all();
      return row?.data ?? '';
    }),

  broadcast: publicProcedure
    .input(z.object({
      sessionIds: z.array(z.string()).min(1),
      text: z.string().min(1),
    }))
    .mutation(({ input }) => {
      const ptyManager = getPtyManager();
      const errors: string[] = [];
      for (const sid of input.sessionIds) {
        try {
          ptyManager.write(sid, input.text + '\r');
        } catch (err) {
          errors.push(`${sid}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
      if (errors.length > 0) {
        throw new Error(`Broadcast partial failure: ${errors.join(', ')}`);
      }
    }),

  savePrompt: publicProcedure
    .input(z.object({ sessionId: z.string(), text: z.string().min(1) }))
    .mutation(({ input }) => {
      const drizzle = getDatabaseManager().drizzle;
      drizzle.insert(schema.promptHistory).values({
        id: uuidv4(),
        sessionId: input.sessionId,
        text: input.text,
      }).run();
    }),

  getPromptHistory: publicProcedure
    .input(z.object({ sessionId: z.string(), limit: z.number().int().positive().max(100).default(50) }))
    .query(({ input }) => {
      const drizzle = getDatabaseManager().drizzle;
      const rows = drizzle
        .select({ id: schema.promptHistory.id, text: schema.promptHistory.text, createdAt: schema.promptHistory.createdAt })
        .from(schema.promptHistory)
        .where(eq(schema.promptHistory.sessionId, input.sessionId))
        .orderBy(desc(schema.promptHistory.createdAt))
        .limit(input.limit)
        .all();
      return rows.reverse(); // 오래된 것이 앞에 오도록
    }),

  // ── M2-03: 세션 이름 변경 ──────────────────────────────────────────────
  rename: publicProcedure
    .input(z.object({ sessionId: z.string(), name: z.string().min(1).max(30) }))
    .mutation(({ input }) => {
      const drizzle = getDatabaseManager().drizzle;
      drizzle.update(schema.sessions)
        .set({ name: input.name })
        .where(eq(schema.sessions.id, input.sessionId))
        .run();
      const [row] = drizzle.select().from(schema.sessions).where(eq(schema.sessions.id, input.sessionId)).all();
      if (!row) throw new Error(`Session ${input.sessionId} not found`);
      return rowToSession(row as unknown as SessionRow);
    }),

  // ── M2-06: 즐겨찾기 토글 ──────────────────────────────────────────────
  setFavorite: publicProcedure
    .input(z.object({ sessionId: z.string(), favorite: z.boolean() }))
    .mutation(({ input }) => {
      const drizzle = getDatabaseManager().drizzle;
      drizzle.update(schema.sessions)
        .set({ isFavorite: input.favorite })
        .where(eq(schema.sessions.id, input.sessionId))
        .run();
      const [row] = drizzle.select().from(schema.sessions).where(eq(schema.sessions.id, input.sessionId)).all();
      if (!row) throw new Error(`Session ${input.sessionId} not found`);
      return rowToSession(row as unknown as SessionRow);
    }),

  // ── M3-01: 세션 비용 조회 ─────────────────────────────────────────────
  getCost: publicProcedure
    .input(z.object({ sessionId: z.string() }))
    .query(({ input }) => {
      const intelligence = getSessionIntelligence();
      const state = intelligence.getState(input.sessionId);
      if (state) return state.costs;

      // 인메모리에 없으면 DB에서 합산
      const drizzle = getDatabaseManager().drizzle;
      const [row] = drizzle
        .select({
          inputTokens: drizzleSql<number>`COALESCE(SUM(${schema.sessionCosts.inputTokens}), 0)`,
          outputTokens: drizzleSql<number>`COALESCE(SUM(${schema.sessionCosts.outputTokens}), 0)`,
          costUsd: drizzleSql<number>`COALESCE(SUM(${schema.sessionCosts.costUsd}), 0)`,
        })
        .from(schema.sessionCosts)
        .where(eq(schema.sessionCosts.sessionId, input.sessionId))
        .all();

      return {
        sessionId: input.sessionId,
        totalInputTokens: row?.inputTokens ?? 0,
        totalOutputTokens: row?.outputTokens ?? 0,
        totalCostUsd: row?.costUsd ?? 0,
      };
    }),

  // ── M3-02: 작업 진행률 조회 ───────────────────────────────────────────
  getTasks: publicProcedure
    .input(z.object({ sessionId: z.string() }))
    .query(({ input }) => {
      const intelligence = getSessionIntelligence();
      const state = intelligence.getState(input.sessionId);
      return state?.tasks ?? [];
    }),

  // ── M3-04: 에러 정보 조회 ────────────────────────────────────────────
  getLastError: publicProcedure
    .input(z.object({ sessionId: z.string() }))
    .query(({ input }) => {
      const intelligence = getSessionIntelligence();
      const state = intelligence.getState(input.sessionId);
      return state?.lastError ?? null;
    }),

  // ── M3: 세션 인텔리전스 전체 조회 ────────────────────────────────────
  getIntelligence: publicProcedure
    .input(z.object({ sessionId: z.string() }))
    .query(({ input }) => {
      const intelligence = getSessionIntelligence();
      return intelligence.getState(input.sessionId);
    }),

  // ── M3: 인텔리전스 실시간 구독 ───────────────────────────────────────
  subscribeIntelligence: publicProcedure
    .input(z.object({ sessionId: z.string() }))
    .subscription(({ input }) => {
      const intelligence = getSessionIntelligence();
      return observable<ReturnType<typeof intelligence.getState>>((emit) => {
        // 초기값 전송
        emit.next(intelligence.getState(input.sessionId));

        const unsub = intelligence.onChange((changedSessionId) => {
          if (changedSessionId === input.sessionId) {
            emit.next(intelligence.getState(input.sessionId));
          }
        });
        return unsub;
      });
    }),

  // ── M4-01: 파이프라인 의존성 설정 ────────────────────────────────────
  setPipeline: publicProcedure
    .input(z.object({ sessionId: z.string(), dependsOnSessionId: z.string().nullable() }))
    .mutation(({ input }) => {
      const drizzle = getDatabaseManager().drizzle;
      drizzle.update(schema.sessions)
        .set({ dependsOnSessionId: input.dependsOnSessionId })
        .where(eq(schema.sessions.id, input.sessionId))
        .run();
      const [row] = drizzle.select().from(schema.sessions).where(eq(schema.sessions.id, input.sessionId)).all();
      if (!row) throw new Error(`Session ${input.sessionId} not found`);
      return rowToSession(row as unknown as SessionRow);
    }),

  // ── M4-02: 컨텍스트 소스 설정 ────────────────────────────────────────
  setContextSource: publicProcedure
    .input(z.object({ sessionId: z.string(), contextSourceSessionId: z.string().nullable() }))
    .mutation(({ input }) => {
      const drizzle = getDatabaseManager().drizzle;
      drizzle.update(schema.sessions)
        .set({ contextSourceSessionId: input.contextSourceSessionId })
        .where(eq(schema.sessions.id, input.sessionId))
        .run();
      const [row] = drizzle.select().from(schema.sessions).where(eq(schema.sessions.id, input.sessionId)).all();
      if (!row) throw new Error(`Session ${input.sessionId} not found`);
      return rowToSession(row as unknown as SessionRow);
    }),

  getContextOutput: publicProcedure
    .input(z.object({ sessionId: z.string(), lines: z.number().int().positive().max(200).default(100) }))
    .query(({ input }) => {
      const ptyManager = getPtyManager();
      const scrollback = ptyManager.getScrollback(input.sessionId);
      if (!scrollback) {
        const drizzle = getDatabaseManager().drizzle;
        const [row] = drizzle
          .select({ data: schema.sessionScrollbacks.data })
          .from(schema.sessionScrollbacks)
          .where(eq(schema.sessionScrollbacks.sessionId, input.sessionId))
          .all();
        const data = row?.data ?? '';
        const lines = data.split('\n').slice(-input.lines).join('\n');
        return lines.slice(0, 4000);
      }
      const lines = scrollback.split('\n').slice(-input.lines).join('\n');
      return lines.slice(0, 4000);
    }),

  // ── M4-03: 일괄 제어 ────────────────────────────────────────────────
  stopAll: publicProcedure.mutation(() => {
    const drizzle = getDatabaseManager().drizzle;
    const ptyManager = getPtyManager();
    const running = drizzle
      .select()
      .from(schema.sessions)
      .where(eq(schema.sessions.status, 'running'))
      .all();
    let stopped = 0;
    for (const row of running) {
      try {
        if (ptyManager.isAlive(row.id)) {
          ptyManager.kill(row.id);
        }
        drizzle.update(schema.sessions)
          .set({ status: 'stopped', pid: null })
          .where(eq(schema.sessions.id, row.id))
          .run();
        stopped++;
      } catch {
        // 개별 실패 무시
      }
    }
    return { stopped };
  }),

  restartAllErrors: publicProcedure.mutation(() => {
    const drizzle = getDatabaseManager().drizzle;
    const errored = drizzle
      .select()
      .from(schema.sessions)
      .where(eq(schema.sessions.status, 'error'))
      .all();
    let restarted = 0;
    for (const row of errored) {
      drizzle.update(schema.sessions)
        .set({ status: 'pending', pid: null })
        .where(eq(schema.sessions.id, row.id))
        .run();
      restarted++;
    }
    // 상태 변경을 렌더러에 알림
    const win = getMainWindow();
    if (win && !win.isDestroyed()) {
      for (const row of errored) {
        win.webContents.send('session-status', { sessionId: row.id, status: 'pending' });
      }
    }
    return { restarted };
  }),

  // ── M4-05: 라벨 관리 ────────────────────────────────────────────────
  addLabel: publicProcedure
    .input(z.object({ sessionId: z.string(), labelName: z.string().min(1).max(20), labelColor: z.string() }))
    .mutation(({ input }) => {
      const drizzle = getDatabaseManager().drizzle;
      drizzle.insert(schema.sessionLabels)
        .values({ sessionId: input.sessionId, labelName: input.labelName, labelColor: input.labelColor })
        .onConflictDoUpdate({
          target: [schema.sessionLabels.sessionId, schema.sessionLabels.labelName],
          set: { labelColor: input.labelColor },
        })
        .run();
      return { sessionId: input.sessionId, labelName: input.labelName, labelColor: input.labelColor };
    }),

  removeLabel: publicProcedure
    .input(z.object({ sessionId: z.string(), labelName: z.string() }))
    .mutation(({ input }) => {
      const drizzle = getDatabaseManager().drizzle;
      drizzle.delete(schema.sessionLabels)
        .where(and(eq(schema.sessionLabels.sessionId, input.sessionId), eq(schema.sessionLabels.labelName, input.labelName)))
        .run();
    }),

  getLabels: publicProcedure
    .input(z.object({ sessionId: z.string() }))
    .query(({ input }) => {
      const drizzle = getDatabaseManager().drizzle;
      return drizzle
        .select()
        .from(schema.sessionLabels)
        .where(eq(schema.sessionLabels.sessionId, input.sessionId))
        .all()
        .map((row) => ({ sessionId: row.sessionId, labelName: row.labelName, labelColor: row.labelColor }));
    }),

  listByLabel: publicProcedure
    .input(z.object({ labelName: z.string() }))
    .query(({ input }) => {
      // JOIN 쿼리 — raw SQL 유지
      const db = getDatabaseManager().getDb();
      return (db
        .prepare(
          `SELECT s.* FROM sessions s
           JOIN session_labels sl ON s.id = sl.session_id
           WHERE sl.label_name = ?
           ORDER BY s.created_at DESC`
        )
        .all(input.labelName) as SessionRow[])
        .map(rowToSession);
    }),

  // ── M7-03: 세션 자동 정리 (GC) ──────────────────────────────────────────
  gc: publicProcedure
    .input(z.object({ dryRun: z.boolean().default(true) }))
    .mutation(({ input }) => {
      const db = getDatabaseManager().getDb();
      // settingsStore의 sessionGcDays는 renderer 측이므로 기본 30일 사용.
      // datetime 비교는 raw SQL 유지 (drizzle의 sqlite datetime 함수 미지원)
      const cutoffDays = 30;
      const rows = db
        .prepare(
          `SELECT id FROM sessions
           WHERE status IN ('stopped', 'error')
           AND created_at < datetime('now', '-' || ? || ' days')`
        )
        .all(cutoffDays) as { id: string }[];

      const ids = rows.map((r) => r.id);

      if (input.dryRun) {
        return { archivedCount: ids.length, archivedIds: ids };
      }

      // soft delete: status → 'archived'
      if (ids.length > 0) {
        const drizzle = getDatabaseManager().drizzle;
        drizzle.update(schema.sessions)
          .set({ status: 'archived' })
          .where(inArray(schema.sessions.id, ids))
          .run();
      }
      return { archivedCount: ids.length, archivedIds: ids };
    }),

  archive: publicProcedure
    .input(z.object({ sessionId: z.string() }))
    .mutation(({ input }) => {
      const drizzle = getDatabaseManager().drizzle;
      drizzle.update(schema.sessions)
        .set({ status: 'archived' })
        .where(eq(schema.sessions.id, input.sessionId))
        .run();
      return { success: true };
    }),

  // ── M9-02: 세션 내보내기 ──────────────────────────────────────────────────
  export: publicProcedure
    .input(z.object({
      sessionId: z.string(),
      format: z.enum(['html', 'txt', 'json']),
      includeTimestamp: z.boolean().default(true),
      includeAnsi: z.boolean().default(false),
    }))
    .mutation(async ({ input }) => {
      const drizzle = getDatabaseManager().drizzle;
      const [sessionRow] = drizzle.select().from(schema.sessions).where(eq(schema.sessions.id, input.sessionId)).all();
      if (!sessionRow) throw new Error(`Session ${input.sessionId} not found`);
      const session = sessionRow as unknown as SessionRow;

      // scrollback 데이터 추출
      const [scrollbackRow] = drizzle
        .select({ data: schema.sessionScrollbacks.data })
        .from(schema.sessionScrollbacks)
        .where(eq(schema.sessionScrollbacks.sessionId, input.sessionId))
        .all();
      let content = scrollbackRow?.data ?? '';

      // ANSI 코드 제거 (txt/json 또는 includeAnsi=false 시)
      const stripAnsi = (str: string) => str.replace(/\x1B\[[0-9;]*[A-Za-z]/g, '').replace(/\x1B\][^\x07]*\x07/g, '');

      const timestamp = input.includeTimestamp ? `Exported: ${new Date().toISOString()}\nSession: ${session.name} (${session.id})\nCreated: ${session.created_at}\n\n` : '';

      let output = '';
      let ext = 'txt';

      if (input.format === 'txt') {
        output = timestamp + stripAnsi(content);
        ext = 'txt';
      } else if (input.format === 'json') {
        output = JSON.stringify({
          sessionId: session.id,
          sessionName: session.name,
          createdAt: session.created_at,
          exportedAt: new Date().toISOString(),
          content: stripAnsi(content),
        }, null, 2);
        ext = 'json';
      } else {
        // HTML format
        const body = input.includeAnsi ? content : stripAnsi(content);
        const escaped = body.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        output = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>${session.name}</title>
<style>body{background:#1e1e2e;color:#cdd6f4;font-family:monospace;white-space:pre-wrap;padding:20px;}
.header{color:#89b4fa;margin-bottom:16px;}</style></head>
<body>${input.includeTimestamp ? `<div class="header">Session: ${session.name}<br>Created: ${session.created_at}<br>Exported: ${new Date().toISOString()}</div>` : ''}${escaped}</body></html>`;
        ext = 'html';
      }

      const result = await dialog.showSaveDialog({
        title: 'Export Session',
        defaultPath: `${session.name.replace(/[^a-zA-Z0-9_-]/g, '_')}.${ext}`,
        filters: [
          { name: ext.toUpperCase(), extensions: [ext] },
          { name: 'All Files', extensions: ['*'] },
        ],
      });

      if (result.canceled || !result.filePath) {
        return { success: false, filePath: '' };
      }

      fs.writeFileSync(result.filePath, output, 'utf-8');
      return { success: true, filePath: result.filePath };
    }),

  // ── M9-04: 세션 아카이브 검색 ─────────────────────────────────────────────
  searchArchive: publicProcedure
    .input(z.object({ query: z.string().min(1) }))
    .query(({ input }) => {
      const { app: electronApp } = require('electron');
      const archiveDir = path.join(electronApp.getPath('home'), '.maestro', 'sessions');

      if (!fs.existsSync(archiveDir)) {
        return [];
      }

      const results: Array<{
        sessionId: string;
        sessionName: string;
        date: string;
        matchingLines: Array<{ lineNumber: number; content: string }>;
      }> = [];

      const files = fs.readdirSync(archiveDir).filter((f: string) => f.endsWith('.log'));
      const searchLower = input.query.toLowerCase();

      for (const file of files) {
        const filePath = path.join(archiveDir, file);
        const sessionId = file.replace('.log', '');

        try {
          const stat = fs.statSync(filePath);
          const content = fs.readFileSync(filePath, 'utf-8');
          const lines = content.split('\n');
          const matchingLines: Array<{ lineNumber: number; content: string }> = [];

          for (let i = 0; i < lines.length; i++) {
            if (lines[i].toLowerCase().includes(searchLower)) {
              matchingLines.push({ lineNumber: i + 1, content: lines[i].slice(0, 200) });
              if (matchingLines.length >= 5) break; // 파일당 최대 5개 매칭
            }
          }

          if (matchingLines.length > 0) {
            // DB에서 세션 이름 조회
            const drizzle = getDatabaseManager().drizzle;
            const [sessionNameRow] = drizzle
              .select({ name: schema.sessions.name })
              .from(schema.sessions)
              .where(eq(schema.sessions.id, sessionId))
              .all();

            results.push({
              sessionId,
              sessionName: sessionNameRow?.name ?? sessionId,
              date: stat.mtime.toISOString(),
              matchingLines,
            });
          }
        } catch {
          // 파일 읽기 실패 시 무시
        }
      }

      return results.slice(0, 20); // 최대 20개 결과
    }),
});
