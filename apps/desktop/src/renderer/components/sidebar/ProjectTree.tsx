import { useState, useMemo, useRef, useEffect } from 'react';
import { useProjectStore } from '../../store/projectStore';
import { useTaskStore } from '../../store/taskStore';
import { useRepositoryStore } from '../../store/repositoryStore';
import { useProjects } from '../../hooks/useProjects';
import { useProjectTasks } from '../../hooks/useProjectTasks';
import { trpc } from '../../lib/trpc';
import { TaskTreeItem } from './TaskTreeItem';
import { EmptyState } from '../shared/EmptyState';
import { TaskCreationChatModal } from '../task/TaskCreationChatModal';
import { useAnthropicAuthStore } from '../../store/anthropicAuthStore';
import type { Project } from '@maestro/shared-types';

// ── 프로젝트 생성 인라인 폼 ───────────────────────────────────────────────────

function NewProjectForm({ onClose }: { onClose: () => void }) {
  const [name, setName] = useState('');
  const [repositoryId, setRepositoryId] = useState('');
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const addProject = useProjectStore((s) => s.addProject);
  const repositories = useRepositoryStore((s) => s.repositories);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const createMutation = trpc.project.create.useMutation({
    onSuccess: (project) => {
      addProject(project);
      onClose();
    },
    onError: (err) => {
      setError(err.message);
    },
  });

  const handleSubmit = () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setError('프로젝트 이름을 입력해주세요.');
      return;
    }
    setError(null);
    createMutation.mutate({ name: trimmed, repositoryId: repositoryId || undefined });
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSubmit();
    if (e.key === 'Escape') onClose();
  };

  return (
    <div
      className="px-2 py-2 flex flex-col gap-1.5"
      style={{ borderBottom: '1px solid var(--border)' }}
    >
      <input
        ref={inputRef}
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="프로젝트 이름"
        className="w-full text-xs px-2 py-1 rounded outline-none"
        style={{
          backgroundColor: 'var(--bg-active)',
          color: 'var(--text-primary)',
          border: '1px solid var(--border)',
        }}
        disabled={createMutation.isPending}
      />
      {repositories.length > 0 && (
        <select
          value={repositoryId}
          onChange={(e) => setRepositoryId(e.target.value)}
          className="w-full text-xs px-2 py-1 rounded outline-none"
          style={{
            backgroundColor: 'var(--bg-active)',
            color: repositoryId ? 'var(--text-primary)' : 'var(--text-muted)',
            border: '1px solid var(--border)',
          }}
          disabled={createMutation.isPending}
        >
          <option value="">레포지토리 선택 (선택사항)</option>
          {repositories.map((r) => (
            <option key={r.id} value={r.id}>{r.name}</option>
          ))}
        </select>
      )}
      {error && (
        <span className="text-[11px]" style={{ color: '#ef4444' }}>
          {error}
        </span>
      )}
      <div className="flex items-center gap-1">
        <button
          onClick={handleSubmit}
          disabled={createMutation.isPending}
          className="text-[11px] px-2 py-0.5 rounded transition-opacity disabled:opacity-50"
          style={{
            backgroundColor: 'var(--accent)',
            color: '#fff',
          }}
        >
          {createMutation.isPending ? '생성 중...' : '저장'}
        </button>
        <button
          onClick={onClose}
          disabled={createMutation.isPending}
          className="text-[11px] px-2 py-0.5 rounded transition-colors"
          style={{
            color: 'var(--text-muted)',
            backgroundColor: 'transparent',
          }}
          onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--bg-hover)')}
          onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
        >
          취소
        </button>
      </div>
    </div>
  );
}

// ── 프로젝트 헤더 ─────────────────────────────────────────────────────────────

function ProjectHeader({
  project,
  isExpanded,
  isSelected,
  onToggle,
  onSelect,
  onAddTask,
}: {
  project: Project;
  isExpanded: boolean;
  isSelected: boolean;
  onToggle: () => void;
  onSelect: () => void;
  onAddTask: () => void;
}) {
  const anthropicStatus = useAnthropicAuthStore((s) => s.status);
  const isAnthropicUnauthed = anthropicStatus === 'unauthenticated' || anthropicStatus === 'expired';

  return (
    <div
      className="flex items-center gap-1.5 px-2 py-2 cursor-pointer group transition-colors"
      style={{
        backgroundColor: isSelected ? 'var(--bg-active)' : undefined,
        color: 'var(--text-primary)',
      }}
      onClick={() => {
        onSelect();
        onToggle();
      }}
      onMouseEnter={(e) => {
        if (!isSelected) e.currentTarget.style.backgroundColor = 'var(--bg-hover)';
      }}
      onMouseLeave={(e) => {
        if (!isSelected) e.currentTarget.style.backgroundColor = 'transparent';
      }}
      role="treeitem"
      aria-expanded={isExpanded}
    >
      <span
        className="text-[10px] flex-shrink-0 transition-transform"
        style={{
          color: 'var(--text-muted)',
          transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)',
        }}
      >
        ▶
      </span>

      {/* 프로젝트 아이콘 */}
      <span className="text-[11px] flex-shrink-0" style={{ color: 'var(--text-muted)' }}>
        ◈
      </span>

      <span
        className="text-xs truncate flex-1 font-medium"
        style={{ color: 'var(--text-primary)' }}
        title={project.name}
      >
        {project.name}
      </span>

      {/* 태스크 추가 버튼 — hover 시 표시 */}
      <div className="relative flex-shrink-0">
        <button
          className="text-[11px] w-4 h-4 flex items-center justify-center rounded opacity-0 group-hover:opacity-100 transition-opacity"
          style={{ color: 'var(--text-muted)' }}
          title={isAnthropicUnauthed ? 'AI 태스크 생성 (Anthropic 인증 필요)' : '새 태스크 추가'}
          onClick={(e) => {
            e.stopPropagation();
            onAddTask();
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.backgroundColor = 'var(--bg-hover)';
            e.currentTarget.style.color = 'var(--text-primary)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = 'transparent';
            e.currentTarget.style.color = 'var(--text-muted)';
          }}
          aria-label={`${project.name}에 태스크 추가`}
        >
          +
        </button>
        {isAnthropicUnauthed && (
          <span
            className="absolute -top-0.5 -right-0.5 w-1.5 h-1.5 rounded-full opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none"
            style={{ backgroundColor: '#f59e0b' }}
            aria-hidden="true"
          />
        )}
      </div>
    </div>
  );
}

