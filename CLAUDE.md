<!-- nx configuration start-->
<!-- Leave the start & end comments to automatically receive updates. -->

# General Guidelines for working with Nx

- For navigating/exploring the workspace, invoke the `nx-workspace` skill first - it has patterns for querying projects, targets, and dependencies
- When running tasks (for example build, lint, test, e2e, etc.), always prefer running the task through `nx` (i.e. `nx run`, `nx run-many`, `nx affected`) instead of using the underlying tooling directly
- Prefix nx commands with the workspace's package manager (e.g., `pnpm nx build`, `npm exec nx test`) - avoids using globally installed CLI
- You have access to the Nx MCP server and its tools, use them to help the user
- For Nx plugin best practices, check `node_modules/@nx/<plugin>/PLUGIN.md`. Not all plugins have this file - proceed without it if unavailable.
- NEVER guess CLI flags - always check nx_docs or `--help` first when unsure

## Scaffolding & Generators

- For scaffolding tasks (creating apps, libs, project structure, setup), ALWAYS invoke the `nx-generate` skill FIRST before exploring or calling MCP tools

## When to use nx_docs

- USE for: advanced config options, unfamiliar flags, migration guides, plugin configuration, edge cases
- DON'T USE for: basic generator syntax (`nx g @nx/react:app`), standard commands, things you already know
- The `nx-generate` skill handles generator discovery internally - don't call nx_docs just to look up generator syntax


<!-- nx configuration end-->

# Design System

UI 컴포넌트를 구현하거나 스타일을 작성할 때는 `DESIGN.md`의 토큰과 원칙을 따른다.
전체 명세는 `DESIGN.md`를 참조. 아래는 작업 중 바로 쓸 수 있는 핵심 요약이다.

## Colors

| 토큰 | 값 | 용도 |
|------|----|------|
| `canvas-night` | `#000000` | 시네마틱 히어로, 다크 배경 |
| `canvas-night-elevated` | `#0a0a0a` | 다크 카드, 비디오 프레임 |
| `canvas-light` | `#ffffff` | 가격표, 폼, 트랜잭션 |
| `canvas-cream` | `#fbfbf5` | 라이트 트랙 배경 |
| `ink` | `#000000` | 라이트 캔버스 텍스트 |
| `on-dark` | `#ffffff` | 다크 캔버스 텍스트 |
| `aloe-10` | `#c1fbd4` | 강조 CTA, 추천 티어 (라이트 전용) |
| `pistachio-10` | `#d4f9e0` | 섹션 밴드 (라이트 전용) |
| `shade-30~70` | `#d4d4d8`→`#3f3f46` | 보조 텍스트, pressed 상태 |
| `hairline-light` | `#e4e4e7` | 라이트 카드 테두리 |

## Typography

| 토큰 | 크기 / 굵기 | 용도 |
|------|------------|------|
| `display-xxl` | 96px / 330 | 시네마틱 히어로 헤드라인 |
| `display-xl` | 70px / 330 | 섹션 오프너 |
| `display-lg` | 55px / 330 | 페이지 타이틀 |
| `display-md` | 48px / 330 | 서브섹션 헤드라인 |
| `heading-xl` | 28px / 500 | 카드 타이틀 |
| `heading-md` | 20px / 500 | 섹션 서브헤딩 |
| `body-lg` | 18px / 550 | 마케팅 본문 리드 |
| `body-md` | 16px / 420 | 기본 UI 본문, 버튼 레이블 |
| `body-strong` | 16px / 550 | 강조 본문 |
| `caption` | 14px / 500 | 헬퍼 텍스트, 주석 |
| `micro` | 13px / 500 | 파인프린트 |
| `eyebrow-cap` | 12px / 400 | 올캡스 아이브로 |
| `code` | 16px / 400 | 코드블록 |

- Display: `NeueHaasGrotesk Display` (폴백: Helvetica, Arial)
- UI Body: `Inter Variable` (폴백: Inter, Helvetica)
- Code/Terminal: `Geist Mono` (폴백: ui-monospace, SFMono-Regular, Menlo)
- 전체에 `font-feature-settings: "ss03"` 적용

## Spacing & Radius

```
spacing: xxs=2 xs=4 sm=8 md=12 lg=16 xl=24 xxl=32 huge=64 (px)
rounded: xs=4 sm=5 md=8 lg=12 xl=20 pill=9999 (px)
```

## Core Principles

- **두 캔버스 분리**: `canvas-night`(시네마틱) vs `canvas-light/cream`(트랜잭션) — 혼용 금지
- **버튼 형태**: 항상 `rounded.pill` (9999px). 라운드 사각형 버튼 없음
- **Display 굵기**: 항상 330. 400+ 사용 시 브랜드 깨짐
- **Aloe/Pistachio**: 라이트 트랙 전용 — 다크 페이지에 절대 사용 금지
- **사진**: 시네마틱 트랙에서 풀블리드, 컨테이너 탈출 허용

## Key Components

| 컴포넌트 | 배경 | 형태 |
|---------|------|------|
| `button-primary-pill` | `ink` (#000) | pill, 텍스트 white |
| `button-outline-on-dark` | transparent | pill, 테두리 white |
| `button-aloe-pill` | `aloe-10` | pill, 텍스트 ink — 추천 CTA |
| `card-pricing` | `canvas-light` | rounded-lg, padding 32px |
| `card-pricing-featured` | `aloe-10` | rounded-lg, padding 32px |
| `card-feature-cinematic` | `canvas-night-elevated` | rounded-lg |
| `text-input` | `canvas-light` | rounded-md, padding 10px 12px |
| `pill-tag-mint` | `aloe-10` | pill, eyebrow-cap |