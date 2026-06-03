# Conductor 리버스 엔지니어링 분석

> 분석 대상: `/Applications/Conductor.app` (macOS 네이티브 앱)
> 분석 방법: 바이너리 strings 추출 + SKILL.md + conductor-skill 플러그인

---

## 앱 구조

```
Conductor.app/Contents/
├── MacOS/
│   └── conductor              ← 메인 macOS 바이너리 (Tauri/Swift UI)
└── Resources/
    ├── bin/
    │   ├── checkpointer.sh    ← git 체크포인트 쉘 스크립트
    │   ├── gh                 ← GitHub CLI 번들
    │   ├── git-busy-check.sh
    │   ├── spotlighter.sh
    │   ├── watchexec
    │   └── .internal/
    │       ├── conductor-runtime   ← 핵심 런타임 (Node.js/Bun 번들, ~40MB)
    │       ├── sidecar             ← conductor-runtime sidecar 서브커맨드 래퍼
    │       ├── actions             ← 액션 서브커맨드 래퍼
    │       ├── internal            ← 내부 유틸
    │       └── logger              ← 로깅 서브커맨드
    └── conductor-skill/
        ├── .claude-plugin/plugin.json
        └── skills/conductor/SKILL.md  ← Claude에게 Conductor 사용법 알려주는 스킬
```

### conductor-runtime

`.internal/sidecar`, `.internal/actions` 등은 모두 쉘 스크립트로 `conductor-runtime <subcommand>`를 호출하는 래퍼다:

```sh
#!/bin/sh
DIR="$(CDPATH= cd -- "$(dirname "$0")" && pwd)"
exec "$DIR/conductor-runtime" "sidecar" "$@"
```

**conductor-runtime** 이 실질적인 모든 로직을 담고 있으며, Bun으로 번들된 JavaScript이다.

---

## 지원 에이전트

Conductor는 **Claude Code**와 **Codex** 두 가지 에이전트 타입만 공식 지원한다.

```
"Conductor is a macOS app for running Claude Code and Codex agents locally
 in isolated git worktree workspaces."
— conductor-skill/SKILL.md
```

### Claude 모델 목록 (agentType: "claude")

```js
Lx0 = ["opus-4-8-1m", "opus-4-8", "opus-1m", "opus", "opus-4-6-1m", "sonnet", "haiku"]
```

내부적으로 short alias → 실제 모델 ID로 매핑된다.

### Codex/ChatGPT 모델 목록 (agentType: "codex")

```js
Tx0 = ["gpt-5.5", "gpt-5.4", "gpt-5.3-codex-spark", "gpt-5.3-codex", "gpt-5.2-codex"]
```

### 전체 선택 가능 모델

```js
fx0 = [...claudeModels, ...codexModels]
// = ["opus-4-8-1m", "opus-4-8", ..., "gpt-5.5", "gpt-5.4", ...]
```

---

## 인증 방식

### Claude (anthropic)
- `accountType: "apiKey"` — Anthropic API 키
- `modelProvider`: Anthropic 또는 Bedrock 등

### Codex (openai)
- `accountType: "apiKey"` — OpenAI API 키 (`CODEX_API_KEY`, `OPENAI_API_KEY`)
- `accountType: "chatgpt"` — **ChatGPT 구독 계정** (이메일, planType 포함)
  - ChatGPT Plus/Pro 구독이 있으면 API 키 없이 사용 가능
- Vercel AI Gateway 지원: `usesVercelAiGateway` 플래그

```js
// Codex 인증 정보 구조
this.latestAccountInfo = {
  accountType: "chatgpt",
  email: account.email,
  planType: account.planType
}
```

---

## 파일 구조
- [overview.md](./overview.md) — 이 파일 (전체 개요)
- [agents.md](./agents.md) — Claude vs Codex 에이전트 아키텍처
- [chat-protocol.md](./chat-protocol.md) — 이벤트 프로토콜 및 스트리밍
- [context.md](./context.md) — 컨텍스트 전달 방식
- [checkpoints.md](./checkpoints.md) — Git 체크포인트 시스템
