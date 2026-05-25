/**
 * TaskCardEditor — AI Agent Editor 핵심 UI
 *
 * taskStore.selectedTaskId를 구독하고 tRPC로 태스크 상세를 조회한다.
 * 모든 필드는 인라인 편집 가능하며 debounce(500ms) 자동 저장된다.
 * 실행 버튼(trpc.projectTask.run)은 task-4 구현 후 활성화된다.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { trpc } from '../../lib/trpc';
import { useTaskStore } from '../../store/taskStore';
import { useAgentStore } from '../../store/agentStore';
import type { ProjectTask, ProjectTaskStatus, ProjectTaskPriority } from '@maestro/shared-types';

// ── 상수 ──────────────────────────────────────────────────────────────────────

const STATUS_OPTIONS: { value: ProjectTaskStatus; label: string; color: string }[] = [
  { value: 'pending', label: '대기', color: '#e2a94e' },
  { value: 'in_progress', label: '진행 중', color: '#818cf8' },
  { value: 'completed', label: '완료', color: '#4ade80' },
  { value: 'cancelled', label: '취소', color: '#f87171' },
];

const PRIORITY_OPTIONS: { value: ProjectTaskPriority; label: string; color: string }[] = [
  { value: 'critical', label: 'Critical', color: '#f87171' },
  { value: 'high', label: 'High', color: '#fb923c' },
  { value: 'medium', label: 'Medium', color: '#e2a94e' },
  { value: 'low', label: 'Low', color: '#94a3b8' },
];

function getStatusColor(status: ProjectTaskStatus): string {
  return STATUS_OPTIONS.find((o) => o.value === status)?.color ?? 'var(--text-muted)';
}

function getPriorityColor(priority: ProjectTaskPriority): string {
  return PRIORITY_OPTIONS.find((o) => o.value === priority)?.color ?? 'var(--text-muted)';
}

// ── 섹션 레이블 ──────────────────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="text-[10px] font-semibold uppercase tracking-wider mb-1 select-none"
      style={{ color: 'var(--text-muted)' }}
    >
      {children}
    </div>
  );
}

// ── 인라인 텍스트 입력 ────────────────────────────────────────────────────────

interface FieldInputProps {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  multiline?: boolean;
  rows?: number;
  className?: string;
}

function FieldInput({
  value,
  onChange,
  placeholder,
  multiline = false,
  rows = 4,
  className = '',
}: FieldInputProps) {
  const baseStyle: React.CSSProperties = {
    backgroundColor: 'var(--bg-secondary)',
    color: 'var(--text-primary)',
    border: '1px solid var(--border)',
  };

  const sharedProps = {
    value,
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => onChange(e.target.value),
    placeholder,
    style: baseStyle,
    onFocus: (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      e.currentTarget.style.borderColor = 'var(--accent)';
    },
    onBlur: (e: React.FocusEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      e.currentTarget.style.borderColor = 'var(--border)';
    },
    className: `w-full rounded px-2.5 py-1.5 text-xs outline-none transition-colors resize-none ${className}`,
  };

  if (multiline) {
    return <textarea {...sharedProps} rows={rows} />;
  }
  return <input type="text" {...(sharedProps as React.InputHTMLAttributes<HTMLInputElement>)} />;
}

// ── 빈 상태 ──────────────────────────────────────────────────────────────────

function EmptyTaskState() {
  return (
    <div className="flex flex-col items-center justify-center h-full gap-3 px-6 text-center">
      <div className="text-3xl opacity-30" style={{ color: 'var(--text-muted)' }}>
        ☰
      </div>
      <div className="text-sm font-medium" style={{ color: 'var(--text-secondary)' }}>
        태스크를 선택하세요
      </div>
      <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
        좌측 목록에서 태스크를 클릭하면 여기에 편집기가 열립니다
      </div>
    </div>
  );
}

// ── 로딩 상태 ────────────────────────────────────────────────────────────────

function LoadingState() {
  return (
    <div className="flex items-center justify-center h-full">
      <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
        불러오는 중...
      </div>
    </div>
  );
}

// ── 편집 폼 상태 타입 ─────────────────────────────────────────────────────────

interface FormState {
  title: string;
  status: ProjectTaskStatus;
  priority: ProjectTaskPriority;
  prd: string;
  spec: string;
  acceptanceCriteria: string;
  assignedAgentId: string;
  referenceFiles: string; // 줄바꿈 구분 문자열
}

function taskToForm(task: ProjectTask): FormState {
  return {
    title: task.title,
    status: task.status,
    priority: task.priority,
    prd: task.prd ?? '',
    spec: task.spec ?? '',
    acceptanceCriteria: task.acceptanceCriteria ?? '',
    assignedAgentId: task.assignedAgentId ?? '',
    referenceFiles: (task.referenceFiles ?? []).join('\n'),
  };
}

// ── TaskCardEditor (main) ────────────────────────────────────────────────────

export function TaskCardEditor() {
  const selectedTaskId = useTaskStore((s) => s.selectedTaskId);
  const updateTaskInStore = useTaskStore((s) => s.updateTask);
  const agents = useAgentStore((s) => s.agents);

  // tRPC: 태스크 상세 조회
  const { data: task, isLoading } = trpc.projectTask.get.useQuery(
    { id: selectedTaskId! },
    { enabled: !!selectedTaskId },
  );

  // tRPC utils (캐시 무효화용)
  const utils = trpc.useUtils();

  // tRPC: 태스크 업데이트 뮤테이션
  const updateMutation = trpc.projectTask.update.useMutation({
    onSuccess: (updated) => {
      updateTaskInStore(updated);
      utils.projectTask.get.invalidate({ id: updated.id });
      setSaveState('saved');
      const t = setTimeout(() => setSaveState('idle'), 2000);
      return () => clearTimeout(t);
    },
    onError: (err) => {
      console.error('[TaskCardEditor] update failed:', err.message);
      setSaveState('error');
    },
  });

  // 저장 상태 표시 ('idle' | 'saving' | 'saved' | 'error')
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');

  // 폼 상태
  const [form, setForm] = useState<FormState | null>(null);

  // 태스크가 바뀌면 폼 초기화
  useEffect(() => {
    if (task) {
      setForm(taskToForm(task));
      setSaveState('idle');
    }
  }, [task]);

  // debounce 타이머 ref
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 폼 필드 변경 핸들러 (debounce 자동 저장)
  const handleFieldChange = useCallback(
    (field: keyof FormState, value: string) => {
      setForm((prev) => {
        if (!prev) return prev;
        return { ...prev, [field]: value };
      });

      setSaveState('saving');

      if (debounceRef.current) clearTimeout(debounceRef.current);

      debounceRef.current = setTimeout(() => {
        setForm((current) => {
          if (!current || !task) return current;

          const refFiles = current.referenceFiles
            .split('\n')
            .map((s) => s.trim())
            .filter(Boolean);

          updateMutation.mutate({
            id: task.id,
            data: {
              title: current.title || task.title,
              status: current.status,
              priority: current.priority,
              prd: current.prd || undefined,
              spec: current.spec || undefined,
              acceptanceCriteria: current.acceptanceCriteria || undefined,
              assignedAgentId: current.assignedAgentId || undefined,
              referenceFiles: refFiles.length > 0 ? refFiles : undefined,
            },
          });

          return current;
        });
      }, 500);
    },
    [task, updateMutation],
  );

  // 컴포넌트 언마운트 시 타이머 정리
  useEffect(() => {
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  // ── 렌더 분기 ──────────────────────────────────────────────────────────────

  if (!selectedTaskId) return <EmptyTaskState />;
  if (isLoading || !form) return <LoadingState />;
  if (!task) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
          태스크를 찾을 수 없습니다
        </div>
      </div>
    );
  }

  const statusColor = getStatusColor(form.status);
  const priorityColor = getPriorityColor(form.priority);

  // ── 저장 상태 배지 ──────────────────────────────────────────────────────────

  const saveBadge = saveState === 'saving'
    ? <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>저장 중...</span>
    : saveState === 'saved'
      ? <span className="text-[10px]" style={{ color: '#4ade80' }}>저장됨</span>
      : saveState === 'error'
        ? <span className="text-[10px]" style={{ color: '#f87171' }}>저장 실패</span>
        : null;

  // ── agent 배지 (createdBy) ─────────────────────────────────────────────────

  const createdByBadge = task.createdBy === 'agent' ? (
    <span
      className="text-[9px] px-1.5 py-0.5 rounded-full font-medium flex-shrink-0"
      style={{ backgroundColor: 'rgba(129,140,248,0.15)', color: '#818cf8' }}
    >
      AI 생성
    </span>
  ) : null;

  return (
    <div className="flex flex-col h-full overflow-hidden text-xs" style={{ color: 'var(--text-primary)' }}>
      {/* ── 헤더: 제목 + 저장 상태 ─────────────────────────────────────────── */}
      <div
        className="flex-shrink-0 px-4 py-3 flex flex-col gap-2"
        style={{ borderBottom: '1px solid var(--border)' }}
      >
        {/* 제목 입력 */}
        <input
          type="text"
          value={form.title}
          onChange={(e) => handleFieldChange('title', e.target.value)}
          placeholder="태스크 제목..."
          className="w-full bg-transparent text-base font-semibold outline-none placeholder:opacity-40"
          style={{ color: 'var(--text-primary)' }}
        />

        {/* 메타 행: createdBy 배지 + 저장 상태 */}
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            {createdByBadge}
            <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
              {new Date(task.createdAt).toLocaleDateString('ko-KR')}
            </span>
          </div>
          {saveBadge}
        </div>
      </div>

      {/* ── 스크롤 영역 ─────────────────────────────────────────────────────── */}
      <div className="flex-1 overflow-y-auto px-4 py-3 flex flex-col gap-4">

        {/* ── 상태 + 우선순위 ─────────────────────────────────────────────── */}
        <div className="flex gap-3">
          {/* 상태 */}
          <div className="flex-1">
            <SectionLabel>상태</SectionLabel>
            <select
              value={form.status}
              onChange={(e) => handleFieldChange('status', e.target.value)}
              className="w-full rounded px-2.5 py-1.5 text-xs outline-none transition-colors"
              style={{
                backgroundColor: 'var(--bg-secondary)',
                color: statusColor,
                border: '1px solid var(--border)',
              }}
              onFocus={(e) => (e.currentTarget.style.borderColor = 'var(--accent)')}
              onBlur={(e) => (e.currentTarget.style.borderColor = 'var(--border)')}
            >
              {STATUS_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value} style={{ color: opt.color }}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          {/* 우선순위 */}
          <div className="flex-1">
            <SectionLabel>우선순위</SectionLabel>
            <select
              value={form.priority}
              onChange={(e) => handleFieldChange('priority', e.target.value)}
              className="w-full rounded px-2.5 py-1.5 text-xs outline-none transition-colors"
              style={{
                backgroundColor: 'var(--bg-secondary)',
                color: priorityColor,
                border: '1px solid var(--border)',
              }}
              onFocus={(e) => (e.currentTarget.style.borderColor = 'var(--accent)')}
              onBlur={(e) => (e.currentTarget.style.borderColor = 'var(--border)')}
            >
              {PRIORITY_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value} style={{ color: opt.color }}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* ── 담당 에이전트 ────────────────────────────────────────────────── */}
        <div>
          <SectionLabel>담당 에이전트</SectionLabel>
          {agents.length > 0 ? (
            <select
              value={form.assignedAgentId}
              onChange={(e) => handleFieldChange('assignedAgentId', e.target.value)}
              className="w-full rounded px-2.5 py-1.5 text-xs outline-none transition-colors"
              style={{
                backgroundColor: 'var(--bg-secondary)',
                color: form.assignedAgentId ? 'var(--text-primary)' : 'var(--text-muted)',
                border: '1px solid var(--border)',
              }}
              onFocus={(e) => (e.currentTarget.style.borderColor = 'var(--accent)')}
              onBlur={(e) => (e.currentTarget.style.borderColor = 'var(--border)')}
            >
              <option value="">에이전트 없음</option>
              {agents.map((agent) => (
                <option key={agent.id} value={agent.id}>
                  {agent.name}
                </option>
              ))}
            </select>
          ) : (
            <FieldInput
              value={form.assignedAgentId}
              onChange={(v) => handleFieldChange('assignedAgentId', v)}
              placeholder="에이전트 ID 또는 이름..."
            />
          )}
        </div>

        {/* ── PRD ─────────────────────────────────────────────────────────── */}
        <div>
          <SectionLabel>PRD (제품 요구사항)</SectionLabel>
          <FieldInput
            value={form.prd}
            onChange={(v) => handleFieldChange('prd', v)}
            placeholder="이 태스크의 목적, 배경, 요구사항을 마크다운으로 작성하세요..."
            multiline
            rows={5}
          />
        </div>

        {/* ── 스펙 ────────────────────────────────────────────────────────── */}
        <div>
          <SectionLabel>스펙 (기술 명세)</SectionLabel>
          <FieldInput
            value={form.spec}
            onChange={(v) => handleFieldChange('spec', v)}
            placeholder="구현 방법, 기술 스택, 주의사항을 마크다운으로 작성하세요..."
            multiline
            rows={5}
          />
        </div>

        {/* ── 완료 기준 ────────────────────────────────────────────────────── */}
        <div>
          <SectionLabel>완료 기준</SectionLabel>
          <FieldInput
            value={form.acceptanceCriteria}
            onChange={(v) => handleFieldChange('acceptanceCriteria', v)}
            placeholder="- 테스트가 통과해야 한다&#10;- 특정 기능이 동작해야 한다..."
            multiline
            rows={4}
          />
        </div>

        {/* ── 참조 파일 ────────────────────────────────────────────────────── */}
        <div>
          <SectionLabel>참조 파일 (줄바꿈 구분)</SectionLabel>
          <FieldInput
            value={form.referenceFiles}
            onChange={(v) => handleFieldChange('referenceFiles', v)}
            placeholder="src/components/MyComponent.tsx&#10;docs/spec.md"
            multiline
            rows={3}
          />
          {form.referenceFiles.trim() && (
            <div className="mt-1.5 flex flex-wrap gap-1">
              {form.referenceFiles
                .split('\n')
                .map((f) => f.trim())
                .filter(Boolean)
                .map((file, i) => (
                  <span
                    key={i}
                    className="text-[10px] px-1.5 py-0.5 rounded font-mono"
                    style={{
                      backgroundColor: 'var(--bg-secondary)',
                      color: 'var(--text-secondary)',
                      border: '1px solid var(--border)',
                    }}
                  >
                    {file}
                  </span>
                ))}
            </div>
          )}
        </div>

        {/* ── 태스크 메타 정보 ─────────────────────────────────────────────── */}
        <div
          className="rounded px-3 py-2 flex flex-col gap-1"
          style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border)' }}
        >
          <div className="flex justify-between">
            <span style={{ color: 'var(--text-muted)' }}>ID</span>
            <span className="font-mono truncate max-w-[60%]" style={{ color: 'var(--text-secondary)' }}>
              {task.id}
            </span>
          </div>
          <div className="flex justify-between">
            <span style={{ color: 'var(--text-muted)' }}>생성</span>
            <span style={{ color: 'var(--text-secondary)' }}>
              {new Date(task.createdAt).toLocaleString('ko-KR')}
            </span>
          </div>
          <div className="flex justify-between">
            <span style={{ color: 'var(--text-muted)' }}>수정</span>
            <span style={{ color: 'var(--text-secondary)' }}>
              {new Date(task.updatedAt).toLocaleString('ko-KR')}
            </span>
          </div>
          {task.workspaceId && (
            <div className="flex justify-between">
              <span style={{ color: 'var(--text-muted)' }}>워크스페이스</span>
              <span className="font-mono truncate max-w-[60%]" style={{ color: 'var(--text-secondary)' }}>
                {task.workspaceId}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* ── 하단 액션 바 ─────────────────────────────────────────────────────── */}
      <div
        className="flex-shrink-0 px-4 py-3 flex gap-2"
        style={{ borderTop: '1px solid var(--border)' }}
      >
        {/* 수동 저장 버튼 */}
        <button
          onClick={() => {
            if (!task) return;
            if (debounceRef.current) clearTimeout(debounceRef.current);

            const refFiles = form.referenceFiles
              .split('\n')
              .map((s) => s.trim())
              .filter(Boolean);

            setSaveState('saving');
            updateMutation.mutate({
              id: task.id,
              data: {
                title: form.title || task.title,
                status: form.status,
                priority: form.priority,
                prd: form.prd || undefined,
                spec: form.spec || undefined,
                acceptanceCriteria: form.acceptanceCriteria || undefined,
                assignedAgentId: form.assignedAgentId || undefined,
                referenceFiles: refFiles.length > 0 ? refFiles : undefined,
              },
            });
          }}
          disabled={updateMutation.isPending}
          className="flex-1 py-1.5 rounded text-xs font-medium transition-colors"
          style={{
            backgroundColor: updateMutation.isPending ? 'var(--bg-hover)' : 'var(--accent)',
            color: updateMutation.isPending ? 'var(--text-muted)' : '#fff',
            opacity: updateMutation.isPending ? 0.7 : 1,
          }}
          onMouseEnter={(e) => {
            if (!updateMutation.isPending) e.currentTarget.style.backgroundColor = 'var(--accent-hover)';
          }}
          onMouseLeave={(e) => {
            if (!updateMutation.isPending) e.currentTarget.style.backgroundColor = 'var(--accent)';
          }}
        >
          {updateMutation.isPending ? '저장 중...' : '저장'}
        </button>

        {/* 실행 버튼 (task-4 구현 후 활성화) */}
        <RunTaskButton taskId={task.id} status={task.status} />
      </div>
    </div>
  );
}

