/**
 * M8-01: 온보딩 위자드
 *
 * 앱 첫 실행 시 3단계 위자드를 오버레이로 표시:
 * 1. 에이전트 선택
 * 2. 레포지토리 추가
 * 3. 첫 세션 생성
 */

import { useState, useCallback } from 'react';
import { useSettingsStore } from '../../store/settingsStore';
import { useAgentStore } from '../../store/agentStore';
import { useRepositoryStore } from '../../store/repositoryStore';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { FocusTrap } from '../shared/FocusTrap';
import { trpc } from '../../lib/trpc';

const AGENT_OPTIONS: { name: string; desc: string; icon: string }[] = [
  { name: 'Claude Code', desc: 'Anthropic AI 코딩 어시스턴트', icon: 'C' },
  { name: 'Codex CLI', desc: 'OpenAI 코드 생성 에이전트', icon: 'O' },
  { name: 'Gemini CLI', desc: 'Google AI 코딩 어시스턴트', icon: 'G' },
];

type Step = 1 | 2 | 3;

export function OnboardingWizard({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState<Step>(1);
  const [selectedAgentName, setSelectedAgentName] = useState('Claude Code');
  const [neverShowAgain, setNeverShowAgain] = useState(false);
  const [repoPath, setRepoPath] = useState('');
  const [isAdding, setIsAdding] = useState(false);

  const setOnboardingCompleted = useSettingsStore((s) => s.setOnboardingCompleted);
  const agents = useAgentStore((s) => s.agents);
  const { addRepository } = useRepositoryStore();
  const { addWorkspace } = useWorkspaceStore();

  const addRepoMutation = trpc.repository.add.useMutation({
    onSuccess: (repo) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      addRepository(repo as any);
      setIsAdding(false);
      setStep(3);
    },
    onError: () => setIsAdding(false),
  });

  const openDirMutation = trpc.dialog.openDirectory.useMutation({
    onSuccess: (result: string | null) => {
      if (result) {
        setRepoPath(result);
      }
    },
  });

  const createWorkspaceMutation = trpc.workspace.create.useMutation({
    onSuccess: (ws) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      addWorkspace(ws as any);
      handleComplete();
    },
  });

  const handleComplete = useCallback(() => {
    setOnboardingCompleted(true);
    onClose();
  }, [setOnboardingCompleted, onClose]);

  const handleSkip = () => {
    if (neverShowAgain) {
      setOnboardingCompleted(true);
    }
    onClose();
  };

  const handleAddRepo = () => {
    if (!repoPath.trim()) return;
    setIsAdding(true);
    addRepoMutation.mutate({ path: repoPath.trim() });
  };

  const handleCreateSession = () => {
    const repo = useRepositoryStore.getState().repositories[0];
    if (!repo) {
      handleComplete();
      return;
    }

    // 선택한 에이전트 이름으로 매칭 (Agent 인터페이스에 type 필드 없음)
    const _agentId = agents.find((a) => a.name === selectedAgentName)?.id;
    // 에이전트 없어도 워크스페이스는 생성
    void _agentId;

    createWorkspaceMutation.mutate({
      repositoryId: repo.id,
      name: `${repo.name}-workspace`,
    });
  };

  const stepTitles: Record<Step, string> = {
    1: '에이전트 선택',
    2: '레포지토리 추가',
    3: '시작하기',
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ backgroundColor: 'rgba(0,0,0,0.7)' }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="onboarding-title"
    >
      <FocusTrap>
        <div
          className="w-full max-w-xl rounded-xl shadow-2xl overflow-hidden"
          style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border)' }}
        >
          {/* Header */}
          <div className="px-6 pt-6 pb-4">
            <h2 id="onboarding-title" className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>
              Maestro에 오신 것을 환영합니다
            </h2>
            <p className="text-sm mt-1" style={{ color: 'var(--text-secondary)' }}>
              {stepTitles[step]} (단계 {step}/3)
            </p>
            {/* Progress bar */}
            <div className="flex gap-1.5 mt-3">
              {[1, 2, 3].map((s) => (
                <div
                  key={s}
                  className="flex-1 h-1 rounded-full transition-colors"
                  style={{
                    backgroundColor: s <= step ? 'var(--accent)' : 'var(--bg-hover)',
                  }}
                />
              ))}
            </div>
          </div>

          {/* Content */}
          <div className="px-6 pb-4 min-h-[280px]">
            {step === 1 && (
              <div className="flex flex-col gap-3">
                <p className="text-xs mb-2" style={{ color: 'var(--text-muted)' }}>
                  사용할 AI 에이전트를 선택하세요. 나중에 설정에서 변경할 수 있습니다.
                </p>
                {AGENT_OPTIONS.map((agent) => (
                  <button
                    key={agent.name}
                    onClick={() => setSelectedAgentName(agent.name)}
                    className="flex items-center gap-4 p-4 rounded-lg transition-colors text-left"
                    style={{
                      backgroundColor: selectedAgentName === agent.name ? 'var(--bg-active)' : 'var(--bg-primary)',
                      border: `2px solid ${selectedAgentName === agent.name ? 'var(--accent)' : 'var(--border)'}`,
                    }}
                  >
                    <div
                      className="w-12 h-12 rounded-lg flex items-center justify-center text-lg font-bold flex-shrink-0"
                      style={{
                        backgroundColor: selectedAgentName === agent.name ? 'var(--accent)' : 'var(--bg-hover)',
                        color: selectedAgentName === agent.name ? '#fff' : 'var(--text-secondary)',
                      }}
                    >
                      {agent.icon}
                    </div>
                    <div className="flex flex-col gap-0.5">
                      <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                        {agent.name}
                      </span>
                      <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                        {agent.desc}
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            )}

            {step === 2 && (
              <div className="flex flex-col gap-4">
                <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
                  작업할 레포지토리를 추가하세요. 로컬 폴더를 선택하거나 경로를 직접 입력할 수 있습니다.
                </p>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={repoPath}
                    onChange={(e) => setRepoPath(e.target.value)}
                    placeholder="/path/to/your/project"
                    className="flex-1 px-3 py-2 text-sm rounded-lg outline-none"
                    style={{
                      backgroundColor: 'var(--bg-primary)',
                      color: 'var(--text-primary)',
                      border: '1px solid var(--border)',
                    }}
                    onFocus={(e) => (e.currentTarget.style.borderColor = 'var(--accent)')}
                    onBlur={(e) => (e.currentTarget.style.borderColor = 'var(--border)')}
                  />
                  <button
                    onClick={() => openDirMutation.mutate()}
                    className="px-3 py-2 text-sm rounded-lg transition-colors flex-shrink-0"
                    style={{
                      backgroundColor: 'var(--bg-primary)',
                      color: 'var(--text-secondary)',
                      border: '1px solid var(--border)',
                    }}
                    aria-label="폴더 선택"
                  >
                    폴더 선택
                  </button>
                </div>
                {addRepoMutation.isError && (
                  <p className="text-xs" style={{ color: '#f87171' }}>
                    {addRepoMutation.error.message}
                  </p>
                )}
              </div>
            )}

            {step === 3 && (
              <div className="flex flex-col items-center justify-center gap-4 py-6">
                <div
                  className="w-16 h-16 rounded-full flex items-center justify-center text-2xl"
                  style={{ backgroundColor: 'rgba(34,197,94,0.15)', color: '#22c55e' }}
                >
                  ✓
                </div>
                <div className="text-center">
                  <p className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                    준비 완료!
                  </p>
                  <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
                    새 워크스페이스를 자동으로 생성하고 첫 세션을 시작합니다.
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* Footer */}
          <div
            className="flex items-center justify-between px-6 py-4 border-t"
            style={{ borderColor: 'var(--border)' }}
          >
            <div className="flex items-center gap-2">
              <button
                onClick={handleSkip}
                className="text-xs transition-colors"
                style={{ color: 'var(--text-muted)' }}
                onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--text-primary)')}
                onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--text-muted)')}
              >
                건너뛰기
              </button>
              <label className="flex items-center gap-1.5 cursor-pointer">
                <input
                  type="checkbox"
                  checked={neverShowAgain}
                  onChange={(e) => setNeverShowAgain(e.target.checked)}
                  className="cursor-pointer"
                  style={{ accentColor: 'var(--accent)' }}
                />
                <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                  다시 보지 않기
                </span>
              </label>
            </div>
            <div className="flex gap-2">
              {step > 1 && (
                <button
                  onClick={() => setStep((step - 1) as Step)}
                  className="px-4 py-2 text-xs rounded-lg transition-colors"
                  style={{
                    backgroundColor: 'var(--bg-primary)',
                    color: 'var(--text-secondary)',
                    border: '1px solid var(--border)',
                  }}
                >
                  이전
                </button>
              )}
              {step === 1 && (
                <button
                  onClick={() => setStep(2)}
                  className="px-4 py-2 text-xs rounded-lg font-medium text-white transition-colors"
                  style={{ backgroundColor: 'var(--accent)' }}
                  onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--accent-hover)')}
                  onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'var(--accent)')}
                >
                  다음
                </button>
              )}
              {step === 2 && (
                <button
                  onClick={handleAddRepo}
                  disabled={!repoPath.trim() || isAdding}
                  className="px-4 py-2 text-xs rounded-lg font-medium text-white transition-colors disabled:opacity-50"
                  style={{ backgroundColor: 'var(--accent)' }}
                  onMouseEnter={(e) => { if (repoPath.trim()) e.currentTarget.style.backgroundColor = 'var(--accent-hover)'; }}
                  onMouseLeave={(e) => { if (repoPath.trim()) e.currentTarget.style.backgroundColor = 'var(--accent)'; }}
                >
                  {isAdding ? '추가 중...' : '추가 후 다음'}
                </button>
              )}
              {step === 3 && (
                <button
                  onClick={handleCreateSession}
                  disabled={createWorkspaceMutation.isPending}
                  className="px-4 py-2 text-xs rounded-lg font-medium text-white transition-colors disabled:opacity-50"
                  style={{ backgroundColor: 'var(--accent)' }}
                  onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--accent-hover)')}
                  onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'var(--accent)')}
                >
                  {createWorkspaceMutation.isPending ? '생성 중...' : '시작하기'}
                </button>
              )}
            </div>
          </div>
        </div>
      </FocusTrap>
    </div>
  );
}
