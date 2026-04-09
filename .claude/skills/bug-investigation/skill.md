---
name: bug-investigation
description: "Maestro 앱 이슈 조사 방법론. 증상에서 근본 원인까지 체계적으로 추적하는 절차. bug-investigator가 이슈를 분석할 때 반드시 참조한다."
---

# Maestro 버그 조사 방법론

## 이슈 유형 분류

### 유형 1: 타입/빌드 오류

즉시 실행으로 확인한다:

```bash
pnpm nx run shared-types:build
pnpm nx run desktop:type-check
```

오류 파일 목록 수집 → 각 파일에서 오류 발생 위치 추적 → shared-types 변경과 사용부 불일치 확인.

### 유형 2: tRPC 프로시저 오류 (백엔드)

```
재현 시나리오
  → router.ts의 해당 프로시저 읽기
  → .input() Zod 스키마 검증
  → 비즈니스 로직 (DB 쿼리, 서비스 호출)
  → 반환 타입이 shared-types 정의와 일치하는지
```

확인할 경계면:
- `router.ts` 프로시저 ↔ `shared-types/index.ts` 타입
- `router.ts` ↔ `services/*.ts` 함수 시그니처
- `services/*.ts` ↔ `db/database.ts` 쿼리 반환 타입

### 유형 3: IPC 통신 오류

```
렌더러 오류
  → renderer/lib/ipc-link.ts (메시지 형식 확인)
  → preload/index.ts (expose된 채널 확인)
  → trpc/ipc.ts (JSON-RPC 코드 매핑 확인)
```

Maestro IPC 프로토콜:
- 요청: `{ method: 'request', operation: { id, type, path, input } }`
- 응답: `{ id, result: { type: 'data', data } }` or `{ id, error: { code: number, message } }`
- 에러 코드: 반드시 **숫자**형 (tRPC v11 요구사항)

### 유형 4: 렌더러/상태 오류

```
UI 증상
  → 해당 컴포넌트 읽기
  → tRPC 훅 설정 (enabled 조건, onSuccess 콜백) 확인
  → Zustand 스토어 업데이트 로직 확인
  → 스토어 타입과 서버 응답 타입 일치 여부
```

### 유형 5: PTY/터미널 오류

```
세션 상태 이상
  → services/pty-manager.ts의 이벤트 핸들러 확인
  → node-pty 이벤트 (data, exit) 등록/해제 대칭성
  → DB 상태 업데이트 (pending→running→stopped/error) 전이 추적
  → router.ts의 session.launch 프로시저 흐름
```

## 경계면 교차 비교 체크리스트

이슈를 조사할 때 반드시 두 파일을 동시에 읽는다:

| 경계면 | 확인 대상 1 | 확인 대상 2 |
|--------|-----------|-----------|
| 타입 불일치 | `shared-types/index.ts` 인터페이스 | `router.ts` 반환값, `store/*.ts` 타입 |
| API 계약 | `router.ts` 프로시저 output | `renderer/lib/trpc.ts` 사용부 |
| DB 스키마 | `db/database.ts` CREATE TABLE 컬럼명 | `router.ts`에서 DB 결과 접근 필드명 |
| IPC 프로토콜 | `trpc/ipc.ts` 메시지 파서 | `renderer/lib/ipc-link.ts` 메시지 생성 |
| 세션 상태 전이 | `pty-manager.ts` 이벤트 핸들러 | `router.ts` status 업데이트 코드 |

## 근본 원인 보고서 구조

```markdown
## 증상 요약
[한 줄로 무슨 일이 일어나고 있는지]

## 근본 원인
**원인**: [파일명:라인번호]
**코드 증거**:
```
[실제 코드 인용 — 최대 10줄]
```
**왜 문제인가**: [설명]

## 영향 범위
- 수정 필요 파일: [절대 경로 목록]
- 수정 방향: [구체적 변경 내용]

## 재현 케이스
```typescript
// 이 시나리오가 버그를 유발한다
setupMockDb({
  'FROM sessions WHERE id': { get: vi.fn().mockReturnValue(undefined) }
});
// 기대: NOT_FOUND 에러
// 실제: TypeError: Cannot read property X of undefined
```
```

## 조사 중 사용할 명령

```bash
# 타입 오류 확인
pnpm nx run desktop:type-check 2>&1 | head -50

# 특정 심볼 사용처 검색
grep -rn "session\.launch" apps/desktop/src/

# IPC 채널명 확인
grep -rn "ipcMain.handle\|ipcRenderer.on" apps/desktop/src/

# DB 컬럼명 확인
grep -n "CREATE TABLE" apps/desktop/src/db/database.ts
```
