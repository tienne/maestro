import { useState } from 'react';
import * as path from 'path-browserify';
import { trpc } from '../../lib/trpc';
import { MarkdownRenderer } from './MarkdownRenderer';

interface ConfigFile {
  name: string;
  relativePath: string;
}

const CONFIG_FILES: ConfigFile[] = [
  { name: 'CLAUDE.md', relativePath: 'CLAUDE.md' },
  { name: '.env', relativePath: '.env' },
  { name: 'mcp.json', relativePath: 'mcp.json' },
  { name: '.mcp.json', relativePath: '.mcp.json' },
  { name: 'package.json', relativePath: 'package.json' },
];

interface FileViewerProps {
  filePath: string;
  onClose: () => void;
  onOpenExternal: () => void;
}

function FileViewer({ filePath, onClose, onOpenExternal }: FileViewerProps) {
  const query = trpc.shell.readFile.useQuery({ filePath }, { staleTime: 10_000 });
  const fileName = path.basename(filePath);
  const isMarkdown = fileName.endsWith('.md');

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ backgroundColor: 'rgba(0,0,0,0.5)' }}
      onClick={onClose}
    >
      <div
        className="w-full max-w-2xl max-h-[80vh] flex flex-col rounded-xl shadow-2xl overflow-hidden"
        style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border)' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* 헤더 */}
        <div
          className="flex items-center justify-between px-4 py-3 border-b flex-shrink-0"
          style={{ borderColor: 'var(--border)' }}
        >
          <span className="text-sm font-medium font-mono" style={{ color: 'var(--text-primary)' }}>
            {fileName}
          </span>
          <div className="flex gap-2">
            <button
              onClick={onOpenExternal}
              className="text-xs px-2.5 py-1 rounded transition-colors"
              style={{ backgroundColor: 'var(--accent)', color: '#fff' }}
            >
              에디터로 열기
            </button>
            <button
              onClick={onClose}
              className="text-xs px-2 py-1 rounded transition-colors"
              style={{ color: 'var(--text-muted)', backgroundColor: 'var(--bg-primary)' }}
            >
              닫기
            </button>
          </div>
        </div>

        {/* 내용 */}
        <div className="flex-1 overflow-y-auto p-4">
          {query.isLoading && (
            <div className="text-xs" style={{ color: 'var(--text-muted)' }}>Loading...</div>
          )}
          {query.data && !query.data.exists && (
            <div className="text-xs" style={{ color: 'var(--text-muted)' }}>파일을 찾을 수 없습니다.</div>
          )}
          {query.data?.exists && (
            isMarkdown ? (
              <MarkdownRenderer content={query.data.content} />
            ) : (
              <pre
                className="text-xs font-mono whitespace-pre-wrap break-all"
                style={{ color: 'var(--text-primary)' }}
              >
                {query.data.content || '(파일이 비어 있습니다)'}
              </pre>
            )
          )}
        </div>
      </div>
    </div>
  );
}

interface Props {
  worktreePath: string;
}

/**
 * 워크스페이스 설정 파일 미리보기.
 * CLAUDE.md, .env, mcp.json 등을 목록으로 표시하고 클릭 시 모달로 프리뷰.
 */
export function ConfigPreview({ worktreePath }: Props) {
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const openFileMutation = trpc.shell.openPath.useMutation();

  const handleOpen = (relativePath: string) => {
    const fullPath = `${worktreePath}/${relativePath}`;
    setSelectedFile(fullPath);
  };

  const handleOpenExternal = () => {
    if (selectedFile) {
      openFileMutation.mutate({ filePath: selectedFile });
    }
  };

  return (
    <div className="flex flex-col gap-1 py-2">
      <div className="px-3 py-1 text-[10px] font-semibold uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
        설정 파일
      </div>
      {CONFIG_FILES.map((cfg) => (
        <button
          key={cfg.relativePath}
          onClick={() => handleOpen(cfg.relativePath)}
          className="flex items-center gap-2 px-3 py-1.5 text-xs text-left transition-colors hover:bg-[var(--bg-hover)]"
          style={{ color: 'var(--text-secondary)' }}
        >
          <span className="font-mono">{cfg.name}</span>
        </button>
      ))}

      {selectedFile && (
        <FileViewer
          filePath={selectedFile}
          onClose={() => setSelectedFile(null)}
          onOpenExternal={handleOpenExternal}
        />
      )}
    </div>
  );
}
