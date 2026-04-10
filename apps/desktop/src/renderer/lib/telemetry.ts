/**
 * 텔레메트리 유틸리티 — posthog-js 기반.
 *
 * 옵트인 방식: settingsStore.telemetryEnabled가 true일 때만 이벤트를 전송한다.
 * PII(개인식별정보)는 수집하지 않는다.
 *
 * POSTHOG_API_KEY가 설정되지 않은 경우 (개발/자체빌드 환경) 이벤트를 조용히 무시한다.
 */

import posthog from 'posthog-js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const API_KEY = (import.meta as any).env?.['VITE_POSTHOG_API_KEY'] as string | undefined;
const API_HOST = 'https://app.posthog.com';

let initialized = false;

function init(): void {
  if (initialized || !API_KEY) return;
  posthog.init(API_KEY, {
    api_host: API_HOST,
    autocapture: false,
    capture_pageview: false,
    disable_session_recording: true,
    persistence: 'localStorage',
  });
  initialized = true;
}

export const telemetry = {
  /**
   * 텔레메트리 활성화/비활성화.
   * 비활성화 시 posthog opt-out 처리.
   */
  setEnabled(enabled: boolean): void {
    if (!API_KEY) return;
    if (enabled) {
      init();
      posthog.opt_in_capturing();
    } else {
      posthog.opt_out_capturing();
    }
  },

  capture(event: string, properties?: Record<string, unknown>): void {
    if (!API_KEY || !initialized) return;
    posthog.capture(event, properties);
  },
};
