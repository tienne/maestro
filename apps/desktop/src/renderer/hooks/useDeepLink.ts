import { useEffect } from 'react';
import { useUiStore } from '../store/uiStore';
import { toast } from '../lib/toast';

/**
 * 메인 프로세스에서 오는 딥링크 IPC 이벤트 처리.
 * - deeplink:session → 해당 세션 탭 포커스
 * - deeplink:workspace → 워크스페이스 활성화 (미구현, 토스트 안내)
 * - deeplink:broadcast → 브로드캐스트 입력 (미구현, 토스트 안내)
 */
export function useDeepLink() {
  const { setPaneSession } = useUiStore();

  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ipcRenderer = (window as any).electron?.ipcRenderer;
    if (!ipcRenderer) return;

    const handleSession = (_: unknown, { sessionId }: { sessionId: string }) => {
      setPaneSession(0, sessionId);
      toast.info('세션 포커스', sessionId);
    };

    const handleWorkspace = (_: unknown, { workspaceId }: { workspaceId: string }) => {
      toast.info(`워크스페이스 전환: ${workspaceId}`);
    };

    const handleBroadcast = (_: unknown, { text }: { text: string }) => {
      toast.info('브로드캐스트 수신', text.substring(0, 50));
    };

    ipcRenderer.on('deeplink:session', handleSession);
    ipcRenderer.on('deeplink:workspace', handleWorkspace);
    ipcRenderer.on('deeplink:broadcast', handleBroadcast);

    return () => {
      ipcRenderer.removeListener?.('deeplink:session', handleSession);
      ipcRenderer.removeListener?.('deeplink:workspace', handleWorkspace);
      ipcRenderer.removeListener?.('deeplink:broadcast', handleBroadcast);
    };
  }, [setPaneSession]);
}
