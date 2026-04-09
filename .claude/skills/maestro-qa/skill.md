---
name: maestro-qa
description: "Maestro 빌드 검증 스킬. TypeScript 타입 체크, Nx 빌드, Vitest 테스트를 실행한다. qa-engineer가 구현 완료 후 품질을 검증할 때 사용. 팀원들이 구현을 마쳤을 때 이 스킬로 검증을 수행한다."
---

# Maestro QA 검증 가이드

Maestro 프로젝트의 빌드 품질 검증 절차를 정의한다.

## 검증 순서

검증은 의존성 순서대로 실행한다. 앞 단계 실패 시 원인 에이전트에게 즉시 보고하고, 수정 후 해당 단계부터 재실행한다.

### Step 1: shared-types 빌드

```bash
pnpm nx run shared-types:build
```

이 단계가 실패하면 type-architect에게 보고.

### Step 2: TypeScript 타입 체크

```bash
pnpm nx run desktop:type-check
```

또는 직접:
```bash
cd apps/desktop && pnpm tsc --noEmit
```

타입 오류 예시:
```
src/trpc/router.ts(42,5): error TS2345: Argument of type 'string' is not 
assignable to parameter of type 'number'.
```

파일명과 라인 번호를 그대로 해당 에이전트에게 전달한다.

### Step 3: 경계면 교차 비교 (핵심 QA)

단순히 빌드가 통과했다고 끝내지 않는다. tRPC 라우터의 실제 input/output 타입과 렌더러의 훅 호출부를 함께 읽어 shape 불일치를 감지한다.

```bash
# 새로 추가된 프로시저 찾기
grep -n "publicProcedure" apps/desktop/src/trpc/router.ts

# 렌더러에서 해당 트리거 확인
grep -rn "trpc\." apps/desktop/src/renderer/components/
```

확인 포인트:
- router의 `.input()` 스키마 ↔ renderer의 `.useQuery({ ... })` 인자 일치 여부
- router의 `.query()` 반환 타입 ↔ renderer에서 `data?.xxx` 접근 방식 일치 여부
- mutation의 onSuccess 콜백에서 스토어 업데이트가 반환 타입과 일치하는지

### Step 4: 단위 테스트 실행

```bash
pnpm nx run desktop:test
```

테스트 파일이 없으면 이 단계 생략.

### Step 5: Nx 린트

```bash
pnpm nx run desktop:lint
```

## 검증 결과 보고서 형식

`_workspace/03_qa_engineer_report.md`에 저장:

```markdown
# QA 검증 보고서

## 검증 시각
{ISO 8601 타임스탬프}

## Step 1: shared-types 빌드
- 상태: ✅ 통과 / ❌ 실패
- 오류: (실패 시 전체 오류 메시지)

## Step 2: TypeScript 타입 체크
- 상태: ✅ 통과 / ❌ 실패
- 오류: (실패 시 파일명:라인:컬럼 + 오류 메시지)

## Step 3: 경계면 교차 비교
- 상태: ✅ 이상 없음 / ⚠️ 불일치 발견
- 발견 사항: (있는 경우 상세 기술)

## Step 4: 단위 테스트
- 상태: ✅ 통과 / ❌ 실패 / ⏭️ 테스트 없음

## Step 5: 린트
- 상태: ✅ 통과 / ❌ 실패

## 최종 판정
- ✅ 전체 통과: 오케스트레이터에게 완료 보고
- ❌ 수정 필요: 해당 에이전트에게 오류 상세 전달
```

## 수정 요청 방식

오류 발견 시 SendMessage로 해당 에이전트에게 전달:
- TypeScript 오류 → 파일이 메인/서비스 → backend-engineer
- TypeScript 오류 → 파일이 renderer → frontend-engineer
- shared-types 빌드 실패 → type-architect
- 경계면 불일치 → backend-engineer + frontend-engineer 모두에게

수정 후 팀원이 완료 알림을 보내면 해당 Step부터 재실행한다.
