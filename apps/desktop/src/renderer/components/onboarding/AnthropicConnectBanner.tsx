import { useAnthropicAuthStore } from '../../store/anthropicAuthStore';

interface Props {
  variant?: 'banner' | 'card';
}

export function AnthropicConnectBanner({ variant = 'banner' }: Props) {
  const status = useAnthropicAuthStore((s) => s.status);
  const isLoading = useAnthropicAuthStore((s) => s.isLoading);
  const openOAuth = useAnthropicAuthStore((s) => s.openOAuth);

  if (status === 'authenticated' || status === 'checking') return null;

  if (variant === 'banner') {
    return (
      <div
        className="flex items-center justify-between px-4 py-2.5 text-xs"
        style={{
          backgroundColor: 'rgba(79, 139, 255, 0.1)',
          borderBottom: '1px solid rgba(79, 139, 255, 0.2)',
          color: 'var(--text-primary)',
        }}
      >
        <div className="flex items-center gap-2">
          <span style={{ color: '#4B8BFF' }}>⚡</span>
          <span>
            {status === 'expired'
              ? 'Anthropic 인증이 만료되었습니다.'
              : 'AI 태스크 생성을 사용하려면 Anthropic 계정이 필요합니다.'}
          </span>
        </div>
        <button
          onClick={() => void openOAuth()}
          disabled={isLoading}
          className="px-3 py-1 rounded text-xs font-medium transition-colors"
          style={{
            backgroundColor: '#4B8BFF',
            color: '#fff',
            opacity: isLoading ? 0.6 : 1,
          }}
        >
          {isLoading ? '연결 중...' : status === 'expired' ? '재인증' : 'Anthropic 연결'}
        </button>
      </div>
    );
  }

  // card variant
  return (
    <div
      className="flex flex-col items-center justify-center gap-4 p-8 rounded-xl text-center"
      style={{
        backgroundColor: 'var(--bg-secondary)',
        border: '1px solid var(--border)',
      }}
    >
      <div className="text-3xl opacity-30" style={{ color: 'var(--text-muted)' }}>
        🤖
      </div>
      <div className="flex flex-col gap-1">
        <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
          AI 기능을 사용하려면 Anthropic 계정이 필요합니다
        </p>
        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
          Claude AI를 통해 자연어로 태스크를 생성할 수 있습니다.
        </p>
      </div>
      <button
        onClick={() => void openOAuth()}
        disabled={isLoading}
        className="px-4 py-2 rounded text-sm font-medium transition-colors"
        style={{
          backgroundColor: 'var(--accent)',
          color: '#fff',
          opacity: isLoading ? 0.6 : 1,
        }}
      >
        {isLoading ? '연결 중...' : 'Anthropic으로 로그인'}
      </button>
    </div>
  );
}
