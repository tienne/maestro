# Maestro 디자인 전면 변경 스펙

> Gestalt 인터뷰 기반 생성 | Spec ID: `95de6863-8b02-4769-9dcf-2846a9803082`  
> 인터뷰 세션: `a346e60a-8590-4dc7-bf60-f75cb33158c8` | 해상도 점수: 0.81 | 8라운드

---

## 목표

DESIGN.md 토큰 시스템을 기반으로 Maestro 앱(데스크탑 Electron + 모바일 Expo/React Native)의 모든 화면을 전면 재설계한다. 개발자 도구 전용 컴포넌트 시스템과 공유 토큰 패키지(`packages/tokens`)를 구축하여 라이트/다크 테마를 일관되게 지원하고, 에이전트 실행 상태를 통일된 시각 언어로 표현한다.

---

## 제약 조건

1. **플랫폼**: 데스크탑(Electron/React)과 모바일(Expo/React Native 0.74.1) 모두 적용 — 모든 화면 포함
2. **테마**: 라이트/다크 테마 동시 지원, 모든 화면에서 레이아웃 구조 동일
3. **폰트**: UI = Inter Variable (폴백: Inter, Helvetica) / 코드·터미널 = Geist Mono (폴백: ui-monospace)
4. **데스크탑 레이아웃**: Superset 구조 — 왼쪽 사이드바 + 메인 콘텐츠 + 리사이저블 보조 패널
5. **모바일 레이아웃**: expo-router 기반 하단 탭바 (iOS/Android 네이티브 패턴)
6. **컴포넌트 분리**: DESIGN.md 마케팅 컴포넌트(`card-pricing` 등) 재사용 금지 — 개발자 도구 전용 컴포넌트 별도 설계
7. **토큰 아키텍처**: `packages/tokens` 단일 소스 → 데스크탑은 CSS custom properties, 모바일은 StyleSheet 객체
8. **상태 색상**: DESIGN.md에 status 토큰 추가 완료 (`status-running/success/warning/danger/idle/completed`)

---

## 인수 기준

- [ ] `packages/tokens` 패키지에 DESIGN.md의 모든 색상/타이포/간격/상태 토큰이 TypeScript 상수로 정의됨
- [ ] 데스크탑에서 CSS custom properties로 토큰 적용, 라이트/다크 테마 전환 동작
- [ ] 모바일에서 StyleSheet 객체로 토큰 적용, 라이트/다크 테마 전환 동작
- [ ] 데스크탑: 좌 사이드바 + 메인 콘텐츠 + 리사이저블 보조 패널 레이아웃 구현
- [ ] 모바일: expo-router 기반 하단 탭바 네비게이션 구현
- [ ] 세션 목록, 채팅/에이전트 실행, 태스크 패널, 설정, 온보딩/로그인 — 5개 화면 모두 신규 디자인 적용
- [ ] 에이전트 상태(running/idle/error/completed)가 모든 화면에서 동일한 색상 토큰과 애니메이션으로 표시됨
- [ ] Inter Variable 및 Geist Mono 폰트 로드 확인 (데스크탑/모바일 각각)

---

## 엔티티 모델

```
DesignToken       — 색상/타이포/간격/상태 색상 원자 단위
TokenPackage      — packages/tokens, CSS vars + RN StyleSheet 이중 출력
Screen            — 세션목록·채팅·태스크·설정·온보딩 (platform, themes)
DevToolComponent  — 개발자 도구 전용 컴포넌트 (마케팅 컴포넌트와 별개)
NavigationStructure — 데스크탑: left-sidebar / 모바일: bottom-tabs
StatusIndicator   — running·idle·error·completed (colorToken + animationType)
Theme             — light·dark (토큰 오버라이드만, 레이아웃 불변)
```

**관계:**
- `TokenPackage` → exports → `DesignToken`
- `Screen` → uses → `DevToolComponent`
- `Screen` → belongs-to → `NavigationStructure`
- `DevToolComponent` → references → `DesignToken`
- `StatusIndicator` → uses-status-token → `DesignToken`
- `Theme` → overrides → `DesignToken`

---

## Gestalt 분석

| 원리 | 발견 | 신뢰도 |
|------|------|--------|
| **Closure** | DESIGN.md에 상태 색상 토큰 없었음 — 에이전트 실행 표현에 필수라 추가 | 0.92 |
| **Proximity** | 데스크탑(CSS)·모바일(RN StyleSheet) 다른 형식이지만 `packages/tokens` 단일 소스로 그룹핑 | 0.88 |
| **Similarity** | 모든 화면의 상태 표시 패턴(running/idle/error/completed)을 통일된 토큰·애니메이션으로 표준화 | 0.85 |
| **Figure-Ground** | DESIGN.md 마케팅 컴포넌트(ground) vs 개발자 도구 전용 컴포넌트(figure) 명확히 분리 | 0.90 |
| **Continuity** | 라이트/다크 테마가 모든 화면에서 동일한 레이아웃 유지 — 테마는 색상 토큰만 변경 | 0.87 |

---

## 구현 순서 제안

### Phase 1 — 토큰 인프라
1. `packages/tokens` NX 라이브러리 생성
2. DESIGN.md → TypeScript 상수 변환
3. 데스크탑: CSS custom properties 주입 (`globals.css`)
4. 모바일: `useTheme` hook + StyleSheet 래퍼

### Phase 2 — 데스크탑 레이아웃
5. Superset 구조 레이아웃 컴포넌트 (`AppShell`, `Sidebar`, `MainPanel`, `AuxPanel`)
6. 라이트/다크 테마 전환 (`ThemeProvider`)
7. Inter Variable + Geist Mono 폰트 로드

### Phase 3 — 모바일 레이아웃
8. expo-router 하단 탭바 구조 재설계
9. 테마 전환 (`useColorScheme` + tokens)
10. Geist Mono 폰트 로드 (Expo Font)

### Phase 4 — 화면 재설계
11. 온보딩/로그인
12. 세션 목록
13. 채팅/에이전트 실행 화면
14. 태스크 패널
15. 설정

### Phase 5 — 상태 시각 언어
16. `StatusIndicator` 공통 컴포넌트
17. 펄스 애니메이션 (running), 정적 아이콘 (idle/completed/error)
18. 전체 화면 통합 검증
