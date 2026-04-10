import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';
import type { Components } from 'react-markdown';

interface Props {
  content: string;
  className?: string;
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <button
      onClick={handleCopy}
      className="absolute top-2 right-2 px-2 py-0.5 text-[10px] rounded opacity-0 group-hover:opacity-100 transition-opacity"
      style={{
        backgroundColor: 'var(--bg-primary)',
        color: 'var(--text-muted)',
        border: '1px solid var(--border)',
      }}
    >
      {copied ? '복사됨' : '복사'}
    </button>
  );
}

const components: Components = {
  // 코드 블록: 복사 버튼 + syntax highlight
  pre({ children, ...props }) {
    const codeEl = (children as React.ReactElement)?.props;
    const codeText = typeof codeEl?.children === 'string' ? codeEl.children : '';

    return (
      <div className="relative group my-3">
        <CopyButton text={codeText} />
        <pre
          {...props}
          className="overflow-x-auto rounded-lg text-xs p-4"
          style={{ backgroundColor: 'var(--bg-primary)', border: '1px solid var(--border)' }}
        >
          {children}
        </pre>
      </div>
    );
  },

  // 인라인 코드
  code({ className, children, ...props }) {
    const isBlock = /language-/.test(className ?? '');
    if (isBlock) {
      return <code className={className} {...props}>{children}</code>;
    }
    return (
      <code
        className="px-1.5 py-0.5 rounded text-xs font-mono"
        style={{ backgroundColor: 'var(--bg-primary)', color: 'var(--accent)' }}
        {...props}
      >
        {children}
      </code>
    );
  },

  // 링크: 외부 링크는 새 탭
  a({ href, children, ...props }) {
    return (
      <a
        href={href}
        target="_blank"
        rel="noreferrer"
        style={{ color: 'var(--accent)' }}
        className="underline underline-offset-2 hover:opacity-80 transition-opacity"
        {...props}
      >
        {children}
      </a>
    );
  },

  // 체크박스
  input({ checked, ...props }) {
    return (
      <input
        type="checkbox"
        checked={checked}
        readOnly
        className="mr-1.5 accent-[var(--accent)]"
        {...props}
      />
    );
  },

  // 테이블
  table({ children, ...props }) {
    return (
      <div className="overflow-x-auto my-3">
        <table
          className="w-full border-collapse text-xs"
          style={{ borderColor: 'var(--border)' }}
          {...props}
        >
          {children}
        </table>
      </div>
    );
  },

  th({ children, ...props }) {
    return (
      <th
        className="px-3 py-2 text-left font-semibold border-b"
        style={{ borderColor: 'var(--border)', backgroundColor: 'var(--bg-primary)' }}
        {...props}
      >
        {children}
      </th>
    );
  },

  td({ children, ...props }) {
    return (
      <td
        className="px-3 py-2 border-b"
        style={{ borderColor: 'var(--border)' }}
        {...props}
      >
        {children}
      </td>
    );
  },
};

/**
 * GFM 마크다운 렌더러.
 * - 코드 블록 신택스 하이라이팅 (rehype-highlight)
 * - GFM 체크리스트, 테이블, 취소선 (remark-gfm)
 * - 코드 블록 클립보드 복사 버튼
 */
export function MarkdownRenderer({ content, className }: Props) {
  return (
    <div
      className={`prose prose-sm max-w-none text-xs leading-relaxed ${className ?? ''}`}
      style={{ color: 'var(--text-primary)' }}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeHighlight]}
        components={components}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
}
