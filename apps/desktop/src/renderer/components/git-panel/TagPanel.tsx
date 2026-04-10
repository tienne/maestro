/**
 * TagPanel -- F-M1-06
 *
 * Git 태그 목록 표시, 생성/삭제/push 기능.
 * GitPanel 하단에 접힘/펼침 섹션으로 삽입된다.
 */

import { useState, useEffect } from 'react';
import { trpc } from '../../lib/trpc';

interface Props {
  repoPath: string;
}

export function TagPanel({ repoPath }: Props) {
  const [collapsed, setCollapsed] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [tagName, setTagName] = useState('');
  const [tagMessage, setTagMessage] = useState('');
  const [annotated, setAnnotated] = useState(true);
  const [actionResult, setActionResult] = useState<{ ok: boolean; text: string } | null>(null);

  const tagsQuery = trpc.git.listTags.useQuery(
    { repoPath },
    { staleTime: 10_000 },
  );

  const createTagMutation = trpc.git.createTag.useMutation({
    onSuccess: () => {
      setTagName('');
      setTagMessage('');
      setShowForm(false);
      setActionResult({ ok: true, text: 'Tag created' });
      tagsQuery.refetch();
    },
    onError: (e) => setActionResult({ ok: false, text: e.message }),
  });

  const deleteTagMutation = trpc.git.deleteTag.useMutation({
    onSuccess: () => {
      setActionResult({ ok: true, text: 'Tag deleted' });
      tagsQuery.refetch();
    },
    onError: (e) => setActionResult({ ok: false, text: e.message }),
  });

  const pushTagsMutation = trpc.git.pushTags.useMutation({
    onSuccess: () => setActionResult({ ok: true, text: 'Tags pushed to remote' }),
    onError: (e) => setActionResult({ ok: false, text: e.message }),
  });

  // auto-dismiss
  useEffect(() => {
    if (!actionResult) return;
    const t = setTimeout(() => setActionResult(null), 3000);
    return () => clearTimeout(t);
  }, [actionResult]);

  const tags = tagsQuery.data ?? [];
  const isActing = createTagMutation.isPending || deleteTagMutation.isPending || pushTagsMutation.isPending;

  const handleCreate = () => {
    if (!tagName.trim()) return;
    createTagMutation.mutate({
      repoPath,
      name: tagName.trim(),
      message: tagMessage.trim() || undefined,
      annotated,
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
        <span style={{ fontSize: '8px' }}>{collapsed ? '\u25B8' : '\u25BE'}</span>
        <span>Tags</span>
        {tags.length > 0 && (
          <span
            className="ml-auto px-1 rounded-full text-[9px]"
            style={{ backgroundColor: 'var(--bg-active)', color: 'var(--accent)' }}
          >
            {tags.length}
          </span>
        )}
      </button>

      {!collapsed && (
        <div className="px-2 pb-2">
          {/* Action buttons */}
          <div className="flex gap-1 mb-1.5">
            <button
              onClick={() => setShowForm((s) => !s)}
              className="flex-1 py-1 text-[10px] rounded transition-colors"
              style={{
                backgroundColor: 'var(--bg-secondary)',
                color: 'var(--text-secondary)',
                border: '1px solid var(--border)',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.borderColor = 'var(--accent)')}
              onMouseLeave={(e) => (e.currentTarget.style.borderColor = 'var(--border)')}
            >
              {showForm ? 'Cancel' : '+ New Tag'}
            </button>
            <button
              onClick={() => pushTagsMutation.mutate({ repoPath })}
              disabled={isActing || tags.length === 0}
              className="px-2 py-1 text-[10px] rounded transition-colors"
              style={{
                backgroundColor: 'var(--accent)',
                color: '#fff',
                opacity: isActing || tags.length === 0 ? 0.5 : 1,
              }}
            >
              {pushTagsMutation.isPending ? '...' : 'Push Tags'}
            </button>
          </div>

          {/* Create tag form */}
          {showForm && (
            <div
              className="flex flex-col gap-1.5 mb-2 p-2 rounded"
              style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border)' }}
            >
              <input
                value={tagName}
                onChange={(e) => setTagName(e.target.value)}
                placeholder="Tag name (e.g. v1.0.0)"
                className="text-[11px] rounded px-2 py-1 outline-none transition-colors"
                style={{
                  backgroundColor: 'var(--bg-primary)',
                  color: 'var(--text-primary)',
                  border: '1px solid var(--border)',
                }}
                onFocus={(e) => (e.currentTarget.style.borderColor = 'var(--accent)')}
                onBlur={(e) => (e.currentTarget.style.borderColor = 'var(--border)')}
                onKeyDown={(e) => { if (e.key === 'Enter') handleCreate(); }}
              />
              {annotated && (
                <input
                  value={tagMessage}
                  onChange={(e) => setTagMessage(e.target.value)}
                  placeholder="Tag message (optional)"
                  className="text-[11px] rounded px-2 py-1 outline-none transition-colors"
                  style={{
                    backgroundColor: 'var(--bg-primary)',
                    color: 'var(--text-primary)',
                    border: '1px solid var(--border)',
                  }}
                  onFocus={(e) => (e.currentTarget.style.borderColor = 'var(--accent)')}
                  onBlur={(e) => (e.currentTarget.style.borderColor = 'var(--border)')}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleCreate(); }}
                />
              )}
              <label
                className="flex items-center gap-2 text-[10px] cursor-pointer"
                style={{ color: 'var(--text-secondary)' }}
              >
                <input
                  type="checkbox"
                  checked={annotated}
                  onChange={(e) => setAnnotated(e.target.checked)}
                  style={{ accentColor: 'var(--accent)' }}
                />
                Annotated tag
              </label>
              <button
                onClick={handleCreate}
                disabled={isActing || !tagName.trim()}
                className="py-1 text-[10px] rounded transition-colors"
                style={{
                  backgroundColor: tagName.trim() && !isActing ? 'var(--accent)' : 'var(--bg-hover)',
                  color: tagName.trim() && !isActing ? '#fff' : 'var(--text-muted)',
                }}
              >
                {createTagMutation.isPending ? 'Creating...' : 'Create Tag'}
              </button>
            </div>
          )}

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

          {/* Tag list */}
          {tagsQuery.isLoading ? (
            <div className="text-[10px] py-1" style={{ color: 'var(--text-muted)' }}>Loading...</div>
          ) : tags.length === 0 ? (
            <div className="text-[10px] py-1" style={{ color: 'var(--text-muted)' }}>No tags</div>
          ) : (
            <div className="flex flex-col gap-0.5 max-h-[150px] overflow-y-auto">
              {tags.map((tag) => (
                <div
                  key={tag.name}
                  className="flex items-center gap-1.5 px-1.5 py-1 rounded text-[11px] group"
                  style={{ backgroundColor: 'var(--bg-secondary)' }}
                >
                  <span
                    className="text-[9px] px-1 rounded flex-shrink-0"
                    style={{
                      backgroundColor: tag.isAnnotated ? 'rgba(99,102,241,0.15)' : 'var(--bg-active)',
                      color: tag.isAnnotated ? 'var(--accent)' : 'var(--text-muted)',
                    }}
                  >
                    {tag.isAnnotated ? 'A' : 'L'}
                  </span>
                  <span className="font-mono text-[10px] flex-shrink-0" style={{ color: 'var(--accent)' }}>
                    {tag.name}
                  </span>
                  <span className="truncate flex-1 text-[10px]" style={{ color: 'var(--text-muted)' }}>
                    {tag.message}
                  </span>
                  <button
                    onClick={() => {
                      if (window.confirm(`Delete tag "${tag.name}"?`)) {
                        deleteTagMutation.mutate({ repoPath, name: tag.name });
                      }
                    }}
                    disabled={isActing}
                    className="flex-shrink-0 px-1.5 py-0.5 text-[9px] rounded opacity-0 group-hover:opacity-100 transition-opacity"
                    style={{
                      backgroundColor: 'var(--bg-active)',
                      color: '#f87171',
                    }}
                    onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'rgba(239,68,68,0.2)')}
                    onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'var(--bg-active)')}
                    title="Delete tag"
                  >
                    Del
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
