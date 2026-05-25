import { createClient, SupabaseClient } from '@supabase/supabase-js';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

let _supabase: SupabaseClient | null = null;

export function getSupabaseClient(): SupabaseClient {
  if (!_supabase) {
    if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
      throw new Error('Supabase 환경변수가 설정되지 않았습니다 (VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY)');
    }
    _supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  }
  return _supabase;
}

export const isSupabaseConfigured = !!(SUPABASE_URL && SUPABASE_ANON_KEY);

// 하위 호환 — 환경변수 없으면 null
export const supabase = isSupabaseConfigured ? createClient(SUPABASE_URL!, SUPABASE_ANON_KEY!) : null;
