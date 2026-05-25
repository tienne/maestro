import { useState, useEffect } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useTheme } from '../ThemeProvider';
import { useSettingsStore, DEFAULT_INTERVIEW_SYSTEM_PROMPT } from '../../store/settingsStore';
import { useUiStore } from '../../store/uiStore';
import { useAgentStore } from '../../store/agentStore';
import { useMcpStore, type McpServer } from '../../store/mcpStore';
import { useRepositoryStore } from '../../store/repositoryStore';
import { AgentIcon } from '../shared/AgentIcon';
import { trpc } from '../../lib/trpc';
import { toast } from '../../lib/toast';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { useAuthStore } from '../../store/authStore';
import { useAnthropicAuthStore } from '../../store/anthropicAuthStore';
import type { Agent, Repository, EnvVar, AgentPreset } from '@maestro/shared-types';

type Section = 'account' | 'repositories' | 'appearance' | 'terminal' | 'notifications' | 'system' | 'agents' | 'presets' | 'mcp' | 'webhooks' | 'api' | 'relay' | 'shortcuts' | 'plugins' | 'about' | 'taskCreationAI' | 'anthropicAuth';

const NAV_GROUPS: { label: string; items: { id: Section; label: string }[] }[] = [
  {
    label: '계정',
    items: [
      { id: 'account', label: '계정' },
    ],
  },
  {
    label: '워크스페이스',
    items: [
      { id: 'repositories', label: 'Repositories' },
    ],
  },
  {
    label: '에이전트',
    items: [
      { id: 'agents', label: 'Agents' },
      { id: 'presets', label: 'Presets' },
      { id: 'mcp', label: 'MCP Servers' },
      { id: 'plugins', label: 'Plugins' },
      { id: 'taskCreationAI', label: '태스크 생성 AI' },
      { id: 'anthropicAuth', label: 'Anthropic 인증' },
    ],
  },
  {
    label: '외관 & 입력',
    items: [
      { id: 'appearance', label: '외관' },
      { id: 'terminal', label: 'Terminal' },
      { id: 'shortcuts', label: '단축키' },
    ],
  },
  {
    label: '자동화 & API',
    items: [
      { id: 'webhooks', label: 'Webhooks' },
      { id: 'api', label: 'API' },
      { id: 'relay', label: 'Relay' },
    ],
  },
  {
    label: '시스템',
    items: [
      { id: 'notifications', label: '알림' },
      { id: 'system', label: 'System' },
      { id: 'about', label: '정보' },
    ],
  },
];

const SHORTCUTS = [
  { keys: '⌘K', desc: '명령 팔레트 열기' },
  { keys: '⌘B', desc: '사이드바 토글' },
  { keys: '⌘\\', desc: '수직 분할' },
  { keys: '⌘⇧\\', desc: '수평 분할' },
  { keys: '⌘G', desc: 'Git 패널 열기' },
  { keys: '⌘⇧N', desc: '새 창 열기' },
  { keys: '⌘1~9', desc: '세션 번호로 이동' },
];

const PRESET_COLORS = [
  '#4B8BFF', '#34D399', '#F59E0B', '#EF4444', '#A78BFA',
  '#EC4899', '#06B6D4', '#84CC16', '#F97316', '#6B7280',
];

interface SettingsPageProps {
  initialSection?: Section;
}

export function SettingsPage({ initialSection = 'appearance' }: SettingsPageProps) {
  const navigate = useNavigate();
  const { setCurrentView, settingsRepoId } = useUiStore();
  const [activeSection, setActiveSection] = useState<Section>(initialSection);
  const [repoDetailId, setRepoDetailId] = useState<string | null>(
    initialSection === 'repositories' && settingsRepoId ? settingsRepoId : null,
  );

  const handleSectionChange = (section: Section) => {
    setActiveSection(section);
    if (section !== 'repositories') setRepoDetailId(null);
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div
        className="flex items-center gap-3 px-5 py-3 border-b flex-shrink-0"
        style={{ borderColor: 'var(--border)', backgroundColor: 'var(--bg-panel)' }}
      >
        <button
          onClick={() => {
            setCurrentView('terminal');
            void navigate({ to: '/' });
          }}
          className="text-sm transition-colors"
          style={{ color: 'var(--text-muted)' }}
          onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--text-primary)')}
          onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--text-muted)')}
        >
          ←
        </button>
        <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
          설정
        </span>
      </div>

      {/* Body: nav + content */}
      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* Left nav */}
        <nav
          className="w-48 flex-shrink-0 flex flex-col overflow-y-auto border-r"
          style={{ borderColor: 'var(--border)', backgroundColor: 'var(--bg-secondary)' }}
        >
          {NAV_GROUPS.map((group) => (
            <div key={group.label} className="pt-4 pb-1">
              {/* 그룹 레이블 */}
              <div
                className="px-4 pb-1 text-[10px] font-semibold uppercase tracking-wider"
                style={{ color: 'var(--text-muted)' }}
              >
                {group.label}
              </div>
              {/* 항목들 */}
              {group.items.map(({ id, label }) => (
                <button
                  key={id}
                  onClick={() => handleSectionChange(id)}
                  className="w-full text-left text-sm transition-colors"
                  style={{
                    padding: '6px 12px 6px 16px',
                    color: activeSection === id ? 'var(--text-primary)' : 'var(--text-secondary)',
                    backgroundColor: activeSection === id ? 'var(--bg-active)' : 'transparent',
                    fontWeight: activeSection === id ? 600 : 400,
                    borderRadius: '6px',
                    margin: '1px 6px',
                    width: 'calc(100% - 12px)',
                  }}
                  onMouseEnter={(e) => {
                    if (activeSection !== id) e.currentTarget.style.backgroundColor = 'var(--bg-hover)';
                  }}
                  onMouseLeave={(e) => {
                    if (activeSection !== id) e.currentTarget.style.backgroundColor = 'transparent';
                  }}
                >
                  {label}
                </button>
              ))}
            </div>
          ))}
          {/* 하단 여백 */}
          <div className="pb-4" />
        </nav>

        {/* Right content */}
        <main className="flex-1 overflow-y-auto px-8 py-6">
          {activeSection === 'account' && <AccountSection />}
          {activeSection === 'repositories' && (
            <RepositoriesSection
              selectedId={repoDetailId}
              onSelect={setRepoDetailId}
              onBack={() => setRepoDetailId(null)}
            />
          )}
          {activeSection === 'appearance' && <AppearanceSection />}
          {activeSection === 'terminal' && <TerminalSettingsSection />}
          {activeSection === 'notifications' && <NotificationsSection />}
          {activeSection === 'system' && <SystemSection />}
          {activeSection === 'agents' && <AgentsSection />}
          {activeSection === 'presets' && <PresetsSection />}
          {activeSection === 'mcp' && <McpSection />}
          {activeSection === 'webhooks' && <WebhooksSection />}
          {activeSection === 'api' && <ApiSection />}
          {activeSection === 'relay' && <RelaySection />}
          {activeSection === 'shortcuts' && <ShortcutsSection />}
          {activeSection === 'plugins' && <PluginsSection />}
          {activeSection === 'about' && <AboutSection />}
          {activeSection === 'taskCreationAI' && <TaskCreationAISection />}
          {activeSection === 'anthropicAuth' && <AnthropicAuthSection />}
        </main>
      </div>
    </div>
  );
}

/* ─── Section: Repositories (목록) ─── */

function RepositoriesSection({
  selectedId,
  onSelect,
  onBack,
}: {
  selectedId: string | null;
  onSelect: (id: string) => void;
  onBack: () => void;
}) {
  const { repositories } = useRepositoryStore();

  if (selectedId !== null) {
    const repo = repositories.find((r) => r.id === selectedId);
    if (!repo) {
      onBack();
      return null;
    }
    return <RepositoryDetailContent repo={repo} onBack={onBack} />;
  }

  return (
    <div className="flex flex-col gap-6 max-w-lg">
      <SectionHeader title="Repositories" desc="레포지토리별 설정을 관리합니다." />

      {repositories.length === 0 ? (
        <div
          className="text-xs text-center py-8 rounded-lg"
          style={{
            color: 'var(--text-muted)',
            backgroundColor: 'var(--bg-secondary)',
            border: '1px solid var(--border)',
          }}
        >
          추가된 레포지토리가 없습니다.
        </div>
      ) : (
        <div className="flex flex-col gap-1.5">
          {repositories.map((repo) => (
            <button
              key={repo.id}
              onClick={() => onSelect(repo.id)}
              className="flex items-center gap-3 px-4 py-3 rounded-lg text-left transition-colors w-full"
              style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border)' }}
              onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--bg-hover)')}
              onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'var(--bg-secondary)')}
            >
              <span
                className="w-3 h-3 rounded-full flex-shrink-0"
                style={{ backgroundColor: repo.color }}
              />
              <span className="text-sm flex-1 font-medium truncate" style={{ color: 'var(--text-primary)' }}>
                {repo.name}
              </span>
              <span
                className="text-[11px] font-mono truncate max-w-[200px]"
                style={{ color: 'var(--text-muted)' }}
              >
                {repo.path}
              </span>
              <span className="text-xs flex-shrink-0" style={{ color: 'var(--text-muted)' }}>
                →
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/* ─── Repository Detail (설정 폼) ─── */

const repoInputCls =
  'text-xs rounded px-3 py-2 outline-none border focus:border-blue-600 placeholder-gray-600 w-full';
const repoInputStyle = {
  backgroundColor: 'var(--bg-secondary)',
  color: 'var(--text-primary)',
  borderColor: 'var(--border)',
};

function RepositoryDetailContent({ repo, onBack }: { repo: Repository; onBack: () => void }) {
  const { updateRepository, envVars, setEnvVars, addOrUpdateEnvVar, removeEnvVar } =
    useRepositoryStore();

  const [name, setName] = useState(repo.name);
  const [color, setColor] = useState(repo.color);
  const [branchPrefix, setBranchPrefix] = useState(repo.branchPrefix);
  const [baseBranch, setBaseBranch] = useState(repo.baseBranch);
  const [worktreeBasePath, setWorktreeBasePath] = useState(repo.worktreeBasePath);
  const [setupScript, setSetupScript] = useState(repo.setupScript);
  const [teardownScript, setTeardownScript] = useState(repo.teardownScript);
  const [savedMsg, setSavedMsg] = useState(false);
  const [newKey, setNewKey] = useState('');
  const [newValue, setNewValue] = useState('');

  const envVarQuery = trpc.repository.envVar.list.useQuery({ repositoryId: repo.id });
  useEffect(() => {
    const d = envVarQuery.data as unknown;
    if (d) setEnvVars(repo.id, d as EnvVar[]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [envVarQuery.data, repo.id]);

  const openDirMutation = trpc.dialog.openDirectory.useMutation();
  const updateMutation = trpc.repository.update.useMutation({
    onSuccess: (updated) => {
      updateRepository(updated as Repository);
      setSavedMsg(true);
      setTimeout(() => setSavedMsg(false), 2000);
    },
  });
  // M5-04: env change notification
  const notifyEnvChangeMutation = trpc.workspace.notifyEnvChange.useMutation();

  const envVarUpsertMutation = trpc.repository.envVar.upsert.useMutation({
    onSuccess: (envVar) => {
      addOrUpdateEnvVar(repo.id, envVar as EnvVar);
      setNewKey('');
      setNewValue('');
      // M5-04: 활성 세션에 알림
      notifyEnvChangeMutation.mutate({ repositoryId: repo.id });
    },
  });
  const envVarDeleteMutation = trpc.repository.envVar.delete.useMutation({
    onSuccess: (_, vars) => {
      removeEnvVar(vars.id, repo.id);
      // M5-04: 활성 세션에 알림
      notifyEnvChangeMutation.mutate({ repositoryId: repo.id });
    },
  });

  const repoEnvVars: EnvVar[] = envVars[repo.id] ?? [];

  const handleSave = () => {
    updateMutation.mutate({
      id: repo.id,
      settings: { name, color, branchPrefix, baseBranch, worktreeBasePath, setupScript, teardownScript },
    });
  };

  const handleAddEnvVar = () => {
    if (!newKey.trim()) return;
    envVarUpsertMutation.mutate({ repositoryId: repo.id, key: newKey.trim(), value: newValue });
  };

  return (
    <div className="flex flex-col gap-6 max-w-xl">
      {/* Breadcrumb + Save */}
      <div
        className="flex items-center gap-2 border-b pb-4"
        style={{ borderColor: 'var(--border)' }}
      >
        <button
          onClick={onBack}
          className="text-xs transition-colors flex-shrink-0"
          style={{ color: 'var(--text-muted)' }}
          onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--text-primary)')}
          onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--text-muted)')}
        >
          ← Repositories
        </button>
        <span className="text-xs" style={{ color: 'var(--border)' }}>/</span>
        <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ backgroundColor: repo.color }} />
        <span
          className="text-sm font-semibold flex-1 truncate"
          style={{ color: 'var(--text-primary)' }}
        >
          {repo.name}
        </span>
        {savedMsg && (
          <span className="text-xs text-green-400 flex-shrink-0">Saved</span>
        )}
        <button
          onClick={handleSave}
          disabled={updateMutation.isPending}
          className="px-3 py-1.5 text-xs text-white rounded disabled:opacity-50 flex-shrink-0"
          style={{ backgroundColor: 'var(--accent)' }}
        >
          {updateMutation.isPending ? 'Saving...' : 'Save'}
        </button>
      </div>

      {/* General */}
      <RepoSubSection title="General">
        <RepoField label="Repository Name">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className={repoInputCls}
            style={repoInputStyle}
          />
        </RepoField>
        <RepoField label="Color">
          <div className="flex flex-wrap gap-2 mt-1">
            {PRESET_COLORS.map((c) => (
              <button
                key={c}
                onClick={() => setColor(c)}
                className={`w-6 h-6 rounded-full transition-all ${color === c ? 'ring-2 ring-white ring-offset-1' : ''}`}
                style={{ backgroundColor: c }}
              />
            ))}
            <input
              type="color"
              value={color}
              onChange={(e) => setColor(e.target.value)}
              className="w-6 h-6 rounded-full cursor-pointer bg-transparent border-0"
              title="Custom color"
            />
          </div>
        </RepoField>
      </RepoSubSection>

      {/* Branch Settings */}
      <RepoSubSection title="Branch Settings">
        <RepoField label="Branch Prefix" hint="e.g. feat, fix — applied to all workspace branches">
          <input
            value={branchPrefix}
            onChange={(e) => setBranchPrefix(e.target.value)}
            placeholder="feat"
            className={repoInputCls}
            style={repoInputStyle}
          />
        </RepoField>
        <RepoField label="Base Branch" hint="New workspaces branch off from this">
          <input
            value={baseBranch}
            onChange={(e) => setBaseBranch(e.target.value)}
            placeholder="main"
            className={repoInputCls}
            style={repoInputStyle}
          />
        </RepoField>
        <RepoField label="Worktree Base Path" hint="Directory where git worktrees are created">
          <div className="flex gap-1.5">
            <input
              value={worktreeBasePath}
              onChange={(e) => setWorktreeBasePath(e.target.value)}
              placeholder="(same level as repo by default)"
              className={`${repoInputCls} flex-1`}
              style={repoInputStyle}
            />
            <button
              onClick={() =>
                openDirMutation.mutate(undefined, {
                  onSuccess: (p) => { if (p) setWorktreeBasePath(p as string); },
                })
              }
              className="px-2.5 py-1.5 text-xs rounded border transition-colors flex-shrink-0"
              style={{
                borderColor: 'var(--border)',
                color: 'var(--text-secondary)',
                backgroundColor: 'var(--bg-secondary)',
              }}
              onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--text-primary)')}
              onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--text-secondary)')}
            >
              Browse
            </button>
          </div>
        </RepoField>
      </RepoSubSection>

      {/* Lifecycle Scripts */}
      <RepoSubSection title="Lifecycle Scripts">
        <RepoField label="Setup Script" hint="Runs after a workspace is created">
          <textarea
            value={setupScript}
            onChange={(e) => setSetupScript(e.target.value)}
            placeholder={"#!/bin/sh\nnpm install"}
            rows={4}
            className={`${repoInputCls} font-mono resize-none`}
            style={repoInputStyle}
          />
        </RepoField>
        <RepoField label="Teardown Script" hint="Runs before a workspace is deleted">
          <textarea
            value={teardownScript}
            onChange={(e) => setTeardownScript(e.target.value)}
            placeholder={"#!/bin/sh\nnpm run cleanup"}
            rows={4}
            className={`${repoInputCls} font-mono resize-none`}
            style={repoInputStyle}
          />
        </RepoField>
      </RepoSubSection>

      {/* Environment Variables */}
      <RepoSubSection title="Environment Variables">
        <div className="flex flex-col gap-1.5">
          {repoEnvVars.map((v) => (
            <div
              key={v.id}
              className="flex items-center gap-2 rounded px-2 py-1.5"
              style={{ backgroundColor: 'var(--bg-secondary)' }}
            >
              <span className="text-xs font-mono flex-1 truncate" style={{ color: 'var(--text-primary)' }}>
                {v.key}
              </span>
              <span className="text-xs font-mono flex-1 truncate" style={{ color: 'var(--text-muted)' }}>
                {v.value}
              </span>
              <button
                onClick={() => envVarDeleteMutation.mutate({ id: v.id })}
                className="text-xs px-1 transition-colors hover:text-red-400"
                style={{ color: 'var(--text-muted)' }}
              >
                ×
              </button>
            </div>
          ))}
          <div className="flex items-center gap-2 mt-1">
            <input
              value={newKey}
              onChange={(e) => setNewKey(e.target.value)}
              placeholder="KEY"
              className="text-xs rounded px-2 py-1.5 outline-none border flex-1 font-mono"
              style={repoInputStyle}
            />
            <span className="text-xs" style={{ color: 'var(--text-muted)' }}>=</span>
            <input
              value={newValue}
              onChange={(e) => setNewValue(e.target.value)}
              placeholder="value"
              className="text-xs rounded px-2 py-1.5 outline-none border flex-1 font-mono"
              style={repoInputStyle}
              onKeyDown={(e) => { if (e.key === 'Enter') handleAddEnvVar(); }}
            />
            <button
              onClick={handleAddEnvVar}
              disabled={envVarUpsertMutation.isPending || !newKey.trim()}
              className="px-2 py-1.5 text-xs rounded whitespace-nowrap disabled:opacity-50 transition-colors"
              style={{ backgroundColor: 'var(--bg-hover)', color: 'var(--text-secondary)' }}
              onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--bg-active)')}
              onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'var(--bg-hover)')}
            >
              Add
            </button>
          </div>
        </div>
      </RepoSubSection>

      {/* M5-01: Templates */}
      <TemplatesSubSection repositoryId={repo.id} />

      {/* M5-02 & M5-03: Workspace-level settings per workspace */}
      <WorkspaceSettingsSubSection repositoryId={repo.id} />
    </div>
  );
}

