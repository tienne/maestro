# Maestro 모바일 컴패니언 앱 로드맵

> **Spec ID:** `167c08b3` | **인터뷰 해상도:** 0.91  
> **Spec 파일:** `_workspace/mobile_companion_spec.json`  
> **기준일:** 2026-04-12

---

## 개요

이동 중에도 Maestro 데스크탑의 AI 세션을 모니터링하고 프롬프트를 전송할 수 있는 모바일 컴패니언 앱.

**핵심 결정: 데스크탑도 Supabase 로그인 필수**  
데스크탑 앱은 앞으로 로그인 후에만 사용 가능하다. 릴레이 서버 JWT 인증 및 사용자 식별을 위한 것이기도 하지만, 장기적으로 팀 공유·클라우드 동기화의 기반이 된다.

```
[로그인 화면] ──인증──▶ [Maestro 데스크탑 (앱 본체)]
                              │
                              │ WebSocket (Supabase JWT)
                              ▼
                        [릴레이 서버]
                              │
                              │ WebSocket (Supabase JWT)
                              ▼
                        [모바일 앱]
```

---

## 인프라 스택 (전부 무료)

| 레이어 | 기술 | 용도 |
|--------|------|------|
| 모바일 앱 | React Native + Expo | iOS + Android |
| 인증 | Supabase Auth | 이메일 / Google / GitHub OAuth |
| DB | Supabase PostgreSQL | desktop_instances, mobile_sessions |
| 실시간 | WebSocket 릴레이 서버 | 데스크탑 ↔ 모바일 메시지 중계 |
| 릴레이 배포 | Railway 또는 Render 무료 플랜 | Node.js + ws |
| 타입 공유 | `packages/shared-types` | Session, Message 인터페이스 |

---

## 제약 조건

- 무료 티어만 사용 — 유료 서비스 도입 금지
- 메시지 지연 3초 이내 (WebSocket round-trip)
- 초기 동시 접속자 5명 이하, 단일 데스크탑 인스턴스 연결
- Maestro 기존 Nx 모노레포에 통합 (`apps/mobile/`, `packages/relay-server/`)

---

## Phase 1 — MVP

**목표:** 로그인 → 세션 목록 확인 → 채팅 전송 → AI 응답 수신 전체 플로우 동작

---

### F-M11-00. 데스크탑 계정 시스템 (선행 작업)

**배경**  
데스크탑 앱을 로그인 필수 앱으로 전환. 인증 안 된 상태에서는 앱 본체에 진입 불가.

**스펙**

- **로그인 화면** (`LoginScreen.tsx` 신규)
  - `AppShell` 진입 전에 렌더링 (인증 상태 확인 → 미인증 시 로그인 화면)
  - 이메일+비밀번호 / Google / GitHub 소셜 로그인
  - Supabase Auth SDK (`@supabase/supabase-js`) 사용
  - 토큰은 Electron `safeStorage`로 암호화 저장 (keychain 활용)

- **authStore** (`store/authStore.ts` 신규)
  - `user: SupabaseUser | null`
  - `session: Session | null`
  - `signIn()`, `signOut()`, `refreshSession()`
  - 앱 시작 시 저장된 세션 복원 (자동 로그인)

- **설정 > 계정** 섹션 추가 (`SettingsPage.tsx`)
  - 내비게이션 그룹 최상단에 '계정' 그룹 추가
  - 로그인된 사용자 정보 표시 (이메일, 프로필 이미지)
  - 로그아웃 버튼 → `signOut()` 호출 → 로그인 화면으로 이동
  - 연결된 소셜 계정 표시

- **온보딩 위자드** — 로그인 이후에만 표시 (순서 변경 불필요)

**수용 기준**
- [ ] 미인증 상태에서 앱 실행 시 로그인 화면 표시 (앱 본체 접근 불가)
- [ ] 로그인 성공 후 앱 본체 진입
- [ ] 앱 재시작 시 저장된 세션으로 자동 로그인
- [ ] 설정 > 계정에서 현재 사용자 정보 확인 가능
- [ ] 로그아웃 후 로그인 화면으로 이동, 기존 세션 완전 삭제

---

### F-M11-01. WebSocket 릴레이 서버

**배경**  
현재 Maestro의 relay router는 스텁(500ms 타임아웃 시뮬레이션)만 존재함.  
NAT/방화벽 뒤의 데스크탑과 모바일을 연결하려면 중앙 중계 서버가 필요함.

