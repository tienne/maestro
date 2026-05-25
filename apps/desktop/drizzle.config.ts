import { defineConfig } from 'drizzle-kit';
import * as path from 'path';
import * as os from 'os';

// 런타임에는 electron의 app.getPath('userData')로 결정되지만,
// drizzle-kit CLI(마이그레이션 생성)는 Electron 컨텍스트 밖에서 실행되므로
// 환경변수 MAESTRO_DB_PATH 또는 OS별 기본 userData 경로를 폴백으로 사용한다.
function resolveDbUrl(): string {
  if (process.env.MAESTRO_DB_PATH) {
    return process.env.MAESTRO_DB_PATH;
  }

  // Electron의 app.getPath('userData') 기본값과 동일한 경로 계산
  const platform = process.platform;
  let userDataDir: string;

  if (platform === 'darwin') {
    userDataDir = path.join(os.homedir(), 'Library', 'Application Support', 'maestro');
  } else if (platform === 'win32') {
    userDataDir = path.join(process.env.APPDATA ?? os.homedir(), 'maestro');
  } else {
    userDataDir = path.join(os.homedir(), '.config', 'maestro');
  }

  return path.join(userDataDir, 'maestro.db');
}

export default defineConfig({
  dialect: 'sqlite',
  schema: './src/db/schema.ts',
  out: './drizzle',
  dbCredentials: {
    url: resolveDbUrl(),
  },
});
