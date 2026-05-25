import { createClient, SupabaseClient } from '@supabase/supabase-js';

export type { SupabaseClient };

/**
 * Supabase 클라이언트 팩토리.
 * 데스크탑(VITE 환경변수)과 모바일(Expo Constants) 양측에서 런타임 값을 주입한다.
 */
export function createSupabaseClient(url: string, anonKey: string): SupabaseClient {
  return createClient(url, anonKey, {
    auth: {
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
    },
  });
}