/* ─── M5-01: Templates Sub-Section ─── */

function TemplatesSubSection({ repositoryId }: { repositoryId: string }) {
  const templateQuery = trpc.template.list.useQuery();
  const createMutation = trpc.template.create.useMutation({ onSuccess: () => templateQuery.refetch() });
  const deleteMutation = trpc.template.delete.useMutation({ onSuccess: () => templateQuery.refetch() });
  const [showCreate, setShowCreate] = useState(false);
  const [tplName, setTplName] = useState('');
  const [tplDesc, setTplDesc] = useState('');

  const templates = (templateQuery.data ?? []) as Array<{
    id: string; name: string; description: string; agentType: string;
    envVars: Record<string, string>; setupScript: string; teardownScript: string; branchPattern: string; createdAt: string;
  }>;

  const handleCreate = () => {
    if (!tplName.trim()) return;
    createMutation.mutate({ name: tplName.trim(), description: tplDesc.trim() });
    setTplName('');
    setTplDesc('');
    setShowCreate(false);
  };

  return (
    <RepoSubSection title="Workspace Templates">
      <div className="flex flex-col gap-2">
        {templates.map((tpl) => (
          <div
            key={tpl.id}
            className="flex items-center gap-2 px-3 py-2 rounded"
            style={{ backgroundColor: 'var(--bg-secondary)' }}
          >
            <div className="flex-1 min-w-0">
              <div className="text-xs font-medium truncate" style={{ color: 'var(--text-primary)' }}>{tpl.name}</div>
              {tpl.description && (
                <div className="text-[10px] truncate" style={{ color: 'var(--text-muted)' }}>{tpl.description}</div>
              )}
            </div>
            {tpl.agentType && (
              <span className="text-[10px] px-1.5 py-0.5 rounded" style={{ backgroundColor: 'var(--bg-hover)', color: 'var(--text-secondary)' }}>
                {tpl.agentType}
              </span>
            )}
            <button
              onClick={() => deleteMutation.mutate({ id: tpl.id })}
              className="text-xs px-1 transition-colors hover:text-red-400 flex-shrink-0"
              style={{ color: 'var(--text-muted)' }}
            >
              x
            </button>
          </div>
        ))}

        {showCreate ? (
          <div className="flex flex-col gap-2 p-2 rounded" style={{ backgroundColor: 'var(--bg-secondary)' }}>
            <input
              value={tplName}
              onChange={(e) => setTplName(e.target.value)}
              placeholder="Template name"
              className="text-xs rounded px-2 py-1.5 outline-none border"
              style={{ backgroundColor: 'var(--bg-panel)', color: 'var(--text-primary)', borderColor: 'var(--border)' }}
              autoFocus
            />
            <input
              value={tplDesc}
              onChange={(e) => setTplDesc(e.target.value)}
              placeholder="Description (optional)"
              className="text-xs rounded px-2 py-1.5 outline-none border"
              style={{ backgroundColor: 'var(--bg-panel)', color: 'var(--text-primary)', borderColor: 'var(--border)' }}
              onKeyDown={(e) => { if (e.key === 'Enter') handleCreate(); }}
            />
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setShowCreate(false)}
                className="text-xs px-2 py-1 transition-colors"
                style={{ color: 'var(--text-muted)' }}
              >
                Cancel
              </button>
              <button
                onClick={handleCreate}
                disabled={!tplName.trim()}
                className="text-xs px-3 py-1 rounded text-white disabled:opacity-50"
                style={{ backgroundColor: 'var(--accent)' }}
              >
                Save
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setShowCreate(true)}
            className="text-xs px-3 py-1.5 rounded transition-colors self-start"
            style={{ backgroundColor: 'var(--bg-hover)', color: 'var(--text-secondary)' }}
            onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--bg-active)')}
            onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'var(--bg-hover)')}
          >
            + Save as Template
          </button>
        )}
      </div>
    </RepoSubSection>
  );
}

/* ─── M5-02 & M5-03: Per-Workspace Settings (Snapshots + Hooks) ─── */

function WorkspaceSettingsSubSection({ repositoryId }: { repositoryId: string }) {
  const { workspaces } = useWorkspaceStore();
  const repoWorkspaces = workspaces.filter((w) => w.repositoryId === repositoryId);

  if (repoWorkspaces.length === 0) return null;

  return (
    <RepoSubSection title="Workspace Settings">
      <div className="flex flex-col gap-3">
        {repoWorkspaces.map((ws) => (
          <WorkspaceSettingsItem key={ws.id} workspaceId={ws.id} workspaceName={ws.name} />
        ))}
      </div>
    </RepoSubSection>
  );
}

