/**
 * M3-03: 구조화 출력 패널 — 마크다운 전용 뷰.
 * 파일 경로를 받아 fs.watch 기반으로 실시간 업데이트한다.
 * tRPC subscription으로 메인 프로세스에서 파일 변경을 감지한다.
 */
import { useState } from 'react';
import { MarkdownRenderer } from './MarkdownRenderer';
import { trpc } from '../../lib/trpc';

interface Props {
  filePath: string | null;
  onClose: () => void;
  onChangePath: (path: string) => void;
}

export function MarkdownPanel({ filePath, onClose, onChangePath }: Props) {
  const [inputPath, setInputPath] = useState('');
  const [showInput, setShowInput] = useState(!filePath);

  // tRPC subscription으로 파일 내용 실시간 수신
  const [content, setContent] = useState('');
  const [exists, setExists] = useState(false);

  trpc.file.watchMarkdown.useSubscription(
    { filePath: filePath ?? '' },
    {
      enabled: !!filePath,
      onData(data: unknown) {
        const d = data as { content: string; exists: boolean };
        setContent(d.content);
        setExists(d.exists);
      },
    },
  );

  if (!filePath || showInput) {
    return (
      <div className="h-full flex flex-col items-center justify-center p-4 gap-3">
        <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
          Enter a markdown file path to preview
        </span>
        <div className="flex gap-2 w-full max-w-sm">
          <input
            value={inputPath}
            onChange={(e) => setInputPath(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && inputPath.trim()) {
                onChangePath(inputPath.trim());
                setShowInput(false);
              }
            }}
            placeholder="/path/to/file.md"
            className="flex-1 text-xs px-2 py-1.5 rounded outline-none"
            style={{
              backgroundColor: 'var(--bg-primary)',
              color: 'var(--text-primary)',
              border: '1px solid var(--border)',
            }}
            autoFocus
          />
          <button
            onClick={() => {
              if (inputPath.trim()) {
                onChangePath(inputPath.trim());
                setShowInput(false);
              }
            }}
            className="text-xs px-3 py-1.5 rounded"
            style={{ backgroundColor: 'var(--accent)', color: 'white' }}
          >
            Open
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      {/* 헤더 */}
      <div
        className="flex items-center gap-2 px-3 py-2 border-b flex-shrink-0"
        style={{ borderColor: 'var(--border)' }}
      >
        <span className="text-[10px] font-mono truncate flex-1" style={{ color: 'var(--text-muted)' }}>
          {filePath}
        </span>
        <button
          onClick={() => setShowInput(true)}
          className="text-[10px] px-1.5 py-0.5 rounded transition-colors"
          style={{ color: 'var(--text-muted)', backgroundColor: 'var(--bg-hover)' }}
          title="Change file"
        >
          ...
        </button>
        <button
          onClick={onClose}
          className="text-[10px] px-1.5 py-0.5 rounded transition-colors"
          style={{ color: 'var(--text-muted)' }}
          title="Close"
        >
          x
        </button>
      </div>

      {/* 내용 */}
      <div className="flex-1 overflow-y-auto p-3">
        {!exists ? (
          <div className="text-xs text-center py-8" style={{ color: 'var(--text-muted)' }}>
            File not found: {filePath}
          </div>
        ) : (
          <MarkdownRenderer content={content} />
        )}
      </div>
    </div>
  );
}