// ── RunTaskButton ─────────────────────────────────────────────────────────────
// trpc.projectTask.run이 task-4에서 구현되면 실제 호출로 교체한다.

function RunTaskButton({ taskId, status }: { taskId: string; status: ProjectTaskStatus }) {
  const [isRunning, setIsRunning] = useState(false);

  const handleRun = () => {
    // TODO(task-4): trpc.projectTask.run.useMutation 으로 교체
    // 현재는 상태를 in_progress로 업데이트하는 방식으로 임시 처리
    console.log('[TaskCardEditor] run task:', taskId);
    setIsRunning(true);
    setTimeout(() => setIsRunning(false), 2000);
  };

  const isCompleted = status === 'completed' || status === 'cancelled';

  return (
    <button
      onClick={handleRun}
      disabled={isRunning || isCompleted}
      title={isCompleted ? '이미 완료/취소된 태스크입니다' : '에이전트로 태스크를 실행합니다'}
      className="px-4 py-1.5 rounded text-xs font-medium transition-colors flex-shrink-0"
      style={{
        backgroundColor: isCompleted || isRunning
          ? 'var(--bg-hover)'
          : 'rgba(129,140,248,0.2)',
        color: isCompleted || isRunning
          ? 'var(--text-muted)'
          : '#818cf8',
        border: `1px solid ${isCompleted || isRunning ? 'var(--border)' : 'rgba(129,140,248,0.4)'}`,
        opacity: isCompleted ? 0.5 : 1,
      }}
      onMouseEnter={(e) => {
        if (!isCompleted && !isRunning) {
          e.currentTarget.style.backgroundColor = 'rgba(129,140,248,0.3)';
        }
      }}
      onMouseLeave={(e) => {
        if (!isCompleted && !isRunning) {
          e.currentTarget.style.backgroundColor = 'rgba(129,140,248,0.2)';
        }
      }}
    >
      {isRunning ? '실행 중...' : '실행'}
    </button>
  );
}