**스펙**
- `packages/relay-server/` 신규 Nx 패키지 (Node.js + `ws` 라이브러리)
- 데스크탑 ↔ 서버 ↔ 모바일 WebSocket 브릿지
- Room 기반 연결 관리: `roomId = userId:desktopInstanceId`
- 메시지 프로토콜:
  ```
  session:list       데스크탑 → 서버 → 모바일  세션 목록 동기화
  session:output     데스크탑 → 서버 → 모바일  터미널 출력 스트리밍
  session:input      모바일   → 서버 → 데스크탑 프롬프트 전송
  ping / pong        양방향                    heartbeat (30s)
  ```
- Supabase JWT로 연결 인증 (`Authorization: Bearer <token>` 헤더)
- Railway 또는 Render 무료 플랜 배포 설정 포함 (`render.yaml` / `railway.toml`)

**수용 기준**
- [ ] 데스크탑-서버 WebSocket 연결 및 heartbeat 동작
- [ ] 모바일-서버 WebSocket 연결 및 메시지 중계
- [ ] Railway/Render 배포 후 실제 접근 가능
- [ ] 유효하지 않은 JWT 연결 거부 (401)

---

### F-M11-02. Supabase 백엔드 설정

**배경**  
사용자 인증, 데스크탑 인스턴스 등록, 세션 메타데이터 영속화를 Supabase 무료 티어로 처리.

**스펙**
- Supabase 프로젝트 생성 + 환경 변수 문서화 (`.env.example`)
- Auth: 이메일+비밀번호, Google OAuth, GitHub OAuth
- DB 스키마:
  ```sql
  CREATE TABLE desktop_instances (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    device_name  TEXT NOT NULL,
    relay_token  TEXT UNIQUE NOT NULL,  -- 릴레이 연결 식별자
    status       TEXT DEFAULT 'offline', -- 'online' | 'offline'
    connected_at TIMESTAMPTZ
  );

  CREATE TABLE mobile_sessions (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    desktop_instance_id UUID REFERENCES desktop_instances(id) ON DELETE CASCADE,
    agent_name          TEXT,
    title               TEXT,
    status              TEXT DEFAULT 'active', -- 'active' | 'idle' | 'completed'
    created_at          TIMESTAMPTZ DEFAULT NOW()
  );

  -- RLS 정책
  ALTER TABLE desktop_instances ENABLE ROW LEVEL SECURITY;
  ALTER TABLE mobile_sessions ENABLE ROW LEVEL SECURITY;

  CREATE POLICY "users see own instances" ON desktop_instances
    FOR ALL USING (auth.uid() = user_id);

  CREATE POLICY "users see own sessions" ON mobile_sessions
    FOR ALL USING (
      desktop_instance_id IN (
        SELECT id FROM desktop_instances WHERE user_id = auth.uid()
      )
    );
  ```
- `packages/supabase/` — Supabase 클라이언트 초기화 + 공유 타입

**수용 기준**
- [ ] 이메일 / Google / GitHub 로그인 동작
- [ ] RLS로 타 사용자 데이터 접근 차단 확인
- [ ] `desktop_instances` 테이블에 데스크탑 등록 / 해제 동작

---

### F-M11-03. 데스크탑-릴레이 연동

**배경**  
Maestro Electron 앱이 시작 시 릴레이 서버에 자동 연결되어 세션 상태와 터미널 출력을 브로드캐스트.  
현재 relay router 스텁(`apps/desktop/src/trpc/router.ts:3126-3164`)을 실제 구현으로 교체.

**스펙**
- `apps/desktop/src/main/relay-client.ts` 신규 (Electron 메인 프로세스)
  - 앱 시작 시 Supabase Auth JWT로 릴레이 서버 WebSocket 연결
  - 설정에서 "모바일 연결" 토글로 on/off
- 이벤트 연동:
  - 세션 생성/종료 → `session:list` 브로드캐스트
  - 터미널 출력 → `session:output` 브로드캐스트 (청크 단위)
  - `session:input` 수신 → 해당 세션 PTY에 write
- tRPC relay router 실제 구현으로 교체 (스텁 제거)

**수용 기준**
- [ ] 앱 시작 시 릴레이 자동 연결 (설정 토글 연동)
- [ ] 세션 목록 변경 시 모바일에 실시간 동기화
- [ ] 터미널 출력이 3초 이내 모바일에 전달
- [ ] 모바일 입력이 해당 터미널에 주입

---

### F-M11-04. React Native 모바일 앱 (MVP)

**배경**  
iOS + Android에서 세션 목록 확인 및 실시간 채팅이 가능한 모바일 앱.

**스펙**
- `apps/mobile/` 신규 Expo 앱 (React Native + TypeScript)
- Nx 모노레포 통합 (`@nx/expo` 플러그인)
- **화면 구성:**

  | 화면 | 경로 | 기능 |
  |------|------|------|
  | `LoginScreen` | `/` | Supabase Auth (이메일 / Google / GitHub) |
  | `SessionListScreen` | `/sessions` | 데스크탑 인스턴스 + 세션 목록, 연결 상태 표시 |
  | `ChatScreen` | `/sessions/:id` | 실시간 채팅 (프롬프트 입력 + AI 출력 스트리밍) |

