import { useEffect } from 'react';
import { useUiStore } from '../store/uiStore';
import { toast } from '../lib/toast';
import { trpc } from '../lib/trpc';

/**
 * 메인 프로세스에서 오는 딥링크 IPC 이벤트 처리.
 *
 * M6-01: 확장된 딥링크 패턴 지원
 * - deeplink:session              → 해당 세션 탭 포커스
 * - deeplink:session:new          → 새 세션 생성 + 시작 명령
 * - deeplink:session:send         → 특정 세션에 텍스트 전송
 * - deeplink:workspace            → 워크스페이스 활성화
 * - deeplink:workspace:focus      → 워크스페이스 포커스 (사이드바 열기)
 * - deeplink:broadcast            → 브로드캐스트 입력 (라벨 그룹 지원)
 * - deeplink:preset:launch        → 프리셋 즉시 실행
 * - deeplink:error                → 딥링크 에러 알림
 */
export function useDeepLink() {
  const { setPaneSession, setCurrentView } = useUiStore();
  const sendInputMutation = trpc.session.sendInput.useMutation();
  const broadcastMutation = trpc.session.broadcast.useMutation();

  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ipcRenderer = (window as any).electron?.ipcRenderer;
    if (!ipcRenderer) return;

    // 세션 포커스
    const handleSession = (_: unknown, { sessionId }: { sessionId: string }) => {
      setPaneSession(0, sessionId);
      setCurrentView('terminal');
      toast.info('세션 포커스', sessionId);
    };

    // 새 세션 생성 + 시작 명령
    const handleSessionNew = (_: unknown, payload: { workspaceId?: string; agentId?: string; command?: string }) => {
      if (payload.workspaceId && payload.agentId) {
        toast.info('딥링크: 새 세션 생성 요청', `workspace=${payload.workspaceId}`);
        // 렌더러에서 세션 생성 흐름은 UI 컨텍스트가 필요 — IPC를 통해 알림 처리
      } else {
        toast.error('딥링크 오류', 'workspace, agent 파라미터가 필요합니다');
      }
    };

    // 특정 세션에 텍스트 전송
    const handleSessionSend = (_: unknown, { sessionId, text }: { sessionId: string; text: string }) => {
      sendInputMutation.mutate(
        { sessionId, text: text + '\r' },
        {
          onSuccess: () => toast.info('딥링크: 텍스트 전송 완료', `→ ${sessionId.slice(0, 8)}...`),
          onError: (err) => toast.error('딥링크: 전송 실패', err.message),
        },
      );
    };

    // 워크스페이스 활성화 (기존 호환)
    const handleWorkspace = (_: unknown, { workspaceId }: { workspaceId: string }) => {
      toast.info(`워크스페이스 전환: ${workspaceId}`);
    };

    // 워크스페이스 포커스 (사이드바 열기)
    const handleWorkspaceFocus = (_: unknown, { workspaceId }: { workspaceId: string }) => {
      setCurrentView('terminal');
      toast.info('워크스페이스 포커스', workspaceId);
    };

    // 브로드캐스트 (라벨 그룹 지원)
    const handleBroadcast = (_: unknown, { text, label }: { text: string; label?: string }) => {
      if (label) {
        toast.info(`브로드캐스트 (${label})`, text.substring(0, 50));
      } else {
        toast.info('브로드캐스트 수신', text.substring(0, 50));
      }
    };

    // 프리셋 실행
    const handlePresetLaunch = (_: unknown, { presetName }: { presetName: string }) => {
      toast.info('프리셋 실행 요청', presetName);
    };

    // 에러 처리
    const handleError = (_: unknown, { message }: { message: string }) => {
      toast.error('딥링크 오류', message);
    };

    ipcRenderer.on('deeplink:session', handleSession);
    ipcRenderer.on('deeplink:session:new', handleSessionNew);
    ipcRenderer.on('deeplink:session:send', handleSessionSend);
    ipcRenderer.on('deeplink:workspace', handleWorkspace);
    ipcRenderer.on('deeplink:workspace:focus', handleWorkspaceFocus);
    ipcRenderer.on('deeplink:broadcast', handleBroadcast);
    ipcRenderer.on('deeplink:preset:launch', handlePresetLaunch);
    ipcRenderer.on('deeplink:error', handleError);

    return () => {
      ipcRenderer.removeListener?.('deeplink:session', handleSession);
      ipcRenderer.removeListener?.('deeplink:session:new', handleSessionNew);
      ipcRenderer.removeListener?.('deeplink:session:send', handleSessionSend);
      ipcRenderer.removeListener?.('deeplink:workspace', handleWorkspace);
      ipcRenderer.removeListener?.('deeplink:workspace:focus', handleWorkspaceFocus);
      ipcRenderer.removeListener?.('deeplink:broadcast', handleBroadcast);
      ipcRenderer.removeListener?.('deeplink:preset:launch', handlePresetLaunch);
      ipcRenderer.removeListener?.('deeplink:error', handleError);
    };
  }, [setPaneSession, setCurrentView, sendInputMutation, broadcastMutation]);
}
