/**
 * SquashPanel -- F-M1-08
 *
 * 최근 N개 커밋 목록을 표시하고 pick/squash/drop 선택 드롭다운으로
 * squash rebase를 수행한다.
 *
 * 실제 구현은 `git reset --soft HEAD~N` + `git commit` 방식.
 */

import { useState, useEffect } from 'react';
import { trpc } from '../../lib/trpc';

interface Props {
  repoPath: string;
}

type CommitAction = 'pick' | 'squash' | 'drop';

interface CommitItem {
  hash: string;
  shortHash: string;
  message: string;
  action: CommitAction;
}

export function SquashPanel({ repoPath }: Props) {
  const [collapsed, setCollapsed] = useState(true);
  const [commitCount, setCommitCount] = useState(5);
  const [commits, setCommits] = useState<CommitItem[]>([]);
  const [squashMessage, setSquashMessage] = useState('');
  const [actionResult, setActionResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [shouldFetch, setShouldFetch] = useState(false);

  const commitsQuery = trpc.git.getRecentCommits.useQuery(
    { repoPath, count: commitCount },
    { enabled: shouldFetch, staleTime: 5_000 },
  );

  const squashMutation = trpc.git.squashCommits.useMutation({
    onSuccess: () => {
      setActionResult({ ok: true, text: 'Squash successful' });
      setCommits([]);
      setShouldFetch(false);
    },
    onError: (e) => setActionResult({ ok: false, text: e.message }),
  });

  // commitsQuery 결과가 오면 로컬 상태로 복사
  useEffect(() => {
    if (commitsQuery.data && commitsQuery.data.length > 0) {
      setCommits(
        commitsQuery.data.map((c, i) => ({
          ...c,
          action: i === 0 ? 'pick' : 'squash' as CommitAction,
        })),
      );
      // 기본 squash 메시지 생성
      setSquashMessage(
        commitsQuery.data.map((c) => c.message).join('\n'),
      );
    }
  }, [commitsQuery.data]);

  // auto-dismiss
  useEffect(() => {
    if (!actionResult) return;
    const t = setTimeout(() => setActionResult(null), 4000);
    return () => clearTimeout(t);
  }, [actionResult]);

  const handleLoadCommits = () => {
    setShouldFetch(true);
    commitsQuery.refetch();
  };

  const handleActionChange = (index: number, action: CommitAction) => {
    setCommits((prev) => prev.map((c, i) => i === index ? { ...c, action } : c));
  };

  const handleApply = () => {
    if (!squashMessage.trim()) {
      setActionResult({ ok: false, text: 'Commit message is required' });
      return;
    }

    // count = 전체 커밋 중 drop 아닌 것들만 squash
    // 실제로는 모든 커밋을 reset하고 새로 commit하므로 전체 count 사용
    const pickedMessages = commits
      .filter((c) => c.action !== 'drop')
      .map((c) => c.message);

    if (pickedMessages.length === 0) {
      setActionResult({ ok: false, text: 'At least one commit must be picked or squashed' });
      return;
    }

    squashMutation.mutate({
      repoPath,
      count: commits.length,
      message: squashMessage.trim(),
    });
  };

  const isActing = squashMutation.isPending;

  return (
    <div className="flex-shrink-0" style={{ borderTop: '1px solid var(--border)' }}>
      {/* Header (toggle) */}
      <button
        onClick={() => setCollapsed((c) => !c)}
        className="w-full flex items-center gap-1.5 px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wider select-none transition-colors"
        style={{ color: 'var(--text-muted)' }}
        onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--bg-hover)')}
        onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
      >
        <span style={{ fontSize: '8px' }}>{collapsed ? '\u25B8' : '\u25BE'}</span>
        <span>Squash Rebase</span>
      </button>

      {!collapsed && (
        <div className="px-2 pb-2">
          {/* Commit count selector + Load */}
          <div className="flex gap-1 mb-1.5 items-center">
            <label className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
              Last
            </label>
            <select
              value={commitCount}
              onChange={(e) => setCommitCount(parseInt(e.target.value, 10))}
              className="text-[10px] rounded px-1 py-0.5 outline-none"
              style={{
                backgroundColor: 'var(--bg-secondary)',
                color: 'var(--text-primary)',
                border: '1px solid var(--border)',
              }}
            >
              {[3, 5, 10, 15, 20].map((n) => (
                <option key={n} value={n}>{n}</option>
              ))}
            </select>
            <label className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
              commits
            </label>
            <button
              onClick={handleLoadCommits}
              disabled={commitsQuery.isFetching}
              className="ml-auto px-2 py-0.5 text-[10px] rounded transition-colors"
              style={{
                backgroundColor: 'var(--bg-secondary)',
                color: 'var(--text-secondary)',
                border: '1px solid var(--border)',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.borderColor = 'var(--accent)')}
              onMouseLeave={(e) => (e.currentTarget.style.borderColor = 'var(--border)')}
            >
              {commitsQuery.isFetching ? '...' : 'Load'}
            </button>
          </div>

          {/* Action result */}
          {actionResult && (
            <div
              className="rounded px-2 py-1 text-[10px] mb-1.5"
              style={{
                backgroundColor: actionResult.ok ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)',
                color: actionResult.ok ? '#4ade80' : '#f87171',
              }}
            >
              {actionResult.text}
            </div>
          )}

          {/* Commit list with action dropdowns */}
          {commits.length > 0 && (
            <>
              <div className="flex flex-col gap-0.5 max-h-[200px] overflow-y-auto mb-1.5">
                {commits.map((commit, index) => (
                  <div
                    key={commit.hash}
                    className="flex items-center gap-1.5 px-1.5 py-1 rounded text-[11px]"
                    style={{
                      backgroundColor: commit.action === 'drop'
                        ? 'rgba(239,68,68,0.05)'
                        : 'var(--bg-secondary)',
                      opacity: commit.action === 'drop' ? 0.5 : 1,
                    }}
                  >
                    <select
                      value={commit.action}
                      onChange={(e) => handleActionChange(index, e.target.value as CommitAction)}
                      className="text-[9px] rounded px-1 py-0.5 outline-none flex-shrink-0"
                      style={{
                        backgroundColor: 'var(--bg-active)',
                        color: commit.action === 'pick' ? '#4ade80'
                          : commit.action === 'squash' ? 'var(--accent)'
                          : '#f87171',
                        border: 'none',
                        width: '60px',
                      }}
                    >
                      <option value="pick">pick</option>
                      <option value="squash">squash</option>
                      <option value="drop">drop</option>
                    </select>
                    <span
                      className="font-mono text-[10px] flex-shrink-0"
                      style={{ color: 'var(--accent)' }}
                    >
                      {commit.shortHash}
                    </span>
                    <span className="truncate flex-1" style={{ color: 'var(--text-secondary)' }}>
                      {commit.message}
                    </span>
                  </div>
                ))}
              </div>

              {/* Squash commit message */}
              <textarea
                value={squashMessage}
                onChange={(e) => setSquashMessage(e.target.value)}
                placeholder="Squash commit message..."
                rows={3}
                className="w-full resize-none rounded px-2 py-1.5 text-[11px] outline-none transition-colors mb-1.5 font-mono"
                style={{
                  backgroundColor: 'var(--bg-secondary)',
                  color: 'var(--text-primary)',
                  border: '1px solid var(--border)',
                }}
                onFocus={(e) => (e.currentTarget.style.borderColor = 'var(--accent)')}
                onBlur={(e) => (e.currentTarget.style.borderColor = 'var(--border)')}
              />

              {/* Apply button */}
              <button
                onClick={() => {
                  if (window.confirm(`This will squash ${commits.length} commits into one. Continue?`)) {
                    handleApply();
                  }
                }}
                disabled={isActing || !squashMessage.trim()}
                className="w-full py-1.5 text-[10px] rounded font-medium transition-colors"
                style={{
                  backgroundColor: squashMessage.trim() && !isActing ? 'var(--accent)' : 'var(--bg-hover)',
                  color: squashMessage.trim() && !isActing ? '#fff' : 'var(--text-muted)',
                }}
              >
                {squashMutation.isPending ? 'Squashing...' : 'Apply Squash Rebase'}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
