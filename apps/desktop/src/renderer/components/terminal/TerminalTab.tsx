import { useAgentStore } from '../../store/agentStore';
import { AgentIcon } from '../shared/AgentIcon';
import type { Session } from '@maestro/shared-types';

interface Props {
  session: Session;
  isActive: boolean;
  onClick: () => void;
  onClose: () => void;
}

export function TerminalTab({ session, isActive, onClick, onClose }: Props) {
  const { agents } = useAgentStore();
  const agent = agents.find((a) => a.id === session.agentId);

  return (
    <button
      onClick={onClick}
      className={`group flex items-center gap-1.5 px-3 border-r transition-colors whitespace-nowrap ${
        isActive
          ? 'font-bold border-b-2 border-b-[var(--accent)]'
          : 'border-b-2 border-b-transparent'
      }`}
      style={{
        minHeight: '44px',
        backgroundColor: isActive ? 'var(--tab-active-bg)' : 'var(--tab-inactive-bg)',
        color: isActive ? 'var(--tab-active-text)' : 'var(--tab-inactive-text)',
        borderRightColor: 'var(--border)',
      }}
    >
      {/* 세션 상태 dot */}
      <span
        className={`w-2 h-2 rounded-full flex-shrink-0 ${
          session.status === 'running'
            ? 'bg-green-400 animate-pulse'
            : session.status === 'error'
              ? 'bg-red-400'
              : 'bg-gray-500'
        }`}
        title={session.status === 'running' ? '실행 중' : session.status === 'error' ? '에러' : '중지됨'}
      />

      {/* 에이전트 아이콘 */}
      {agent && <AgentIcon agent={agent} size="sm" />}

      {/* 세션 이름 */}
      <span className="max-w-[100px] truncate text-sm">{session.name}</span>

      {/* 에이전트 이름 레이블 */}
      {agent && (
        <span
          className="text-[10px] leading-none flex-shrink-0"
          style={{ color: isActive ? 'var(--text-secondary)' : 'var(--text-muted)' }}
        >
          {agent.name}
        </span>
      )}

      {/* 닫기 버튼 */}
      <span
        role="button"
        onClick={(e) => { e.stopPropagation(); onClose(); }}
        className="opacity-0 group-hover:opacity-100 ml-0.5 w-4 h-4 flex items-center justify-center rounded transition-all cursor-pointer flex-shrink-0 hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
        title="Close session"
      >
        ×
      </span>
    </button>
  );
}
