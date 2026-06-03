# Conductor 리버스 엔지니어링

> `/Applications/Conductor.app` 바이너리 분석 결과
> conductor-runtime (Bun 번들 JS) strings 추출 + SKILL.md 기반

## 파일 목록

| 파일 | 내용 |
|------|------|
| [overview.md](./overview.md) | 앱 구조, 지원 에이전트, 모델 목록, 인증 방식 |
| [agents.md](./agents.md) | Claude Code vs Codex 아키텍처 비교 |
| [chat-protocol.md](./chat-protocol.md) | 이벤트 타입, 세션 상태머신, 스트리밍 |
| [context.md](./context.md) | 컨텍스트 전달 방식 (cwd, CLAUDE.md, .context/, env) |
| [checkpoints.md](./checkpoints.md) | Git 체크포인트 시스템 |

## 핵심 요약

### 왜 ChatGPT 모델을 채팅에서 선택할 수 있나?

Conductor는 Claude Code와 **Codex** 두 가지 에이전트를 지원한다.
Codex는 OpenAI의 코딩 에이전트로, **ChatGPT 구독 계정**으로도 인증 가능하다 (`accountType: "chatgpt"`).
그래서 ChatGPT Plus/Pro가 있으면 API 키 없이 GPT 모델을 사용할 수 있다.

```
Claude models: opus, sonnet, haiku, opus-4-8, opus-4-6-1m, ...
Codex models:  gpt-5.5, gpt-5.4, gpt-5.3-codex, gpt-5.3-codex-spark, gpt-5.2-codex
```

### 두 에이전트의 근본 차이

```
Claude Code:
  ├── PTY + stream-json I/O
  ├── cwd에서 CLAUDE.md 자동 로드
  ├── resumeThread() 지원
  └── developerInstructions로 Conductor 스킬 안내

Codex:
  ├── app-server --listen stdio:// (JSON-RPC)
  ├── @openai/codex-sdk 사용
  ├── ChatGPT 구독 또는 API 키 인증
  └── pre-tool-use hook으로 체크포인트 생성
```

### 컨텍스트는 어떻게 전달하나?

직접 시스템 프롬프트를 주입하지 않는다.
`cwd` = git worktree 경로를 설정하면 Claude Code가 CLAUDE.md, .claude/settings.json을 자동 로드한다.
Codex는 `personality`와 `developerInstructions`로 보완한다.
