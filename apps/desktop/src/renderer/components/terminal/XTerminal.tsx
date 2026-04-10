import { useEffect, useRef } from 'react';
import { registerOutputHandler } from '../../hooks/useAppInit';
import { trpc } from '../../lib/trpc';

interface Props {
  sessionId: string;
  isActive: boolean;
  /** pending 세션: xterm이 마운트되고 실제 cols/rows 를 측정한 후 호출 */
  onReady?: (cols: number, rows: number) => void;
  /** 세션 상태 — 'stopped'/'error' 이면 마운트 시 scrollback 복원 */
  sessionStatus?: string;
}

// 150ms 타임 기반 디바운스
function debounce<T extends (...args: unknown[]) => void>(fn: T, ms: number) {
  let timer: ReturnType<typeof setTimeout>;
  const debounced = (...args: Parameters<T>) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
  debounced.cancel = () => clearTimeout(timer);
  return debounced;
}

/**
 * 16ms rAF 기반 데이터 배칭 — 출력 데이터를 한 프레임 단위로 묶어
 * terminal.write() 호출 횟수를 줄이고 렌더링 스루풋을 높인다.
 */
class DataBatcher {
  private buffer = '';
  private timer: number | null = null;
  private readonly BATCH_MS = 16;
  private readonly MAX_SIZE = 200 * 1024; // 200KB

  constructor(private readonly flush: (data: string) => void) {}

  push(data: string): void {
    this.buffer += data;
    // 버퍼 크기 초과 시 즉시 플러시 (backpressure 방지)
    if (this.buffer.length >= this.MAX_SIZE) {
      this.forceFlush();
      return;
    }
    // 타이머가 없으면 다음 rAF에 플러시 예약
    if (this.timer === null) {
      this.timer = requestAnimationFrame(() => this.forceFlush()) as unknown as number;
    }
  }

  private forceFlush(): void {
    if (this.timer !== null) {
      cancelAnimationFrame(this.timer);
      this.timer = null;
    }
    if (this.buffer.length > 0) {
      const data = this.buffer;
      this.buffer = '';
      this.flush(data);
    }
  }

  dispose(): void {
    this.forceFlush();
  }
}

