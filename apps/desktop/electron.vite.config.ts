import { defineConfig, externalizeDepsPlugin } from 'electron-vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { tanstackRouter } from '@tanstack/router-plugin/vite';
import { resolve } from 'path';
import { copyFileSync, cpSync, existsSync, mkdirSync } from 'fs';

/** M7-05: splash.html을 main 빌드 출력 디렉토리에 복사 */
function copySplashPlugin() {
  return {
    name: 'copy-splash-html',
    closeBundle() {
      const src = resolve(__dirname, 'src/main/splash.html');
      const destDir = resolve(__dirname, 'out/main');
      if (!existsSync(destDir)) mkdirSync(destDir, { recursive: true });
      copyFileSync(src, resolve(destDir, 'splash.html'));
    },
  };
}

/** drizzle/ 마이그레이션 폴더를 out/main 옆에 복사 — 런타임에 migrate()가 참조 */
function copyDrizzleMigrationsPlugin() {
  return {
    name: 'copy-drizzle-migrations',
    closeBundle() {
      const src = resolve(__dirname, 'drizzle');
      const dest = resolve(__dirname, 'out/drizzle');
      if (existsSync(src)) {
        if (!existsSync(dest)) mkdirSync(dest, { recursive: true });
        cpSync(src, dest, { recursive: true });
      }
    },
  };
}

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin(), copySplashPlugin(), copyDrizzleMigrationsPlugin()],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/main/index.ts'),
          'host-service/index': resolve(__dirname, 'src/main/host-service/index.ts'),
        },
        external: [
          '@trpc/server',
          /^@trpc\/server\/.*/,
          '@anthropic-ai/sdk',
          /^@anthropic-ai\/sdk\/.*/,
          'hono',
          /^hono\/.*/,
          '@hono/node-server',
          /^@hono\/node-server\/.*/,
          'ai',
          /^ai\/.*/,
          '@ai-sdk/anthropic',
          /^@ai-sdk\/anthropic\/.*/,
          '@ai-sdk/openai',
          /^@ai-sdk\/openai\/.*/,
          '@ai-sdk/google',
          /^@ai-sdk\/google\/.*/,
        ],
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin({ exclude: ['@electron-toolkit/preload', 'electron-trpc'] })],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/preload/index.ts'),
        },
      },
    },
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve(__dirname, 'src/renderer'),
        '@': resolve(__dirname, 'src/renderer'),
        '@maestro/shared-types': resolve(__dirname, '../../packages/shared-types/src/index.ts'),
      },
    },
    plugins: [
      tanstackRouter({
        target: 'react',
        autoCodeSplitting: true,
        routesDirectory: resolve(__dirname, 'src/renderer/routes'),
        generatedRouteTree: resolve(__dirname, 'src/renderer/routeTree.gen.ts'),
      }),
      tailwindcss(),
      react(),
    ],
    build: {
      rollupOptions: {
        input: {
          index: resolve(__dirname, 'src/renderer/index.html'),
        },
      },
    },
  },
});
