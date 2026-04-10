/**
 * M3: 세션 인텔리전스 데이터 구독 훅.
 * tRPC subscription으로 세션별 비용/작업/에러/완료 정보를 실시간 수신한다.
 */
import { useState, useEffect, useRef } from 'react';
import { trpc } from '../lib/trpc';
import { useSettingsStore } from '../store/settingsStore';
import { toast } from '../lib/toast';
import type { SessionIntelligence } from '@maestro/shared-types';

export function useSessionIntelligence(sessionId: string | null): SessionIntelligence | null {
  const [state, setState] = useState<SessionIntelligence | null>(null);
  const costWarningThreshold = useSettingsStore((s) => s.costWarningThreshold);
  const warningShownRef = useRef(false);

  // tRPC subscription
  trpc.session.subscribeIntelligence.useSubscription(
    { sessionId: sessionId ?? '' },
    {
      enabled: !!sessionId,
      onData(data) {
        setState(data as SessionIntelligence | null);
      },
    },
  );

  // 비용 경고 알림
  useEffect(() => {
    if (!state?.costs) return;
    if (state.costs.totalCostUsd >= costWarningThreshold && !warningShownRef.current) {
      warningShownRef.current = true;
      toast.error(
        'Cost Warning',
        `Session cost ($${state.costs.totalCostUsd.toFixed(2)}) exceeded threshold ($${costWarningThreshold})`,
      );
    }
  }, [state?.costs, costWarningThreshold]);

  // 세션 변경 시 경고 리셋
  useEffect(() => {
    warningShownRef.current = false;
    setState(null);
  }, [sessionId]);

  return state;
}

/**
 * 개별 세션의 인텔리전스를 일회성 쿼리로 조회 (폴링/초기 로딩용)
 */
export function useSessionIntelligenceQuery(sessionId: string | null) {
  return trpc.session.getIntelligence.useQuery(
    { sessionId: sessionId ?? '' },
    { enabled: !!sessionId, refetchInterval: 5000 },
  );
}