export function XTerminal({ sessionId, isActive, onReady, sessionStatus }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const termRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fitAddonRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const webglAddonRef = useRef<any>(null);
  const batcherRef = useRef<DataBatcher | null>(null);

  const resizeMutation = trpc.session.resize.useMutation();
  const sendInputMutation = trpc.session.sendInput.useMutation();

  // 종료된 세션의 스크롤백 복원 (running 세션은 실시간 출력으로 채워짐)
  const scrollbackQuery = trpc.session.getScrollback.useQuery(
    { sessionId },
    { enabled: sessionStatus === 'stopped' || sessionStatus === 'error', retry: false }
  );

  useEffect(() => {
    if (!containerRef.current) return;

    // React Strict Mode(dev)에서 effect가 2회 실행되는 것을 막는 플래그.
    // cleanup이 실행된 후에도 RAF 콜백이 늦게 실행될 수 있으므로,
    // disposed=true가 되면 onReady를 절대 호출하지 않는다.
    let disposed = false;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let terminal: any;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let webgl: any;
    let unregister: (() => void) | null = null;

    async function init() {
      const { Terminal } = await import('@xterm/xterm');
      const { FitAddon } = await import('@xterm/addon-fit');
      const { WebglAddon } = await import('@xterm/addon-webgl');

      // async import 이후 이미 cleanup이 실행된 경우 중단.
      // React Strict Mode에서 첫 번째 effect가 cleanup된 뒤에도
      // await가 완료되면 DOM 마운트·핸들러 등록이 실행되는 것을 막는다.
      if (disposed) return;

      terminal = new Terminal({
        allowProposedApi: true,
        macOptionIsMeta: false,
        fontFamily: '"Courier New", monospace',
        fontSize: 13,
        lineHeight: 1.2,
        theme: {
          // ── Warm Dark — Maestro 앱 팔레트 기반 ──────────────────────────
          background:          '#0e0c0b', // --terminal-bg
          foreground:          '#eae8e6', // --text-primary
          cursor:              '#e07850', // --accent (오렌지)
          cursorAccent:        '#0e0c0b',
          selectionBackground: '#3d3330', // --bg-hover 계열 따뜻한 갈색

          // ANSI normal (따뜻한 톤으로 재조율)
          black:   '#1a1716', // --bg-secondary
          red:     '#d95f49', // 따뜻한 적색
          green:   '#6aab4a', // 올리브 그린
          yellow:  '#c89a3a', // 앰버
          blue:    '#5588c8', // 탁한 블루 (차갑지 않게)
          magenta: '#a068c0', // 따뜻한 퍼플
          cyan:    '#4da8a0', // 틸 (따뜻한 언더톤)
          white:   '#c8c5c2', // --text-secondary 계열

          // ANSI bright
          brightBlack:   '#4a4542', // --text-muted 계열
          brightRed:     '#f07058', // 액센트와 유사한 따뜻한 적색
          brightGreen:   '#88c860',
          brightYellow:  '#e8b848',
          brightBlue:    '#70a0e0',
          brightMagenta: '#c888e0',
          brightCyan:    '#68c8c0',
          brightWhite:   '#eae8e6', // --text-primary
        },
        cursorBlink: true,
        scrollback: 5000,
        allowTransparency: true,
      });

      const fitAddon = new FitAddon();
      terminal.loadAddon(fitAddon);

      const containerEl = containerRef.current;
      if (!containerEl) return;

      // terminal.open() 먼저 호출한 후 WebGL 어댑터 로드
      terminal.open(containerEl);

      // WebGL 렌더러 적용 — Canvas 2D 대비 GPU 가속으로 렌더링 성능 향상
      webgl = new WebglAddon();
      webgl.onContextLoss(() => {
        // WebGL 컨텍스트 손실(전력 관리, GPU 리셋 등) 시 graceful 폴백
        console.warn('[XTerminal] WebGL context lost — falling back to canvas renderer');
        webgl.dispose();
        webglAddonRef.current = null;
      });
      terminal.loadAddon(webgl);
      webglAddonRef.current = webgl;

      // 16ms 배칭 batcher 초기화
      const batcher = new DataBatcher((data) => terminal.write(data));
      batcherRef.current = batcher;

      termRef.current = terminal;
      fitAddonRef.current = fitAddon;

      // 레이아웃 완전 정착 후 초기 크기 전송 (double RAF)
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          // disposed=true면 이미 cleanup이 실행된 것 — onReady 절대 호출 금지
          if (disposed || !fitAddon || !terminal) return;
          fitAddon.fit();
          const { rows, cols } = terminal;
          if (onReady) {
            // pending 세션: 측정된 크기로 PTY 를 시작한다
            onReady(cols, rows);
          } else {
            // 이미 실행 중인 세션: 크기 보정 SIGWINCH 전송
            resizeMutation.mutate({ sessionId, cols, rows });
          }
          if (isActive) terminal.focus();
        });
      });

      // IME: Electron(Chromium)에서 xterm이 한글 IME를 자체 처리.
      // composition 중 keydown(keyCode 229)만 차단해 이중 전송 방지.
      terminal.attachCustomKeyEventHandler((event: KeyboardEvent) => {
        if (event.isComposing || event.keyCode === 229) return false;
        return true;
      });

      terminal.onData((data: string) => {
        sendInputMutation.mutate({ sessionId, text: data });
      });

      // 출력 데이터를 batcher를 통해 16ms 단위로 묶어 terminal.write() 호출
      unregister = registerOutputHandler(sessionId, (data) => {
        batcher.push(data);
      });
    }

    init();

    return () => {
      disposed = true; // RAF 콜백이 onReady를 호출하지 못하도록 먼저 플래그 설정
      unregister?.();
      // 남은 버퍼 즉시 플러시 후 정리
      batcherRef.current?.dispose();
      batcherRef.current = null;
      webglAddonRef.current?.dispose();
      webglAddonRef.current = null;
      termRef.current?.dispose();
      termRef.current = null;
      fitAddonRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  // 종료 세션 scrollback 복원 — 데이터가 로드되고 terminal이 준비된 후 한 번만 write
  useEffect(() => {
    const data = scrollbackQuery.data;
    if (!data || !termRef.current) return;
    termRef.current.write(data);
    // 복원 후 스크롤 최하단으로
    requestAnimationFrame(() => termRef.current?.scrollToBottom());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scrollbackQuery.data]);

  // 탭 전환 시: 크기가 바뀐 경우에만 SIGWINCH, 항상 스크롤 최하단 + 포커스
  useEffect(() => {
    if (!isActive) return;
    requestAnimationFrame(() => {
      if (!fitAddonRef.current || !termRef.current) return;
      const prevRows = termRef.current.rows;
      const prevCols = termRef.current.cols;
      fitAddonRef.current.fit();
      const { rows, cols } = termRef.current;
      if (rows !== prevRows || cols !== prevCols) {
        resizeMutation.mutate({ sessionId, rows, cols });
      }
      termRef.current.scrollToBottom();
      termRef.current.focus();
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isActive, sessionId]);

  // 윈도우/패널 리사이즈: rows/cols 실제 변경 시에만 SIGWINCH
  useEffect(() => {
    if (!containerRef.current) return;

    const handleResize = debounce(() => {
      if (!fitAddonRef.current || !termRef.current) return;
      // wasAtBottom: fit 전에 측정해야 정확
      const buffer = termRef.current.buffer?.active;
      const wasAtBottom = !buffer || buffer.viewportY >= buffer.baseY;
      const prevRows = termRef.current.rows;
      const prevCols = termRef.current.cols;
      fitAddonRef.current.fit();
      const { rows, cols } = termRef.current;
      if (rows !== prevRows || cols !== prevCols) {
        resizeMutation.mutate({ sessionId, rows, cols });
        if (wasAtBottom) {
          requestAnimationFrame(() => termRef.current?.scrollToBottom());
        }
      }
    }, 150);

    const observer = new ResizeObserver(handleResize);
    observer.observe(containerRef.current);
    window.addEventListener('resize', handleResize);

    return () => {
      observer.disconnect();
      window.removeEventListener('resize', handleResize);
      handleResize.cancel();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  return (
    <div
      ref={containerRef}
      className="w-full h-full"
      style={{ padding: '4px' }}
      onClick={() => termRef.current?.focus()}
    />
  );
}
