import { useEffect, useRef, useCallback, useState } from 'react';
import CodeMirror, { EditorView, type ViewUpdate } from '@uiw/react-codemirror';
import { javascript } from '@codemirror/lang-javascript';
import { python } from '@codemirror/lang-python';
import { json } from '@codemirror/lang-json';
import { css } from '@codemirror/lang-css';
import { html } from '@codemirror/lang-html';
import { markdown } from '@codemirror/lang-markdown';
import { oneDark } from '@codemirror/theme-one-dark';
import { trpc } from '../../lib/trpc';
import { useUiStore } from '../../store/uiStore';

interface Props {
  filePath: string;
}

function getLanguageExtension(filePath: string) {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
  switch (ext) {
    case 'ts':
    case 'tsx':
      return javascript({ typescript: true, jsx: ext === 'tsx' });
    case 'js':
    case 'jsx':
    case 'mjs':
    case 'cjs':
      return javascript({ jsx: ext === 'jsx' });
    case 'py':
      return python();
    case 'json':
    case 'jsonc':
      return json();
    case 'css':
    case 'scss':
    case 'less':
      return css();
    case 'html':
    case 'htm':
      return html();
    case 'md':
    case 'mdx':
      return markdown();
    default:
      return null;
  }
}

function getLanguageName(filePath: string): string {
  const ext = filePath.split('.').pop()?.toLowerCase() ?? '';
  const names: Record<string, string> = {
    ts: 'TypeScript', tsx: 'TSX', js: 'JavaScript', jsx: 'JSX',
    mjs: 'JavaScript', cjs: 'JavaScript', py: 'Python',
    json: 'JSON', jsonc: 'JSON', css: 'CSS', scss: 'SCSS',
    less: 'Less', html: 'HTML', htm: 'HTML', md: 'Markdown', mdx: 'MDX',
    sh: 'Shell', bash: 'Shell', zsh: 'Shell', yml: 'YAML', yaml: 'YAML',
  };
  return names[ext] ?? (ext.toUpperCase() || 'Plain Text');
}

export function FileEditorPanel({ filePath }: Props) {
  const { setFileDirty } = useUiStore();
  const fileQuery = trpc.shell.readFile.useQuery({ filePath }, { staleTime: Infinity });
  const writeFileMutation = trpc.shell.writeFile.useMutation({
    onSuccess: () => setFileDirty(filePath, false),
  });

  const [value, setValue] = useState<string | null>(null);
  const [cursorLine, setCursorLine] = useState(1);
  const [cursorCol, setCursorCol] = useState(1);
  const valueRef = useRef<string>('');

  // 파일 내용 초기 로드 (쿼리 데이터가 바뀔 때만)
  useEffect(() => {
    if (fileQuery.data !== undefined && value === null) {
      const content = fileQuery.data.content;
      setValue(content);
      valueRef.current = content;
    }
  // 의도적으로 value 변경 무시 — 초기 1회만 세팅
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fileQuery.data]);

  const handleChange = useCallback((newValue: string) => {
    setValue(newValue);
    valueRef.current = newValue;
    setFileDirty(filePath, true);
  }, [filePath, setFileDirty]);

  const save = useCallback(() => {
    writeFileMutation.mutate({ filePath, content: valueRef.current });
  }, [filePath, writeFileMutation]);

  // Ctrl+S / Cmd+S 저장
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 's') {
        e.preventDefault();
        save();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [save]);

  // 커서 위치 추적 — onUpdate 핸들러로 처리
  const handleUpdate = useCallback((update: ViewUpdate) => {
    if (update.selectionSet) {
      const state = update.state;
      const pos = state.selection.main.head;
      const line = state.doc.lineAt(pos);
      setCursorLine(line.number);
      setCursorCol(pos - line.from + 1);
    }
  }, []);

  const langExt = getLanguageExtension(filePath);
  const langName = getLanguageName(filePath);
  const fileName = filePath.split('/').pop() ?? filePath;
  const dirPath = filePath.substring(0, filePath.lastIndexOf('/'));

  const extensions = [
    EditorView.theme({
      '&': { height: '100%', fontSize: '13px' },
      '.cm-scroller': { overflow: 'auto', fontFamily: 'var(--font-mono, "JetBrains Mono", "Fira Code", monospace)' },
    }),
    ...(langExt ? [langExt] : []),
  ];

  if (fileQuery.isLoading || value === null) {
    return (
      <div className="flex-1 flex items-center justify-center" style={{ color: 'var(--text-muted)' }}>
        <span className="text-xs">Loading...</span>
      </div>
    );
  }

  if (!fileQuery.data?.exists) {
    return (
      <div className="flex-1 flex items-center justify-center" style={{ color: 'var(--text-muted)' }}>
        <span className="text-xs">File not found: {filePath}</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full" style={{ backgroundColor: '#282c34' }}>
      {/* 파일 경로 헤더 */}
      <div
        className="flex items-center gap-1 px-3 py-1.5 text-xs flex-shrink-0 border-b select-none"
        style={{ backgroundColor: 'var(--bg-secondary)', borderColor: 'var(--border)', color: 'var(--text-muted)' }}
      >
        <span className="truncate" title={filePath}>{dirPath}/</span>
        <span className="font-semibold flex-shrink-0" style={{ color: 'var(--text-primary)' }}>{fileName}</span>
      </div>

      {/* 에디터 본문 */}
      <div className="flex-1 overflow-hidden">
        <CodeMirror
          value={value}
          height="100%"
          theme={oneDark}
          extensions={extensions}
          onChange={handleChange}
          onUpdate={handleUpdate}
          style={{ height: '100%' }}
          basicSetup={{
            lineNumbers: true,
            highlightActiveLineGutter: true,
            highlightSpecialChars: true,
            history: true,
            foldGutter: true,
            drawSelection: true,
            dropCursor: true,
            allowMultipleSelections: true,
            indentOnInput: true,
            syntaxHighlighting: true,
            bracketMatching: true,
            closeBrackets: true,
            autocompletion: false,
            rectangularSelection: true,
            crosshairCursor: false,
            highlightActiveLine: true,
            highlightSelectionMatches: true,
            closeBracketsKeymap: true,
            defaultKeymap: true,
            searchKeymap: false,
            historyKeymap: true,
            foldKeymap: true,
            completionKeymap: false,
            lintKeymap: false,
            tabSize: 2,
          }}
        />
      </div>

      {/* 상태바 */}
      <div
        className="flex items-center justify-between px-3 py-1 text-[10px] flex-shrink-0 border-t select-none"
        style={{ backgroundColor: 'var(--bg-secondary)', borderColor: 'var(--border)', color: 'var(--text-muted)' }}
      >
        <div className="flex items-center gap-3">
          <span>Ln {cursorLine}, Col {cursorCol}</span>
          {writeFileMutation.isPending && (
            <span style={{ color: 'var(--accent)' }}>Saving...</span>
          )}
        </div>
        <span>{langName}</span>
      </div>
    </div>
  );
}