function WorkspaceSettingsItem({ workspaceId, workspaceName }: { workspaceId: string; workspaceName: string }) {
  const [expanded, setExpanded] = useState(false);
  const [hookStart, setHookStart] = useState('');
  const [hookComplete, setHookComplete] = useState('');
  const [hookError, setHookError] = useState('');
  const [hookSaved, setHookSaved] = useState(false);
  const [showRestore, setShowRestore] = useState<string | null>(null);

  const hooksQuery = trpc.workspace.getHooks.useQuery({ workspaceId });
  const snapshotsQuery = trpc.workspace.listSnapshots.useQuery({ workspaceId });
  const updateHooksMutation = trpc.workspace.updateHooks.useMutation({
    onSuccess: () => {
      setHookSaved(true);
      setTimeout(() => setHookSaved(false), 2000);
    },
  });
  const createSnapshotMutation = trpc.workspace.createSnapshot.useMutation({
    onSuccess: () => snapshotsQuery.refetch(),
  });
  const restoreSnapshotMutation = trpc.workspace.restoreSnapshot.useMutation({
    onSuccess: () => {
      setShowRestore(null);
      snapshotsQuery.refetch();
    },
  });

  useEffect(() => {
    if (hooksQuery.data) {
      const d = hooksQuery.data as { hookOnSessionStart: string; hookOnAgentComplete: string; hookOnError: string };
      setHookStart(d.hookOnSessionStart);
      setHookComplete(d.hookOnAgentComplete);
      setHookError(d.hookOnError);
    }
  }, [hooksQuery.data]);

  const snapshots = (snapshotsQuery.data ?? []) as Array<{
    id: string; workspaceId: string; envVars: Record<string, string>; gitHead: string; setupScript: string; createdAt: string;
  }>;

  const handleSaveHooks = () => {
    updateHooksMutation.mutate({
      workspaceId,
      hookOnSessionStart: hookStart,
      hookOnAgentComplete: hookComplete,
      hookOnError: hookError,
    });
  };

  return (
    <div className="rounded border" style={{ borderColor: 'var(--border)' }}>
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center justify-between w-full px-3 py-2 text-xs transition-colors"
        style={{ color: 'var(--text-primary)' }}
        onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--bg-hover)')}
        onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
      >
        <span className="font-medium">{workspaceName}</span>
        <span style={{ color: 'var(--text-muted)' }}>{expanded ? '-' : '+'}</span>
      </button>

      {expanded && (
        <div className="flex flex-col gap-4 px-3 pb-3">
          {/* Lifecycle Hooks */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="text-[10px] uppercase tracking-wider font-semibold" style={{ color: 'var(--text-muted)' }}>
                Lifecycle Hooks
              </span>
              <div className="flex items-center gap-2">
                {hookSaved && <span className="text-[10px] text-green-400">Saved</span>}
                <button
                  onClick={handleSaveHooks}
                  className="text-[10px] px-2 py-0.5 rounded text-white"
                  style={{ backgroundColor: 'var(--accent)' }}
                >
                  Save Hooks
                </button>
              </div>
            </div>
            <RepoField label="onSessionStart" hint="PTY start hook">
              <textarea
                value={hookStart}
                onChange={(e) => setHookStart(e.target.value)}
                placeholder="#!/bin/sh"
                rows={2}
                className="text-xs rounded px-2 py-1.5 outline-none border font-mono resize-none w-full"
                style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--text-primary)', borderColor: 'var(--border)' }}
              />
            </RepoField>
            <RepoField label="onAgentComplete" hint="exit 0 hook">
              <textarea
                value={hookComplete}
                onChange={(e) => setHookComplete(e.target.value)}
                placeholder="#!/bin/sh"
                rows={2}
                className="text-xs rounded px-2 py-1.5 outline-none border font-mono resize-none w-full"
                style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--text-primary)', borderColor: 'var(--border)' }}
              />
            </RepoField>
            <RepoField label="onError" hint="error pattern hook">
              <textarea
                value={hookError}
                onChange={(e) => setHookError(e.target.value)}
                placeholder="#!/bin/sh"
                rows={2}
                className="text-xs rounded px-2 py-1.5 outline-none border font-mono resize-none w-full"
                style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--text-primary)', borderColor: 'var(--border)' }}
              />
            </RepoField>
          </div>

          {/* Snapshots */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <span className="text-[10px] uppercase tracking-wider font-semibold" style={{ color: 'var(--text-muted)' }}>
                Snapshots
              </span>
              <button
                onClick={() => createSnapshotMutation.mutate({ workspaceId })}
                disabled={createSnapshotMutation.isPending}
                className="text-[10px] px-2 py-0.5 rounded transition-colors disabled:opacity-50"
                style={{ backgroundColor: 'var(--bg-hover)', color: 'var(--text-secondary)' }}
              >
                {createSnapshotMutation.isPending ? 'Creating...' : '+ Create Snapshot'}
              </button>
            </div>
            {snapshots.length === 0 ? (
              <div className="text-[10px] py-2 text-center" style={{ color: 'var(--text-muted)' }}>
                No snapshots yet
              </div>
            ) : (
              <div className="flex flex-col gap-1">
                {snapshots.map((snap) => (
                  <div
                    key={snap.id}
                    className="flex items-center gap-2 px-2 py-1.5 rounded text-[10px]"
                    style={{ backgroundColor: 'var(--bg-secondary)' }}
                  >
                    <span className="flex-1 font-mono truncate" style={{ color: 'var(--text-primary)' }}>
                      {snap.gitHead ? snap.gitHead.slice(0, 7) : 'no-ref'}
                    </span>
                    <span style={{ color: 'var(--text-muted)' }}>
                      {Object.keys(snap.envVars).length} vars
                    </span>
                    <span style={{ color: 'var(--text-muted)' }}>
                      {new Date(snap.createdAt).toLocaleString()}
                    </span>
                    {showRestore === snap.id ? (
                      <div className="flex gap-1">
                        <button
                          onClick={() => restoreSnapshotMutation.mutate({ snapshotId: snap.id })}
                          className="text-[10px] px-1.5 py-0.5 rounded text-white bg-red-600"
                        >
                          Confirm
                        </button>
                        <button
                          onClick={() => setShowRestore(null)}
                          className="text-[10px] px-1.5 py-0.5"
                          style={{ color: 'var(--text-muted)' }}
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <button
                        onClick={() => setShowRestore(snap.id)}
                        className="text-[10px] px-1.5 py-0.5 rounded transition-colors"
                        style={{ backgroundColor: 'var(--bg-hover)', color: 'var(--text-secondary)' }}
                      >
                        Restore
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function RepoSubSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-3">
      <h3
        className="text-xs font-semibold uppercase tracking-wider border-b pb-1.5"
        style={{ color: 'var(--text-secondary)', borderColor: 'var(--border)' }}
      >
        {title}
      </h3>
      {children}
    </div>
  );
}

function RepoField({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs" style={{ color: 'var(--text-secondary)' }}>
        {label}
        {hint && <span className="ml-1" style={{ color: 'var(--text-muted)' }}>— {hint}</span>}
      </label>
      {children}
    </div>
  );
}

/* ─── Section: 외관 ─── */

function AppearanceSection() {
  const { theme, fontSize, setTheme, setFontSize } = useTheme();
  const { terminalFontSize, setTerminalFontSize, accentColor, setAccentColor, appThemeName, setAppThemeName } = useSettingsStore();

  // M8-05: 내장 테마 목록
  const APP_THEMES: { value: string; label: string; accent: string; bg: string }[] = [
    { value: 'default', label: 'Superset (기본)', accent: '#e07850', bg: '#151110' },
    { value: 'catppuccin', label: 'Catppuccin Mocha', accent: '#cba6f7', bg: '#1e1e2e' },
    { value: 'nord', label: 'Nord', accent: '#88c0d0', bg: '#2e3440' },
    { value: 'gruvbox', label: 'Gruvbox Dark', accent: '#fe8019', bg: '#282828' },
    { value: 'one-dark-pro', label: 'One Dark Pro', accent: '#61afef', bg: '#282c34' },
  ];

  // M8-05: hover 시 즉시 미리보기
  const [previewTheme, setPreviewTheme] = useState<string | null>(null);

  const handleThemeHover = (themeName: string) => {
    setPreviewTheme(themeName);
    const html = document.documentElement;
    if (themeName === 'default') {
      html.removeAttribute('data-theme');
    } else {
      html.setAttribute('data-theme', themeName);
    }
  };

  const handleThemeLeave = () => {
    setPreviewTheme(null);
    // 원래 테마로 복원
    const html = document.documentElement;
    if (appThemeName === 'default') {
      html.removeAttribute('data-theme');
    } else {
      html.setAttribute('data-theme', appThemeName);
    }
  };

  const handleThemeSelect = (themeName: string) => {
    setAppThemeName(themeName as typeof appThemeName);
    setPreviewTheme(null);
  };

  return (
    <div className="flex flex-col gap-8 max-w-lg">
      <SectionHeader title="외관" desc="테마와 글꼴 크기를 설정합니다." />

      <Field label="테마">
        <div className="flex flex-col gap-2">
          {(
            [
              { value: 'dark', label: 'Dracula 다크', desc: '어두운 배경, 보라/시안 포인트' },
              { value: 'light', label: 'Notion 라이트', desc: '오프화이트 배경, 따뜻한 톤' },
            ] as const
          ).map(({ value, label, desc }) => (
            <label
              key={value}
              className="flex items-center gap-3 p-3 rounded-lg cursor-pointer transition-colors"
              style={{
                backgroundColor: theme === value ? 'var(--bg-active)' : 'var(--bg-secondary)',
                border: `1px solid ${theme === value ? 'var(--accent)' : 'var(--border)'}`,
              }}
            >
              <input
                type="radio"
                name="theme"
                value={value}
                checked={theme === value}
                onChange={() => setTheme(value)}
                className="sr-only"
              />
              <span
                className="w-4 h-4 rounded-full border-2 flex-shrink-0 flex items-center justify-center"
                style={{
                  borderColor: theme === value ? 'var(--accent)' : 'var(--border)',
                  backgroundColor: theme === value ? 'var(--accent)' : 'transparent',
                }}
              >
                {theme === value && <span className="w-1.5 h-1.5 rounded-full bg-white" />}
              </span>
              <div className="flex flex-col">
                <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                  {label}
                </span>
                <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>
                  {desc}
                </span>
              </div>
            </label>
          ))}
        </div>
      </Field>

      {/* M8-05: 내장 테마 */}
      <Field label="컬러 테마" hint={previewTheme ? `미리보기: ${previewTheme}` : undefined}>
        <div className="flex flex-wrap gap-2">
          {APP_THEMES.map((t) => (
            <button
              key={t.value}
              onClick={() => handleThemeSelect(t.value)}
              onMouseEnter={() => handleThemeHover(t.value)}
              onMouseLeave={handleThemeLeave}
              className="flex items-center gap-2 px-3 py-2 rounded-lg transition-all text-xs"
              style={{
                backgroundColor: appThemeName === t.value ? 'var(--bg-active)' : 'var(--bg-secondary)',
                border: `2px solid ${appThemeName === t.value ? t.accent : 'var(--border)'}`,
              }}
            >
              <span
                className="w-4 h-4 rounded-full flex-shrink-0"
                style={{ backgroundColor: t.accent }}
              />
              <span
                className="w-4 h-4 rounded flex-shrink-0"
                style={{ backgroundColor: t.bg }}
              />
              <span style={{ color: 'var(--text-primary)' }}>{t.label}</span>
            </button>
          ))}
        </div>
      </Field>

      {/* M8-05: 액센트 컬러 */}
      <Field label="액센트 컬러" hint={accentColor}>
        <div className="flex items-center gap-3">
          <input
            type="color"
            value={accentColor}
            onChange={(e) => setAccentColor(e.target.value)}
            className="w-10 h-10 rounded-lg cursor-pointer border-0 p-0"
            style={{ backgroundColor: 'transparent' }}
          />
          <input
            type="text"
            value={accentColor}
            onChange={(e) => {
              if (/^#[0-9a-fA-F]{0,6}$/.test(e.target.value)) {
                setAccentColor(e.target.value);
              }
            }}
            className="px-2 py-1.5 text-xs font-mono rounded w-24 outline-none"
            style={{
              backgroundColor: 'var(--bg-primary)',
              color: 'var(--text-primary)',
              border: '1px solid var(--border)',
            }}
            maxLength={7}
          />
          <div className="flex gap-1.5">
            {['#e07850', '#7c3aed', '#22c55e', '#3b82f6', '#f59e0b', '#ec4899'].map((c) => (
              <button
                key={c}
                onClick={() => setAccentColor(c)}
                className="w-6 h-6 rounded-full transition-transform hover:scale-110"
                style={{
                  backgroundColor: c,
                  border: accentColor === c ? '2px solid var(--text-primary)' : '2px solid transparent',
                }}
                aria-label={`액센트 컬러 ${c}`}
              />
            ))}
          </div>
        </div>
      </Field>

      <Field label="UI 폰트 크기">
        <div
          className="flex rounded-lg overflow-hidden w-48"
          style={{ border: '1px solid var(--border)' }}
        >
          {(
            [
              { value: 'small', label: '소', size: '12px' },
              { value: 'medium', label: '중', size: '14px' },
              { value: 'large', label: '대', size: '16px' },
            ] as const
          ).map(({ value, label, size }, i) => (
            <button
              key={value}
              onClick={() => setFontSize(value)}
              className="flex-1 py-2 text-sm flex flex-col items-center gap-0.5 transition-colors"
              style={{
                backgroundColor: fontSize === value ? 'var(--accent)' : 'var(--bg-secondary)',
                color: fontSize === value ? '#fff' : 'var(--text-secondary)',
                borderRight: i < 2 ? '1px solid var(--border)' : undefined,
                fontWeight: fontSize === value ? 700 : 400,
              }}
            >
              <span style={{ fontSize: size }}>{label}</span>
              <span className="text-xs opacity-70">{size}</span>
            </button>
          ))}
        </div>
      </Field>

      <Field label="터미널 폰트 크기" hint={`현재 ${terminalFontSize}px`}>
        <div className="flex items-center gap-3">
          <input
            type="range"
            min={10}
            max={20}
            value={terminalFontSize}
            onChange={(e) => setTerminalFontSize(Number(e.target.value))}
            className="w-48"
            style={{ accentColor: 'var(--accent)' }}
          />
          <span className="text-sm tabular-nums" style={{ color: 'var(--text-secondary)' }}>
            {terminalFontSize}px
          </span>
        </div>
      </Field>

      {/* M10-03: Theme Editor */}
      <div className="border-t pt-6" style={{ borderColor: 'var(--border)' }}>
        <ThemeEditorSection />
      </div>
    </div>
  );
}

/* ─── Section: 알림 ─── */

function NotificationsSection() {
  const { soundEnabled, telemetryEnabled, setSoundEnabled, setTelemetryEnabled } = useSettingsStore();

  return (
    <div className="flex flex-col gap-8 max-w-lg">
      <SectionHeader title="알림" desc="알림음 및 데이터 수집 설정을 관리합니다." />

      <div className="flex flex-col gap-3">
        <ToggleRow
          label="알림음"
          desc="세션 완료 시 성공음, 오류 시 경고음을 재생합니다."
          checked={soundEnabled}
          onChange={setSoundEnabled}
        />
        <ToggleRow
          label="사용 데이터 수집"
          desc="익명 통계만 수집합니다. PII(개인식별정보)는 수집하지 않습니다. (옵트인)"
          checked={telemetryEnabled}
          onChange={setTelemetryEnabled}
        />
      </div>
    </div>
  );
}

/* ─── Section: System (M7-02 리소스 임계값 + M7-03 GC) ─── */

function SystemSection() {
  const {
    cpuAlertThreshold,
    setCpuAlertThreshold,
    memAlertThresholdMb,
    setMemAlertThresholdMb,
    sessionGcDays,
    setSessionGcDays,
  } = useSettingsStore();

  const [gcDryRunResult, setGcDryRunResult] = useState<{ count: number; ids: string[] } | null>(null);
  const [showGcConfirm, setShowGcConfirm] = useState(false);

  const gcDryRunMutation = trpc.session.gc.useMutation({
    onSuccess: (result: unknown) => {
      const r = result as { archivedCount: number; archivedIds: string[] };
      setGcDryRunResult({ count: r.archivedCount, ids: r.archivedIds });
      setShowGcConfirm(true);
    },
  });

  const gcRunMutation = trpc.session.gc.useMutation({
    onSuccess: (result: unknown) => {
      const r = result as { archivedCount: number };
      setShowGcConfirm(false);
      setGcDryRunResult(null);
      if (r.archivedCount > 0) {
        toast.success('세션 정리 완료', `${r.archivedCount}개 세션 아카이브됨`);
      } else {
        toast.info('정리할 세션 없음', '모든 세션이 최신 상태입니다');
      }
    },
  });

  return (
    <div className="flex flex-col gap-8 max-w-lg">
      <SectionHeader title="System" desc="리소스 모니터링 임계값 및 세션 자동 정리를 설정합니다." />

      {/* M7-02: CPU 임계값 */}
      <Field label="CPU 경고 임계값" hint={`${cpuAlertThreshold}%`}>
        <input
          type="range"
          min={50}
          max={100}
          step={5}
          value={cpuAlertThreshold}
          onChange={(e) => setCpuAlertThreshold(Number(e.target.value))}
          className="w-full accent-[var(--accent)]"
        />
        <div className="flex justify-between text-[10px]" style={{ color: 'var(--text-muted)' }}>
          <span>50%</span>
          <span>100%</span>
        </div>
      </Field>

      {/* M7-02: 메모리 임계값 */}
      <Field label="메모리 경고 임계값" hint={`${memAlertThresholdMb}MB`}>
        <input
          type="range"
          min={512}
          max={8192}
          step={256}
          value={memAlertThresholdMb}
          onChange={(e) => setMemAlertThresholdMb(Number(e.target.value))}
          className="w-full accent-[var(--accent)]"
        />
        <div className="flex justify-between text-[10px]" style={{ color: 'var(--text-muted)' }}>
          <span>512MB</span>
          <span>8192MB</span>
        </div>
      </Field>

      {/* M7-03: 세션 자동 정리 */}
      <Field label="자동 정리 주기" hint={`${sessionGcDays}일`}>
        <input
          type="range"
          min={7}
          max={90}
          step={1}
          value={sessionGcDays}
          onChange={(e) => setSessionGcDays(Number(e.target.value))}
          className="w-full accent-[var(--accent)]"
        />
        <div className="flex justify-between text-[10px]" style={{ color: 'var(--text-muted)' }}>
          <span>7일</span>
          <span>90일</span>
        </div>
      </Field>

      <div className="flex flex-col gap-2">
        <button
          onClick={() => gcDryRunMutation.mutate({ dryRun: true })}
          disabled={gcDryRunMutation.isPending}
          className="self-start px-3 py-1.5 text-xs text-white rounded transition-colors"
          style={{ backgroundColor: 'var(--accent)' }}
        >
          {gcDryRunMutation.isPending ? '확인 중...' : '지금 정리'}
        </button>

        {showGcConfirm && gcDryRunResult && (
          <div
            className="flex flex-col gap-2 p-3 rounded-lg"
            style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border)' }}
          >
            <span className="text-xs font-medium" style={{ color: 'var(--text-primary)' }}>
              {gcDryRunResult.count}개 세션이 정리 대상입니다.
            </span>
            {gcDryRunResult.ids.length > 0 && (
              <div className="max-h-24 overflow-y-auto text-[10px] font-mono" style={{ color: 'var(--text-muted)' }}>
                {gcDryRunResult.ids.slice(0, 10).map((id) => (
                  <div key={id}>{id}</div>
                ))}
                {gcDryRunResult.ids.length > 10 && <div>...and {gcDryRunResult.ids.length - 10} more</div>}
              </div>
            )}
            <div className="flex gap-2">
              <button
                onClick={() => gcRunMutation.mutate({ dryRun: false })}
                disabled={gcRunMutation.isPending}
                className="px-3 py-1 text-xs text-white rounded"
                style={{ backgroundColor: '#f14c4c' }}
              >
                {gcRunMutation.isPending ? '정리 중...' : '확인 (아카이브)'}
              </button>
              <button
                onClick={() => { setShowGcConfirm(false); setGcDryRunResult(null); }}
                className="px-3 py-1 text-xs rounded"
                style={{ backgroundColor: 'var(--bg-hover)', color: 'var(--text-secondary)' }}
              >
                취소
              </button>
            </div>
          </div>
        )}
      </div>

      {/* M9-04: 세션 아카이브 설정 */}
      <ToggleRow
        label="세션 아카이브"
        desc="세션 종료 시 출력을 자동으로 ~/.maestro/sessions/에 저장합니다."
        checked={useSettingsStore.getState().archiveEnabled}
        onChange={(v) => useSettingsStore.getState().setArchiveEnabled(v)}
      />

      {/* M9-03: 프로파일 가져오기/내보내기 */}
      <ProfileSection />
    </div>
  );
}

/* ─── Section: Agents ─── */

interface AgentFormState {
  name: string;
  command: string;
  args: string;
  env: string;
  scriptPath?: string;
  scriptContent?: string;
}

const EMPTY_FORM: AgentFormState = { name: '', command: '', args: '', env: '', scriptPath: '', scriptContent: '' };

function agentToForm(agent: Agent): AgentFormState {
  return {
    name: agent.name,
    command: agent.command,
    args: agent.args.join(' '),
    env: Object.entries(agent.env)
      .map(([k, v]) => `${k}=${v}`)
      .join('\n'),
    scriptPath: agent.scriptPath ?? '',
    scriptContent: agent.scriptContent ?? '',
  };
}

function parseArgs(raw: string): string[] {
  return raw.trim().split(/\s+/).filter(Boolean);
}

function parseEnv(raw: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of raw.split('\n')) {
    const eq = line.indexOf('=');
    if (eq > 0) result[line.slice(0, eq).trim()] = line.slice(eq + 1).trim();
  }
  return result;
}

const fieldInputClass = 'text-xs rounded px-3 py-1.5 outline-none border focus:border-blue-600 disabled:opacity-50';
const fieldInputStyle = {
  backgroundColor: 'var(--bg-secondary)',
  color: 'var(--text-primary)',
  borderColor: 'var(--border)',
};

function AgentsSection() {
  const { agents, addAgent, updateAgent: updateAgentStore, removeAgent } = useAgentStore();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [form, setForm] = useState<AgentFormState>(EMPTY_FORM);
  const [isNew, setIsNew] = useState(false);
  const [error, setError] = useState('');

  const selectedAgent = agents.find((a) => a.id === selectedId);

  const createMutation = trpc.agent.create.useMutation({
    onSuccess: (agent) => {
      addAgent(agent as Agent);
      setSelectedId((agent as Agent).id);
      setIsNew(false);
    },
    onError: (e) => setError(e.message),
  });

  const updateMutation = trpc.agent.update.useMutation({
    onSuccess: (agent) => updateAgentStore(agent as Agent),
    onError: (e) => setError(e.message),
  });

  const deleteMutation = trpc.agent.delete.useMutation({
    onSuccess: () => {
      if (selectedId) removeAgent(selectedId);
      setSelectedId(null);
      setForm(EMPTY_FORM);
      setIsNew(false);
    },
    onError: (e) => setError(e.message),
  });

  const handleSelect = (agent: Agent) => {
    setSelectedId(agent.id);
    setForm(agentToForm(agent));
    setIsNew(false);
    setError('');
  };

  const handleNew = () => {
    setSelectedId(null);
    setForm(EMPTY_FORM);
    setIsNew(true);
    setError('');
  };

  const handleSave = () => {
    if (!form.name.trim() || !form.command.trim()) {
      setError('Name and command are required');
      return;
    }
    setError('');
    const args = parseArgs(form.args);
    const env = parseEnv(form.env);
    const scriptPath = form.scriptPath?.trim() || null;
    const scriptContent = form.scriptContent?.trim() || null;
    if (isNew) {
      createMutation.mutate({ name: form.name, command: form.command, args, env, scriptPath, scriptContent });
    } else if (selectedId) {
      updateMutation.mutate({ id: selectedId, name: form.name, command: form.command, args, env, scriptPath, scriptContent });
    }
  };

  const isSaving = createMutation.isPending || updateMutation.isPending || deleteMutation.isPending;

  return (
    <div className="flex flex-col gap-6 h-full">
      <SectionHeader title="Agents" desc="에이전트 명령과 환경 변수를 관리합니다." />

      <div
        className="flex rounded-lg overflow-hidden flex-1 min-h-0"
        style={{ border: '1px solid var(--border)', minHeight: 360 }}
      >
        {/* Left: agent list */}
        <div className="w-44 flex flex-col border-r flex-shrink-0" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--bg-secondary)' }}>
          <div
            className="flex items-center justify-between px-3 py-2 border-b"
            style={{ borderColor: 'var(--border)' }}
          >
            <span className="text-xs font-semibold" style={{ color: 'var(--text-secondary)' }}>
              Agents
            </span>
            <button
              onClick={handleNew}
              className="text-base leading-none"
              style={{ color: 'var(--text-secondary)' }}
              onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--text-primary)')}
              onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--text-secondary)')}
              title="New agent"
            >
              +
            </button>
          </div>
          <div className="flex-1 overflow-y-auto">
            {agents.map((agent) => (
              <button
                key={agent.id}
                onClick={() => handleSelect(agent)}
                className="w-full flex items-center gap-2 px-3 py-2 text-left text-xs border-b transition-colors"
                style={{
                  borderColor: 'var(--border)',
                  backgroundColor: selectedId === agent.id ? 'var(--bg-hover)' : 'transparent',
                  color: selectedId === agent.id ? 'var(--text-primary)' : 'var(--text-secondary)',
                }}
                onMouseEnter={(e) => { if (selectedId !== agent.id) e.currentTarget.style.backgroundColor = 'var(--bg-hover)'; }}
                onMouseLeave={(e) => { if (selectedId !== agent.id) e.currentTarget.style.backgroundColor = 'transparent'; }}
              >
                <AgentIcon agent={agent} size="sm" />
                <div className="flex flex-col min-w-0">
                  <span className="truncate">{agent.name}</span>
                  {agent.isBuiltIn && (
                    <span className="text-[9px]" style={{ color: 'var(--text-muted)' }}>built-in</span>
                  )}
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Right: form */}
        <div className="flex-1 flex flex-col min-w-0">
          {(isNew || selectedId) ? (
            <div className="flex-1 overflow-y-auto px-4 py-3 flex flex-col gap-3">
              <div className="flex flex-col gap-1">
                <label className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Name</label>
                <input
                  value={form.name}
                  onChange={(e) => setForm({ ...form, name: e.target.value })}
                  disabled={selectedAgent?.isBuiltIn}
                  className={fieldInputClass}
                  style={fieldInputStyle}
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>Command</label>
                <input
                  value={form.command}
                  onChange={(e) => setForm({ ...form, command: e.target.value })}
                  disabled={selectedAgent?.isBuiltIn}
                  placeholder="e.g. claude"
                  className={`${fieldInputClass} font-mono`}
                  style={fieldInputStyle}
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
                  Args <span className="normal-case" style={{ color: 'var(--text-muted)' }}>(space-separated)</span>
                </label>
                <input
                  value={form.args}
                  onChange={(e) => setForm({ ...form, args: e.target.value })}
                  disabled={selectedAgent?.isBuiltIn}
                  placeholder="e.g. --dangerously-skip-permissions"
                  className={`${fieldInputClass} font-mono`}
                  style={fieldInputStyle}
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
                  Env <span className="normal-case" style={{ color: 'var(--text-muted)' }}>(KEY=value per line)</span>
                </label>
                <textarea
                  value={form.env}
                  onChange={(e) => setForm({ ...form, env: e.target.value })}
                  disabled={selectedAgent?.isBuiltIn}
                  placeholder="OPENAI_API_KEY=sk-..."
                  rows={4}
                  className={`${fieldInputClass} font-mono resize-none`}
                  style={fieldInputStyle}
                />
              </div>
              {/* M10-02: Script Agent 필드 */}
              <div className="flex flex-col gap-1">
                <label className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
                  Script Path <span className="normal-case">(optional - for Script-type agents)</span>
                </label>
                <input
                  value={(form as AgentFormState & { scriptPath?: string }).scriptPath ?? ''}
                  onChange={(e) => setForm({ ...form, scriptPath: e.target.value } as AgentFormState)}
                  disabled={selectedAgent?.isBuiltIn}
                  placeholder="/path/to/script.sh or /path/to/script.py"
                  className={`${fieldInputClass} font-mono`}
                  style={fieldInputStyle}
                />
              </div>
              <div className="flex flex-col gap-1">
                <label className="text-[10px] uppercase tracking-wider" style={{ color: 'var(--text-muted)' }}>
                  Script Content <span className="normal-case">(inline script, alternative to path)</span>
                </label>
                <textarea
                  value={(form as AgentFormState & { scriptContent?: string }).scriptContent ?? ''}
                  onChange={(e) => setForm({ ...form, scriptContent: e.target.value } as AgentFormState)}
                  disabled={selectedAgent?.isBuiltIn}
                  placeholder="#!/bin/bash&#10;echo 'Hello from custom script'"
                  rows={4}
                  className={`${fieldInputClass} font-mono resize-none`}
                  style={fieldInputStyle}
                />
              </div>
              <div
                className="text-[10px] font-mono px-3 py-2 rounded"
                style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--text-muted)' }}
              >
                $ {form.command || '<command>'} {form.args}
              </div>
              {error && (
                <div className="text-xs text-red-400 bg-red-900/30 px-3 py-2 rounded">{error}</div>
              )}
            </div>
          ) : (
            <div className="flex-1 flex items-center justify-center text-xs" style={{ color: 'var(--text-muted)' }}>
              에이전트를 선택하거나 새로 만드세요
            </div>
          )}

          {/* Footer actions */}
          <div
            className="border-t px-4 py-2 flex items-center justify-between flex-shrink-0"
            style={{ borderColor: 'var(--border)' }}
          >
            <div>
              {selectedId && !selectedAgent?.isBuiltIn && (
                <button
                  onClick={() => deleteMutation.mutate({ id: selectedId })}
                  disabled={isSaving}
                  className="text-xs text-red-500 hover:text-red-400 disabled:opacity-50"
                >
                  Delete
                </button>
              )}
            </div>
            {(isNew || (selectedId && !selectedAgent?.isBuiltIn)) && (
              <button
                onClick={handleSave}
                disabled={isSaving}
                className="px-4 py-1.5 text-xs text-white rounded transition-colors disabled:opacity-50"
                style={{ backgroundColor: 'var(--accent)' }}
              >
                {isSaving ? 'Saving...' : 'Save'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─── Section: MCP Servers ─── */

const STATUS_DOT: Record<string, string> = {
  connected: '#4ade80',
  offline: '#6b7280',
  error: '#f87171',
};

const STATUS_LABEL: Record<string, string> = {
  connected: 'Connected',
  offline: 'Offline',
  error: 'Error',
};

function McpSection() {
  const { servers, addServer, removeServer, updateServer } = useMcpStore();
  const [name, setName] = useState('');
  const [url, setUrl] = useState('');
  const [addError, setAddError] = useState('');
  const [expandedError, setExpandedError] = useState<string | null>(null);

  const addMutation = trpc.mcp.add.useMutation({
    onSuccess: (server) => {
      addServer(server as McpServer);
      setName('');
      setUrl('');
      setAddError('');
    },
    onError: (e) => setAddError(e.message),
  });

  const deleteMutation = trpc.mcp.delete.useMutation({
    onSuccess: (_, vars) => removeServer(vars.id),
  });

  const toggleMutation = trpc.mcp.toggle.useMutation({
    onSuccess: (server) => updateServer(server as McpServer),
  });

  return (
    <div className="flex flex-col gap-6 max-w-xl">
      <SectionHeader title="MCP Servers" desc="Model Context Protocol 서버를 추가하고 관리합니다." />

      {/* Server list */}
      <div className="flex flex-col gap-2">
        {servers.length === 0 ? (
          <div
            className="text-xs text-center py-8 rounded-lg"
            style={{ color: 'var(--text-muted)', backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border)' }}
          >
            연결된 MCP 서버가 없습니다.
          </div>
        ) : (
          servers.map((server) => (
            <div
              key={server.id}
              className="rounded-lg p-3 flex flex-col gap-1.5"
              style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border)' }}
            >
              <div className="flex items-center gap-2">
                <span
                  className="w-2 h-2 rounded-full flex-shrink-0"
                  style={{
                    backgroundColor: STATUS_DOT[server.status] ?? '#6b7280',
                    boxShadow: server.status === 'connected' ? `0 0 6px ${STATUS_DOT.connected}` : undefined,
                  }}
                  title={STATUS_LABEL[server.status] ?? server.status}
                />
                <span className="text-xs font-medium flex-1 truncate" style={{ color: 'var(--text-primary)' }}>
                  {server.name}
                </span>
                <span
                  className="text-[10px] px-1.5 py-0.5 rounded"
                  style={{
                    backgroundColor:
                      server.status === 'connected' ? 'rgba(34,197,94,0.1)'
                      : server.status === 'error' ? 'rgba(239,68,68,0.1)'
                      : 'var(--bg-hover)',
                    color: STATUS_DOT[server.status] ?? 'var(--text-muted)',
                  }}
                >
                  {STATUS_LABEL[server.status] ?? server.status}
                </span>
                <button
                  onClick={() => toggleMutation.mutate({ id: server.id, enabled: !server.enabled })}
                  className="text-[10px] px-2 py-0.5 rounded transition-colors"
                  style={{
                    backgroundColor: server.enabled ? 'var(--accent)' : 'var(--bg-hover)',
                    color: server.enabled ? '#fff' : 'var(--text-muted)',
                  }}
                  title={server.enabled ? 'Disable' : 'Enable'}
                >
                  {server.enabled ? 'ON' : 'OFF'}
                </button>
                <button
                  onClick={() => deleteMutation.mutate({ id: server.id })}
                  className="w-6 h-6 flex items-center justify-center rounded transition-colors text-sm"
                  style={{ color: 'var(--text-muted)' }}
                  onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'rgba(239,68,68,0.15)'; e.currentTarget.style.color = '#f87171'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.color = 'var(--text-muted)'; }}
                  title="Remove server"
                >
                  ×
                </button>
              </div>
              <div className="text-[10px] font-mono truncate pl-4" style={{ color: 'var(--text-muted)' }}>
                {server.url}
              </div>
              {server.status === 'error' && server.errorMsg && (
                <div className="pl-4">
                  <button
                    onClick={() => setExpandedError(expandedError === server.id ? null : server.id)}
                    className="text-[10px] flex items-center gap-1"
                    style={{ color: '#f87171' }}
                  >
                    <span>{expandedError === server.id ? '▾' : '▸'}</span>
                    Error details
                  </button>
                  {expandedError === server.id && (
                    <div
                      className="mt-1 text-[10px] font-mono px-2 py-1 rounded"
                      style={{ backgroundColor: 'rgba(239,68,68,0.1)', color: '#f87171' }}
                    >
                      {server.errorMsg}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))
        )}
      </div>

      {/* Add server form */}
      <div
        className="flex flex-col gap-3 p-4 rounded-lg"
        style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border)' }}
      >
        <span className="text-xs font-medium" style={{ color: 'var(--text-secondary)' }}>서버 추가</span>
        <div className="flex gap-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Name"
            className="flex-1 text-xs rounded px-2 py-1.5 outline-none"
            style={{ backgroundColor: 'var(--bg-primary)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}
          />
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="URL (e.g. http://localhost:3000)"
            className="flex-[2] text-xs rounded px-2 py-1.5 outline-none font-mono"
            style={{ backgroundColor: 'var(--bg-primary)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}
            onKeyDown={(e) => { if (e.key === 'Enter') addMutation.mutate({ name: name.trim(), url: url.trim() }); }}
          />
          <button
            onClick={() => addMutation.mutate({ name: name.trim(), url: url.trim() })}
            disabled={addMutation.isPending || !name.trim() || !url.trim()}
            className="px-3 py-1.5 text-xs rounded transition-colors disabled:opacity-50"
            style={{ backgroundColor: 'var(--accent)', color: '#fff' }}
          >
            {addMutation.isPending ? '...' : 'Add'}
          </button>
        </div>
        {addError && (
          <div className="text-xs px-2 py-1 rounded" style={{ backgroundColor: 'rgba(239,68,68,0.1)', color: '#f87171' }}>
            {addError}
          </div>
        )}
      </div>
    </div>
  );
}

/* ─── Section: 단축키 ─── */

function ShortcutsSection() {
  return (
    <div className="flex flex-col gap-8 max-w-lg">
      <SectionHeader title="단축키" desc="앱 전역 단축키 목록입니다." />

      <div
        className="flex flex-col rounded-lg overflow-hidden"
        style={{ border: '1px solid var(--border)' }}
      >
        {SHORTCUTS.map(({ keys, desc }, i) => (
          <div
            key={keys}
            className="flex items-center justify-between px-4 py-3"
            style={{
              borderTop: i > 0 ? '1px solid var(--border)' : undefined,
              backgroundColor: i % 2 === 0 ? 'var(--bg-secondary)' : 'var(--bg-panel)',
            }}
          >
            <span className="text-sm" style={{ color: 'var(--text-primary)' }}>{desc}</span>
            <kbd
              className="text-xs px-2 py-0.5 rounded font-mono"
              style={{ backgroundColor: 'var(--bg-primary)', border: '1px solid var(--border)', color: 'var(--text-secondary)' }}
            >
              {keys}
            </kbd>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ─── Section: Terminal (F-M2-07) ─── */

function TerminalSettingsSection() {
  const { terminalTheme, terminalFont, terminalFontSize, setTerminalTheme, setTerminalFont, setTerminalFontSize, scrollbackLines, setScrollbackLines } = useSettingsStore();

  const themes: { value: string; label: string }[] = [
    { value: 'default', label: 'Warm Dark (기본)' },
    { value: 'dracula', label: 'Dracula' },
    { value: 'solarized-dark', label: 'Solarized Dark' },
    { value: 'one-dark', label: 'One Dark' },
    { value: 'nord', label: 'Nord' },
  ];

  const fonts: { value: string; label: string }[] = [
    { value: 'JetBrains Mono', label: 'JetBrains Mono' },
    { value: 'Fira Code', label: 'Fira Code' },
    { value: 'Cascadia Code', label: 'Cascadia Code' },
    { value: 'Courier New', label: 'Courier New' },
  ];

  return (
    <div className="flex flex-col gap-8 max-w-lg">
      <SectionHeader title="Terminal" desc="터미널 테마, 폰트, 크기를 설정합니다." />

      <Field label="색상 테마">
        <div className="flex flex-col gap-2">
          {themes.map(({ value, label }) => (
            <label
              key={value}
              className="flex items-center gap-3 p-3 rounded-lg cursor-pointer transition-colors"
              style={{
                backgroundColor: terminalTheme === value ? 'var(--bg-active)' : 'var(--bg-secondary)',
                border: `1px solid ${terminalTheme === value ? 'var(--accent)' : 'var(--border)'}`,
              }}
            >
              <input
                type="radio"
                name="terminal-theme"
                value={value}
                checked={terminalTheme === value}
                onChange={() => setTerminalTheme(value as typeof terminalTheme)}
                className="sr-only"
              />
              <span
                className="w-4 h-4 rounded-full border-2 flex-shrink-0 flex items-center justify-center"
                style={{
                  borderColor: terminalTheme === value ? 'var(--accent)' : 'var(--border)',
                  backgroundColor: terminalTheme === value ? 'var(--accent)' : 'transparent',
                }}
              >
                {terminalTheme === value && <span className="w-1.5 h-1.5 rounded-full bg-white" />}
              </span>
              <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                {label}
              </span>
            </label>
          ))}
        </div>
      </Field>

      <Field label="폰트 패밀리">
        <div className="flex flex-col gap-2">
          {fonts.map(({ value, label }) => (
            <label
              key={value}
              className="flex items-center gap-3 p-3 rounded-lg cursor-pointer transition-colors"
              style={{
                backgroundColor: terminalFont === value ? 'var(--bg-active)' : 'var(--bg-secondary)',
                border: `1px solid ${terminalFont === value ? 'var(--accent)' : 'var(--border)'}`,
              }}
            >
              <input
                type="radio"
                name="terminal-font"
                value={value}
                checked={terminalFont === value}
                onChange={() => setTerminalFont(value as typeof terminalFont)}
                className="sr-only"
              />
              <span
                className="w-4 h-4 rounded-full border-2 flex-shrink-0 flex items-center justify-center"
                style={{
                  borderColor: terminalFont === value ? 'var(--accent)' : 'var(--border)',
                  backgroundColor: terminalFont === value ? 'var(--accent)' : 'transparent',
                }}
              >
                {terminalFont === value && <span className="w-1.5 h-1.5 rounded-full bg-white" />}
              </span>
              <span className="text-sm" style={{ color: 'var(--text-primary)', fontFamily: `"${value}", monospace` }}>
                {label}
              </span>
            </label>
          ))}
        </div>
      </Field>

      <Field label="폰트 크기" hint={`${terminalFontSize}px`}>
        <input
          type="range"
          min={10}
          max={24}
          step={1}
          value={terminalFontSize}
          onChange={(e) => setTerminalFontSize(Number(e.target.value))}
          className="w-full accent-[var(--accent)]"
        />
      </Field>

      {/* M7-01: Scrollback Lines 슬라이더 */}
      <Field label="Scrollback Lines" hint={`${scrollbackLines.toLocaleString()} lines`}>
        <input
          type="range"
          min={1000}
          max={20000}
          step={1000}
          value={scrollbackLines}
          onChange={(e) => setScrollbackLines(Number(e.target.value))}
          className="w-full accent-[var(--accent)]"
        />
        <div className="flex justify-between text-[10px]" style={{ color: 'var(--text-muted)' }}>
          <span>1,000</span>
          <span>20,000</span>
        </div>
      </Field>
    </div>
  );
}

/* ─── Section: 정보 ─── */

function AboutSection() {
  const openLogsMutation = trpc.system.openLogsFolder.useMutation();
  const setOnboardingCompleted = useSettingsStore((s) => s.setOnboardingCompleted);

  const handleRestartOnboarding = () => {
    setOnboardingCompleted(false);
    window.location.reload();
  };

  return (
    <div className="flex flex-col gap-8 max-w-lg">
      <SectionHeader title="정보" desc="Maestro 앱 버전 및 빌드 정보입니다." />

      <div
        className="flex flex-col gap-3 p-4 rounded-lg"
        style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border)' }}
      >
        <InfoRow label="앱 이름" value="Maestro" />
        <InfoRow label="버전" value={(import.meta as any).env?.VITE_APP_VERSION ?? '—'} />
        <InfoRow label="플랫폼" value={navigator.platform} />
        <InfoRow label="Electron" value={navigator.userAgent.match(/Electron\/([\d.]+)/)?.[1] ?? '—'} />
      </div>

      <div className="flex gap-3">
        {/* M7-04: 로그 파일 열기 */}
        <button
          onClick={() => openLogsMutation.mutate()}
          disabled={openLogsMutation.isPending}
          className="px-4 py-2 text-xs text-white rounded transition-colors"
          style={{ backgroundColor: 'var(--accent)' }}
        >
          {openLogsMutation.isPending ? '열는 중...' : '로그 파일 열기'}
        </button>

        {/* M8-01: 온보딩 다시 시작 */}
        <button
          onClick={handleRestartOnboarding}
          className="px-4 py-2 text-xs rounded transition-colors"
          style={{
            backgroundColor: 'var(--bg-secondary)',
            color: 'var(--text-secondary)',
            border: '1px solid var(--border)',
          }}
          onMouseEnter={(e) => (e.currentTarget.style.borderColor = 'var(--accent)')}
          onMouseLeave={(e) => (e.currentTarget.style.borderColor = 'var(--border)')}
        >
          온보딩 다시 시작
        </button>
      </div>

      {/* M10-04: 텔레메트리 수집 항목 */}
      <TelemetryDetails />
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-sm" style={{ color: 'var(--text-secondary)' }}>{label}</span>
      <span className="text-sm font-mono" style={{ color: 'var(--text-primary)' }}>{value}</span>
    </div>
  );
}

/* ─── M4-04: Presets Section ─── */

function PresetsSection() {
  const { data: presets, refetch } = trpc.preset.list.useQuery();
  const agents = useAgentStore((s) => s.agents);
  const workspaces = useWorkspaceStore((s) => s.workspaces);

  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [agentId, setAgentId] = useState(agents[0]?.id ?? '');
  const [workspaceId, setWorkspaceId] = useState(workspaces[0]?.id ?? '');
  const [initialCommand, setInitialCommand] = useState('');

  const createMutation = trpc.preset.create.useMutation({
    onSuccess: () => { refetch(); resetForm(); },
  });
  const updateMutation = trpc.preset.update.useMutation({
    onSuccess: () => { refetch(); resetForm(); },
  });
  const deleteMutation = trpc.preset.delete.useMutation({
    onSuccess: () => { refetch(); },
  });

  const resetForm = () => {
    setShowForm(false);
    setEditId(null);
    setName('');
    setAgentId(agents[0]?.id ?? '');
    setWorkspaceId(workspaces[0]?.id ?? '');
    setInitialCommand('');
  };

  const handleEdit = (preset: AgentPreset) => {
    setEditId(preset.id);
    setName(preset.name);
    setAgentId(preset.agentId);
    setWorkspaceId(preset.workspaceId);
    setInitialCommand(preset.initialCommand);
    setShowForm(true);
  };

  const handleSave = () => {
    if (!name.trim()) return;
    if (editId) {
      updateMutation.mutate({ id: editId, name: name.trim(), agentId, workspaceId, initialCommand });
    } else {
      createMutation.mutate({ name: name.trim(), agentId, workspaceId, initialCommand });
    }
  };

  const presetList = (presets as AgentPreset[] | undefined) ?? [];

  const inputStyle = {
    backgroundColor: 'var(--bg-primary)',
    color: 'var(--text-primary)',
    borderColor: 'var(--border)',
  };

  return (
    <div className="flex flex-col gap-6 max-w-2xl">
      <SectionHeader title="Agent Presets" desc="Quick Launch 프리셋을 관리합니다. 커맨드 팔레트(Cmd+K)에서 바로 실행 가능합니다." />

      <button
        onClick={() => { resetForm(); setShowForm(true); }}
        className="self-start px-3 py-1.5 text-xs text-white rounded"
        style={{ backgroundColor: 'var(--accent)' }}
      >
        + New Preset
      </button>

      {showForm && (
        <div className="flex flex-col gap-3 p-4 rounded-lg border" style={{ borderColor: 'var(--border)', backgroundColor: 'var(--bg-primary)' }}>
          <Field label="Name">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="text-sm rounded px-3 py-2 outline-none border"
              style={inputStyle}
              placeholder="e.g. Claude Auth Task"
            />
          </Field>
          <Field label="Agent">
            <select value={agentId} onChange={(e) => setAgentId(e.target.value)} className="text-sm rounded px-3 py-2 outline-none border" style={inputStyle}>
              {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </Field>
          <Field label="Workspace">
            <select value={workspaceId} onChange={(e) => setWorkspaceId(e.target.value)} className="text-sm rounded px-3 py-2 outline-none border" style={inputStyle}>
              {workspaces.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          </Field>
          <Field label="Initial Command" hint="세션 시작 후 자동으로 전송될 텍스트">
            <input
              value={initialCommand}
              onChange={(e) => setInitialCommand(e.target.value)}
              className="text-sm rounded px-3 py-2 outline-none border font-mono"
              style={inputStyle}
              placeholder="e.g. fix the auth bug in login.ts"
            />
          </Field>
          <div className="flex gap-2">
            <button onClick={handleSave} className="px-3 py-1.5 text-xs text-white rounded" style={{ backgroundColor: 'var(--accent)' }}>
              {editId ? 'Update' : 'Create'}
            </button>
            <button onClick={resetForm} className="px-3 py-1.5 text-xs rounded" style={{ color: 'var(--text-secondary)' }}>
              Cancel
            </button>
          </div>
        </div>
      )}

      <div className="flex flex-col gap-2">
        {presetList.map((preset) => {
          const agent = agents.find((a) => a.id === preset.agentId);
          const ws = workspaces.find((w) => w.id === preset.workspaceId);
          return (
            <div
              key={preset.id}
              className="flex items-center justify-between p-3 rounded-lg border"
              style={{ borderColor: 'var(--border)', backgroundColor: 'var(--bg-primary)' }}
            >
              <div className="flex flex-col gap-0.5">
                <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{preset.name}</span>
                <div className="flex gap-3 text-xs" style={{ color: 'var(--text-muted)' }}>
                  <span>{agent?.name ?? 'Unknown'}</span>
                  <span>{ws?.name ?? 'Unknown'}</span>
                  {preset.initialCommand && <span className="font-mono truncate max-w-[200px]">$ {preset.initialCommand}</span>}
                </div>
              </div>
              <div className="flex gap-1">
                <button
                  onClick={() => handleEdit(preset)}
                  className="text-xs px-2 py-1 rounded"
                  style={{ color: 'var(--text-secondary)' }}
                  onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--bg-hover)')}
                  onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                >
                  Edit
                </button>
                <button
                  onClick={() => deleteMutation.mutate({ id: preset.id })}
                  className="text-xs px-2 py-1 rounded"
                  style={{ color: '#f14c4c' }}
                  onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'rgba(241,76,76,0.1)')}
                  onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                >
                  Delete
                </button>
              </div>
            </div>
          );
        })}
        {presetList.length === 0 && (
          <div className="text-sm py-8 text-center" style={{ color: 'var(--text-muted)' }}>
            프리셋이 없습니다. 위 버튼으로 추가하세요.
          </div>
        )}
      </div>
    </div>
  );
}

/* ─── Shared UI ─── */

function SectionHeader({ title, desc }: { title: string; desc: string }) {
  return (
    <div className="flex flex-col gap-1 border-b pb-4" style={{ borderColor: 'var(--border)' }}>
      <h2 className="text-base font-semibold" style={{ color: 'var(--text-primary)' }}>{title}</h2>
      <p className="text-sm" style={{ color: 'var(--text-secondary)' }}>{desc}</p>
    </div>
  );
}

/* ─── M6-02: Webhooks Section ─── */

const WEBHOOK_EVENTS = ['session.completed', 'session.error', 'agent.task_done', 'session.started'] as const;

function WebhooksSection() {
  const webhookQuery = trpc.webhook.list.useQuery();
  const createMutation = trpc.webhook.create.useMutation({ onSuccess: () => webhookQuery.refetch() });
  const deleteMutation = trpc.webhook.delete.useMutation({ onSuccess: () => webhookQuery.refetch() });
  const testMutation = trpc.webhook.test.useMutation();
  const [showAdd, setShowAdd] = useState(false);
  const [newUrl, setNewUrl] = useState('');
  const [selectedEvents, setSelectedEvents] = useState<string[]>(['session.completed']);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const webhooks = webhookQuery.data ?? [];

  const handleCreate = () => {
    if (!newUrl.trim()) return;
    createMutation.mutate({ url: newUrl.trim(), events: selectedEvents as typeof WEBHOOK_EVENTS[number][] });
    setNewUrl('');
    setSelectedEvents(['session.completed']);
    setShowAdd(false);
  };

  const toggleEvent = (event: string) => {
    setSelectedEvents((prev) =>
      prev.includes(event) ? prev.filter((e) => e !== event) : [...prev, event]
    );
  };

  return (
    <div className="flex flex-col gap-6 max-w-2xl">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>Webhooks</h2>
        <button
          onClick={() => setShowAdd(!showAdd)}
          className="text-xs px-3 py-1.5 rounded transition-colors"
          style={{ backgroundColor: 'var(--accent)', color: '#fff' }}
        >
          + Add Webhook
        </button>
      </div>

      {showAdd && (
        <div className="flex flex-col gap-3 p-4 rounded-lg" style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border)' }}>
          <input
            value={newUrl}
            onChange={(e) => setNewUrl(e.target.value)}
            placeholder="https://example.com/webhook"
            className="text-sm rounded px-3 py-2 outline-none border font-mono"
            style={{ backgroundColor: 'var(--bg-primary)', color: 'var(--text-primary)', borderColor: 'var(--border)' }}
          />
          <div className="flex flex-wrap gap-2">
            {WEBHOOK_EVENTS.map((event) => (
              <label key={event} className="flex items-center gap-1.5 text-xs cursor-pointer" style={{ color: 'var(--text-secondary)' }}>
                <input
                  type="checkbox"
                  checked={selectedEvents.includes(event)}
                  onChange={() => toggleEvent(event)}
                />
                {event}
              </label>
            ))}
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleCreate}
              disabled={createMutation.isPending || !newUrl.trim()}
              className="text-xs px-3 py-1.5 rounded transition-colors disabled:opacity-50"
              style={{ backgroundColor: 'var(--accent)', color: '#fff' }}
            >
              Create
            </button>
            <button
              onClick={() => setShowAdd(false)}
              className="text-xs px-3 py-1.5 rounded"
              style={{ color: 'var(--text-muted)' }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {webhooks.length === 0 ? (
        <div className="text-sm py-8 text-center" style={{ color: 'var(--text-muted)' }}>
          No webhooks configured
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {webhooks.map((wh) => (
            <div key={wh.id} className="rounded-lg" style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border)' }}>
              <div className="flex items-center gap-3 px-4 py-3">
                <div
                  className="w-2 h-2 rounded-full flex-shrink-0"
                  style={{ backgroundColor: wh.enabled ? '#22c55e' : '#6b7280' }}
                />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-mono truncate" style={{ color: 'var(--text-primary)' }}>{wh.url}</div>
                  <div className="flex gap-1.5 mt-1">
                    {(wh.events as string[]).map((e) => (
                      <span key={e} className="text-[10px] px-1.5 py-0.5 rounded" style={{ backgroundColor: 'var(--bg-hover)', color: 'var(--text-muted)' }}>
                        {e}
                      </span>
                    ))}
                  </div>
                </div>
                <button
                  onClick={() => testMutation.mutate({ id: wh.id })}
                  disabled={testMutation.isPending}
                  className="text-xs px-2 py-1 rounded transition-colors"
                  style={{ backgroundColor: 'var(--bg-hover)', color: 'var(--text-secondary)' }}
                >
                  Test
                </button>
                <button
                  onClick={() => setExpandedId(expandedId === wh.id ? null : wh.id)}
                  className="text-xs px-2 py-1 rounded transition-colors"
                  style={{ color: 'var(--text-muted)' }}
                >
                  Logs
                </button>
                <button
                  onClick={() => deleteMutation.mutate({ id: wh.id })}
                  className="text-xs px-1 transition-colors hover:text-red-400"
                  style={{ color: 'var(--text-muted)' }}
                >
                  x
                </button>
              </div>
              {expandedId === wh.id && <WebhookLogsPanel webhookId={wh.id} />}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function WebhookLogsPanel({ webhookId }: { webhookId: string }) {
  const logsQuery = trpc.webhook.getLogs.useQuery({ webhookId, limit: 20 });
  const logs = logsQuery.data ?? [];

  return (
    <div className="border-t px-4 py-3 flex flex-col gap-1" style={{ borderColor: 'var(--border)' }}>
      <span className="text-[10px] uppercase tracking-wider font-semibold mb-1" style={{ color: 'var(--text-muted)' }}>
        Recent Logs ({logs.length})
      </span>
      {logs.length === 0 ? (
        <div className="text-xs py-2 text-center" style={{ color: 'var(--text-muted)' }}>No logs yet</div>
      ) : (
        logs.map((log) => (
          <div key={log.id} className="flex items-center gap-2 text-[10px] font-mono py-0.5">
            <span style={{ color: (log.statusCode ?? 0) >= 200 && (log.statusCode ?? 0) < 300 ? '#22c55e' : '#ef4444' }}>
              {log.statusCode ?? 'ERR'}
            </span>
            <span style={{ color: 'var(--text-secondary)' }}>{log.event}</span>
            <span className="flex-1" />
            <span style={{ color: 'var(--text-muted)' }}>{new Date(log.createdAt).toLocaleTimeString()}</span>
          </div>
        ))
      )}
    </div>
  );
}

/* ─── M6-03: API Section ─── */

function ApiSection() {
  const apiKeyQuery = trpc.apiKey.get.useQuery();
  const generateMutation = trpc.apiKey.generate.useMutation({ onSuccess: () => apiKeyQuery.refetch() });
  const revokeMutation = trpc.apiKey.revoke.useMutation({ onSuccess: () => apiKeyQuery.refetch() });
  const [showKey, setShowKey] = useState(false);

  const apiKey = apiKeyQuery.data;

  return (
    <div className="flex flex-col gap-6 max-w-2xl">
      <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>API</h2>

      {/* API Key */}
      <div className="flex flex-col gap-3 p-4 rounded-lg" style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border)' }}>
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>API Key</span>
          {apiKey ? (
            <div className="flex gap-2">
              <button
                onClick={() => setShowKey(!showKey)}
                className="text-xs px-2 py-1 rounded transition-colors"
                style={{ backgroundColor: 'var(--bg-hover)', color: 'var(--text-secondary)' }}
              >
                {showKey ? 'Hide' : 'Show'}
              </button>
              <button
                onClick={() => generateMutation.mutate({ name: 'Default' })}
                className="text-xs px-2 py-1 rounded transition-colors"
                style={{ backgroundColor: 'var(--bg-hover)', color: 'var(--text-secondary)' }}
              >
                Regenerate
              </button>
              <button
                onClick={() => revokeMutation.mutate({ id: apiKey.id })}
                className="text-xs px-2 py-1 rounded text-red-400 transition-colors"
              >
                Revoke
              </button>
            </div>
          ) : (
            <button
              onClick={() => generateMutation.mutate({ name: 'Default' })}
              disabled={generateMutation.isPending}
              className="text-xs px-3 py-1.5 rounded transition-colors disabled:opacity-50"
              style={{ backgroundColor: 'var(--accent)', color: '#fff' }}
            >
              Generate API Key
            </button>
          )}
        </div>
        {apiKey && (
          <div className="text-sm font-mono px-3 py-2 rounded" style={{ backgroundColor: 'var(--bg-primary)', color: 'var(--text-primary)' }}>
            {showKey ? apiKey.key : '••••••••••••••••••••••••••••••••••••'}
          </div>
        )}
      </div>

      {/* Swagger Link */}
      <div className="flex flex-col gap-2 p-4 rounded-lg" style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border)' }}>
        <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>API Documentation</span>
        <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
          API 문서는 로컬 서버에서 제공됩니다. 앱 실행 중 아래 링크로 접속하세요.
        </span>
        <a
          href="#"
          onClick={(e) => {
            e.preventDefault();
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (window as any).electron?.ipcRenderer?.invoke?.('shell:openExternal', 'http://127.0.0.1/api/docs');
          }}
          className="text-sm underline"
          style={{ color: 'var(--accent)' }}
        >
          /api/docs
        </a>
      </div>

      {/* curl 예시 */}
      <div className="flex flex-col gap-2 p-4 rounded-lg" style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border)' }}>
        <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>curl Examples</span>
        <pre
          className="text-xs font-mono p-3 rounded overflow-x-auto whitespace-pre-wrap"
          style={{ backgroundColor: 'var(--bg-primary)', color: 'var(--text-secondary)' }}
        >
{`# 세션 목록 조회
curl -H "Authorization: Bearer <token>" \\
  http://127.0.0.1:<port>/api/remote/sessions

# 새 세션 생성
curl -X POST \\
  -H "Authorization: Bearer <token>" \\
  -H "Content-Type: application/json" \\
  -d '{"name":"test","workspaceId":"...","agentId":"..."}' \\
  http://127.0.0.1:<port>/api/remote/sessions

# 세션에 텍스트 전송
curl -X POST \\
  -H "Authorization: Bearer <token>" \\
  -H "Content-Type: application/json" \\
  -d '{"text":"hello"}' \\
  http://127.0.0.1:<port>/api/remote/sessions/<id>/input`}
        </pre>
      </div>
    </div>
  );
}

/* ─── M6-05: Relay Section ─── */

function RelaySection() {
  const relayStatusQuery = trpc.relay.getStatus.useQuery(undefined, { refetchInterval: 5000 });
  const connectMutation = trpc.relay.connect.useMutation({ onSuccess: () => relayStatusQuery.refetch() });
  const disconnectMutation = trpc.relay.disconnect.useMutation({ onSuccess: () => relayStatusQuery.refetch() });

  const status = relayStatusQuery.data?.status ?? 'disconnected';
  const latencyMs = relayStatusQuery.data?.latencyMs ?? null;

  const dotColor = status === 'connected' ? '#22c55e' : status === 'connecting' ? '#eab308' : '#ef4444';
  const statusLabel = status === 'connected' ? 'Connected' : status === 'connecting' ? 'Connecting...' : 'Disconnected';

  return (
    <div className="flex flex-col gap-6 max-w-2xl">
      <h2 className="text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>Relay</h2>

      <div className="flex flex-col gap-4 p-4 rounded-lg" style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border)' }}>
        <div className="flex items-center gap-3">
          <div
            style={{
              width: 12,
              height: 12,
              borderRadius: '50%',
              backgroundColor: dotColor,
              boxShadow: `0 0 6px ${dotColor}80`,
            }}
          />
          <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{statusLabel}</span>
          {latencyMs !== null && (
            <span
              className="text-xs font-mono"
              style={{ color: latencyMs > 30 ? '#eab308' : 'var(--text-muted)' }}
            >
              {latencyMs}ms
            </span>
          )}
        </div>

        <div className="flex gap-2">
          {status === 'disconnected' ? (
            <button
              onClick={() => connectMutation.mutate()}
              disabled={connectMutation.isPending}
              className="text-xs px-3 py-1.5 rounded transition-colors disabled:opacity-50"
              style={{ backgroundColor: 'var(--accent)', color: '#fff' }}
            >
              Connect
            </button>
          ) : (
            <button
              onClick={() => disconnectMutation.mutate()}
              disabled={disconnectMutation.isPending}
              className="text-xs px-3 py-1.5 rounded transition-colors disabled:opacity-50"
              style={{ backgroundColor: 'var(--bg-hover)', color: 'var(--text-secondary)' }}
            >
              Disconnect
            </button>
          )}
        </div>

        <div className="text-xs" style={{ color: 'var(--text-muted)' }}>
          Relay 서버에 연결하면 외부에서 앱을 제어할 수 있습니다.
          연결이 끊어지면 지수 백오프(1s, 2s, 4s, 8s, 16s)로 자동 재연결을 시도합니다.
        </div>
      </div>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline gap-2">
        <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{label}</span>
        {hint && <span className="text-xs" style={{ color: 'var(--text-muted)' }}>{hint}</span>}
      </div>
      {children}
    </div>
  );
}

/* ─── Section: Plugins (M10-01) ─── */

function PluginsSection() {
  const { data: plugins, refetch } = trpc.plugin.list.useQuery();
  const loadMutation = trpc.plugin.load.useMutation({
    onSuccess: () => {
      refetch();
      toast.success('Plugin loaded');
    },
    onError: (err) => toast.error(`Failed to load plugin: ${err.message}`),
  });
  const unloadMutation = trpc.plugin.unload.useMutation({
    onSuccess: () => {
      refetch();
      toast.success('Plugin unloaded');
    },
  });

  const [pluginPath, setPluginPath] = useState('');

  const pluginList = (plugins ?? []) as Array<{
    id: string;
    name: string;
    version: string;
    path: string;
    enabled: boolean;
    loadedAt: string;
  }>;

  return (
    <div className="flex flex-col gap-6 max-w-lg">
      <SectionHeader title="Plugins" desc="Maestro 플러그인을 로드하고 관리합니다." />

      {/* Load Plugin */}
      <div className="flex gap-2">
        <input
          value={pluginPath}
          onChange={(e) => setPluginPath(e.target.value)}
          placeholder="플러그인 폴더 경로 (maestro-plugin.json이 있는 디렉토리)"
          className="flex-1 text-xs rounded px-3 py-2 outline-none border"
          style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--text-primary)', borderColor: 'var(--border)' }}
        />
        <button
          onClick={() => {
            if (pluginPath.trim()) {
              loadMutation.mutate({ pluginPath: pluginPath.trim() });
              setPluginPath('');
            }
          }}
          disabled={loadMutation.isPending || !pluginPath.trim()}
          className="px-3 py-2 text-xs text-white rounded disabled:opacity-50"
          style={{ backgroundColor: 'var(--accent)' }}
        >
          Load Plugin
        </button>
      </div>

      {/* Plugin List */}
      {pluginList.length === 0 ? (
        <div
          className="text-xs text-center py-8 rounded-lg"
          style={{ color: 'var(--text-muted)', backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border)' }}
        >
          로드된 플러그인이 없습니다.
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {pluginList.map((plugin) => (
            <div
              key={plugin.id}
              className="flex items-center justify-between p-3 rounded-lg"
              style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border)' }}
            >
              <div className="flex flex-col gap-0.5">
                <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
                  {plugin.name}
                </span>
                <span className="text-[10px] font-mono" style={{ color: 'var(--text-muted)' }}>
                  v{plugin.version} - {plugin.path}
                </span>
              </div>
              <button
                onClick={() => unloadMutation.mutate({ pluginId: plugin.id })}
                className="text-xs px-2 py-1 rounded"
                style={{ color: '#f14c4c', backgroundColor: 'rgba(241,76,76,0.1)' }}
              >
                Unload
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Manifest spec */}
      <div
        className="p-3 rounded-lg text-[11px] font-mono"
        style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--text-muted)', border: '1px solid var(--border)' }}
      >
        <div style={{ color: 'var(--text-secondary)' }}>maestro-plugin.json:</div>
        {`{
  "name": "my-plugin",
  "version": "1.0.0",
  "entry": "dist/index.js"
}`}
      </div>
    </div>
  );
}

/* ─── Section: ThemeEditorSection (M10-03) — Appearance 내부에서 사용 ─── */

function ThemeEditorSection() {
  const [showEditor, setShowEditor] = useState(false);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <div className="flex flex-col gap-0.5">
          <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>
            Theme Editor
          </span>
          <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>
            CSS 변수를 직접 편집하여 커스텀 테마를 만듭니다.
          </span>
        </div>
        <button
          onClick={() => setShowEditor(!showEditor)}
          className="text-xs px-3 py-1.5 rounded"
          style={{ color: 'var(--text-secondary)', backgroundColor: 'var(--bg-primary)', border: '1px solid var(--border)' }}
        >
          {showEditor ? 'Close Editor' : 'Open Editor'}
        </button>
      </div>
      {showEditor && <ThemeEditorInline />}
    </div>
  );
}

function ThemeEditorInline() {
  // 인라인 ThemeEditor 구현 (별도 파일 import 대신 여기서 구현)
  const { customThemeVariables, applyCustomTheme, setCustomThemeName } = useSettingsStore();

  const DEFAULT_VARS: Record<string, string> = {
    '--bg-primary': '#1e1e2e',
    '--bg-secondary': '#181825',
    '--bg-panel': '#1e1e2e',
    '--bg-hover': '#313244',
    '--bg-active': '#45475a',
    '--accent': '#e07850',
    '--text-primary': '#cdd6f4',
    '--text-secondary': '#a6adc8',
    '--text-muted': '#6c7086',
    '--border': '#313244',
  };

  const [variables, setVariables] = useState<Record<string, string>>(() => {
    if (Object.keys(customThemeVariables).length > 0) {
      return { ...DEFAULT_VARS, ...customThemeVariables };
    }
    const computed: Record<string, string> = {};
    const style = getComputedStyle(document.documentElement);
    for (const key of Object.keys(DEFAULT_VARS)) {
      computed[key] = style.getPropertyValue(key).trim() || DEFAULT_VARS[key];
    }
    return computed;
  });
  const [themeName, setThemeName] = useState('My Custom Theme');

  const exportMut = trpc.theme.export.useMutation({
    onSuccess: (r) => { if (r.success) toast.success('Theme exported'); },
    onError: (e) => toast.error(e.message),
  });
  const importMut = trpc.theme.import.useMutation({
    onSuccess: (r) => {
      if (r) {
        setVariables({ ...DEFAULT_VARS, ...r.variables });
        setThemeName(r.name);
        applyCustomTheme(r.variables);
        setCustomThemeName(r.name);
        toast.success(`Theme "${r.name}" imported`);
      }
    },
    onError: (e) => toast.error(e.message),
  });

  const handleChange = (key: string, val: string) => {
    setVariables((p) => ({ ...p, [key]: val }));
    document.documentElement.style.setProperty(key, val);
  };

  const toLabel = (k: string) => k.replace(/^--/, '').replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

  return (
    <div className="flex flex-col gap-3 p-3 rounded-lg" style={{ backgroundColor: 'var(--bg-primary)', border: '1px solid var(--border)' }}>
      <div className="flex gap-2 items-center">
        <input
          value={themeName}
          onChange={(e) => setThemeName(e.target.value)}
          placeholder="Theme name"
          className="flex-1 text-xs rounded px-2 py-1.5 outline-none border"
          style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--text-primary)', borderColor: 'var(--border)' }}
        />
        <button onClick={() => importMut.mutate()} className="text-[10px] px-2 py-1 rounded" style={{ color: 'var(--text-secondary)', border: '1px solid var(--border)' }}>
          Import
        </button>
        <button onClick={() => exportMut.mutate({ name: themeName, variables })} className="text-[10px] px-2 py-1 rounded" style={{ color: 'var(--text-secondary)', border: '1px solid var(--border)' }}>
          Export
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2">
        {Object.entries(variables).map(([key, value]) => (
          <label key={key} className="flex items-center gap-2">
            <input type="color" value={value} onChange={(e) => handleChange(key, e.target.value)} className="w-6 h-6 rounded cursor-pointer border-0" />
            <span className="text-[10px]" style={{ color: 'var(--text-secondary)' }}>{toLabel(key)}</span>
          </label>
        ))}
      </div>

      <div className="flex gap-2 justify-end">
        <button
          onClick={() => {
            for (const k of Object.keys(variables)) document.documentElement.style.removeProperty(k);
            setVariables(DEFAULT_VARS);
            applyCustomTheme({});
            toast.success('Reset to default');
          }}
          className="text-[10px] px-2 py-1 rounded"
          style={{ color: 'var(--text-secondary)', border: '1px solid var(--border)' }}
        >
          Reset
        </button>
        <button
          onClick={() => { applyCustomTheme(variables); setCustomThemeName(themeName); toast.success('Applied'); }}
          className="text-[10px] px-2 py-1 rounded text-white"
          style={{ backgroundColor: 'var(--accent)' }}
        >
          Apply
        </button>
      </div>
    </div>
  );
}

/* ─── Section: Profile export/import (M9-03) — System 내부에서 사용 ─── */

function ProfileSection() {
  const exportMut = trpc.profile.export.useMutation({
    onSuccess: (r) => { if (r.success) toast.success(`Profile exported to ${r.filePath}`); },
    onError: (e) => toast.error(e.message),
  });
  const importMut = trpc.profile.import.useMutation({
    onSuccess: (r) => { if (r.success) { toast.success('Profile imported'); window.location.reload(); } },
    onError: (e) => toast.error(e.message),
  });
  const [importMode, setImportMode] = useState<'merge' | 'overwrite'>('merge');

  return (
    <div className="flex flex-col gap-3">
      <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
        Settings Profile
      </span>
      <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>
        에이전트, MCP 서버, 테마 설정을 내보내거나 가져올 수 있습니다.
      </span>
      <div className="flex gap-2">
        <button
          onClick={() => exportMut.mutate()}
          disabled={exportMut.isPending}
          className="px-3 py-1.5 text-xs text-white rounded disabled:opacity-50"
          style={{ backgroundColor: 'var(--accent)' }}
        >
          Export Profile
        </button>
        <select
          value={importMode}
          onChange={(e) => setImportMode(e.target.value as 'merge' | 'overwrite')}
          className="text-xs rounded px-2 py-1 border"
          style={{ backgroundColor: 'var(--bg-secondary)', color: 'var(--text-primary)', borderColor: 'var(--border)' }}
        >
          <option value="merge">Merge</option>
          <option value="overwrite">Overwrite</option>
        </select>
        <button
          onClick={() => importMut.mutate({ mode: importMode })}
          disabled={importMut.isPending}
          className="px-3 py-1.5 text-xs rounded"
          style={{ color: 'var(--text-secondary)', backgroundColor: 'var(--bg-primary)', border: '1px solid var(--border)' }}
        >
          Import Profile
        </button>
      </div>
    </div>
  );
}

/* ─── Section: Telemetry details (M10-04) — About 내부에서 사용 ─── */

function TelemetryDetails() {
  const { telemetryEnabled } = useSettingsStore();
  const [showDetails, setShowDetails] = useState(false);

  const EVENTS = [
    { name: 'session_created', desc: '세션 생성 시 (agent_type, has_workspace)', pii: false },
    { name: 'feature_used', desc: '기능 사용 시 (feature_name)', pii: false },
    { name: 'app_started', desc: '앱 시작 시 (version)', pii: false },
  ];

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
          수집 데이터
        </span>
        <button
          onClick={() => setShowDetails(!showDetails)}
          className="text-xs px-2 py-1 rounded"
          style={{ color: 'var(--text-secondary)', border: '1px solid var(--border)' }}
        >
          {showDetails ? '숨기기' : '수집 항목 보기'}
        </button>
      </div>

      <div className="text-xs" style={{ color: telemetryEnabled ? '#22c55e' : 'var(--text-muted)' }}>
        텔레메트리: {telemetryEnabled ? '활성화됨 (옵트인)' : '비활성화됨'}
      </div>

      {showDetails && (
        <div className="flex flex-col gap-2 p-3 rounded-lg" style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border)' }}>
          <div className="text-[10px] font-semibold" style={{ color: 'var(--text-secondary)' }}>
            수집 이벤트 (PII 미포함 보장):
          </div>
          {EVENTS.map((evt) => (
            <div key={evt.name} className="flex items-start gap-2">
              <span className="text-[10px] font-mono px-1.5 py-0.5 rounded" style={{ backgroundColor: 'var(--bg-primary)', color: 'var(--accent)' }}>
                {evt.name}
              </span>
              <span className="text-[10px]" style={{ color: 'var(--text-muted)' }}>
                {evt.desc}
              </span>
            </div>
          ))}
          <div className="text-[10px] mt-1" style={{ color: 'var(--text-muted)' }}>
            * 세션 ID는 해시 처리, 파일 경로 미포함, 개인식별정보(PII) 수집 없음
          </div>
        </div>
      )}
    </div>
  );
}

function ToggleRow({ label, desc, checked, onChange }: { label: string; desc: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <div
      className="flex items-center justify-between p-4 rounded-lg"
      style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border)' }}
    >
      <div className="flex flex-col gap-0.5 mr-4">
        <span className="text-sm font-medium" style={{ color: 'var(--text-primary)' }}>{label}</span>
        <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>{desc}</span>
      </div>
      <button
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className="relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full transition-colors duration-200 focus:outline-none"
        style={{ backgroundColor: checked ? 'var(--accent)' : 'var(--bg-tertiary, #444)' }}
      >
        <span
          className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform duration-200 ${checked ? 'translate-x-6' : 'translate-x-1'}`}
        />
      </button>
    </div>
  );
}

/* ─── M11-00: Account Section ─── */

function AccountSection() {
  const { user, signOut } = useAuthStore();
  const [isSigningOut, setIsSigningOut] = useState(false);

  const handleSignOut = async () => {
    setIsSigningOut(true);
    try {
      await signOut();
    } finally {
      setIsSigningOut(false);
    }
  };

  return (
    <div className="flex flex-col gap-6 max-w-lg">
      <div>
        <h2 className="text-sm font-semibold mb-4" style={{ color: 'var(--text-primary)' }}>
          계정
        </h2>

        <div
          className="rounded-xl p-5 flex flex-col gap-4"
          style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border)' }}
        >
          {/* Profile */}
          <div className="flex items-center gap-4">
            <div
              className="w-10 h-10 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0"
              style={{ backgroundColor: 'var(--accent)', color: '#fff' }}
            >
              {user?.email?.[0]?.toUpperCase() ?? '?'}
            </div>
            <div className="flex flex-col gap-0.5 min-w-0">
              <span className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>
                {user?.email ?? '알 수 없음'}
              </span>
              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                로그인됨
              </span>
            </div>
          </div>

          {/* Divider */}
          <div className="h-px" style={{ backgroundColor: 'var(--border)' }} />

          {/* Logout */}
          <button
            onClick={handleSignOut}
            disabled={isSigningOut}
            className="w-fit px-4 py-2 text-sm rounded-lg transition-colors disabled:opacity-50"
            style={{
              backgroundColor: 'var(--bg-primary)',
              color: 'var(--text-secondary)',
              border: '1px solid var(--border)',
            }}
            onMouseEnter={(e) => { e.currentTarget.style.borderColor = '#f87171'; e.currentTarget.style.color = '#f87171'; }}
            onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--text-secondary)'; }}
          >
            {isSigningOut ? '로그아웃 중...' : '로그아웃'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ─── Section: 태스크 생성 AI ─── */

function TaskCreationAISection() {
  const { taskCreationSystemPrompt, setTaskCreationSystemPrompt } = useSettingsStore();
  const [localValue, setLocalValue] = useState<string>(taskCreationSystemPrompt ?? '');

  const handleSave = () => {
    setTaskCreationSystemPrompt(localValue.trim() === '' ? undefined : localValue);
    toast.success('저장됨', '태스크 생성 AI 프롬프트가 저장되었습니다.');
  };

  const handleReset = () => {
    setTaskCreationSystemPrompt(undefined);
    setLocalValue('');
    toast.info('초기화됨', '기본 프롬프트로 복원되었습니다.');
  };

  const placeholderPreview = DEFAULT_INTERVIEW_SYSTEM_PROMPT.split('\n').slice(0, 4).join('\n') + '\n...';

  return (
    <div className="flex flex-col gap-8 max-w-2xl">
      <SectionHeader
        title="태스크 생성 AI 인터뷰 프롬프트"
        desc="새 태스크 생성 시 AI와의 대화를 안내하는 시스템 프롬프트입니다. 비워두면 기본 프롬프트가 사용됩니다."
      />

      <div className="flex flex-col gap-3">
        <textarea
          value={localValue}
          onChange={(e) => setLocalValue(e.target.value)}
          placeholder={placeholderPreview}
          rows={12}
          className="w-full rounded-lg px-3 py-2.5 text-sm font-mono resize-y focus:outline-none"
          style={{
            backgroundColor: 'var(--bg-secondary)',
            border: '1px solid var(--border)',
            color: 'var(--text-primary)',
            minHeight: '200px',
          }}
          onFocus={(e) => (e.currentTarget.style.borderColor = 'var(--accent)')}
          onBlur={(e) => (e.currentTarget.style.borderColor = 'var(--border)')}
        />
        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
          <code className="px-1 py-0.5 rounded text-[11px]" style={{ backgroundColor: 'var(--bg-tertiary, #333)' }}>
            {'{projectName}'}
          </code>
          ,{' '}
          <code className="px-1 py-0.5 rounded text-[11px]" style={{ backgroundColor: 'var(--bg-tertiary, #333)' }}>
            {'{repositoryName}'}
          </code>{' '}
          변수를 사용하면 현재 프로젝트/레포 이름으로 자동 치환됩니다.
        </p>
      </div>

      <div className="flex items-center gap-3">
        <button
          onClick={handleSave}
          className="px-4 py-2 text-sm rounded-lg transition-colors"
          style={{
            backgroundColor: 'var(--accent)',
            color: '#fff',
          }}
          onMouseEnter={(e) => (e.currentTarget.style.opacity = '0.85')}
          onMouseLeave={(e) => (e.currentTarget.style.opacity = '1')}
        >
          저장
        </button>
        <button
          onClick={handleReset}
          className="px-4 py-2 text-sm rounded-lg transition-colors"
          style={{
            backgroundColor: 'var(--bg-secondary)',
            color: 'var(--text-secondary)',
            border: '1px solid var(--border)',
          }}
          onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--bg-hover)')}
          onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'var(--bg-secondary)')}
        >
          기본값으로 초기화
        </button>
      </div>
    </div>
  );
}

/* ─── Section: Anthropic 인증 ─── */

function AnthropicAuthSection() {
  const { status, isAuthenticated, source, expiresAt, isLoading, openOAuth, checkStatus } = useAnthropicAuthStore();

  const statusText = {
    checking: '확인 중...',
    authenticated: '인증됨',
    unauthenticated: '미인증',
    expired: '만료됨',
  }[status];

  const sourceText = source
    ? ({
        'claude-config': 'Claude 설정 파일',
        keychain: 'macOS Keychain',
        mastracode: 'Maestro 저장소',
      } as Record<string, string>)[source]
    : undefined;

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h3 className="text-sm font-semibold mb-1" style={{ color: 'var(--text-primary)' }}>
          Anthropic 인증
        </h3>
        <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
          AI 채팅 태스크 생성에 사용할 Anthropic 계정 인증을 관리합니다.
        </p>
      </div>

      {/* 상태 카드 */}
      <div
        className="rounded-lg p-4"
        style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border)' }}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            {/* 상태 인디케이터 */}
            <div
              className="w-2 h-2 rounded-full"
              style={{
                backgroundColor: isAuthenticated
                  ? '#34D399'
                  : status === 'expired'
                    ? '#F59E0B'
                    : '#6B7280',
              }}
            />
            <div>
              <div className="text-xs font-medium" style={{ color: 'var(--text-primary)' }}>
                {statusText}
              </div>
              {sourceText && (
                <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                  출처: {sourceText}
                </div>
              )}
              {expiresAt && isAuthenticated && (
                <div className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
                  만료: {new Date(expiresAt).toLocaleDateString('ko-KR')}
                </div>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2">
            {/* 새로고침 버튼 */}
            <button
              onClick={() => void checkStatus()}
              disabled={isLoading}
              className="text-xs px-2 py-1 rounded transition-colors"
              style={{ color: 'var(--text-muted)', backgroundColor: 'var(--bg-hover)' }}
            >
              새로고침
            </button>

            {/* 로그인/재인증 버튼 */}
            {(!isAuthenticated || status === 'expired') && (
              <button
                onClick={() => void openOAuth()}
                disabled={isLoading}
                className="text-xs px-3 py-1.5 rounded font-medium transition-colors"
                style={{
                  backgroundColor: 'var(--accent)',
                  color: '#fff',
                  opacity: isLoading ? 0.6 : 1,
                }}
              >
                {isLoading ? '연결 중...' : 'Anthropic으로 로그인'}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* 인증 경로 설명 */}
      <div>
        <p className="text-xs mb-3 font-medium" style={{ color: 'var(--text-secondary)' }}>
          자동 인증 탐색 순서
        </p>
        {[
          { label: '1. Claude 설정 파일', desc: '~/.claude/.credentials.json 또는 ~/.claude.json' },
          { label: '2. macOS Keychain', desc: 'claude-cli 키체인 항목' },
          { label: '3. Maestro 저장소', desc: '~/Library/Application Support/mastracode/auth.json' },
        ].map(({ label, desc }) => (
          <div
            key={label}
            className="flex flex-col mb-2 px-3 py-2 rounded"
            style={{ backgroundColor: 'var(--bg-secondary)' }}
          >
            <span className="text-xs font-medium" style={{ color: 'var(--text-primary)' }}>
              {label}
            </span>
            <span className="text-[11px]" style={{ color: 'var(--text-muted)' }}>
              {desc}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
