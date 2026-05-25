# Conductor 아키텍처 분석

> Conductor Mac 앱의 내부 구조와 작동 원리를 리버스 엔지니어링으로 분석한 문서.  
> 분석 시점: 2026-05-25 / 앱 버전: 0.56.1 / Claude Code: 2.1.139

---

## 1. 앱 유형 및 기술 스택

Conductor는 **하이브리드 네이티브 macOS 앱**이다. UI와 런타임은 컴파일된 네이티브 바이너리로, 에이전트 실행 레이어는 Node.js로 구성된 이중 구조를 사용한다.

| 레이어 | 구현 방식 | 크기 |
|--------|-----------|------|
| 메인 앱 실행파일 | 컴파일된 네이티브 ARM64 바이너리 | 48.6MB |
| 핵심 런타임 엔진 | `conductor-runtime` (별도 프로세스) | 63.1MB |
| 에이전트 실행 레이어 | Node.js + `@anthropic-ai/claude-agent-sdk v0.1.28` | 478KB (번들) |
| 상태 저장소 | SQLite (`conductor.db`) | ~700MB |
| 번들 CLI | GitHub CLI (`gh`), `watchexec` | 50.8MB + 7MB |

---

## 2. 파일시스템 구조

### 2.1 앱 번들

```
/Applications/Conductor.app/Contents/
├── Info.plist                        # 번들 메타데이터 (ID: com.conductor.app)
├── MacOS/
│   └── conductor*                    # 메인 실행파일 (48.6MB, ARM64)
└── Resources/
    ├── icon.icns
    └── bin/
        ├── checkpointer.sh           # 작업 체크포인트 스크립트
        ├── git-busy-check.sh         # git 상태 확인 스크립트
        ├── spotlighter.sh            # macOS Spotlight 인덱싱 연동
        ├── watchexec                 # 파일 변경 감시 바이너리 (7MB)
        ├── gh                        # GitHub CLI 내장 (50.8MB)
        └── .internal/
            ├── conductor-runtime*    # 핵심 런타임 엔진 (63.1MB)
            ├── actions               # 쉘 래퍼
            ├── internal              # 쉘 래퍼
            ├── sidecar               # 쉘 래퍼
            └── logger                # 쉘 래퍼
```

### 2.2 앱 데이터 디렉터리

```
~/Library/Application Support/com.conductor.app/
├── conductor.db                      # 핵심 SQLite DB (697MB)
├── conductor.db-shm                  # SQLite 공유 메모리
├── conductor.db-wal                  # SQLite WAL 트랜잭션 로그 (4.8MB)
├── index.bundled.js                  # Node.js 에이전트 번들 (478KB)
├── install-claude.sh                 # Claude Code 버전 설치/업그레이드 스크립트
├── .window-state.json                # 윈도우 위치·크기 상태
├── .bin-source-markers.json          # 바이너리 버전 추적
├── bin/                              # 버전별 에이전트 바이너리 심링크
│   └── .internal/conductor-runtime  # 런타임 심링크
├── agent-binaries/
│   ├── claude/2.1.139/claude         # Claude Code CLI (205MB, ARM64)
│   └── codex/0.130.0/codex           # Codex 에이전트 (레거시)
├── vendor/                           # 크로스플랫폼 바이너리
│   ├── aarch64-apple-darwin/
│   ├── x86_64-apple-darwin/
│   ├── linux/
│   └── windows/
├── sidecar/                          # Node.js 런타임 환경
├── local-storage.entries/            # UI 세션 상태 JSON
│   ├── composer-drafts               # 작성 중인 메시지 초안
│   ├── terminal-history              # 터미널 히스토리
│   └── context-windows               # 컨텍스트 창 상태
├── terminal-shell-integration/       # 쉘 통합 파일
├── uploads/                          # 사용자 업로드 파일
└── logs/
    └── latest-server.json            # 현재 로컬 HTTP 서버 포트 기록
```

### 2.3 워크스페이스 구조

