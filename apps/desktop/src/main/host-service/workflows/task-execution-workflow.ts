/**
 * task-execution-workflow.ts — Mastra Workflow 기반 태스크 실행 파이프라인
 *
 * host-service child process(Node.js) 안에서 실행된다.
 * Electron API는 사용 불가.
 *
 * 파이프라인: plan → execute → verify
 *
 * - plan: AI가 taskDescription을 분석해 실행 계획을 수립
 * - execute: 계획에 따라 워크스페이스 파일 시스템 도구로 실행
 * - verify: 실행 결과를 검증하고 최종 상태 보고
 */

import { createWorkflow, createStep } from '@mastra/core/workflows';
import { z } from 'zod';
import log from 'electron-log';

// ── 입력 스키마 ────────────────────────────────────────────────────────────────

const triggerSchema = z.object({
  taskDescription: z.string().describe('수행할 태스크 설명'),
  workspacePath: z.string().describe('워크스페이스 절대 경로'),
  workspaceId: z.string().describe('워크스페이스 식별자'),
});

// ── Step 출력 스키마 ───────────────────────────────────────────────────────────

const planOutputSchema = z.object({
  taskDescription: z.string(),
  workspacePath: z.string(),
  workspaceId: z.string(),
  plan: z.object({
    summary: z.string().describe('실행 계획 요약'),
    steps: z.array(
      z.object({
        order: z.number(),
        action: z.string().describe('수행할 액션 (read_file, write_file, list_files, delete_file 등)'),
        target: z.string().describe('대상 파일/디렉토리 경로 (워크스페이스 기준 상대 경로)'),
        description: z.string().describe('이 단계의 설명'),
      }),
    ),
  }),
});

const executeOutputSchema = z.object({
  taskDescription: z.string(),
  workspacePath: z.string(),
  workspaceId: z.string(),
  plan: planOutputSchema.shape.plan,
  results: z.array(
    z.object({
      order: z.number(),
      action: z.string(),
      target: z.string(),
      success: z.boolean(),
      output: z.unknown().optional(),
      error: z.string().optional(),
    }),
  ),
});

const verifyOutputSchema = z.object({
  workspaceId: z.string(),
  taskDescription: z.string(),
  success: z.boolean(),
  summary: z.string().describe('최종 실행 결과 요약'),
  completedSteps: z.number(),
  failedSteps: z.number(),
  results: executeOutputSchema.shape.results,
});

// ── Step 1: Plan ───────────────────────────────────────────────────────────────

/**
 * plan 단계: AI가 taskDescription을 분석해 실행 계획(StepList)을 수립한다.
 * 실제 프로덕션에서는 mastra.getAgent()를 통해 LLM을 호출해야 하지만,
 * 현재는 mastra 인스턴스가 workflow에 주입되지 않으므로 정적 파싱을 수행한다.
 */
const planStep = createStep({
  id: 'plan',
  description: 'AI가 태스크 설명을 분석해 파일 시스템 작업 계획을 수립한다',
  inputSchema: triggerSchema,
  outputSchema: planOutputSchema,
  execute: async ({ inputData }) => {
    const { taskDescription, workspacePath, workspaceId } = inputData;

    log.info(`[task-execution-workflow/plan] 계획 수립 시작: "${taskDescription}"`);

    // 태스크 설명에서 파일 시스템 작업 키워드를 파싱해 계획 수립
    // 실제 환경에서는 LLM agent.generate()로 교체한다
    const planSteps = inferPlanSteps(taskDescription);

    const plan = {
      summary: `태스크 "${taskDescription}"에 대한 실행 계획 (${planSteps.length}단계)`,
      steps: planSteps,
    };

    log.info(`[task-execution-workflow/plan] 계획 수립 완료: ${plan.steps.length}단계`);

    return {
      taskDescription,
      workspacePath,
      workspaceId,
      plan,
    };
  },
});

// ── Step 2: Execute ────────────────────────────────────────────────────────────

/**
 * execute 단계: plan에서 수립한 계획에 따라 node:fs/promises로 실행한다.
 * workspace-tools의 도구와 동일한 경로 검증 로직을 사용한다.
 */
