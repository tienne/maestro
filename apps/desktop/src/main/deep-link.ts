/**
 * Deep Link Handler — maestro:// 커스텀 프로토콜
 *
 * 지원 URL 패턴:
 *   maestro://session/:id              → 해당 세션 탭 포커스
 *   maestro://session/:id/send?text=:text  → 특정 세션에 텍스트 전송
 *   maestro://session/new?workspace=:id&agent=:agentId&cmd=:command  → 새 세션 생성 + 시작 명령
 *   maestro://workspace/:id/focus      → 워크스페이스 포커스 (좌측 사이드바 해당 레포 열기)
 *   maestro://broadcast?text=:text&label=:label → 라벨 그룹 브로드캐스트
 *   maestro://preset/:name/launch      → 프리셋 즉시 실행
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
    broadcastToRenderer('deeplink:error', { message: `Invalid URL: ${url}` });
    return;
  }

  const host = parsed.hostname; // e.g. "session", "workspace", "broadcast", "preset"
  const pathname = parsed.pathname; // e.g. "/abc-123", "/abc-123/send", "/:name/launch"
  const pathParts = pathname.replace(/^\//, '').split('/');
  const id = pathParts[0] || '';
  const action = pathParts[1] || '';
  const params = parsed.searchParams;

  bringToFront();

  switch (host) {
    case 'session':
      if (id === 'new') {
        // maestro://session/new?workspace=:id&agent=:agentId&cmd=:command
        broadcastToRenderer('deeplink:session:new', {
          workspaceId: params.get('workspace'),
          agentId: params.get('agent'),
          command: params.get('cmd'),
        });
      } else if (id && action === 'send') {
        // maestro://session/:id/send?text=:text
        const text = params.get('text');
        if (text) {
          broadcastToRenderer('deeplink:session:send', { sessionId: id, text });
        } else {
          broadcastToRenderer('deeplink:error', { message: 'text parameter is required for session send' });
        }
      } else if (id) {
        // maestro://session/:id → 세션 포커스
        broadcastToRenderer('deeplink:session', { sessionId: id });
      }
      break;

    case 'workspace':
      if (id && action === 'focus') {
        // maestro://workspace/:id/focus
        broadcastToRenderer('deeplink:workspace:focus', { workspaceId: id });
      } else if (id) {
        // maestro://workspace/:id (기존 호환)
        broadcastToRenderer('deeplink:workspace', { workspaceId: id });
      }
      break;

    case 'broadcast': {
      // maestro://broadcast?text=:text&label=:label
      const text = params.get('text');
      const label = params.get('label');
      if (text) {
        broadcastToRenderer('deeplink:broadcast', { text, label: label || undefined });
      } else {
        broadcastToRenderer('deeplink:error', { message: 'text parameter is required for broadcast' });
      }
      break;
    }

    case 'preset': {
      // maestro://preset/:name/launch
      if (id && action === 'launch') {
        broadcastToRenderer('deeplink:preset:launch', { presetName: id });
      } else {
        broadcastToRenderer('deeplink:error', { message: `Unknown preset action: ${action}` });
      }
      break;
    }

    default:
      log.warn('[DeepLink] Unknown host:', host);
      broadcastToRenderer('deeplink:error', { message: `Unknown protocol host: ${host}` });
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
