'use client';

import { useState } from 'react';
import { gitStageAll, gitCommit } from '@/lib/tauri';
import type { Workspace } from '@maestro/shared-types';

interface Props {
  workspace: Workspace;
}

export function CommitPanel({ workspace }: Props) {
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<{ success: boolean; text: string } | null>(null);

  const handleCommit = async () => {
    if (!message.trim()) return;
    setLoading(true);
    setResult(null);
    try {
      await gitStageAll(workspace.worktreePath);
      const output = await gitCommit(workspace.worktreePath, message);
      setResult({ success: true, text: output });
      setMessage('');
    } catch (e) {
      setResult({ success: false, text: String(e) });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col h-full p-3 gap-3">
      <div className="text-xs text-gray-500">{workspace.name} ({workspace.branch})</div>

      <textarea
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        placeholder="Commit message..."
        className="flex-1 bg-gray-800 text-gray-100 text-xs rounded px-3 py-2 resize-none outline-none border border-gray-700 focus:border-blue-600 placeholder-gray-600 min-h-[80px]"
      />

      <button
        onClick={handleCommit}
        disabled={loading || !message.trim()}
        className="px-3 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-700 disabled:text-gray-500 text-white text-xs rounded transition-colors"
      >
        {loading ? 'Committing...' : 'Stage All & Commit'}
      </button>

      {result && (
        <div className={`text-[11px] rounded px-2 py-1 ${result.success ? 'bg-green-900/40 text-green-400' : 'bg-red-900/40 text-red-400'}`}>
          <pre className="whitespace-pre-wrap">{result.text}</pre>
        </div>
      )}
    </div>
  );
}
