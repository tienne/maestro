import { useState } from 'react';
import { trpc } from '../../lib/trpc';
import { toast } from '../../lib/toast';
import type { Workspace } from '@maestro/shared-types';

interface Props {
  workspace: Workspace;
}

export function CommitPanel({ workspace }: Props) {
  const [message, setMessage] = useState('');
  const [result, setResult] = useState<{ success: boolean; text: string } | null>(null);

  const stageAllMutation = trpc.git.stageAll.useMutation();
  const commitMutation = trpc.git.commit.useMutation({
    onSuccess: (output) => {
      setResult({ success: true, text: output as string });
      setMessage('');
      toast.success('커밋 완료');
    },
    onError: (e) => {
      setResult({ success: false, text: e.message });
      toast.error('커밋 실패', e.message);
    },
  });

  const handleCommit = async () => {
    if (!message.trim()) return;
    setResult(null);
    try {
      await stageAllMutation.mutateAsync({ repoPath: workspace.worktreePath });
      commitMutation.mutate({ repoPath: workspace.worktreePath, message });
    } catch (e) {
      setResult({ success: false, text: String(e) });
    }
  };

  const isLoading = stageAllMutation.isPending || commitMutation.isPending;

  return (
    <div className="flex flex-col h-full p-3 gap-3">
      <div className="text-xs" style={{ color: 'var(--text-muted)' }}>{workspace.name} ({workspace.branch})</div>

      <textarea
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        placeholder="Commit message..."
        className="flex-1 text-xs rounded px-3 py-2 resize-none outline-none border focus:border-blue-600 placeholder-gray-600 min-h-[80px]"
        style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--text-primary)', borderColor: 'var(--border)' }}
      />

      <button
        onClick={handleCommit}
        disabled={isLoading || !message.trim()}
        className="px-3 py-2 text-white text-xs rounded transition-colors disabled:opacity-50"
        style={{ backgroundColor: 'var(--accent)' }}
      >
        {isLoading ? 'Committing...' : 'Stage All & Commit'}
      </button>

      {result && (
        <div
          className={`text-[11px] rounded px-2 py-1 ${
            result.success ? 'bg-green-900/40 text-green-400' : 'bg-red-900/40 text-red-400'
          }`}
        >
          <pre className="whitespace-pre-wrap">{result.text}</pre>
        </div>
      )}
    </div>
  );
}
