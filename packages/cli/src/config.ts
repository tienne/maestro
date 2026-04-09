import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

interface ServerConfig {
  port: number;
  token: string;
  pid: number;
  startedAt: string;
}

export function readServerConfig(): ServerConfig {
  const configPath = path.join(os.homedir(), '.maestro', 'server.json');
  if (!fs.existsSync(configPath)) {
    throw new Error('Maestro desktop is not running. Start the app first.');
  }
  return JSON.parse(fs.readFileSync(configPath, 'utf-8'));
}
