import { useAtom } from 'jotai';
import { CHAT_MODELS, type ChatProvider, type ChatModel } from '@maestro/shared-types';
import { anthropicIsAuthenticatedAtom } from '../../store/anthropicAuthStore';
import {
  openaiStatusAtom,
  googleStatusAtom,
  startOAuth,
  disconnectProvider,
} from '../../store/chatProviderStore';

interface Props {
  selectedProvider: ChatProvider;
  selectedModel: string;
  onSelect: (provider: ChatProvider, modelId: string) => void;
}

const PROVIDER_LABELS: Record<ChatProvider, string> = {
  anthropic: 'Claude',
  openai: 'ChatGPT',
  google: 'Gemini',
};

// 프로바이더별 모델 그룹핑
const modelsByProvider = CHAT_MODELS.reduce(
  (acc, model) => {
    if (!acc[model.provider]) acc[model.provider] = [];
    acc[model.provider].push(model);
    return acc;
  },
  {} as Record<ChatProvider, ChatModel[]>
);

export function ModelSelector({ selectedProvider, selectedModel, onSelect }: Props) {
  const [anthropicAuth] = useAtom(anthropicIsAuthenticatedAtom);
  const [openaiStatus] = useAtom(openaiStatusAtom);
  const [googleStatus] = useAtom(googleStatusAtom);

  const statusMap: Record<ChatProvider, boolean> = {
    anthropic: anthropicAuth,
    openai: openaiStatus === 'connected',
    google: googleStatus === 'connected',
  };

  const connectingMap: Record<ChatProvider, boolean> = {
    anthropic: false,
    openai: openaiStatus === 'connecting',
    google: googleStatus === 'connecting',
  };

  const providers: ChatProvider[] = ['anthropic', 'openai', 'google'];

  const handleProviderClick = (provider: ChatProvider) => {
    const isConnected = statusMap[provider];
    const isConnecting = connectingMap[provider];

    if (isConnecting) return;

    if (!isConnected) {
      if (provider !== 'anthropic') {
        void startOAuth(provider);
      }
      return;
    }

    // 연결된 경우 해당 프로바이더의 첫 번째 모델 자동 선택
    const firstModel = modelsByProvider[provider]?.[0];
    if (firstModel) onSelect(provider, firstModel.id);
  };

  return (
    <div
      className="flex items-center gap-2 px-3 py-2 flex-shrink-0"
      style={{ borderBottom: '1px solid var(--border)', backgroundColor: 'var(--bg-secondary)' }}
    >
      {/* 프로바이더 선택 버튼 그룹 */}
      <div className="flex gap-1">
        {providers.map((provider) => {
          const isConnected = statusMap[provider];
          const isConnecting = connectingMap[provider];
          const isSelected = selectedProvider === provider && isConnected;

          return (
            <button
              key={provider}
              onClick={() => handleProviderClick(provider)}
              disabled={isConnecting}
              className="flex items-center gap-1.5 px-2 py-1 rounded text-xs transition-colors"
              style={{
                backgroundColor: isSelected
                  ? 'var(--accent)'
                  : isConnected
                    ? 'var(--bg-hover)'
                    : 'transparent',
                color: isSelected
                  ? '#fff'
                  : isConnected
                    ? 'var(--text-primary)'
                    : 'var(--text-muted)',
                border: `1px solid ${isSelected ? 'var(--accent)' : 'var(--border)'}`,
                opacity: !isConnected && !isConnecting && provider !== 'anthropic' ? 0.6 : 1,
                cursor: isConnecting ? 'wait' : 'pointer',
              }}
              title={
                isConnecting
                  ? '연결 중...'
                  : !isConnected && provider !== 'anthropic'
                    ? `${PROVIDER_LABELS[provider]} 연결하기`
                    : PROVIDER_LABELS[provider]
              }
            >
              <span style={{ fontSize: 8 }}>
                {isConnecting ? '◌' : isConnected ? '●' : '○'}
              </span>
              {PROVIDER_LABELS[provider]}
              {!isConnected && !isConnecting && provider !== 'anthropic' && (
                <span style={{ fontSize: 9, opacity: 0.8 }}>연결</span>
              )}
              {isConnecting && (
                <span style={{ fontSize: 9, opacity: 0.8 }}>중...</span>
              )}
            </button>
          );
        })}
      </div>

      {/* 모델 선택 드롭다운 (현재 프로바이더가 연결된 경우만) */}
      {statusMap[selectedProvider] && (
        <select
          value={selectedModel}
          onChange={(e) => onSelect(selectedProvider, e.target.value)}
          className="text-xs px-2 py-1 rounded outline-none"
          style={{
            backgroundColor: 'var(--bg-elevated)',
            color: 'var(--text-primary)',
            border: '1px solid var(--border)',
          }}
        >
          {(modelsByProvider[selectedProvider] ?? []).map((m) => (
            <option key={m.id} value={m.id}>
              {m.displayName}
            </option>
          ))}
        </select>
      )}

      {/* 연결 해제 버튼 (anthropic 제외, 연결된 경우만) */}
      {selectedProvider !== 'anthropic' && statusMap[selectedProvider] && (
        <button
          onClick={() => void disconnectProvider(selectedProvider)}
          className="ml-auto text-xs px-2 py-1 rounded transition-colors"
          style={{ color: 'var(--text-muted)', border: '1px solid var(--border)' }}
          title="연결 해제"
        >
          ✕
        </button>
      )}
    </div>
  );
}
