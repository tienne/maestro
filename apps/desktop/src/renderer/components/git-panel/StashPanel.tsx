/**
 * StashPanel -- F-M1-02
 *
 * Git stash 목록 표시, push/pop/drop 기능.
 * GitPanel 하단에 접힘/펼침 섹션으로 삽입된다.
 */

import { useState, useEffect } from 'react';
import { trpc } from '../../lib/trpc';

interface Props {
  repoPath: string;
}

export function StashPanel({ repoPath }: Props) {
  const [collapsed, setCollapsed] = useState(true);
  const [stashMessage, setStashMessage] = useState('');
  const [actionResult, setActionResult] = useState<{ ok: boolean; text: string } | null>(null);

  const stashQuery = trpc.git.stashList.useQuery(
    { repoPath },
    { staleTime: 5_000 },
  );

  const stashPushMutation = trpc.git.stashPush.useMutation({
    onSuccess: () => {
      setStashMessage('');
      setActionResult({ ok: true, text: 'Stash saved' });
      stashQuery.refetch();
    },
    onError: (e) => setActionResult({ ok: false, text: e.message }),
  });

  const stashPopMutation = trpc.git.stashPop.useMutation({
    onSuccess: () => {
      setActionResult({ ok: true, text: 'Stash applied & dropped' });
      stashQuery.refetch();
    },
    onError: (e) => setActionResult({ ok: false, text: e.message }),
  });

  const stashDropMutation = trpc.git.stashDrop.useMutation({
    onSuccess: () => {
      setActionResult({ ok: true, text: 'Stash dropped' });
      stashQuery.refetch();
    },
    onError: (e) => setActionResult({ ok: false, text: e.message }),
  });

  // auto-dismiss
  useEffect(() => {
    if (!actionResult) return;
    const t = setTimeout(() => setActionResult(null), 3000);
    return () => clearTimeout(t);
  }, [actionResult]);

  const stashes = stashQuery.data ?? [];
  const isActing = stashPushMutation.isPending || stashPopMutation.isPending || stashDropMutation.isPending;

  const handlePush = () => {
    stashPushMutation.mutate({
      repoPath,
      message: stashMessage.trim() || undefined,
    });
  };

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
        <span style={{ fontSize: '8px' }}>{collapsed ? '▸' : '▾'}</span>
        <span>Stash</span>
        {stashes.length > 0 && (
          <span
            className="ml-auto px-1 rounded-full text-[9px]"
            style={{ backgroundColor: 'var(--bg-active)', color: 'var(--accent)' }}
          >
            {stashes.length}
          </span>
        )}
      </button>

      {!collapsed && (
        <div className="px-2 pb-2">
          {/* Stash push */}
          <div className="flex gap-1 mb-1.5">
            <input
              value={stashMessage}
              onChange={(e) => setStashMessage(e.target.value)}
              placeholder="Stash message (optional)"
              className="flex-1 text-[11px] rounded px-2 py-1 outline-none transition-colors"
              style={{
                backgroundColor: 'var(--bg-secondary)',
                color: 'var(--text-primary)',
                border: '1px solid var(--border)',
              }}
              onFocus={(e) => (e.currentTarget.style.borderColor = 'var(--accent)')}
              onBlur={(e) => (e.currentTarget.style.borderColor = 'var(--border)')}
              onKeyDown={(e) => { if (e.key === 'Enter') handlePush(); }}
            />
            <button
              onClick={handlePush}
              disabled={isActing}
              className="px-2 py-1 text-[10px] rounded transition-colors"
              style={{
                backgroundColor: 'var(--accent)',
                color: '#fff',
                opacity: isActing ? 0.5 : 1,
              }}
            >
              {stashPushMutation.isPending ? '...' : 'Stash'}
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

          {/* Stash list */}
          {stashQuery.isLoading ? (
            <div className="text-[10px] py-1" style={{ color: 'var(--text-muted)' }}>Loading...</div>
          ) : stashes.length === 0 ? (
            <div className="text-[10px] py-1" style={{ color: 'var(--text-muted)' }}>No stashes</div>
          ) : (
            <div className="flex flex-col gap-0.5 max-h-[150px] overflow-y-auto">
              {stashes.map((stash) => (
                <div
                  key={stash.ref}
                  className="flex items-center gap-1.5 px-1.5 py-1 rounded text-[11px] group"
                  style={{ backgroundColor: 'var(--bg-secondary)' }}
                >
                  <span className="font-mono text-[10px] flex-shrink-0" style={{ color: 'var(--accent)' }}>
                    {stash.ref}
                  </span>
                  <span className="truncate flex-1" style={{ color: 'var(--text-secondary)' }}>
                    {stash.message}
                  </span>
                  <div className="flex gap-0.5 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={() => stashPopMutation.mutate({ repoPath, index: stash.index })}
                      disabled={isActing}
                      className="px-1.5 py-0.5 text-[9px] rounded transition-colors"
                      style={{
                        backgroundColor: 'var(--bg-active)',
                        color: 'var(--text-primary)',
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--accent)')}
                      onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'var(--bg-active)')}
                      title="Pop (apply & drop)"
                    >
                      Pop
                    </button>
                    <button
                      onClick={() => stashDropMutation.mutate({ repoPath, index: stash.index })}
                      disabled={isActing}
                      className="px-1.5 py-0.5 text-[9px] rounded transition-colors"
                      style={{
                        backgroundColor: 'var(--bg-active)',
                        color: '#f87171',
                      }}
                      onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'rgba(239,68,68,0.2)')}
                      onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'var(--bg-active)')}
                      title="Drop (discard stash)"
                    >
                      Drop
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
