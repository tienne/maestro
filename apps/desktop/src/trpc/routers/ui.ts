/**
 * appStateRouter, uiRouter, panesRouter, layoutRouter, dialogRouter,
 * shellRouter, systemRouter, resourceRouter, fileRouter
 * 원본 router.ts lines 2960-3202
 */

import { router, publicProcedure } from '../trpc';
import { z } from 'zod';
import { observable } from '@trpc/server/observable';
import * as fs from 'fs';
import { dialog, shell, BrowserWindow } from 'electron';
import { getDatabaseManager } from '../../db/database';
import { getPtyManager } from '../../services/pty-manager';
import { getMainWindow } from '../../main';
import { AppStateService } from '../../services/app-state-service';
import type { AppState as LocalAppState } from '../../services/app-state-service';
import type { AppState } from '@maestro/shared-types';

// ── appStateRouter ────────────────────────────────────────────────────────────

export const appStateRouter = router({
  load: publicProcedure.query((): AppState => {
    const state = AppStateService.getInstance().get();
    return {
      sidebarWidth: state.sidebarWidth,
      rightSidebarWidth: state.rightSidebarWidth,
    } as AppState;
  }),

  save: publicProcedure
    .input(z.object({ state: z.record(z.string(), z.unknown()) }))
    .mutation(async ({ input }) => {
      await AppStateService.getInstance().set(input.state as Partial<LocalAppState>);
    }),
});

// ── uiRouter ──────────────────────────────────────────────────────────────────

export const uiRouter = router({
  loadState: publicProcedure.query((): AppState => {
    const state = AppStateService.getInstance().get();
    return {
      sidebarWidth: state.sidebarWidth,
      rightSidebarWidth: state.rightSidebarWidth,
      activeWorkspaceId: state.activeWorkspaceId,
    } as AppState;
  }),

  saveState: publicProcedure
    .input(z.record(z.string(), z.unknown()))
    .mutation(async ({ input }) => {
      await AppStateService.getInstance().set(input as Partial<LocalAppState>);
    }),

  focus: publicProcedure
    .input(z.object({ target: z.string() }))
    .mutation(({ input }) => {
      const win = getMainWindow();
      if (win && !win.isDestroyed()) {
        win.webContents.send('ui-focus', { target: input.target });
      }
    }),

  sidebar: publicProcedure
    .input(z.object({ open: z.boolean(), side: z.enum(['left', 'right']).optional() }))
    .mutation(({ input }) => {
      const win = getMainWindow();
      if (win && !win.isDestroyed()) {
        win.webContents.send('ui-sidebar', input);
      }
    }),

  tabs: publicProcedure
    .input(
      z.object({
        activeTab: z.string(),
        panel: z.enum(['terminal', 'git', 'mcp']).optional(),
      })
    )
    .mutation(({ input }) => {
      const win = getMainWindow();
      if (win && !win.isDestroyed()) {
        win.webContents.send('ui-tabs', input);
      }
    }),
});

// ── panesRouter ───────────────────────────────────────────────────────────────

export const panesRouter = router({
  terminalSend: publicProcedure
    .input(z.object({ sessionId: z.string(), text: z.string() }))
    .mutation(({ input }) => {
      getPtyManager().write(input.sessionId, input.text);
    }),

  terminalRead: publicProcedure
    .input(z.object({ sessionId: z.string() }))
    .query(({ input }) => {
      // PTY 출력은 push 방식이므로 실시간 read는 IPC event로 처리.
      // 여기서는 세션 생존 여부만 반환한다.
      return { alive: getPtyManager().isAlive(input.sessionId) };
    }),
});

// ── layoutRouter ──────────────────────────────────────────────────────────────

export const layoutRouter = router({
  get: publicProcedure
    .input(z.object({ workspaceId: z.string() }))
    .query(({ input }) => {
      const db = getDatabaseManager();
      const layout = db.getTiledLayout(input.workspaceId);
      if (!layout) return null;
      return {
        id: layout.id,
        workspaceId: layout.workspaceId,
        mosaicState: JSON.parse(layout.mosaicState),
        updatedAt: layout.updatedAt,
      };
    }),

  save: publicProcedure
    .input(z.object({ workspaceId: z.string(), mosaicState: z.any() }))
    .mutation(({ input }) => {
      const db = getDatabaseManager();
      return db.saveTiledLayout(input.workspaceId, JSON.stringify(input.mosaicState));
    }),
});

