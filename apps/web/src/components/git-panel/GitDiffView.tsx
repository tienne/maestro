'use client';

import { useEffect, useState } from 'react';
import { gitStatus, gitDiff, type GitFileStatus } from '@/lib/tauri';
import type { Workspace } from '@maestro/shared-types';

interface Props {
  workspace: Workspace;
}

export function GitDiffView({ workspace }: Props) {
  const [files, setFiles] = useState<GitFileStatus[]>([]);
  const [selectedFile, setSelectedFile] = useState<GitFileStatus | null>(null);
  const [diff, setDiff] = useState<string>('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    gitStatus(workspace.worktreePath)
      .then(setFiles)
      .catch(() => setFiles([]))
      .finally(() => setLoading(false));
  }, [workspace.worktreePath]);

  const handleFileClick = async (file: GitFileStatus) => {
    setSelectedFile(file);
    try {
      const d = await gitDiff(workspace.worktreePath, file.path, file.staged);
      setDiff(d);
    } catch {
      setDiff('');
    }
  };

  if (loading) {
    return <div className="p-3 text-xs text-gray-600">Loading...</div>;
  }

  return (
    <div className="flex flex-col h-full">
      {/* File list */}
      <div className="border-b border-gray-800 overflow-y-auto max-h-40">
        {files.length === 0 ? (
          <div className="p-3 text-xs text-gray-600">No changes</div>
        ) : (
          files.map((file) => (
            <button
              key={file.path}
              onClick={() => handleFileClick(file)}
              className={`w-full flex items-center gap-2 px-3 py-1 text-xs text-left hover:bg-gray-800 ${
                selectedFile?.path === file.path ? 'bg-gray-800' : ''
              }`}
            >
              <span className={`text-[10px] ${file.staged ? 'text-green-400' : 'text-yellow-400'}`}>
                {file.status}
              </span>
              <span className="text-gray-300 truncate">{file.path}</span>
            </button>
          ))
        )}
      </div>

      {/* Diff view */}
      <div className="flex-1 overflow-auto p-2">
        {diff ? (
          <pre className="text-[11px] leading-relaxed whitespace-pre-wrap">
            {diff.split('\n').map((line, i) => (
              <span
                key={i}
                className={
                  line.startsWith('+') && !line.startsWith('+++')
                    ? 'text-green-400 block'
                    : line.startsWith('-') && !line.startsWith('---')
                    ? 'text-red-400 block'
                    : line.startsWith('@@')
                    ? 'text-blue-400 block'
                    : 'text-gray-400 block'
                }
              >
                {line}
              </span>
            ))}
          </pre>
        ) : (
          <div className="text-xs text-gray-600">Select a file to view diff</div>
        )}
      </div>
    </div>
  );
}
