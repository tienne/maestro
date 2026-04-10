/**
 * 프로세스 리소스 모니터링 서비스.
 * pidusage로 세션별 PID의 CPU/메모리를 5초마다 수집하고
 * 구독자(콜백)에게 메트릭을 전달한다.
 */

import pidusage from 'pidusage';
import log from 'electron-log';

export interface ProcessMetrics {
  sessionId: string;
  pid: number;
  cpu: number;   // 0~100 (%)
  memory: number; // bytes
}

type MetricsListener = (metrics: ProcessMetrics[]) => void;

const POLL_INTERVAL_MS = 5_000;

class ResourceMonitor {
  private pidMap: Map<string, number> = new Map(); // sessionId → pid
  private listeners: Set<MetricsListener> = new Set();
  private timer: ReturnType<typeof setInterval> | null = null;

  register(sessionId: string, pid: number): void {
    this.pidMap.set(sessionId, pid);
    this.ensurePolling();
  }

  unregister(sessionId: string): void {
    this.pidMap.delete(sessionId);
    if (this.pidMap.size === 0) this.stopPolling();
  }

  subscribe(listener: MetricsListener): () => void {
    this.listeners.add(listener);
    this.ensurePolling();
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0) this.stopPolling();
    };
  }

  private ensurePolling(): void {
    if (this.timer !== null) return;
    this.timer = setInterval(() => this.poll(), POLL_INTERVAL_MS);
  }

  private stopPolling(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  private async poll(): Promise<void> {
    if (this.pidMap.size === 0) return;

    const pids = Array.from(this.pidMap.entries());
    const results: ProcessMetrics[] = [];

    for (const [sessionId, pid] of pids) {
      try {
        const stat = await pidusage(pid);
        results.push({
          sessionId,
          pid,
          cpu: Math.round(stat.cpu * 10) / 10,
          memory: stat.memory,
        });
      } catch {
        // 프로세스가 종료된 경우 조용히 건너뜀
        log.debug(`[ResourceMonitor] PID ${pid} no longer running, skipping`);
      }
    }

    if (results.length > 0) {
      this.listeners.forEach((listener) => listener(results));
    }
  }

  destroy(): void {
    this.stopPolling();
    this.listeners.clear();
    this.pidMap.clear();
  }
}

let instance: ResourceMonitor | null = null;

export function getResourceMonitor(): ResourceMonitor {
  if (!instance) instance = new ResourceMonitor();
  return instance;
}
