/**
 * pluginRouter, profileRouter, themeRouter — 원본 router.ts lines 3520-3762
 */

import { router, publicProcedure } from '../trpc';
import { z } from 'zod';
import * as fs from 'fs';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import { dialog } from 'electron';
import { getDatabaseManager } from '../../db/database';
import * as schema from '../../db/schema';
import { eq, desc } from 'drizzle-orm';

// ── M10-01: pluginRouter ────────────────────────────────────────────────────

export const pluginRouter = router({
  list: publicProcedure.query(() => {
    const drizzle = getDatabaseManager().drizzle;
    return drizzle
      .select()
      .from(schema.plugins)
      .orderBy(desc(schema.plugins.loadedAt))
      .all()
      .map((row) => ({
        id: row.id, name: row.name, version: row.version, path: row.path,
        enabled: row.enabled, loadedAt: row.loadedAt,
      }));
  }),

  load: publicProcedure
    .input(z.object({ pluginPath: z.string().min(1) }))
    .mutation(({ input }) => {
      const manifestPath = path.join(input.pluginPath, 'maestro-plugin.json');
      if (!fs.existsSync(manifestPath)) {
        throw new Error(`No maestro-plugin.json found at ${input.pluginPath}`);
      }

      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf-8'));
      if (!manifest.name || !manifest.version || !manifest.entry) {
        throw new Error('Invalid manifest: name, version, and entry are required');
      }

      const entryPath = path.join(input.pluginPath, manifest.entry);
      if (!fs.existsSync(entryPath)) {
        throw new Error(`Plugin entry file not found: ${entryPath}`);
      }

      const drizzle = getDatabaseManager().drizzle;
      const id = uuidv4();

      // 같은 경로의 플러그인이 이미 로드되어 있으면 교체
      drizzle.delete(schema.plugins).where(eq(schema.plugins.path, input.pluginPath)).run();

      drizzle.insert(schema.plugins).values({
        id, name: manifest.name, version: manifest.version, path: input.pluginPath, enabled: true,
      }).run();

      const [row] = drizzle.select().from(schema.plugins).where(eq(schema.plugins.id, id)).all();
      return {
        id: row.id, name: row.name, version: row.version, path: row.path,
        enabled: row.enabled, loadedAt: row.loadedAt,
      };
    }),

  unload: publicProcedure
    .input(z.object({ pluginId: z.string() }))
    .mutation(({ input }) => {
      const drizzle = getDatabaseManager().drizzle;
      drizzle.delete(schema.plugins).where(eq(schema.plugins.id, input.pluginId)).run();
    }),
});

// ── M9-03: profileRouter ───────────────────────────────────────────────────

