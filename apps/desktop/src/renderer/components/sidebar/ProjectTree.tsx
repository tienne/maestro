import { useState, useMemo } from 'react';
import { useProjectStore } from '../../store/projectStore';
import { useTaskStore } from '../../store/taskStore';
import { useProjects } from '../../hooks/useProjects';
import { useProjectTasks } from '../../hooks/useProjectTasks';
import { TaskTreeItem } from './TaskTreeItem';
import { EmptyState } from '../shared/EmptyState';
import type { Project } from '@maestro/shared-types';

function ProjectHeader({
  project,
  isExpanded,
  isSelected,
  onToggle,
  onSelect,
}: {
  project: Project;
  isExpanded: boolean;
  isSelected: boolean;
  onToggle: () => void;
  onSelect: () => void;
}) {
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
    </div>
  );
}

/** 선택된 프로젝트의 태스크를 로드해 트리로 렌더링하는 내부 컴포넌트 */
function ProjectTaskTree({ projectId }: { projectId: string }) {
  const { tasks, isLoading } = useTaskStore();
  useProjectTasks(projectId);

  // 루트 태스크 = parentTaskId가 없는 태스크
  const rootTasks = useMemo(
    () => tasks.filter((t) => t.projectId === projectId && !t.parentTaskId),
    [tasks, projectId],
  );

  // 현재 프로젝트에 속한 전체 태스크 (재귀 렌더링에 필요)
  const projectTasks = useMemo(
    () => tasks.filter((t) => t.projectId === projectId),
    [tasks, projectId],
  );

  if (isLoading) {
    return (
      <div className="pl-8 pr-3 py-2 text-[11px]" style={{ color: 'var(--text-muted)' }}>
        로딩 중...
      </div>
    );
  }

  if (rootTasks.length === 0) {
    return (
      <div className="pl-8 pr-3 py-1.5 text-[11px]" style={{ color: 'var(--text-muted)' }}>
        태스크가 없습니다.
      </div>
    );
  }

  return (
    <div role="group">
      {rootTasks.map((task) => (
        <TaskTreeItem
          key={task.id}
          task={task}
          depth={1}
          allTasks={projectTasks}
        />
      ))}
    </div>
  );
}

export function ProjectTree() {
  const { projects, selectedProjectId, selectProject } = useProjectStore();
  const { isLoading } = useProjects();

  const [expandedProjectIds, setExpandedProjectIds] = useState<Set<string>>(new Set());

  const toggleProject = (projectId: string) => {
    setExpandedProjectIds((prev) => {
      const next = new Set(prev);
      if (next.has(projectId)) next.delete(projectId);
      else next.add(projectId);
      return next;
    });
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

  if (projects.length === 0) {
    return (
      <EmptyState
        icon="◈"
        title="프로젝트가 없습니다"
        description="새 프로젝트를 만들어 태스크를 관리하세요"
      />
    );
  }

  return (
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
            />

            {isExpanded && (
              <ProjectTaskTree projectId={project.id} />
            )}
          </div>
        );
      })}
    </div>
  );
}
