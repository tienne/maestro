/**
 * BlamePanel -- F-M1-05
 *
 * git blame 결과를 코드 라인 + 커밋 정보 컬럼으로 표시한다.
 * 커밋 클릭 시 CommitHistoryView의 해당 커밋으로 점프.
 */

import { useState } from 'react';
import { trpc } from '../../lib/trpc';
import { useUiStore } from '../../store/uiStore';

interface Props {
  repoPath: string;
  filePath: string;
  onClose: () => void;
}

interface BlameLine {
  lineNumber: number;
  commitHash: string;
  shortHash: string;
  author: string;
  date: string;
  message: string;
  content: string;
}

export function BlamePanel({ repoPath, filePath, onClose }: Props) {
  const { setRightPanelTab } = useUiStore();
  const [hoveredHash, setHoveredHash] = useState<string | null>(null);

  const blameQuery = trpc.git.blame.useQuery(
    { repoPath, filePath },
    { staleTime: 30_000 },
  );

  const handleCommitClick = (commitHash: string) => {
    // History 탭으로 전환 (CommitHistoryView에서 해당 커밋을 자동 선택할 수 있도록)
    setRightPanelTab('history');
  };

  if (blameQuery.isLoading) {
    return (
      <div className="flex flex-col h-full">
        <BlameHeader filePath={filePath} onClose={onClose} />
        <div className="p-3 text-xs" style={{ color: 'var(--text-muted)' }}>Loading blame...</div>
      </div>
    );
  }

  if (blameQuery.isError) {
    return (
      <div className="flex flex-col h-full">
        <BlameHeader filePath={filePath} onClose={onClose} />
        <div className="p-3 text-xs" style={{ color: '#f87171' }}>
          {blameQuery.error.message}
        </div>
      </div>
    );
  }

  const lines = (blameQuery.data ?? []) as BlameLine[];

  // 커밋별 색상 매핑 (같은 커밋이면 같은 배경색)
  const uniqueHashes = [...new Set(lines.map((l) => l.commitHash))];
  const hashColorMap = new Map<string, string>();
  uniqueHashes.forEach((hash, i) => {
    hashColorMap.set(hash, i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.02)');
  });

  return (
    <div className="flex flex-col h-full">
      <BlameHeader filePath={filePath} onClose={onClose} />
      <div className="flex-1 overflow-auto font-mono text-[11px] leading-relaxed">
        {lines.map((line) => {
          const isHovered = hoveredHash === line.commitHash;
          const bgColor = isHovered ? 'rgba(var(--accent-rgb, 99,102,241),0.08)' : hashColorMap.get(line.commitHash) ?? 'transparent';

          return (
            <div
              key={line.lineNumber}
              className="flex"
              style={{ backgroundColor: bgColor }}
              onMouseEnter={() => setHoveredHash(line.commitHash)}
              onMouseLeave={() => setHoveredHash(null)}
            >
              {/* Commit info column */}
              <div
                className="flex-shrink-0 flex items-center gap-1 px-2 py-px cursor-pointer select-none"
                style={{
                  width: '220px',
                  minWidth: '220px',
                  borderRight: '1px solid var(--border)',
                  color: 'var(--text-muted)',
                }}
                onClick={() => handleCommitClick(line.commitHash)}
                title={`${line.message}\n${line.author} - ${new Date(line.date).toLocaleString()}`}
              >
                <span
                  className="text-[10px] w-[52px] flex-shrink-0"
                  style={{ color: 'var(--accent)' }}
                >
                  {line.shortHash}
                </span>
                <span className="truncate text-[10px] flex-1" style={{ color: 'var(--text-secondary)' }}>
                  {line.author}
                </span>
                <span className="text-[9px] flex-shrink-0" style={{ color: 'var(--text-muted)' }}>
                  {line.date ? new Date(line.date).toLocaleDateString() : ''}
                </span>
              </div>

              {/* Line number */}
              <div
                className="flex-shrink-0 text-right px-2 py-px select-none"
                style={{
                  width: '40px',
                  color: 'var(--text-muted)',
                  borderRight: '1px solid var(--border)',
                }}
              >
                {line.lineNumber}
              </div>

              {/* Code content */}
              <div
                className="flex-1 px-2 py-px whitespace-pre overflow-hidden"
                style={{ color: 'var(--text-primary)' }}
              >
                {line.content}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function BlameHeader({ filePath, onClose }: { filePath: string; onClose: () => void }) {
  return (
    <div
      className="flex items-center gap-2 px-2 py-1.5 flex-shrink-0"
      style={{
        backgroundColor: 'var(--bg-secondary)',
        borderBottom: '1px solid var(--border)',
      }}
    >
      <span className="text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
        Blame
      </span>
      <span className="font-mono text-[10px] truncate flex-1" style={{ color: 'var(--text-secondary)' }}>
        {filePath}
      </span>
      <button
        onClick={onClose}
        className="text-[10px] flex-shrink-0 px-1"
        style={{ color: 'var(--text-muted)' }}
      >
        x
      </button>
    </div>
  );
}
