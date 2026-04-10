import { useState } from 'react';
import { trpc } from '../lib/trpc';
import type { ProcessMetrics } from '@maestro/shared-types';

/**
 * 프로세스 리소스 메트릭 구독 훅.
 * tRPC subscription으로 메인 프로세스에서 5초마다 수신한다.
 */
export function useResourceMetrics(): Record<string, ProcessMetrics> {
  const [metricsMap, setMetricsMap] = useState<Record<string, ProcessMetrics>>({});

  trpc.resource.subscribe.useSubscription(undefined, {
    onData(data) {
      const metrics = data as ProcessMetrics[];
      setMetricsMap((prev) => {
        const next = { ...prev };
        for (const m of metrics) {
          next[m.sessionId] = m;
        }
        return next;
      });
    },
  });

  return metricsMap;
}