```
~/conductor/
├── cc/claude                         # 전역 Claude CLI (167MB)
├── repos/                            # (예약)
└── workspaces/                       # 모든 워크스페이스 루트
    ├── wad-fe/
    │   ├── amsterdam-v1/             # 이 문서가 위치한 현재 워크스페이스
    │   ├── algiers/
    │   ├── bilbao/
    │   ├── doha-v2/
    │   ├── jakarta-v1/
    │   ├── missoula/
    │   ├── new-york-v1/
    │   ├── pattaya-v2/
    │   ├── riyadh/
    │   └── tacoma-v3/
    ├── design/
    │   ├── bangalore-v1/
    │   ├── bilbao-v1/
    │   └── cebu-v1/
    ├── biz-admin/
    ├── ct-catchtable-android/
    ├── ct-fe-skills/
    ├── fe-setup/
    ├── gestalt/
    ├── maestro/
    └── pos-frontend/

~/.conductor/projects/                # 프로젝트 메타데이터 (경로 인코딩 방식)
~/.maestro/hooks/                     # 세션 라이프사이클 훅 스크립트 (15개)
```

각 워크스페이스 디렉터리 내부:

```
[workspace]/
├── .context/                         # Conductor 세션 상태 (gitignored)
│   ├── todos.md                      # 작업 목록
│   ├── plans/                        # 실행 계획 파일
│   └── attachments/                  # 첨부 파일
├── .claude/
│   ├── settings.json                 # 워크스페이스별 Claude 설정
│   └── commands/                     # 커스텀 슬래시 커맨드
└── [실제 git 리포지토리 파일들]
```

---

## 3. 데이터베이스 (conductor.db)

Conductor의 모든 상태는 단일 SQLite 파일(`conductor.db`, 697MB)에 저장된다.

### 핵심 테이블

| 테이블 | 역할 |
|--------|------|
| `repos` | 리포지토리 등록 (UUID, 경로, 이름) |
| `workspaces` | git 워크트리 ↔ 리포지토리 매핑 |
| `sessions` | 에이전트 세션 (UUID, 상태, 모델, permission_mode) |
| `session_messages` | 전체 대화 히스토리 |
| `settings` | 전역 설정 key-value 스토어 |
| `diff_comments` | 코드 리뷰 인라인 댓글 |
| `terminal_sessions` | 터미널 세션 관리 |
| `port_forwards` | 포트 포워딩 설정 |
| `symlinks_pending_deletion` | 삭제 대기 중인 심링크 정리 큐 |

### 워크스페이스 예시 레코드

```
repo_id:       84151fdc-c715-41dc-884d-283cead808b6  (wad-fe 리포)
workspace_id:  f1cb0534-5806-4807-9f99-b6f4164ca93f  (amsterdam-v1)
branch:        conductor
```

---

## 4. 병렬 에이전트 실행 메커니즘

### 4.1 git worktree 기반 격리

Conductor의 핵심 아이디어: **각 워크스페이스 = git worktree 1개**.  
동일 리포지토리의 서로 다른 브랜치에서 에이전트들이 동시에 독립적으로 작업한다.

```
리포지토리: ~/work/wad/ct-catchtable-frontend
├── amsterdam-v1  워크트리  →  conductor 브랜치          (AI 어시스턴트 태스크)
├── algiers       워크트리  →  ai-screening-interview 브랜치
├── doha-v2       워크트리  →  docs/ga-vs-amplitude-user-id 브랜치
├── jakarta-v1    워크트리  →  feature/xxx 브랜치
└── ...
```

이 구조 덕분에 파일 충돌 없이 10개 이상의 에이전트가 동시에 같은 리포지토리에서 작업할 수 있다.

### 4.2 Claude Code 프로세스 실행 방식

Conductor가 각 세션에서 Claude Code를 스폰할 때 사용하는 인수:

```bash
/Users/kwon-david/Library/Application\ Support/com.conductor.app/agent-binaries/claude/2.1.139/claude \
  --output-format stream-json \        # JSON 스트림으로 출력 → Conductor가 파싱
  --verbose \
  --input-format stream-json \         # JSON 스트림으로 입력 수신
  --max-thinking-tokens 16000 \        # 내부 추론 토큰 제한
  --thinking-display summarized \      # 추론 과정 요약 표시
  --effort high \                      # 최고 품질 모드
  --max-turns 1000 \                   # 최대 1000턴 (장시간 자율 작업)
  --model sonnet \                     # Claude Sonnet 사용
  --permission-prompt-tool stdio \     # stdio 통해 권한 처리
  --disallowedTools AskUserQuestion \  # 에이전트가 직접 질문 불가
  --setting-sources=user,project,local \
  --permission-mode bypassPermissions  # 모든 툴 자동 승인
```

