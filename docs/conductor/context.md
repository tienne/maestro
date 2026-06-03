# Conductor 컨텍스트 전달 방식

## 핵심 원칙

Conductor는 **시스템 프롬프트를 직접 주입하지 않는다**.
대신 에이전트가 `cwd`를 기반으로 컨텍스트를 자동 로드하는 구조다.

---

## 1. Working Directory (cwd)

가장 중요한 컨텍스트 전달 수단.
모든 스레드 시작/재개 시 `workspaceDir` (git worktree 경로)가 전달된다:

```typescript
startThread({
  cwd: this.workspaceDir,  // /path/to/repo/worktrees/workspace-name
  ...
})
```

Claude Code는 이 `cwd`에서 실행되므로 자동으로:
- `CLAUDE.md` 로드
- `.claude/settings.json` 로드
- git 상태 인식
- 파일 시스템 탐색

---

## 2. 설정 소스 3계층 (`--setting-sources=user,project,local`)

```
우선순위 (낮음 → 높음)
───────────────────────────
1. ~/.claude/settings.json        ← 전역 사용자 설정
2. [workspace]/.claude/settings.json  ← 프로젝트 설정
3. [workspace]/.claude/settings.local.json ← 로컬 개인 설정
```

---

## 3. developerInstructions (Conductor 스킬)

Claude Code에 `developerInstructions`로 Conductor 자체 운영 방법을 주입:

```typescript
getConductorSkillDeveloperInstructions(): string {
  return `The Conductor app provides a bundled Conductor skill at ${skillPath}.
Use it when helping with Conductor setup, troubleshooting, conductor.json,
workspace scripts, files to copy, MCP, agent controls, review workflows,
or other Conductor configuration.`
}

// 스레드 시작 시 주입
startThread({
  developerInstructions: conductorSkillInstructions,
  ...
})
```

이를 통해 Claude Code는 `conductor-skill`을 인식하고 Conductor 관련 질문에 답할 수 있다.

---

## 4. .context 디렉터리

각 workspace에 `.context/` 디렉터리가 있으면 에이전트가 공유 컨텍스트로 활용한다:

```
workspace/
├── .context/         ← gitignore됨, 에이전트 공유 컨텍스트
│   ├── instructions.md   ← 작업 지시사항
│   └── ...
├── .claude/
│   └── settings.json
└── CLAUDE.md
```

Conductor SKILL.md에서:
> "Conductor workspaces include a gitignored `.context` directory for shared agent context."

---

## 5. 환경변수 병합

```typescript
// 환경변수 로드 순서
claudeEnv = await loadEnv({
  workspaceDir,
  options: sessionOptions,
  processEnv: process.env,
  loadShellEnvironment: true,  // 로그인 쉘 환경변수 로드
})

// 환경변수 병합 (Maestro 구현 기준)
mergedEnv = {
  ...shellEnv,        // 로그인 쉘 환경변수
  ...repoEnvVars,     // DB의 repository env_vars
  ...agentEnvVars,    // DB의 agent env
  CONDUCTOR_WORKSPACE_NAME: "...",
  CONDUCTOR_WORKSPACE_PATH: "/path/to/workspace",
  CONDUCTOR_ROOT_PATH: "/path/to/repo",
  CONDUCTOR_DEFAULT_BRANCH: "main",
  CONDUCTOR_PORT: "3000",
}
```

---

## 6. Codex 컨텍스트 전달

Codex는 CLAUDE.md를 읽지 못하므로 다른 방식을 사용:

```typescript
// Codex 스레드 실행 시
thread.runStreamed(message, {
  model: routedModel,
  cwd: workspaceDir,
  effort: thinkingLevel,
  summary: "none",
  sandboxPolicy: { type: "dangerFullAccess" },
  personality: personality,  // 에이전트 페르소나
  collaborationMode: { mode, settings },
})
```

Codex의 `developerInstructions`는 null로 설정된다 (Claude와 달리 Conductor 스킬 미주입).

---

## 7. personality (에이전트 페르소나)

```typescript
personality: Yu(sessionConfig)  // Yu = personality 변환 함수
```

`collaborationMode`에 따라 페르소나가 달라진다:
- `"default"` → 일반 코딩 에이전트
- `"plan"` → 계획 제안 후 승인 대기하는 에이전트

---

## 8. conductor.json (레포지토리 설정)

레포지토리 루트의 `conductor.json`으로 에이전트 동작 설정:

```json
{
  "scripts": {
    "setup": "pnpm install",
    "run": "pnpm dev",
    "archive": "./script/workspace-archive.sh"
  },
  "runScriptMode": "concurrent",
  "enterpriseDataPrivacy": false
}
```

---

## 컨텍스트 전달 요약

| 방법 | Claude | Codex | 설명 |
|------|--------|-------|------|
| `cwd` | ✓ | ✓ | 워크트리 경로, 가장 중요 |
| `CLAUDE.md` | ✓ (자동) | ✗ | Claude Code가 자동 로드 |
| `.claude/settings.json` | ✓ (자동) | ✗ | 3계층 설정 자동 적용 |
| `developerInstructions` | ✓ | ✗ | Conductor 스킬 안내 |
| `.context/` 디렉터리 | ✓ | △ | 에이전트 공유 컨텍스트 |
| 환경변수 | ✓ | ✓ | CONDUCTOR_*, 레포 env |
| `personality` | ✓ | ✓ | 모드별 페르소나 |
| `conductor.json` | ✓ | ✓ | 레포 공유 설정 |