// ── 프로젝트 태스크 트리 ──────────────────────────────────────────────────────

function ProjectTaskTree({ projectId }: { projectId: string }) {
  const { tasks, isLoading } = useTaskStore();
  useProjectTasks(projectId);

  const rootTasks = useMemo(
    () => tasks.filter((t) => t.projectId === projectId && !t.parentTaskId),
    [tasks, projectId],
  );

  const projectTasks = useMemo(
    () => tasks.filter((t) => t.projectId === projectId),
    [tasks, projectId],
  );

  return (
    <div role="group">
      {isLoading && rootTasks.length === 0 ? (
        <div className="pl-8 pr-3 py-2 text-[11px]" style={{ color: 'var(--text-muted)' }}>
          로딩 중...
        </div>
      ) : rootTasks.length === 0 ? (
        <div className="pl-8 pr-3 py-1.5 text-[11px]" style={{ color: 'var(--text-muted)' }}>
          태스크가 없습니다.
        </div>
      ) : (
        rootTasks.map((task) => (
          <TaskTreeItem key={task.id} task={task} depth={1} allTasks={projectTasks} />
        ))
      )}
    </div>
  );
}

// ── ProjectTree (루트) ────────────────────────────────────────────────────────

export function ProjectTree() {
  const { projects, selectedProjectId, selectProject } = useProjectStore();
  const repositories = useRepositoryStore((s) => s.repositories);
  const { isLoading } = useProjects();

  const [expandedProjectIds, setExpandedProjectIds] = useState<Set<string>>(new Set());
  const [showNewProjectForm, setShowNewProjectForm] = useState(false);
  // AI 채팅 모달이 열려 있는 projectId (null이면 닫힘)
  const [chatModalProjectId, setChatModalProjectId] = useState<string | null>(null);

  const toggleProject = (projectId: string) => {
    setExpandedProjectIds((prev) => {
      const next = new Set(prev);
      if (next.has(projectId)) next.delete(projectId);
      else next.add(projectId);
      return next;
    });
  };

  const handleAddTask = (projectId: string) => {
    // 해당 프로젝트를 펼쳐서 태스크 목록이 보이게
    setExpandedProjectIds((prev) => {
      const next = new Set(prev);
      next.add(projectId);
      return next;
    });
    setChatModalProjectId(projectId);
  };

  if (isLoading && projects.length === 0) {
    return (
      <div className="flex items-center justify-center py-8">
        <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
          로딩 중...
        </span>
      </div>
    );
  }

  return (
    <>
    {chatModalProjectId && (() => {
      const project = projects.find((p) => p.id === chatModalProjectId);
      if (!project) return null;
      const repository = repositories.find((r) => r.id === project.repositoryId);
      return (
        <TaskCreationChatModal
          projectId={chatModalProjectId}
          projectName={project.name}
          repositoryName={repository?.name ?? ''}
          onClose={() => setChatModalProjectId(null)}
        />
      );
    })()}
    <div className="flex flex-col flex-1 overflow-hidden">
      {/* 새 프로젝트 버튼 */}
      <div
        className="flex-shrink-0 px-2 py-1.5"
        style={{ borderBottom: '1px solid var(--border)' }}
      >
        {showNewProjectForm ? (
          <NewProjectForm onClose={() => setShowNewProjectForm(false)} />
        ) : (
          <button
            className="w-full flex items-center gap-1.5 text-[11px] px-2 py-1 rounded transition-colors"
            style={{ color: 'var(--text-muted)' }}
            onClick={() => setShowNewProjectForm(true)}
            onMouseEnter={(e) => {
              e.currentTarget.style.backgroundColor = 'var(--bg-hover)';
              e.currentTarget.style.color = 'var(--text-primary)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.backgroundColor = 'transparent';
              e.currentTarget.style.color = 'var(--text-muted)';
            }}
          >
            <span className="text-xs">+</span>
            <span>새 프로젝트</span>
          </button>
        )}
      </div>

      {/* 프로젝트 목록 */}
      {projects.length === 0 ? (
        <EmptyState
          icon="◈"
          title="프로젝트가 없습니다"
          description="새 프로젝트를 만들어 태스크를 관리하세요"
        />
      ) : (
        <div className="flex-1 overflow-y-auto py-1" role="tree" aria-label="프로젝트 트리">
          {projects.map((project) => {
            const isExpanded = expandedProjectIds.has(project.id);
            const isSelected = selectedProjectId === project.id;

            return (
              <div key={project.id}>
                <ProjectHeader
                  project={project}
                  isExpanded={isExpanded}
                  isSelected={isSelected}
                  onToggle={() => toggleProject(project.id)}
                  onSelect={() => selectProject(project.id)}
                  onAddTask={() => handleAddTask(project.id)}
                />

                {isExpanded && (
                  <ProjectTaskTree projectId={project.id} />
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
    </>
  );
}
