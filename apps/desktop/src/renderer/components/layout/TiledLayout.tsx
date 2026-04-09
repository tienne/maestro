import React, { useCallback } from 'react';
import { Mosaic, MosaicWindow } from 'react-mosaic-component';
import 'react-mosaic-component/react-mosaic-component.css';
import { useLayoutStore, type PaneId } from '../../store/layoutStore';
import { useSessionStore } from '../../store/sessionStore';
import { XTerminal } from '../terminal/XTerminal';
import { trpc } from '../../lib/trpc';
import { sendToTerminal } from '../../hooks/useAppInit';
import type { Session } from '@maestro/shared-types';

function TerminalPane({ paneId }: { paneId: PaneId }) {
  const { sessions, updateSession } = useSessionStore();
  const session = sessions.find((s) => s.id === paneId);

  const launchMutation = trpc.session.launch.useMutation({
    onSuccess: (s) => updateSession(s as Session),
    onError: (err, vars) => {
      const msg = `\r\n\x1b[31m[Launch Error] ${err.message}\x1b[0m\r\n`;
      sendToTerminal(vars.sessionId, msg);
    },
  });

  const onReady = useCallback(
    (cols: number, rows: number) => {
      sendToTerminal(paneId, '\x1b[2m[Connecting...]\x1b[0m\r\n');
      launchMutation.mutate({ sessionId: paneId, cols, rows });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [paneId],
  );

  if (!session) {
    return (
      <div
        className="h-full flex items-center justify-center text-sm"
        style={{ color: 'var(--text-muted)' }}
      >
        Session not found
      </div>
    );
  }

  return (
    <XTerminal
      sessionId={paneId}
      isActive={true}
      onReady={session.status === 'pending' ? onReady : undefined}
    />
  );
}

export function TiledLayout(): React.ReactElement {
  const { mosaicState, setMosaicState } = useLayoutStore();

  return (
    // eslint-disable-next-line @typescript-eslint/ban-ts-comment
    // @ts-ignore — react-mosaic-component refs type incompatibility with React 19
    <Mosaic<PaneId>
      renderTile={(id, path) => (
        // @ts-ignore
        <MosaicWindow<PaneId>
          path={path}
          title={id}
          createNode={() => crypto.randomUUID()}
        >
          <TerminalPane paneId={id} />
        </MosaicWindow>
      )}
      value={mosaicState}
      onChange={setMosaicState}
      className="maestro-mosaic"
    />
  );
}
