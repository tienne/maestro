import { useState, useEffect } from 'react';
import { useRepositoryStore } from '../../store/repositoryStore';
import { useUiStore } from '../../store/uiStore';
import { trpc } from '../../lib/trpc';
import type { Repository, EnvVar } from '@maestro/shared-types';

// react-query v5: onSuccess callback in useQuery opts is not supported.

const PRESET_COLORS = [
  '#4B8BFF', '#34D399', '#F59E0B', '#EF4444', '#A78BFA',
  '#EC4899', '#06B6D4', '#84CC16', '#F97316', '#6B7280',
];

interface Props {
  repositoryId: string;
}

const inputStyle = {
  backgroundColor: 'var(--bg-secondary)',
  color: 'var(--text-primary)',
  borderColor: 'var(--border)',
};

const inputCls = 'text-xs rounded px-3 py-2 outline-none border focus:border-blue-600 placeholder-gray-600';

export function RepoSettingsPage({ repositoryId }: Props) {
  const { repositories, updateRepository, envVars, setEnvVars, addOrUpdateEnvVar, removeEnvVar } =
    useRepositoryStore();
  const { setCurrentView } = useUiStore();
  const repo = repositories.find((r) => r.id === repositoryId);

  // Form state mirrors repo settings
  const [name, setName] = useState('');
  const [color, setColor] = useState('#4B8BFF');
  const [branchPrefix, setBranchPrefix] = useState('');
  const [baseBranch, setBaseBranch] = useState('');
  const [worktreeBasePath, setWorktreeBasePath] = useState('');
  const [setupScript, setSetupScript] = useState('');
  const [teardownScript, setTeardownScript] = useState('');
  const [savedMsg, setSavedMsg] = useState(false);

  // EnvVar editing state
  const [newKey, setNewKey] = useState('');
  const [newValue, setNewValue] = useState('');

  useEffect(() => {
    if (repo) {
      setName(repo.name);
      setColor(repo.color);
      setBranchPrefix(repo.branchPrefix);
      setBaseBranch(repo.baseBranch);
      setWorktreeBasePath(repo.worktreeBasePath);
      setSetupScript(repo.setupScript);
      setTeardownScript(repo.teardownScript);
    }
  }, [repo]);

  // Load env vars via tRPC
  const envVarQuery = trpc.repository.envVar.list.useQuery({ repositoryId });
  useEffect(() => {
    const d = envVarQuery.data as unknown;
    if (d) setEnvVars(repositoryId, d as EnvVar[]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [envVarQuery.data, repositoryId]);

  const openDirMutation = trpc.dialog.openDirectory.useMutation({
    onError: (e) => console.error('[dialog] openDirectory failed:', e.message),
  });

  const updateMutation = trpc.repository.update.useMutation({
    onSuccess: (updated) => {
      updateRepository(updated as Repository);
      setSavedMsg(true);
      setTimeout(() => setSavedMsg(false), 2000);
    },
  });

  const envVarUpsertMutation = trpc.repository.envVar.upsert.useMutation({
    onSuccess: (envVar) => {
      addOrUpdateEnvVar(repositoryId, envVar as EnvVar);
      setNewKey('');
      setNewValue('');
    },
  });

  const envVarDeleteMutation = trpc.repository.envVar.delete.useMutation({
    onSuccess: (_, vars) => removeEnvVar(vars.id, repositoryId),
  });

  const handleSave = () => {
    updateMutation.mutate({
      id: repositoryId,
      settings: { name, color, branchPrefix, baseBranch, worktreeBasePath, setupScript, teardownScript },
    });
  };

  const handleAddEnvVar = () => {
    if (!newKey.trim()) return;
    envVarUpsertMutation.mutate({ repositoryId, key: newKey.trim(), value: newValue });
  };

  const handleDeleteEnvVar = (id: string) => {
    envVarDeleteMutation.mutate({ id });
  };

  const repoEnvVars: EnvVar[] = envVars[repositoryId] ?? [];

  if (!repo) return null;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Header */}
      <div
        className="flex items-center gap-3 px-5 py-3 border-b flex-shrink-0"
        style={{ borderColor: 'var(--border)', backgroundColor: 'var(--bg-panel)' }}
      >
        <button
          onClick={() => setCurrentView('terminal')}
          className="text-sm transition-colors"
          style={{ color: 'var(--text-muted)' }}
          onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--text-primary)')}
          onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--text-muted)')}
          title="Back to terminal"
        >
          ←
        </button>
        <div className="flex items-center gap-2">
          <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: repo.color }} />
          <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>{repo.name}</span>
          <span className="text-xs" style={{ color: 'var(--text-muted)' }}>settings</span>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {savedMsg && <span className="text-xs text-green-400">Saved</span>}
          <button
            onClick={handleSave}
            disabled={updateMutation.isPending}
            className="px-3 py-1.5 text-xs text-white rounded disabled:opacity-50"
            style={{ backgroundColor: 'var(--accent)' }}
          >
            {updateMutation.isPending ? 'Saving...' : 'Save'}
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto px-5 py-4 flex flex-col gap-6">
        {/* Basic Info */}
        <Section title="General">
          <Field label="Repository Name">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className={inputCls}
              style={inputStyle}
            />
          </Field>
          <Field label="Color">
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
          </Field>
        </Section>

        {/* Branch Settings */}
        <Section title="Branch Settings">
          <Field label="Branch Prefix" hint="e.g. feat, fix — prefix applied to all workspace branches">
            <input
              value={branchPrefix}
              onChange={(e) => setBranchPrefix(e.target.value)}
              placeholder="feat"
              className={inputCls}
              style={inputStyle}
            />
          </Field>
          <Field label="Base Branch" hint="New workspaces branch off from this">
            <input
              value={baseBranch}
              onChange={(e) => setBaseBranch(e.target.value)}
              placeholder="main"
              className={inputCls}
              style={inputStyle}
            />
          </Field>
          <Field label="Worktree Base Path" hint="Directory where git worktrees are created">
            <div className="flex gap-1.5">
              <input
                value={worktreeBasePath}
                onChange={(e) => setWorktreeBasePath(e.target.value)}
                placeholder="(same level as repo by default)"
                className={`${inputCls} flex-1`}
                style={inputStyle}
              />
              <button
                onClick={() => openDirMutation.mutate(undefined, { onSuccess: (p) => { if (p) setWorktreeBasePath(p as string); } })}
                className="px-2.5 py-1.5 text-xs rounded border transition-colors flex-shrink-0"
                style={{ borderColor: 'var(--border)', color: 'var(--text-secondary)', backgroundColor: 'var(--bg-secondary)' }}
                onMouseEnter={(e) => (e.currentTarget.style.color = 'var(--text-primary)')}
                onMouseLeave={(e) => (e.currentTarget.style.color = 'var(--text-secondary)')}
                title="Browse folder"
              >
                Browse
              </button>
            </div>
          </Field>
        </Section>

        {/* Lifecycle Scripts */}
        <Section title="Lifecycle Scripts">
          <Field label="Setup Script" hint="Runs after a workspace is created">
            <textarea
              value={setupScript}
              onChange={(e) => setSetupScript(e.target.value)}
              placeholder={"#!/bin/sh\nnpm install"}
              rows={4}
              className={`${inputCls} font-mono resize-none`}
              style={inputStyle}
            />
          </Field>
          <Field label="Teardown Script" hint="Runs before a workspace is deleted">
            <textarea
              value={teardownScript}
              onChange={(e) => setTeardownScript(e.target.value)}
              placeholder={"#!/bin/sh\nnpm run cleanup"}
              rows={4}
              className={`${inputCls} font-mono resize-none`}
              style={inputStyle}
            />
          </Field>
        </Section>

        {/* Environment Variables */}
        <Section title="Environment Variables">
          <div className="flex flex-col gap-1.5">
            {repoEnvVars.map((v) => (
              <div
                key={v.id}
                className="flex items-center gap-2 rounded px-2 py-1.5"
                style={{ backgroundColor: 'var(--bg-secondary)' }}
              >
                <span className="text-xs font-mono flex-1 truncate" style={{ color: 'var(--text-primary)' }}>{v.key}</span>
                <span className="text-xs font-mono flex-1 truncate" style={{ color: 'var(--text-muted)' }}>{v.value}</span>
                <button
                  onClick={() => handleDeleteEnvVar(v.id)}
                  className="text-xs px-1 transition-colors hover:text-red-400"
                  style={{ color: 'var(--text-muted)' }}
                >
                  ×
                </button>
              </div>
            ))}

            {/* Add new */}
            <div className="flex items-center gap-2 mt-1">
              <input
                value={newKey}
                onChange={(e) => setNewKey(e.target.value)}
                placeholder="KEY"
                className={`${inputCls} flex-1 font-mono`}
                style={inputStyle}
              />
              <span className="text-xs" style={{ color: 'var(--text-muted)' }}>=</span>
              <input
                value={newValue}
                onChange={(e) => setNewValue(e.target.value)}
                placeholder="value"
                className={`${inputCls} flex-1 font-mono`}
                style={inputStyle}
                onKeyDown={(e) => e.key === 'Enter' && handleAddEnvVar()}
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
        </Section>
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
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

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
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
