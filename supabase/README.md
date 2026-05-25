# Maestro Supabase 설정 가이드

## 3단계로 Supabase 백엔드 준비하기

### 1단계 — Supabase 프로젝트 생성

1. [app.supabase.com](https://app.supabase.com) 접속
2. **New Project** 클릭
3. 프로젝트 이름: `maestro`, 비밀번호 설정, 리전 선택 (Seoul 권장)
4. 생성 완료 후 **Settings > API** 에서 다음 값 복사:
   - `Project URL` → `VITE_SUPABASE_URL`
   - `anon public` key → `VITE_SUPABASE_ANON_KEY`
   - `JWT Secret` → `SUPABASE_JWT_SECRET` (릴레이 서버용)

### 2단계 — SQL 스키마 실행

1. Supabase 대시보드 **SQL Editor** 클릭
2. `supabase/schema.sql` 파일 전체 내용 붙여넣기
3. **Run** 클릭

생성되는 테이블:
- `public.user_profiles` — 유저 프로필 (auth.users 확장)
- `public.relay_sessions` — 데스크탑 세션 메타데이터

RLS가 자동으로 활성화되어 본인 데이터만 접근 가능합니다.

### 3단계 — 환경변수 설정

**데스크탑 앱:**
```bash
cp apps/desktop/.env.example apps/desktop/.env
# .env 파일을 열어 실제 값 입력
```

**릴레이 서버:**
```bash
cp packages/relay-server/.env.example packages/relay-server/.env
# .env 파일을 열어 실제 값 입력
```

## 환경변수 정리

| 변수 | 사용처 | 설명 |
|------|--------|------|
| `VITE_SUPABASE_URL` | 데스크탑, 모바일 | Supabase Project URL |
| `VITE_SUPABASE_ANON_KEY` | 데스크탑, 모바일 | 공개 anon 키 |
| `SUPABASE_JWT_SECRET` | 릴레이 서버 | JWT 검증용 시크릿 |
