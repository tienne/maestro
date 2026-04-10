import { useEffect, useState } from 'react';

interface UpdateInfo {
  version: string;
}

/**
 * 앱 상단 고정 업데이트 배너.
 * - 'updater:available' IPC 수신 시 표시
 * - "지금 재시작" 클릭 → 메인 프로세스에 'updater:install' 전송
 * - "나중에" 클릭으로 닫기 가능
 */
export function UpdateBanner() {
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ipcRenderer = (window as any).electron?.ipcRenderer;
    if (!ipcRenderer) return;

    const handleAvailable = (_: unknown, info: UpdateInfo) => {
      setUpdateInfo(info);
      setDismissed(false);
    };

    ipcRenderer.on('updater:available', handleAvailable);
    return () => ipcRenderer.removeListener?.('updater:available', handleAvailable);
  }, []);

  const handleInstall = () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).electron?.ipcRenderer?.send('updater:install');
  };

  if (!updateInfo || dismissed) return null;

  return (
    <div
      className="flex items-center justify-between px-4 py-1.5 text-xs flex-shrink-0"
      style={{ backgroundColor: 'var(--accent)', color: '#fff' }}
    >
      <span>
        새 버전 <strong>v{updateInfo.version}</strong>을 다운로드했습니다.
      </span>
      <div className="flex items-center gap-3">
        <button
          onClick={handleInstall}
          className="font-semibold underline underline-offset-2"
        >
          지금 재시작
        </button>
        <button
          onClick={() => setDismissed(true)}
          className="opacity-70 hover:opacity-100 transition-opacity"
        >
          나중에
        </button>
      </div>
    </div>
  );
}
