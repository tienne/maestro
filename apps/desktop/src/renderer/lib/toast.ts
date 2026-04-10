/**
 * Maestro toast helper — sonner 기반 타입-안전 토스트 래퍼
 * 앱 전역에서 일관된 토스트 스타일 유지.
 */
import { toast as sonnerToast } from 'sonner';

export const toast = {
  success: (msg: string, description?: string) =>
    sonnerToast.success(msg, { description }),

  error: (msg: string, description?: string) =>
    sonnerToast.error(msg, { description }),

  info: (msg: string, description?: string) =>
    sonnerToast.info(msg, { description }),

  loading: (msg: string) =>
    sonnerToast.loading(msg),

  dismiss: (id?: string | number) =>
    sonnerToast.dismiss(id),
};
