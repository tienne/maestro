import { useState, useRef, useCallback } from 'react';
import { useAgentStore } from '../../store/agentStore';
import { useUiStore } from '../../store/uiStore';
import { useSessionStore } from '../../store/sessionStore';
import { AgentIcon } from '../shared/AgentIcon';
import { trpc } from '../../lib/trpc';
import { useSessionIntelligenceQuery } from '../../hooks/useSessionIntelligence';
import { toast } from '../../lib/toast';
import type { Session, SessionLabel, ExportFormat } from '@maestro/shared-types';

const LABEL_COLORS = [
  '#EF4444', '#F59E0B', '#22C55E', '#3B82F6', '#8B5CF6',
  '#EC4899', '#06B6D4', '#F97316',
];

interface Props {
  session: Session;
  isActive: boolean;
  isPinned: boolean;
  isFavorite: boolean;
  onClick: () => void;
  onClose: () => void;
}

export function TerminalTab({ session, isActive, isPinned, isFavorite, onClick, onClose }: Props) {
  const { agents } = useAgentStore();
  const agent = agents.find((a) => a.id === session.agentId);
  const { setLabels } = useSessionStore();

  // M3: 세션 인텔리전스
  const { data: intelligence } = useSessionIntelligenceQuery(session.id);

  // M4-05: 라벨
  const { data: sessionLabels } = trpc.session.getLabels.useQuery({ sessionId: session.id });
  const labels: SessionLabel[] = (sessionLabels as SessionLabel[] | undefined) ?? [];
  const [showLabelPopover, setShowLabelPopover] = useState(false);
  const [newLabelName, setNewLabelName] = useState('');
  const [newLabelColor, setNewLabelColor] = useState(LABEL_COLORS[0]);
  const addLabelMutation = trpc.session.addLabel.useMutation({
    onSuccess: () => {
      setShowLabelPopover(false);
      setNewLabelName('');
    },
  });
  const removeLabelMutation = trpc.session.removeLabel.useMutation();
  const costDisplay = intelligence?.costs?.totalCostUsd
    ? `$${intelligence.costs.totalCostUsd.toFixed(2)}`
    : null;
  const tasks = intelligence?.tasks ?? [];
  const doneTasks = tasks.filter((t) => t.status === 'done').length;
  const totalTasks = tasks.length;
  const taskDisplay = totalTasks > 0 ? `(${doneTasks}/${totalTasks})` : null;
  const lastError = intelligence?.lastError ?? null;
  const isCompleted = intelligence?.completedAt != null && intelligence?.exitCode === 0;

  // F-M2-03: 인라인 이름 편집 상태
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState(session.name);
  const inputRef = useRef<HTMLInputElement>(null);

  // F-M2-04: 우클릭 컨텍스트 메뉴
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);

  const renameMutation = trpc.session.rename.useMutation({
    onSuccess: (updated) => {
      useSessionStore.getState().updateSession(updated as Session);
    },
  });

  const setFavoriteMutation = trpc.session.setFavorite.useMutation({
    onSuccess: (updated) => {
      useSessionStore.getState().updateSession(updated as Session);
    },
  });

  const { togglePinTab } = useUiStore();

  // M9-02: 세션 내보내기
  const [showExportModal, setShowExportModal] = useState(false);
  const [exportFormat, setExportFormat] = useState<ExportFormat>('txt');
  const [exportTimestamp, setExportTimestamp] = useState(true);
  const [exportAnsi, setExportAnsi] = useState(false);
  const exportMutation = trpc.session.export.useMutation({
    onSuccess: (result) => {
      if (result.success) {
        toast.success(`Session exported to ${result.filePath}`);
      }
      setShowExportModal(false);
    },
    onError: (err) => {
      toast.error(`Export failed: ${err.message}`);
    },
  });

  const handleDoubleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    setEditName(session.name);
    setEditing(true);
    setTimeout(() => inputRef.current?.select(), 0);
  }, [session.name]);

  const commitRename = useCallback(() => {
    const trimmed = editName.trim();
    setEditing(false);
    if (trimmed && trimmed !== session.name) {
      renameMutation.mutate({ sessionId: session.id, name: trimmed.slice(0, 30) });
    }
  }, [editName, session.id, session.name, renameMutation]);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY });
  }, []);

  return (
    <>
      <button
        onClick={onClick}
        onDoubleClick={handleDoubleClick}
        onContextMenu={handleContextMenu}
        role="tab"
        aria-selected={isActive}
        aria-label={`세션: ${session.name}`}
        className={`group flex items-center gap-1.5 px-3 border-r transition-colors whitespace-nowrap ${
          isActive
            ? 'font-bold border-b-2 border-b-[var(--accent)]'
            : 'border-b-2 border-b-transparent'
        }`}
        style={{
          minHeight: '44px',
          backgroundColor: isActive ? 'var(--tab-active-bg)' : 'var(--tab-inactive-bg)',
          color: isActive ? 'var(--tab-active-text)' : 'var(--tab-inactive-text)',
          borderRightColor: 'var(--border)',
        }}
      >
        {/* M4-05: 라벨 칩 */}
        {labels.length > 0 && labels.map((l) => (
          <span
            key={l.labelName}
            className="text-[8px] px-1 py-0.5 rounded flex-shrink-0 font-bold"
            style={{ backgroundColor: `${l.labelColor}30`, color: l.labelColor }}
            title={l.labelName}
          >
            {l.labelName}
          </span>
        ))}

        {/* F-M2-06: 즐겨찾기 아이콘 */}
        {isFavorite && (
          <span className="text-yellow-400 text-xs flex-shrink-0" title="Favorite">★</span>
        )}

        {/* F-M2-04: 핀 아이콘 */}
        {isPinned && (
          <span className="text-[10px] flex-shrink-0" style={{ color: 'var(--text-muted)' }} title="Pinned">📌</span>
        )}

        {/* 세션 상태 dot */}
        <span
          className={`w-2 h-2 rounded-full flex-shrink-0 ${
            session.status === 'running'
              ? 'bg-green-400 animate-pulse'
              : session.status === 'error'
                ? 'bg-red-400'
                : session.status === 'blocked'
                  ? 'bg-orange-400'
                  : 'bg-gray-500'
          }`}
          title={session.status === 'running' ? '실행 중' : session.status === 'error' ? '에러' : session.status === 'blocked' ? '블록됨' : '중지됨'}
        />

        {/* 에이전트 아이콘 */}
        {agent && <AgentIcon agent={agent} size="sm" />}

        {/* F-M2-03: 세션 이름 (편집 모드 or 표시) */}
        {editing ? (
          <input
            ref={inputRef}
            value={editName}
            onChange={(e) => setEditName(e.target.value.slice(0, 30))}
            onBlur={commitRename}
            onKeyDown={(e) => {
              if (e.key === 'Enter') { e.preventDefault(); commitRename(); }
              if (e.key === 'Escape') { e.preventDefault(); setEditing(false); }
            }}
            onClick={(e) => e.stopPropagation()}
            className="text-sm px-1 py-0 rounded outline-none w-24"
            style={{
              backgroundColor: 'var(--bg-primary)',
              color: 'var(--text-primary)',
              border: '1px solid var(--accent)',
            }}
            maxLength={30}
            autoFocus
          />
        ) : (
          <span className="max-w-[100px] truncate text-sm">{session.name}</span>
        )}

        {/* 에이전트 이름 레이블 */}
        {agent && (
          <span
            className="text-[10px] leading-none flex-shrink-0"
            style={{ color: isActive ? 'var(--text-secondary)' : 'var(--text-muted)' }}
          >
            {agent.name}
          </span>
        )}

        {/* M3-02: 작업 진행률 */}
        {taskDisplay && (
          <span
            className="text-[9px] px-1 py-0.5 rounded flex-shrink-0 font-mono"
            style={{ backgroundColor: 'rgba(99,102,241,0.15)', color: '#818cf8' }}
            title={`Tasks: ${doneTasks}/${totalTasks} done`}
          >
            {taskDisplay}
          </span>
        )}

        {/* M3-01: 비용 표시 */}
        {costDisplay && (
          <span
            className="text-[9px] px-1 py-0.5 rounded flex-shrink-0 font-mono"
            style={{ backgroundColor: 'rgba(34,197,94,0.12)', color: '#22c55e' }}
            title={`Input: ${intelligence?.costs?.totalInputTokens?.toLocaleString() ?? 0} tokens\nOutput: ${intelligence?.costs?.totalOutputTokens?.toLocaleString() ?? 0} tokens`}
          >
            {costDisplay}
          </span>
        )}

        {/* M3-04: 에러 뱃지 */}
        {lastError && (
          <span
            className="text-[9px] px-1 py-0.5 rounded flex-shrink-0 font-bold"
            style={{ backgroundColor: 'rgba(241,76,76,0.15)', color: '#f14c4c' }}
            title={lastError.message}
          >
            {lastError.type}
          </span>
        )}

        {/* M3-05: 완료 아이콘 */}
        {isCompleted && (
          <span className="text-[10px] flex-shrink-0" title="Completed">
            {'✅'}
          </span>
        )}

        {/* 닫기 버튼 (핀된 탭은 숨김) */}
        {!isPinned && (
          <span
            role="button"
            onClick={(e) => { e.stopPropagation(); onClose(); }}
            className="opacity-0 group-hover:opacity-100 ml-0.5 w-4 h-4 flex items-center justify-center rounded transition-all cursor-pointer flex-shrink-0 hover:bg-[var(--bg-hover)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]"
            title="Close session"
          >
            x
          </span>
        )}
      </button>

      {/* F-M2-04 / F-M2-06: 우클릭 컨텍스트 메뉴 */}
      {/* M4-05: 라벨 추가 팝오버 */}
      {showLabelPopover && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setShowLabelPopover(false)} />
          <div
            className="fixed z-50 p-3 rounded-lg shadow-xl min-w-[200px] flex flex-col gap-2"
            style={{
              left: '50%',
              top: '50%',
              transform: 'translate(-50%, -50%)',
              backgroundColor: 'var(--bg-secondary)',
              border: '1px solid var(--border)',
            }}
          >
            <span className="text-xs font-semibold" style={{ color: 'var(--text-primary)' }}>Add Label</span>
            <input
              value={newLabelName}
              onChange={(e) => setNewLabelName(e.target.value.slice(0, 20))}
              placeholder="Label name"
              className="text-xs rounded px-2 py-1 outline-none border"
              style={{ backgroundColor: 'var(--bg-primary)', color: 'var(--text-primary)', borderColor: 'var(--border)' }}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter' && newLabelName.trim()) {
                  addLabelMutation.mutate({ sessionId: session.id, labelName: newLabelName.trim(), labelColor: newLabelColor });
                }
                if (e.key === 'Escape') setShowLabelPopover(false);
              }}
            />
            <div className="flex gap-1">
              {LABEL_COLORS.map((c) => (
                <button
                  key={c}
                  className="w-4 h-4 rounded-full border-2"
                  style={{ backgroundColor: c, borderColor: c === newLabelColor ? 'var(--text-primary)' : 'transparent' }}
                  onClick={() => setNewLabelColor(c)}
                />
              ))}
            </div>
            <button
              onClick={() => {
                if (newLabelName.trim()) {
                  addLabelMutation.mutate({ sessionId: session.id, labelName: newLabelName.trim(), labelColor: newLabelColor });
                }
              }}
              disabled={!newLabelName.trim() || addLabelMutation.isPending}
              className="text-xs px-3 py-1 rounded text-white disabled:opacity-50"
              style={{ backgroundColor: 'var(--accent)' }}
            >
              Add
            </button>
          </div>
        </>
      )}

      {contextMenu && (
        <>
          <div
            className="fixed inset-0 z-40"
            onClick={() => setContextMenu(null)}
          />
          <div
            className="fixed z-50 py-1 rounded-lg shadow-xl min-w-[160px]"
            style={{
              left: contextMenu.x,
              top: contextMenu.y,
              backgroundColor: 'var(--bg-secondary)',
              border: '1px solid var(--border)',
            }}
          >
            <button
              className="w-full text-left px-3 py-1.5 text-xs transition-colors"
              style={{ color: 'var(--text-primary)' }}
              onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--bg-hover)')}
              onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
              onClick={() => {
                setContextMenu(null);
                handleDoubleClick({ stopPropagation: () => {} } as React.MouseEvent);
              }}
            >
              Rename
            </button>
            <button
              className="w-full text-left px-3 py-1.5 text-xs transition-colors"
              style={{ color: 'var(--text-primary)' }}
              onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--bg-hover)')}
              onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
              onClick={() => {
                setContextMenu(null);
                togglePinTab(session.id);
              }}
            >
              {isPinned ? 'Unpin Tab' : 'Pin Tab'}
            </button>
            <button
              className="w-full text-left px-3 py-1.5 text-xs transition-colors"
              style={{ color: 'var(--text-primary)' }}
              onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--bg-hover)')}
              onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
              onClick={() => {
                setContextMenu(null);
                setFavoriteMutation.mutate({ sessionId: session.id, favorite: !isFavorite });
              }}
            >
              {isFavorite ? 'Remove from Favorites' : 'Add to Favorites'}
            </button>
            {/* M9-02: Export Session */}
            <button
              className="w-full text-left px-3 py-1.5 text-xs transition-colors"
              style={{ color: 'var(--text-primary)' }}
              onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--bg-hover)')}
              onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
              onClick={() => {
                setContextMenu(null);
                setShowExportModal(true);
              }}
            >
              Export Session
            </button>
            {/* M4-05: Add Label */}
            <button
              className="w-full text-left px-3 py-1.5 text-xs transition-colors"
              style={{ color: 'var(--text-primary)' }}
              onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--bg-hover)')}
              onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
              onClick={() => {
                setContextMenu(null);
                setShowLabelPopover(true);
              }}
            >
              Add Label
            </button>
            {/* M4-05: 기존 라벨 제거 */}
            {labels.map((l) => (
              <button
                key={l.labelName}
                className="w-full text-left px-3 py-1.5 text-xs transition-colors flex items-center gap-1"
                style={{ color: 'var(--text-primary)' }}
                onMouseEnter={(e) => (e.currentTarget.style.backgroundColor = 'var(--bg-hover)')}
                onMouseLeave={(e) => (e.currentTarget.style.backgroundColor = 'transparent')}
                onClick={() => {
                  setContextMenu(null);
                  removeLabelMutation.mutate({ sessionId: session.id, labelName: l.labelName });
                }}
              >
                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: l.labelColor }} />
                Remove: {l.labelName}
              </button>
            ))}
          </div>
        </>
      )}

      {/* M9-02: Export Session Modal */}
      {showExportModal && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setShowExportModal(false)} />
          <div
            className="fixed z-50 p-4 rounded-lg shadow-xl min-w-[280px] flex flex-col gap-3"
            style={{
              left: '50%',
              top: '50%',
              transform: 'translate(-50%, -50%)',
              backgroundColor: 'var(--bg-secondary)',
              border: '1px solid var(--border)',
            }}
          >
            <span className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
              Export Session
            </span>

            <label className="flex flex-col gap-1">
              <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>Format</span>
              <select
                value={exportFormat}
                onChange={(e) => setExportFormat(e.target.value as ExportFormat)}
                className="text-xs rounded px-2 py-1.5 outline-none border"
                style={{ backgroundColor: 'var(--bg-primary)', color: 'var(--text-primary)', borderColor: 'var(--border)' }}
              >
                <option value="txt">Plain Text (.txt)</option>
                <option value="html">HTML (.html)</option>
                <option value="json">JSON (.json)</option>
              </select>
            </label>

            <label className="flex items-center gap-2">
              <input
                type="checkbox"
                checked={exportTimestamp}
                onChange={(e) => setExportTimestamp(e.target.checked)}
                className="rounded"
              />
              <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>Include timestamp</span>
            </label>

            {exportFormat === 'html' && (
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={exportAnsi}
                  onChange={(e) => setExportAnsi(e.target.checked)}
                  className="rounded"
                />
                <span className="text-xs" style={{ color: 'var(--text-secondary)' }}>Include ANSI colors</span>
              </label>
            )}

            <div className="flex gap-2 justify-end mt-1">
              <button
                onClick={() => setShowExportModal(false)}
                className="text-xs px-3 py-1.5 rounded"
                style={{ color: 'var(--text-secondary)', backgroundColor: 'var(--bg-primary)', border: '1px solid var(--border)' }}
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  exportMutation.mutate({
                    sessionId: session.id,
                    format: exportFormat,
                    includeTimestamp: exportTimestamp,
                    includeAnsi: exportAnsi,
                  });
                }}
                disabled={exportMutation.isPending}
                className="text-xs px-3 py-1.5 rounded text-white disabled:opacity-50"
                style={{ backgroundColor: 'var(--accent)' }}
              >
                {exportMutation.isPending ? 'Exporting...' : 'Export'}
              </button>
            </div>
          </div>
        </>
      )}
    </>
  );
}