export const profileRouter = router({
  export: publicProcedure.mutation(async () => {
    const drizzle = getDatabaseManager().drizzle;

    // 에이전트 목록
    const agents = drizzle
      .select()
      .from(schema.agents)
      .where(eq(schema.agents.isBuiltIn, false))
      .all()
      .map((row) => ({
        id: row.id, name: row.name, command: row.command,
        args: JSON.parse(row.args) as string[],
        env: JSON.parse(row.env) as Record<string, string>,
        isBuiltIn: false, scriptPath: row.scriptPath ?? null, scriptContent: row.scriptContent ?? null,
      }));

    // MCP 서버 목록
    const mcpServers = drizzle
      .select()
      .from(schema.mcpServers)
      .all()
      .map((row) => ({ name: row.name, url: row.url, enabled: row.enabled }));

    const profile = {
      agents,
      mcpServers,
      // 나머지 설정은 렌더러가 localStorage에서 추출하여 전달할 수 없으므로
      // 기본값으로 내보냄 — 실제 설정은 렌더러에서 JSON에 merge
      theme: 'dark',
      accentColor: '#e07850',
      terminalTheme: 'default',
      terminalFont: 'Courier New',
      appThemeName: 'default',
    };

    const result = await dialog.showSaveDialog({
      title: 'Export Profile',
      defaultPath: '.maestro-profile.json',
      filters: [
        { name: 'Maestro Profile', extensions: ['json'] },
        { name: 'All Files', extensions: ['*'] },
      ],
    });

    if (result.canceled || !result.filePath) {
      return { success: false, filePath: '' };
    }

    fs.writeFileSync(result.filePath, JSON.stringify(profile, null, 2), 'utf-8');
    return { success: true, filePath: result.filePath };
  }),

  import: publicProcedure
    .input(z.object({ mode: z.enum(['merge', 'overwrite']) }))
    .mutation(async ({ input }) => {
      const result = await dialog.showOpenDialog({
        title: 'Import Profile',
        filters: [
          { name: 'Maestro Profile', extensions: ['json'] },
          { name: 'All Files', extensions: ['*'] },
        ],
        properties: ['openFile'],
      });

      if (result.canceled || result.filePaths.length === 0) {
        return { success: false };
      }

      const content = fs.readFileSync(result.filePaths[0], 'utf-8');
      const profile = JSON.parse(content);
      const drizzle = getDatabaseManager().drizzle;

      if (input.mode === 'overwrite') {
        // 기존 커스텀 에이전트 제거
        drizzle.delete(schema.agents).where(eq(schema.agents.isBuiltIn, false)).run();
        drizzle.delete(schema.mcpServers).run();
      }

      // 에이전트 가져오기
      if (Array.isArray(profile.agents)) {
        for (const agent of profile.agents) {
          drizzle.insert(schema.agents)
            .values({
              id: agent.id ?? uuidv4(),
              name: agent.name,
              command: agent.command,
              args: JSON.stringify(agent.args ?? []),
              env: JSON.stringify(agent.env ?? {}),
              isBuiltIn: false,
            })
            .onConflictDoNothing()
            .run();
        }
      }

      // MCP 서버 가져오기
      if (Array.isArray(profile.mcpServers)) {
        for (const server of profile.mcpServers) {
          drizzle.insert(schema.mcpServers)
            .values({ id: uuidv4(), name: server.name, url: server.url, enabled: Boolean(server.enabled) })
            .onConflictDoNothing()
            .run();
        }
      }

      return { success: true };
    }),
});

// ── M10-03: themeRouter ────────────────────────────────────────────────────

export const themeRouter = router({
  export: publicProcedure
    .input(z.object({ name: z.string().min(1), variables: z.record(z.string(), z.string()) }))
    .mutation(async ({ input }) => {
      const themeData = {
        name: input.name,
        variables: input.variables,
      };

      const result = await dialog.showSaveDialog({
        title: 'Export Theme',
        defaultPath: `${input.name.replace(/[^a-zA-Z0-9_-]/g, '_')}.maestro-theme.json`,
        filters: [
          { name: 'Maestro Theme', extensions: ['json'] },
          { name: 'All Files', extensions: ['*'] },
        ],
      });

      if (result.canceled || !result.filePath) {
        return { success: false, filePath: '' };
      }

      fs.writeFileSync(result.filePath, JSON.stringify(themeData, null, 2), 'utf-8');
      return { success: true, filePath: result.filePath };
    }),

  import: publicProcedure.mutation(async () => {
    const result = await dialog.showOpenDialog({
      title: 'Import Theme',
      filters: [
        { name: 'Maestro Theme', extensions: ['json'] },
        { name: 'All Files', extensions: ['*'] },
      ],
      properties: ['openFile'],
    });

    if (result.canceled || result.filePaths.length === 0) {
      return null;
    }

    const content = fs.readFileSync(result.filePaths[0], 'utf-8');
    const theme = JSON.parse(content);

    if (!theme.name || !theme.variables) {
      throw new Error('Invalid theme file: name and variables are required');
    }

    return { name: theme.name as string, variables: theme.variables as Record<string, string> };
  }),
});
