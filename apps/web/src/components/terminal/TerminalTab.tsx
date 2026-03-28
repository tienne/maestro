'use client';

import type { Session } from '@maestro/shared-types';

const STATUS_COLORS: Record<string, string> = {
  running: 'text-green-400',
  stopped: 'text-gray-500',
  error: 'text-red-400',
};

interface Props {
  session: Session;
  isActive: boolean;
  onClick: () => void;
}

export function TerminalTab({ session, isActive, onClick }: Props) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 px-3 py-2 text-xs border-r border-gray-800 transition-colors whitespace-nowrap ${
        isActive
          ? 'bg-gray-950 text-gray-100 border-b-2 border-b-blue-500'
          : 'bg-gray-900 text-gray-400 hover:text-gray-200 hover:bg-gray-800'
      }`}
    >
      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
        STATUS_COLORS[session.status]
      }`} />
      <span className="max-w-[120px] truncate">{session.name}</span>
    </button>
  );
}