// ── dialogRouter ──────────────────────────────────────────────────────────────

export const dialogRouter = router({
  openDirectory: publicProcedure.mutation(async () => {
    const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
    const opts = { properties: ['openDirectory', 'createDirectory'] as Electron.OpenDialogOptions['properties'] };
    const result = win
      ? await dialog.showOpenDialog(win, opts)
      : await dialog.showOpenDialog(opts);
    if (result.canceled || result.filePaths.length === 0) return null;
    return result.filePaths[0];
  }),
});

// ── shellRouter ───────────────────────────────────────────────────────────────

export const shellRouter = router({
  openPath: publicProcedure
    .input(z.object({ filePath: z.string().min(1) }))
    .mutation(async ({ input }) => {
      await shell.openPath(input.filePath);
    }),

  readFile: publicProcedure
    .input(z.object({ filePath: z.string().min(1) }))
    .query(({ input }) => {
      try {
        return { content: fs.readFileSync(input.filePath, 'utf-8'), exists: true };
      } catch {
        return { content: '', exists: false };
      }
    }),

  writeFile: publicProcedure
    .input(z.object({ filePath: z.string().min(1), content: z.string() }))
    .mutation(({ input }) => {
      fs.writeFileSync(input.filePath, input.content, 'utf-8');
      return { success: true };
    }),
});

// ── systemRouter (M7-04) ─────────────────────────────────────────────────────

export const systemRouter = router({
  openLogsFolder: publicProcedure.mutation(async () => {
    const { getLogsFolder } = await import('../../services/error-logger');
    const logsDir = getLogsFolder();
    await shell.openPath(logsDir);
    return { path: logsDir };
  }),
});

// ── resourceRouter ────────────────────────────────────────────────────────────

export const resourceRouter = router({
  /** 세션별 프로세스 메트릭 실시간 구독 (5초 주기) */
  subscribe: publicProcedure
    .subscription(() => {
      const { getResourceMonitor } = require('../../services/resource-monitor') as typeof import('../../services/resource-monitor');
      return observable<import('../../services/resource-monitor').ProcessMetrics[]>((emit) => {
        const unsub = getResourceMonitor().subscribe((metrics) => emit.next(metrics));
        return unsub;
      });
    }),

  /** 세션 PID 등록/해제 */
  register: publicProcedure
    .input(z.object({ sessionId: z.string(), pid: z.number().int().positive() }))
    .mutation(({ input }) => {
      const { getResourceMonitor } = require('../../services/resource-monitor') as typeof import('../../services/resource-monitor');
      getResourceMonitor().register(input.sessionId, input.pid);
    }),

  unregister: publicProcedure
    .input(z.object({ sessionId: z.string() }))
    .mutation(({ input }) => {
      const { getResourceMonitor } = require('../../services/resource-monitor') as typeof import('../../services/resource-monitor');
      getResourceMonitor().unregister(input.sessionId);
    }),
});

// ── fileRouter (M3-03: 마크다운 파일 워쳐) ──────────────────────────────────

export const fileRouter = router({
  watchMarkdown: publicProcedure
    .input(z.object({ filePath: z.string().min(1) }))
    .subscription(({ input }) => {
      return observable<{ content: string; exists: boolean }>((emit) => {
        // 초기 내용 전송
        try {
          const content = fs.readFileSync(input.filePath, 'utf-8');
          emit.next({ content, exists: true });
        } catch {
          emit.next({ content: '', exists: false });
        }

        // fs.watch로 파일 변경 감지
        let watcher: fs.FSWatcher | null = null;
        let debounceTimer: ReturnType<typeof setTimeout> | null = null;
        try {
          watcher = fs.watch(input.filePath, () => {
            // 150ms 디바운스
            if (debounceTimer) clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => {
              try {
                const content = fs.readFileSync(input.filePath, 'utf-8');
                emit.next({ content, exists: true });
              } catch {
                emit.next({ content: '', exists: false });
              }
            }, 150);
          });
        } catch {
          // 파일이 아직 존재하지 않을 수 있음 — 무시
        }

        return () => {
          if (debounceTimer) clearTimeout(debounceTimer);
          watcher?.close();
        };
      });
    }),

  readMarkdown: publicProcedure
    .input(z.object({ filePath: z.string().min(1) }))
    .query(({ input }) => {
      try {
        return { content: fs.readFileSync(input.filePath, 'utf-8'), exists: true };
      } catch {
        return { content: '', exists: false };
      }
    }),
});
