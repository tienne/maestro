import { ChildProcess, spawn } from 'node:child_process';
import * as path from 'node:path';
import log from 'electron-log';

export class HostServiceManager {
  private process: ChildProcess | null = null;
  private port: number | null = null;
  private portResolvers: Array<(port: number) => void> = [];
  private portRejecters: Array<(err: Error) => void> = [];
  private onReauthRequired?: () => void;

  /**
   * host-service stdout에서 HOST_REAUTH_REQUIRED 신호가 감지됐을 때 호출할 콜백을 등록한다.
   * main/index.ts에서 broadcastReauthRequired를 주입해 circular dependency를 피한다.
   */
  setReauthCallback(cb: () => void): void {
    this.onReauthRequired = cb;
  }

  async start(): Promise<void> {
    // __dirname은 동적 임포트로 인해 out/main/chunks/ 에 위치 → 한 단계 위로
    const hostServicePath = path.join(__dirname, '../host-service/index.js');

    log.info('[host-service] Spawning from', hostServicePath);

    this.process = spawn('node', [hostServicePath], {
      env: { ...process.env },
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    this.process.stdout?.on('data', (data: Buffer) => {
      const text = data.toString();

      // HOST_SERVICE_PORT 감지 — child process가 서버 시작 후 출력하는 포트 신호
      const portMatch = text.match(/HOST_SERVICE_PORT=(\d+)/);
      if (portMatch) {
        this.port = parseInt(portMatch[1], 10);
        log.info('[host-service] Port detected:', this.port);
        const resolvers = this.portResolvers.splice(0);
        for (const resolve of resolvers) {
          resolve(this.port);
        }
      }

      // HOST_REAUTH_REQUIRED 감지 — token-manager가 OAuth 갱신 실패 시 출력하는 재인증 신호
      if (text.includes('HOST_REAUTH_REQUIRED')) {
        log.warn('[host-service] Reauth required signal received — broadcasting to renderer');
        this.onReauthRequired?.();
      }

      log.info('[host-service] stdout:', text.trim());
    });

    this.process.stderr?.on('data', (data: Buffer) => {
      log.error('[host-service]', data.toString().trim());
    });

    this.process.on('exit', (code, signal) => {
      log.warn(`[host-service] Process exited (code=${code}, signal=${signal})`);
      this.port = null;
      this.process = null;
      // 포트를 받지 못한 채 종료 → 대기 중인 Promise 모두 reject
      const rejecters = this.portRejecters.splice(0);
      for (const reject of rejecters) {
        reject(new Error(`host-service exited before providing port (code=${code})`));
      }
      this.portResolvers.splice(0);
    });

    const port = await this.getPort();
    await this.waitForHealthy(port);
  }

  async getPort(): Promise<number> {
    if (this.port !== null) {
      return this.port;
    }
    return new Promise<number>((resolve, reject) => {
      this.portResolvers.push(resolve);
      this.portRejecters.push(reject);
    });
  }

  private async waitForHealthy(port: number, maxRetries = 10): Promise<void> {
    for (let i = 0; i < maxRetries; i++) {
      try {
        const res = await fetch(`http://127.0.0.1:${port}/health`);
        if (res.ok) return;
      } catch {
        await new Promise((r) => setTimeout(r, 100));
      }
    }
    throw new Error(`host-service health check failed after ${maxRetries} retries`);
  }

  stop(): void {
    if (this.process) {
      this.process.kill('SIGTERM');
    }
    this.port = null;
    this.process = null;
  }

  isRunning(): boolean {
    return this.process !== null && !this.process.killed;
  }
}

export const hostServiceManager = new HostServiceManager();
