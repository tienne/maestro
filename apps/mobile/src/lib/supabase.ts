import { createClient, SupabaseClient } from '@supabase/supabase-js';
import Constants from 'expo-constants';

const supabaseUrl: string = Constants.expoConfig?.extra?.supabaseUrl ?? '';
const supabaseAnonKey: string = Constants.expoConfig?.extra?.supabaseAnonKey ?? '';

if (!supabaseUrl || !supabaseAnonKey) {
  console.warn('[supabase] Missing supabaseUrl or supabaseAnonKey in app.json extra');
}

export const supabase: SupabaseClient = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});
