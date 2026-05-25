import { useState } from 'react';
import { X, GitBranch, ArrowRight } from 'lucide-react';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { useRepositoryStore } from '../../store/repositoryStore';
import { trpc } from '../../lib/trpc';
import { toast } from '../../lib/toast';
import type { Workspace, WorkspaceTemplate } from '@maestro/shared-types';

interface Props {
  repositoryId: string;
  onClose: () => void;
  /** 완료 후 세션 생성 모달 열기 콜백 (선택) */
  onCreated?: (workspace: Workspace) => void;
}

// 생성 단계 정의
type Step = 'idle' | 'worktree' | 'setup' | 'done';

const STEP_GAUGE: Record<Step, number> = {
  idle: 0,
  worktree: 33,
  setup: 66,
  done: 100,
};

export function CreateWorkspaceModal({ repositoryId, onClose, onCreated }: Props) {
  const { addWorkspace } = useWorkspaceStore();
  const { repositories } = useRepositoryStore();
  const repo = repositories.find((r) => r.id === repositoryId);

  const [name, setName] = useState('');
  const [prompt, setPrompt] = useState('');
  const [error, setError] = useState('');
  const [step, setStep] = useState<Step>('idle');
  const [createdWorkspace, setCreatedWorkspace] = useState<Workspace | null>(null);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string | null>(null);

  const templateQuery = trpc.template.list.useQuery();
  const applyTemplateMutation = trpc.template.applyToWorkspace.useMutation();

  const templates = (templateQuery.data ?? []) as WorkspaceTemplate[];

  const createMutation = trpc.workspace.create.useMutation({
    onMutate: () => {
      setStep('worktree');
      setTimeout(() => setStep('setup'), 250);
    },
    onSuccess: async (workspace) => {
      const ws = workspace as Workspace;
      addWorkspace(ws);
      setCreatedWorkspace(ws);

      if (selectedTemplateId) {
        try {
          await applyTemplateMutation.mutateAsync({ templateId: selectedTemplateId, workspaceId: ws.id });
        } catch {
          // 템플릿 적용 실패는 워크스페이스 생성 자체를 막지 않음
        }
      }

      setStep('done');
      toast.success('워크스페이스 생성 완료', ws.name);

      if (onCreated) {
        onCreated(ws);
        onClose();
      }
    },
    onError: (e) => {
      setStep('idle');
      setError(e.message);
      toast.error('워크스페이스 생성 실패', e.message);
    },
  });

  const handleCreate = () => {
    if (!name.trim()) return;
    setError('');
    createMutation.mutate({ name: name.trim(), repositoryId });
  };

  const branchName = repo?.branchPrefix
    ? `${repo.branchPrefix}/${name || '...'}`
    : name || '...';

  const gaugeWidth = STEP_GAUGE[step];

  return (
    <div
      className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="워크스페이스 생성"
    >
      <div
        className="w-[min(680px,calc(100vw-2rem))] bg-popover rounded-xl overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 상단 진행 게이지 */}
        <div className="relative h-[1px] w-full bg-border/40">
          <div
            className="absolute inset-y-0 left-0 bg-foreground/70 transition-[width] duration-500 ease-out"
            style={{ width: `${gaugeWidth}%` }}
          />
        </div>

        {/* 헤더 */}
        <div className="flex items-center justify-between px-5 pt-5 pb-4 border-b border-border/60">
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-medium text-muted-foreground">Project</span>
            <span className="text-[13px] font-medium text-foreground">{repo?.name ?? repositoryId}</span>
          </div>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground transition-colors"
            aria-label="닫기"
          >
            <X size={14} />
          </button>
        </div>

        {/* 템플릿 선택 (있을 때만) */}
        {templates.length > 0 && (
          <div className="px-5 pt-4 flex flex-wrap gap-1.5">
            <button
              onClick={() => setSelectedTemplateId(null)}
              className={`text-[10px] px-2 py-1 rounded border transition-colors ${
                selectedTemplateId === null
                  ? 'bg-foreground text-background border-foreground'
                  : 'bg-transparent text-muted-foreground border-border hover:border-foreground/40'
              }`}
            >
              None
            </button>
            {templates.map((tpl) => (
              <button
                key={tpl.id}
                onClick={() => setSelectedTemplateId(tpl.id)}
                className={`text-[10px] px-2 py-1 rounded border transition-colors ${
                  selectedTemplateId === tpl.id
                    ? 'bg-foreground text-background border-foreground'
                    : 'bg-transparent text-muted-foreground border-border hover:border-foreground/40'
                }`}
              >
                {tpl.name}
              </button>
            ))}
          </div>
        )}

        {/* 프롬프트 입력 */}
        <div className="px-5 py-4">
          <textarea
            autoFocus
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="What should this workspace do?"
            className="w-full bg-transparent text-[14px] text-foreground placeholder:text-muted-foreground/60 resize-none outline-none min-h-[96px] leading-relaxed"
            rows={4}
          />
        </div>

        {/* 브랜치명 영역 */}
        <div className="flex items-center gap-4 px-5 py-3 border-t border-border/60">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <GitBranch size={12} className="text-muted-foreground shrink-0" />
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleCreate()}
              placeholder="branch-name"
              className="bg-transparent text-[12px] font-mono text-foreground placeholder:text-muted-foreground/60 outline-none min-w-0 flex-1"
            />
          </div>
          {repo?.baseBranch && (
            <span className="text-[11px] text-muted-foreground font-mono shrink-0">
              from {repo.baseBranch}
            </span>
          )}
          {repo?.branchPrefix && name && (
            <span className="text-[11px] text-muted-foreground font-mono shrink-0 hidden sm:block">
              → {branchName}
            </span>
          )}
        </div>

        {/* 에러 메시지 */}
        {error && (
          <div className="mx-5 mb-3 text-xs text-destructive bg-destructive/10 px-3 py-2 rounded-md">
            {error}
          </div>
        )}

        {/* 푸터 */}
        <div className="flex items-center justify-end gap-2 px-5 py-3.5 border-t border-border/60">
          {step === 'done' && onCreated && createdWorkspace ? (
            <>
              <button
                onClick={onClose}
                className="px-3 py-1.5 text-[12px] text-muted-foreground hover:text-foreground transition-colors"
              >
                Close
              </button>
              <button
                onClick={() => {
                  onCreated(createdWorkspace);
                  onClose();
                }}
                className="flex items-center gap-1.5 px-4 py-1.5 text-[12px] font-medium bg-foreground text-background rounded-md hover:opacity-90 transition-opacity"
              >
                Start Session <ArrowRight size={12} />
              </button>
            </>
          ) : (
            <>
              <button
                onClick={onClose}
                className="px-3 py-1.5 text-[12px] text-muted-foreground hover:text-foreground transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleCreate}
                disabled={step !== 'idle' || !name.trim()}
                className="flex items-center gap-1.5 px-4 py-1.5 text-[12px] font-medium bg-foreground text-background rounded-md hover:opacity-90 transition-opacity disabled:opacity-40"
              >
                {step !== 'idle' ? 'Creating...' : <>Create <ArrowRight size={12} /></>}
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