**핵심 설계 원칙:**

| 인수 | 의미 |
|------|------|
| `bypassPermissions` | Conductor UI가 권한 프롬프트를 직접 관리 — Claude가 멈추지 않음 |
| `--max-turns 1000` | 수천 개의 툴 호출이 필요한 장시간 작업도 중단 없이 실행 |
| `stream-json` I/O | Conductor가 실시간으로 모든 메시지를 가로채 DB에 저장 |
| `disallowedTools AskUserQuestion` | 에이전트가 사용자에게 직접 묻지 않음 — Conductor가 중재자 역할 |

---

## 5. 세션 라이프사이클 & Maestro 훅

### 5.1 이벤트 흐름

```
사용자 프롬프트 입력
        │
        ▼
Conductor UI (네이티브 앱)
        │
        ▼
conductor.db에 세션 UUID 생성
        │
        ▼
git worktree 경로 매핑
        │
        ▼
Claude Code 프로세스 스폰
(session-id, resume 플래그 포함)
        │
        ├─▶ Maestro 훅 실행: UserPromptSubmit → "session:started"
        │
        ▼
Claude Code 작업 실행 (stream-json I/O)
   툴 호출 → PostToolUse 훅
   오류 발생 → PostToolUseFailure 훅
   권한 요청 → PermissionRequest 훅
        │
        ▼
작업 완료
        │
        ├─▶ Maestro 훅 실행: Stop → "session:completed"
        │
        ▼
결과 conductor.db 저장
(session_messages 테이블)
        │
        ▼
Conductor UI 업데이트
```

### 5.2 Maestro 훅 구조

`~/.maestro/hooks/` 디렉터리에 세션별 훅 스크립트 15개가 위치한다.  
모든 훅은 로컬 HTTP 서버로 이벤트를 POST한다:

```bash
#!/bin/bash
# ~/.maestro/hooks/[session-uuid].sh

curl -s -X POST "http://127.0.0.1:59801/api/events" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer [token]" \
  -d "{
    \"type\": \"$EVENT_TYPE\",
    \"sessionId\": \"[uuid]\",
    \"agentType\": \"claude-code\"
  }" \
  --connect-timeout 2 --max-time 5 || true
```

### 5.3 훅 이벤트 매핑

| Claude Code 훅 | 발생 시점 | Conductor 이벤트 |
|---------------|-----------|-----------------|
| `UserPromptSubmit` | 프롬프트 제출 시 | `session:started` |
| `Stop` | 에이전트 작업 완료 시 | `session:completed` |
| `PostToolUse` | 툴 호출 성공 후 | Superset 알림 |
| `PostToolUseFailure` | 툴 호출 실패 후 | Superset 알림 |
| `PermissionRequest` | 권한 요청 시 | Superset 알림 |
| `SessionStart` | 세션 초기화 시 | Superset 알림 |
| `SessionEnd` | 세션 종료 시 | Superset 알림 |

---

## 6. 네트워크 아키텍처

```
┌─────────────────────────────────────────────────────────────┐
│                     로컬 머신 (Mac)                          │
│                                                             │
│  Conductor UI ──────────────────────────────────────────┐  │
│       │                                                  │  │
│       │ spawn                                            │  │
│       ▼                                                  ▼  │
│  Claude Code ──stream-json──▶ conductor.db (SQLite)      │  │
│       │                                                  │  │
│       │ (각 워크스페이스 = git worktree)                   │  │
│       │                                                  │  │
│  Maestro Hooks ──POST──▶ 127.0.0.1:59801 (이벤트 수신기) │  │
└───────┼──────────────────────────────────────────────────┘  │
        │
        ├──HTTPS──▶ api.conductor.build           (Conductor 클라우드)
        │
        ├──HTTPS──▶ wapple-proxy.wadcorp.in       (사내 Claude API 프록시)
        │            /claude/ak/[api_key]
        │
        └──HTTPS──▶ otel-collector.infra.wadcorp.co.kr  (OpenTelemetry 텔레메트리)
```