const executeStep = createStep({
  id: 'execute',
  description: '계획에 따라 워크스페이스 파일 시스템 작업을 실행한다',
  inputSchema: planOutputSchema,
  outputSchema: executeOutputSchema,
  execute: async ({ inputData }) => {
    const { taskDescription, workspacePath, workspaceId, plan } = inputData;

    log.info(`[task-execution-workflow/execute] 실행 시작: ${plan.steps.length}단계`);

    // node:fs/promises를 동적으로 import한다 (ESM/CJS 호환)
    const fs = await import('node:fs/promises');
    const path = await import('node:path');

    const results: z.infer<typeof executeOutputSchema>['results'] = [];

    for (const step of plan.steps) {
      try {
        const fullPath = resolveSafe(path, workspacePath, step.target);
        let output: unknown;

        switch (step.action) {
          case 'list_files': {
            const entries = await fs.readdir(fullPath, { withFileTypes: true });
            output = entries.map((e) => ({
              name: e.name,
              type: e.isDirectory() ? 'directory' : 'file',
            }));
            break;
          }
          case 'read_file': {
            output = await fs.readFile(fullPath, 'utf-8');
            break;
          }
          case 'write_file': {
            // write_file은 execute 단계에서 직접 수행하지 않는다.
            // 실제 내용은 plan 단계의 LLM이 생성해야 하므로 skip 처리한다.
            output = { skipped: true, reason: 'write_file은 LLM 생성 콘텐츠가 필요합니다' };
            break;
          }
          case 'delete_file': {
            await fs.unlink(fullPath);
            output = { deleted: step.target };
            break;
          }
          default: {
            output = { info: `알 수 없는 액션: ${step.action}` };
          }
        }

        results.push({
          order: step.order,
          action: step.action,
          target: step.target,
          success: true,
          output,
        });

        log.info(`[task-execution-workflow/execute] 단계 ${step.order} 완료: ${step.action} ${step.target}`);
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        log.error(`[task-execution-workflow/execute] 단계 ${step.order} 실패: ${errorMessage}`);

        results.push({
          order: step.order,
          action: step.action,
          target: step.target,
          success: false,
          error: errorMessage,
        });
      }
    }

    return {
      taskDescription,
      workspacePath,
      workspaceId,
      plan,
      results,
    };
  },
});

// ── Step 3: Verify ─────────────────────────────────────────────────────────────

/**
 * verify 단계: 실행 결과를 검증하고 최종 상태 요약을 생성한다.
 */
const verifyStep = createStep({
  id: 'verify',
  description: '실행 결과를 검증하고 최종 성공/실패 상태를 보고한다',
  inputSchema: executeOutputSchema,
  outputSchema: verifyOutputSchema,
  execute: async ({ inputData }) => {
    const { taskDescription, workspaceId, results } = inputData;

    const completedSteps = results.filter((r) => r.success).length;
    const failedSteps = results.filter((r) => !r.success).length;
    const success = failedSteps === 0;

    const summary = success
      ? `태스크 "${taskDescription}" 완료 — ${completedSteps}/${results.length}단계 성공`
      : `태스크 "${taskDescription}" 부분 실패 — ${completedSteps}/${results.length}단계 성공, ${failedSteps}단계 실패`;

    log.info(`[task-execution-workflow/verify] 검증 완료: ${summary}`);

    return {
      workspaceId,
      taskDescription,
      success,
      summary,
      completedSteps,
      failedSteps,
      results,
    };
  },
});

// ── Workflow 정의 ──────────────────────────────────────────────────────────────

export const taskExecutionWorkflow = createWorkflow({
  id: 'task-execution',
  description: 'AI Agent 태스크를 plan → execute → verify 3단계로 실행하는 파이프라인',
  inputSchema: triggerSchema,
  outputSchema: verifyOutputSchema,
})
  .then(planStep)
  .then(executeStep)
  .then(verifyStep)
  .commit();

// ── 타입 export ────────────────────────────────────────────────────────────────

export type TaskExecutionInput = z.infer<typeof triggerSchema>;
export type TaskExecutionOutput = z.infer<typeof verifyOutputSchema>;

// ── 내부 헬퍼 ─────────────────────────────────────────────────────────────────

/**
 * relativePath를 workspacePath 안에서 resolve하고,
 * path traversal이 아닌지 확인한다.
 * (workspace-tools.ts의 resolveSafe와 동일한 로직)
 */
function resolveSafe(
  path: typeof import('node:path'),
  workspacePath: string,
  relativePath: string,
): string {
  const resolved = path.resolve(workspacePath, relativePath);
  if (!resolved.startsWith(path.resolve(workspacePath))) {
    throw new Error(
      `[task-execution-workflow] Path traversal 감지: "${relativePath}" 는 workspacePath 밖입니다.`,
    );
  }
  return resolved;
}

/**
 * taskDescription에서 파일 시스템 작업 키워드를 파싱해 계획 단계 목록을 생성한다.
 *
 * 실제 프로덕션에서는 LLM(agent.generate)이 이 역할을 대신해야 한다.
 * 현재는 간단한 키워드 매칭으로 기본 동작을 제공한다.
 */
function inferPlanSteps(
  taskDescription: string,
): z.infer<typeof planOutputSchema>['plan']['steps'] {
  const lower = taskDescription.toLowerCase();
  const steps: z.infer<typeof planOutputSchema>['plan']['steps'] = [];

  if (lower.includes('list') || lower.includes('목록') || lower.includes('파일')) {
    steps.push({
      order: 1,
      action: 'list_files',
      target: '.',
      description: '워크스페이스 루트의 파일 목록을 조회한다',
    });
  }

  if (lower.includes('read') || lower.includes('읽') || lower.includes('확인')) {
    steps.push({
      order: steps.length + 1,
      action: 'read_file',
      target: 'README.md',
      description: 'README.md 파일 내용을 읽어 컨텍스트를 파악한다',
    });
  }

  // 아무 키워드도 매칭되지 않으면 기본으로 list_files를 수행한다
  if (steps.length === 0) {
    steps.push({
      order: 1,
      action: 'list_files',
      target: '.',
      description: '워크스페이스 루트의 파일 목록을 조회해 현황을 파악한다',
    });
  }

  return steps;
}
