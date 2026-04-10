import { useEffect, useRef, useState } from 'react';
import { useResourceMetrics } from './useResourceMetrics';

export interface ResourceHistoryPoint {
  timestamp: number;
  cpu: number;   // %
  memMb: number; // MB
}

const MAX_HISTORY_POINTS = 60; // 1시간 (1분 간격)
const SAMPLE_INTERVAL_MS = 60_000; // 1분

/**
 * M7-02: 리소스 히스토리 훅.
 * 세션별 CPU/메모리를 1분 간격으로 샘플링하여 최근 60포인트 유지.
 */
export function useResourceHistory(): Record<string, ResourceHistoryPoint[]> {
  const metricsMap = useResourceMetrics();
  const [history, setHistory] = useState<Record<string, ResourceHistoryPoint[]>>({});
  const lastSample = useRef(0);

  useEffect(() => {
    const id = setInterval(() => {
      const now = Date.now();
      if (now - lastSample.current < SAMPLE_INTERVAL_MS * 0.9) return;
      lastSample.current = now;

      setHistory((prev) => {
        const next = { ...prev };
        for (const [sessionId, m] of Object.entries(metricsMap)) {
          const points = [...(next[sessionId] ?? [])];
          points.push({
            timestamp: now,
            cpu: m.cpu,
            memMb: m.memory / 1024 / 1024,
          });
          // 최근 60포인트만 유지
          if (points.length > MAX_HISTORY_POINTS) {
            points.splice(0, points.length - MAX_HISTORY_POINTS);
          }
          next[sessionId] = points;
        }
        return next;
      });
    }, SAMPLE_INTERVAL_MS);

    return () => clearInterval(id);
  }, [metricsMap]);

  // 즉시 첫 샘플 기록
  useEffect(() => {
    if (Object.keys(metricsMap).length === 0) return;
    const now = Date.now();
    if (lastSample.current === 0) {
      lastSample.current = now;
      setHistory((prev) => {
        const next = { ...prev };
        for (const [sessionId, m] of Object.entries(metricsMap)) {
          const points = [...(next[sessionId] ?? [])];
          points.push({
            timestamp: now,
            cpu: m.cpu,
            memMb: m.memory / 1024 / 1024,
          });
          next[sessionId] = points;
        }
        return next;
      });
    }
  }, [metricsMap]);

  return history;
}