- 상태 관리: Zustand (데스크탑과 동일 패턴)
- WebSocket: 릴레이 서버 직접 연결 (Supabase Realtime은 대안)
- `packages/shared-types`에서 `Session`, `Message` 타입 공유
- 다크 모드 지원 (Maestro 색상 토큰 참조)

**수용 기준**
- [ ] 로그인 후 세션 목록 화면 진입
- [ ] 세션 선택 → 채팅 화면 → 프롬프트 전송
- [ ] AI 응답 실시간 스트리밍 표시
- [ ] 전체 플로우 3초 이내 지연
- [ ] iOS 시뮬레이터 + Android 에뮬레이터 동작

---

## Phase 2 — 확장 기능

### F-M11-05. 모바일 푸시 알림

**배경**  
세션 완료 또는 에러 발생 시 백그라운드에서도 알림.

**스펙**
- Expo Push Notifications API
- 알림 트리거: `session:completed`, `session:error`
- 릴레이 서버에서 Expo Push API 호출
- 알림 탭 시 해당 세션 채팅 화면으로 딥링크

**수용 기준**
- [ ] 세션 완료 시 푸시 알림 수신
- [ ] 알림 탭으로 앱 열기 및 해당 세션 이동

---

### F-M11-06. 오프라인 히스토리

- 대화 내역 로컬 저장 (MMKV 또는 SQLite)
- 오프라인 상태에서 이전 대화 열람

---

### F-M11-07. 멀티 워크스페이스 / 팀 공유

- 여러 데스크탑 인스턴스 전환
- Supabase RLS 기반 팀원 초대 및 접근 제어

---

## 구현 순서

```
[1] F-M11-02 Supabase 설정
      │  (Auth + DB + RLS 먼저 준비)
      ▼
[2] F-M11-00 데스크탑 계정 시스템
      │  (로그인 화면 + authStore + 설정>계정)
      │  (Supabase 프로젝트 준비 후 진행)
      ▼
[3] F-M11-01 릴레이 서버
      │  (Supabase JWT 인증 의존)
      ▼
[4] F-M11-03 데스크탑-릴레이 연동
      │  (릴레이 서버 엔드포인트 + authStore 의존)
      ▼
[5] F-M11-04 모바일 앱
      │  (전체 스택 준비된 후 UI 구현)
      ▼
[6] F-M11-05~07 Phase 2 기능
```

---

## 파일 구조 (예상)

```
maestro/
├── apps/
│   ├── desktop/src/
│   │   ├── main/
│   │   │   └── relay-client.ts             # 데스크탑 WebSocket 클라이언트
│   │   └── renderer/
│   │       ├── components/
│   │       │   ├── auth/
│   │       │   │   └── LoginScreen.tsx      # 로그인 화면 (신규)
│   │       │   └── settings/
│   │       │       └── SettingsPage.tsx     # 계정 섹션 추가
│   │       └── store/
│   │           └── authStore.ts             # Supabase 인증 상태 (신규)
│   └── mobile/                             # Expo 앱 (신규)
│       ├── app/
│       │   ├── index.tsx                   # LoginScreen
│       │   └── sessions/
│       │       ├── index.tsx               # SessionListScreen
│       │       └── [id].tsx                # ChatScreen
│       ├── store/
│       │   └── relayStore.ts               # Zustand WebSocket 상태
│       └── app.json
├── packages/
│   ├── relay-server/                       # WebSocket 릴레이 (신규)
│   │   ├── src/index.ts
│   │   ├── render.yaml
│   │   └── railway.toml
│   └── supabase/                           # Supabase 클라이언트 + 타입 (신규)
│       └── src/index.ts
└── .env.example                            # SUPABASE_URL, SUPABASE_ANON_KEY, RELAY_URL
```

---

## 성공 기준

1. **데스크탑 인증**: 미로그인 상태에서 앱 본체 접근 불가, 로그인 후 자동 유지
2. **계정 설정**: 설정 > 계정에서 사용자 정보 확인 및 로그아웃 가능
3. **모바일 인증**: 모바일 앱에서 이메일 / 소셜 로그인 가능
4. **세션 목록**: 데스크탑 실행 중인 AI 세션 목록 모바일에 표시
5. **채팅**: 모바일 프롬프트 → 데스크탑 AI 에이전트 → 모바일 응답 스트리밍
6. **지연**: 전체 플로우 3초 이내
7. **배포**: 릴레이 서버가 Railway/Render 무료 플랜에서 실제 동작
