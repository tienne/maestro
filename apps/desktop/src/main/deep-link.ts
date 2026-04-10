/**
 * Deep Link Handler — maestro:// 커스텀 프로토콜
 *
 * 지원 URL 패턴:
 *   maestro://session/:id              → 해당 세션 탭 포커스
 *   maestro://session/new?workspace=:id&agent=:id  → 새 세션 생성 (미구현, 추후 확장)
 *   maestro://workspace/:id            → 워크스페이스 활성화
 *   maestro://broadcast?text=:text     → 브로드캐스트 입력 전송
 */

import { app, BrowserWindow } from 'electron';
import log from 'electron-log';

function broadcastToRenderer(channel: string, payload?: unknown): void {
  BrowserWindow.getAllWindows().forEach((w) => w.webContents.send(channel, payload));
}

function bringToFront(): void {
  const win = BrowserWindow.getAllWindows()[0];
  if (!win) return;
  if (win.isMinimized()) win.restore();
  win.focus();
}

function handleDeepLink(url: string): void {
  log.info('[DeepLink] Received:', url);

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    log.warn('[DeepLink] Invalid URL:', url);
    return;
  }

  const host = parsed.hostname; // e.g. "session", "workspace", "broadcast"
  const pathname = parsed.pathname; // e.g. "/abc-123"
  const id = pathname.replace(/^\//, '');
  const params = parsed.searchParams;

  bringToFront();

  switch (host) {
    case 'session':
      if (id && id !== 'new') {
        broadcastToRenderer('deeplink:session', { sessionId: id });
      } else if (id === 'new') {
        broadcastToRenderer('deeplink:session:new', {
          workspaceId: params.get('workspace'),
          agentId: params.get('agent'),
        });
      }
      break;

    case 'workspace':
      if (id) {
        broadcastToRenderer('deeplink:workspace', { workspaceId: id });
      }
      break;

    case 'broadcast': {
      const text = params.get('text');
      if (text) {
        broadcastToRenderer('deeplink:broadcast', { text });
      }
      break;
    }

    default:
      log.warn('[DeepLink] Unknown host:', host);
  }
}

export function setupDeepLink(): void {
  // macOS/Linux: 프로토콜 클라이언트 등록
  if (!app.isDefaultProtocolClient('maestro')) {
    app.setAsDefaultProtocolClient('maestro');
    log.info('[DeepLink] Registered maestro:// protocol');
  }

  // macOS: open-url 이벤트
  app.on('open-url', (event, url) => {
    event.preventDefault();
    handleDeepLink(url);
  });

  // Windows: second-instance 이벤트 (단일 인스턴스 강제)
  app.on('second-instance', (_event, argv) => {
    const url = argv.find((arg) => arg.startsWith('maestro://'));
    if (url) handleDeepLink(url);
    bringToFront();
  });
}
