import { useState } from 'react';
import { useSessionStore } from '../../store/sessionStore';
import { useUiStore } from '../../store/uiStore';
import { trpc } from '../../lib/trpc';
import type { Session } from '@maestro/shared-types';

interface Props {
  session: Session;
  onClose: () => void;
}

export function SessionResumeModal({ session, onClose }: Props) {
  const { updateSession, setActiveSession } = useSessionStore();
  const { setPaneSession, setCurrentView } = useUiStore();
  const [error, setError] = useState('');

  const resumeMutation = trpc.session.resume.useMutation({
    onSuccess: (resumed) => {
      const sess = resumed as Session;
      updateSession(sess);
      setActiveSession(sess.id);
      setPaneSession(0, sess.id);
      setCurrentView('terminal');
      onClose();
    },
    onError: (e) => setError(e.message),
  });

  const handleDismiss = () => {
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
      <div
        className="rounded-lg w-[360px] p-5 flex flex-col gap-4"
        style={{ backgroundColor: 'var(--bg-secondary)', border: '1px solid var(--border)' }}
      >
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-semibold" style={{ color: 'var(--text-primary)' }}>
            Resume Previous Session
          </h2>
          <button
            onClick={handleDismiss}
            className="text-lg leading-none"
            style={{ color: 'var(--text-muted)' }}
          >
            ×
          </button>
        </div>

        <div
          className="text-xs rounded px-3 py-2"
          style={{ backgroundColor: 'var(--bg-hover)', color: 'var(--text-secondary)' }}
        >
          <div className="font-medium mb-1" style={{ color: 'var(--text-primary)' }}>{session.name}</div>
          <div style={{ color: 'var(--text-muted)' }}>
            Last active session — resume with{' '}
            <span className="font-mono" style={{ color: 'var(--accent)' }}>--resume</span>
          </div>
        </div>

        {error && (
          <div
            className="text-xs px-3 py-2 rounded"
            style={{ backgroundColor: 'rgba(239,68,68,0.1)', color: '#f87171' }}
          >
            {error}
          </div>
        )}

        <div className="flex gap-2 justify-end">
          <button
            onClick={handleDismiss}
            className="px-3 py-1.5 text-xs transition-colors"
            style={{ color: 'var(--text-secondary)' }}
          >
            Start Fresh
          </button>
          <button
            onClick={() => resumeMutation.mutate({ sessionId: session.id })}
            disabled={resumeMutation.isPending}
            className="px-4 py-1.5 text-xs rounded transition-colors"
            style={{
              backgroundColor: resumeMutation.isPending ? 'var(--bg-hover)' : 'var(--accent)',
              color: resumeMutation.isPending ? 'var(--text-muted)' : '#fff',
            }}
          >
            {resumeMutation.isPending ? 'Resuming...' : 'Resume Session'}
          </button>
        </div>
      </div>
    </div>
  );
}