**주목할 점:** Claude API 호출이 `wapple-proxy.wadcorp.co.kr`를 경유한다.  
이는 사내에서 API 키를 중앙 관리하고 사용량을 추적하기 위한 프록시다.

---

## 7. Claude Code 설정 레이어

Conductor는 여러 레이어의 Claude 설정을 계층적으로 적용한다.

```
적용 우선순위 (낮음 → 높음)
─────────────────────────────
1. 전역 사용자 설정      ~/.claude/settings.json
2. 프로젝트 설정         [workspace]/.claude/settings.json
3. 로컬 설정             [workspace]/.claude/settings.local.json
4. Conductor 실행 인수   --permission-mode bypassPermissions 등
```

### 전역 설정 주요 내용 (`~/.claude/settings.json`)

```json
{
  "env": {
    "ENABLE_TOOL_SEARCH": "auto:5"
  },
  "skipDangerousModePermissionPrompt": true,
  "skipAutoPermissionPrompt": true,
  "permissions": {
    "defaultMode": "auto"
  }
}
```

설정 파일에 `"_maestroMarker": "# maestro-managed"` 마커가 있어 Maestro가 이 파일을 자동 관리한다.

### 활성화된 플러그인

| 플러그인 | 출처 |
|----------|------|
| `harness@harness-marketplace` | Conductor 기본 |
| `gestalt@gestalt` | github.com/tienne/gestalt |
| `setup-npm-registry@catchtable` | github.com/catchtable/fe-setup |
| `figma@claude-plugins-official` | 공식 플러그인 |
| `setup-plate-mcp@catchtable` | github.com/catchtable/fe-setup |

---

## 8. 실행 중인 프로세스 구조

Conductor가 실행 중일 때 다음 프로세스들이 동시에 동작한다:

```
Conductor.app (PID ~17016)
├── conductor-runtime sidecar (PID ~17719)   # 에이전트 실행 관리
├── conductor-runtime logger  (PID ~17626)   # 로그 수집
└── Claude Code 인스턴스들 (복수)
    ├── claude --session-id [uuid1] ...      # 워크스페이스 1 에이전트
    ├── claude --session-id [uuid2] ...      # 워크스페이스 2 에이전트
    └── ...                                  # 필요한 만큼 병렬 실행
```

---

## 9. 디버깅 & 탐색 커맨드

Conductor 내부 상태를 직접 확인하고 싶을 때 사용 가능한 읽기 전용 커맨드들:

```bash
# DB 테이블 목록 확인
sqlite3 ~/Library/Application\ Support/com.conductor.app/conductor.db ".tables"

# 현재 실행 중인 세션 조회
sqlite3 ~/Library/Application\ Support/com.conductor.app/conductor.db \
  "SELECT id, status, model, created_at FROM sessions ORDER BY created_at DESC LIMIT 10;"

# 현재 로컬 HTTP 서버 포트 확인
cat ~/Library/Application\ Support/com.conductor.app/logs/latest-server.json

# 실행 중인 Conductor 관련 프로세스 확인
ps aux | grep -E "conductor|claude" | grep -v grep

# 활성 git 워크트리 목록
git worktree list

# Maestro 훅 내용 확인
ls ~/.maestro/hooks/ && cat ~/.maestro/hooks/$(ls ~/.maestro/hooks/ | head -1)
```

---

## 10. 아키텍처 요약

Conductor는 **git worktree 기반 병렬 에이전트 오케스트레이터**다.

**핵심 설계 결정:**
1. **워크트리 격리** — 같은 리포지토리에서 여러 에이전트가 충돌 없이 작업 가능
2. **SQLite 중앙 DB** — 모든 세션·메시지·설정을 단일 파일에 통합 관리
3. **stream-json I/O** — Claude Code의 모든 입출력을 Conductor가 실시간으로 제어
4. **Maestro 훅** — 세션 라이프사이클을 외부에서 관찰·기록 가능한 훅 기반 아키텍처
5. **bypassPermissions** — 사용자 인터럽트 없이 장시간 자율 작업 지원
6. **하이브리드 아키텍처** — 네이티브 UI + Node.js 에이전트 레이어 분리로 확장성 확보
