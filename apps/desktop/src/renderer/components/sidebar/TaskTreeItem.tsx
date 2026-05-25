import { useState } from 'react';
import { useTaskStore } from '../../store/taskStore';
import type { ProjectTask, ProjectTaskStatus } from '@maestro/shared-types';

interface TaskTreeItemProps {
  task: ProjectTask;
  depth: number;
  allTasks: ProjectTask[];
}

function StatusDot({ status }: { status: ProjectTaskStatus }) {
  let color: string;
  let title: string;

  switch (status) {
    case 'in_progress':
      color = 'var(--accent, #3b82f6)';
      title = '진행 중';
      break;
    case 'completed':
      color = '#22c55e';
      title = '완료';
      break;
    case 'cancelled':
      color = '#6b7280';
      title = '취소됨';
      break;
    case 'pending':
    default:
      color = 'var(--text-muted)';
      title = '대기 중';
      break;
  }

  return (
    <span
      className="flex-shrink-0 text-[9px] leading-none"
      style={{ color }}
      title={title}
      aria-label={title}
    >
      ●
    </span>
  );
}

export function TaskTreeItem({ task, depth, allTasks }: TaskTreeItemProps) {
  const { selectedTaskId, selectTask } = useTaskStore();
  const [expanded, setExpanded] = useState(true);

  const childTasks = allTasks.filter((t) => t.parentTaskId === task.id);
  const hasChildren = childTasks.length > 0;
  const isSelected = selectedTaskId === task.id;

  // depth 1부터 들여쓰기 시작, 한 레벨당 12px
  const paddingLeft = 8 + depth * 12;

  const handleClick = () => {
    selectTask(task.id);
  };

  const handleToggle = (e: React.MouseEvent) => {
    e.stopPropagation();
    setExpanded((prev) => !prev);
  };

  return (
    <div>
      <div
        className="flex items-center gap-1.5 pr-2 py-1.5 cursor-pointer group transition-colors"
        style={{
          paddingLeft,
          backgroundColor: isSelected ? 'var(--bg-active)' : undefined,
          color: isSelected ? 'var(--text-primary)' : 'var(--text-secondary)',
        }}
        onClick={handleClick}
        onMouseEnter={(e) => {
          if (!isSelected) e.currentTarget.style.backgroundColor = 'var(--bg-hover)';
        }}
        onMouseLeave={(e) => {
          if (!isSelected) e.currentTarget.style.backgroundColor = 'transparent';
        }}
        role="treeitem"
        aria-selected={isSelected}
        aria-expanded={hasChildren ? expanded : undefined}
      >
        {/* 자식 토글 버튼 또는 스페이서 */}
        {hasChildren ? (
          <span
            className={`text-[9px] flex-shrink-0 transition-transform`}
            style={{
              color: 'var(--text-muted)',
              transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)',
            }}
            onClick={handleToggle}
            aria-label={expanded ? '접기' : '펼치기'}
          >
            ▶
          </span>
        ) : (
          <span className="w-2.5 flex-shrink-0" />
        )}

        {/* 상태 배지 */}
        <StatusDot status={task.status} />

        {/* 태스크 제목 */}
        <span
          className="text-xs truncate flex-1"
          style={{ color: isSelected ? 'var(--text-primary)' : 'var(--text-secondary)' }}
          title={task.title}
        >
          {task.title}
        </span>

        {/* 우선순위 힌트 (hover 시만) */}
        {task.priority === 'critical' || task.priority === 'high' ? (
          <span
            className="text-[9px] flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
            style={{
              color: task.priority === 'critical' ? '#ef4444' : '#f97316',
            }}
          >
            {task.priority === 'critical' ? '!!!' : '!!'}
          </span>
        ) : null}
      </div>

      {/* 자식 태스크 재귀 렌더링 */}
      {hasChildren && expanded && (
        <div role="group">
          {childTasks.map((child) => (
            <TaskTreeItem
              key={child.id}
              task={child}
              depth={depth + 1}
              allTasks={allTasks}
            />
          ))}
        </div>
      )}
    </div>
  );
}
