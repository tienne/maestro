/**
 * Orchestrator Service — AI Agent Editor
 *
 * 태스크 실행 시 적절한 에이전트를 선택하는 오케스트레이터 로직.
 * 향후 LLM 기반 자동 에이전트 선택, 부하 분산 등으로 확장 가능.
 */

import type Database from 'better-sqlite3';

/**
 * 태스크에 할당할 에이전트를 결정한다.
 *
 * 우선순위:
 * 1. 호출 측에서 명시적으로 전달한 agentId (override)
 * 2. 태스크에 이미 배정된 assigned_agent_id
 * 3. DB의 agents 테이블에서 첫 번째 에이전트 (fallback)
 *
 * @returns 결정된 agentId, 에이전트가 전혀 없으면 null
 */
export function selectAgentForTask(
  db: Database.Database,
  task: { assignedAgentId?: string | null; title: string; prd?: string | null },
  overrideAgentId?: string,
): string | null {
  // 1. 호출 측 override
  if (overrideAgentId) return overrideAgentId;

  // 2. 태스크에 배정된 에이전트
  if (task.assignedAgentId) return task.assignedAgentId;

  // 3. DB fallback — 첫 번째 에이전트
  const agent = db
    .prepare('SELECT id FROM agents ORDER BY rowid ASC LIMIT 1')
    .get() as { id: string } | undefined;

  return agent?.id ?? null;
}
