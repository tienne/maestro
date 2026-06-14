/**
 * tRPC Router — Electron Main Process
 *
 * 도메인별 라우터로 분리된 진입점.
 * 각 라우터는 apps/desktop/src/trpc/routers/ 디렉토리에 위치한다.
 */

// tRPC 인스턴스 re-export (하위 호환)
export { router, publicProcedure } from './trpc';

import { workspaceRouter } from './routers/workspace';
import { sessionRouter } from './routers/session';
import { presetRouter, templateRouter } from './routers/preset-template';
import { agentRouter } from './routers/agent';
import { repositoryRouter } from './routers/repository';
import { gitRouter } from './routers/git';
import { mcpRouter } from './routers/mcp';
import {
  appStateRouter,
  uiRouter,
  panesRouter,
  layoutRouter,
  dialogRouter,
  shellRouter,
  systemRouter,
  resourceRouter,
  fileRouter,
} from './routers/ui';
import { webhookRouter, apiKeyRouter, relayRouter } from './routers/integration';
import { pluginRouter, profileRouter, themeRouter } from './routers/customization';
import { projectRouter, projectTaskRouter } from './routers/project';
import { claudeRouter, chatRouter } from './routers/chat';
import { router, t } from './trpc';

export const appRouter = router({
  workspace: workspaceRouter,
  session: sessionRouter,
  agent: agentRouter,
  repository: repositoryRouter,
  git: gitRouter,
  mcp: mcpRouter,
  appState: appStateRouter,
  ui: uiRouter,
  panes: panesRouter,
  layout: layoutRouter,
  dialog: dialogRouter,
  shell: shellRouter,
  system: systemRouter,
  resource: resourceRouter,
  file: fileRouter,
  preset: presetRouter,
  template: templateRouter,
  webhook: webhookRouter,
  apiKey: apiKeyRouter,
  relay: relayRouter,
  plugin: pluginRouter,
  profile: profileRouter,
  theme: themeRouter,
  project: projectRouter,
  projectTask: projectTaskRouter,
  claude: claudeRouter,
  chat: chatRouter,
});

export type AppRouter = typeof appRouter;

// 테스트에서 서버 사이드 caller 생성에 사용
export const createCaller = t.createCallerFactory(appRouter);
