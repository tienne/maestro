-- ============================================================
-- Maestro Supabase Schema
-- Run this in the Supabase Dashboard > SQL Editor
-- ============================================================

-- user_profiles: auth.users 확장 테이블 (공개 프로필)
CREATE TABLE IF NOT EXISTS public.user_profiles (
  id          UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT,
  avatar_url  TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 신규 유저 가입 시 자동으로 user_profiles 행 삽입
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.user_profiles (id)
  VALUES (NEW.id)
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- relay_sessions: 데스크탑 세션 메타데이터
CREATE TABLE IF NOT EXISTS public.relay_sessions (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  session_name   TEXT NOT NULL DEFAULT '',
  last_active_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ============================================================
-- RLS (Row Level Security)
-- ============================================================

-- user_profiles RLS
ALTER TABLE public.user_profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "user_profiles: 본인만 읽기" ON public.user_profiles
  FOR SELECT USING (auth.uid() = id);

CREATE POLICY "user_profiles: 본인만 수정" ON public.user_profiles
  FOR UPDATE USING (auth.uid() = id);

-- relay_sessions RLS
ALTER TABLE public.relay_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "relay_sessions: 본인만 SELECT" ON public.relay_sessions
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "relay_sessions: 본인만 INSERT" ON public.relay_sessions
  FOR INSERT WITH CHECK (auth.uid() = user_id);

CREATE POLICY "relay_sessions: 본인만 UPDATE" ON public.relay_sessions
  FOR UPDATE USING (auth.uid() = user_id);

CREATE POLICY "relay_sessions: 본인만 DELETE" ON public.relay_sessions
  FOR DELETE USING (auth.uid() = user_id);
