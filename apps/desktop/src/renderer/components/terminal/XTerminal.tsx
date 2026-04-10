import { useEffect, useRef, useState, useCallback, forwardRef, useImperativeHandle } from 'react';
import { registerOutputHandler } from '../../hooks/useAppInit';
import { trpc } from '../../lib/trpc';
import { trpcClient } from '../../lib/trpc-client';
import { useSettingsStore } from '../../store/settingsStore';
import { TERMINAL_THEMES } from '../../lib/terminal-themes';

interface Props {
  sessionId: string;
  isActive: boolean;
  /** pending 세션: xterm이 마운트되고 실제 cols/rows 를 측정한 후 호출 */
  onReady?: (cols: number, rows: number) => void;
  /** 세션 상태 — 'stopped'/'error' 이면 마운트 시 scrollback 복원 */
  sessionStatus?: string;
}

/** 부모 컴포넌트에서 검색 기능을 호출하기 위한 ref handle */
export interface XTerminalHandle {
  openSearch: () => void;
  closeSearch: () => void;
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

export const XTerminal = forwardRef<XTerminalHandle, Props>(function XTerminal(
  { sessionId, isActive, onReady, sessionStatus },
  ref,
) {
  const containerRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const termRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fitAddonRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const webglAddonRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const searchAddonRef = useRef<any>(null);
  const batcherRef = useRef<DataBatcher | null>(null);

  // ── F-M2-01: 터미널 검색 상태 ──────────────────────────────────────────
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [searchRegex, setSearchRegex] = useState(false);
  const [searchCaseSensitive, setSearchCaseSensitive] = useState(false);
  const [matchInfo, setMatchInfo] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);

  // ── F-M2-07: 터미널 테마/폰트 설정 ────────────────────────────────────
  const terminalTheme = useSettingsStore((s) => s.terminalTheme);
  const terminalFont = useSettingsStore((s) => s.terminalFont);
  const terminalFontSize = useSettingsStore((s) => s.terminalFontSize);

  const resizeMutation = trpc.session.resize.useMutation();

  // 검색 handle을 부모에 노출
  useImperativeHandle(ref, () => ({
    openSearch: () => {
      setSearchOpen(true);
      setTimeout(() => searchInputRef.current?.focus(), 50);
    },
    closeSearch: () => {
      setSearchOpen(false);
      setSearchText('');
      searchAddonRef.current?.clearDecorations();
    },
  }));

  // 검색 실행
  const doFindNext = useCallback(() => {
    if (!searchAddonRef.current || !searchText) return;
    const result = searchAddonRef.current.findNext(searchText, {
      regex: searchRegex,
      caseSensitive: searchCaseSensitive,
      decorations: { matchOverviewRuler: '#e07850', activeMatchColorOverviewRuler: '#ff5555' },
    });
    if (result) {
      setMatchInfo('');
    } else {
      setMatchInfo(searchText ? '0 results' : '');
    }
  }, [searchText, searchRegex, searchCaseSensitive]);

  const doFindPrevious = useCallback(() => {
    if (!searchAddonRef.current || !searchText) return;
    searchAddonRef.current.findPrevious(searchText, {
      regex: searchRegex,
      caseSensitive: searchCaseSensitive,
    });
  }, [searchText, searchRegex, searchCaseSensitive]);

  // searchText 변경 시 자동 검색
  useEffect(() => {
    if (searchOpen && searchText) {
      doFindNext();
    } else if (!searchText && searchAddonRef.current) {
      searchAddonRef.current.clearDecorations();
      setMatchInfo('');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchText, searchRegex, searchCaseSensitive]);

  // 모든 세션에서 scrollback을 로드한다.
  // - running 세션: 메모리 버퍼(최근 200KB) → 앱 재시작 후에도 이전 출력 복원
  // - stopped/error 세션: DB에 저장된 마지막 출력 복원
  const scrollbackQuery = trpc.session.getScrollback.useQuery(
    { sessionId },
    { enabled: true, retry: false, staleTime: Infinity }
  );

  /**
   * 타이밍 조정 refs:
   * - init()은 async import가 완료된 후에 termRef를 설정한다.
   * - scrollbackQuery는 init()보다 먼저 resolve될 수 있다.
   * 두 가지 순서를 모두 처리하기 위해 콜백 ref 패턴을 사용한다.
   */
  // init() 완료 후 설정되는 "scrollback write" 함수
  const applyScrollbackRef = useRef<((data: string) => void) | null>(null);
  // init() 이전에 쿼리가 resolve된 경우 임시 보관
  const pendingScrollbackRef = useRef<string | null>(null);

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
      const { SearchAddon } = await import('@xterm/addon-search');

      // async import 이후 이미 cleanup이 실행된 경우 중단.
      // React Strict Mode에서 첫 번째 effect가 cleanup된 뒤에도
      // await가 완료되면 DOM 마운트·핸들러 등록이 실행되는 것을 막는다.
      if (disposed) return;

      // F-M2-07: 설정에서 테마/폰트 적용
      const currentTheme = useSettingsStore.getState().terminalTheme;
      const currentFont = useSettingsStore.getState().terminalFont;
      const currentFontSize = useSettingsStore.getState().terminalFontSize;
      const currentScrollback = useSettingsStore.getState().scrollbackLines;
      const themeObj = TERMINAL_THEMES[currentTheme] ?? TERMINAL_THEMES['default'];

      terminal = new Terminal({
        allowProposedApi: true,
        macOptionIsMeta: false,
        fontFamily: `"${currentFont}", monospace`,
        fontSize: currentFontSize,
        lineHeight: 1.2,
        theme: themeObj,
        cursorBlink: true,
        scrollback: Math.min(currentScrollback, 20000),
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

      // F-M2-01: Search addon 로드
      const searchAddon = new SearchAddon();
      terminal.loadAddon(searchAddon);
      searchAddonRef.current = searchAddon;

      // 16ms 배칭 batcher 초기화
      const batcher = new DataBatcher((data) => terminal.write(data));
      batcherRef.current = batcher;

      termRef.current = terminal;
      fitAddonRef.current = fitAddon;

      // scrollback write 함수 등록 (이제부터 데이터 도착 시 즉시 적용 가능)
      applyScrollbackRef.current = (data: string) => {
        terminal.write(data);
        requestAnimationFrame(() => terminal.scrollToBottom());
      };

      // init() 이전에 쿼리가 resolve된 경우 지금 바로 적용
      if (pendingScrollbackRef.current) {
        applyScrollbackRef.current(pendingScrollbackRef.current);
        pendingScrollbackRef.current = null;
      }

      // 이미 실행 중인 세션에서 live output을 이어받을 때는
      // scrollback 이후의 데이터부터 수신하므로 중복 없음
      unregister = registerOutputHandler(sessionId, (data) => {
        batcher.push(data);
      });

      // IME: Electron(Chromium)에서 xterm이 한글 IME를 자체 처리.
      // composition 중 keydown(keyCode 229)만 차단해 이중 전송 방지.
      terminal.attachCustomKeyEventHandler((event: KeyboardEvent) => {
        if (event.isComposing || event.keyCode === 229) return false;
        // F-M2-01: Ctrl+F(Cmd+F) → 터미널 내 검색 열기
        if ((event.ctrlKey || event.metaKey) && event.key === 'f' && event.type === 'keydown') {
          setSearchOpen(true);
          setTimeout(() => searchInputRef.current?.focus(), 50);
          return false; // xterm이 이 키를 처리하지 않도록
        }
        return true;
      });

      // vanilla tRPC client — React Query 상태 없이 fire-and-forget 전달
      // useMutation 훅 대비 re-render 없음, tRPC 라우팅 유지
      terminal.onData((data: string) => {
        trpcClient.session.sendInput.mutate({ sessionId, text: data });
      });

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
    }

    init();

    return () => {
      disposed = true; // RAF 콜백이 onReady를 호출하지 못하도록 먼저 플래그 설정
      applyScrollbackRef.current = null;
      pendingScrollbackRef.current = null;
      unregister?.();
      // 남은 버퍼 즉시 플러시 후 정리
      batcherRef.current?.dispose();
      batcherRef.current = null;
      searchAddonRef.current = null;
      webglAddonRef.current?.dispose();
      webglAddonRef.current = null;
      termRef.current?.dispose();
      termRef.current = null;
      fitAddonRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  // scrollback 복원 — init()보다 먼저 resolve되면 pending에 보관, 이후면 즉시 write
  useEffect(() => {
    const data = scrollbackQuery.data;
    if (!data) return;
    if (applyScrollbackRef.current) {
      // init() 완료됨 → 즉시 write
      applyScrollbackRef.current(data);
      applyScrollbackRef.current = null; // 한 번만 적용
    } else {
      // init() 아직 미완료 → 대기
      pendingScrollbackRef.current = data;
    }
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
      if (!fitAddonRef.current || !termRef.current || !containerRef.current) return;
      // 컨테이너가 숨겨진 상태(visibility:hidden 또는 display:none)에서는
      // offsetWidth/Height가 0이 될 수 있으므로 fit 스킵
      if (containerRef.current.offsetWidth === 0 || containerRef.current.offsetHeight === 0) return;
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

  // F-M2-07: 테마/폰트 변경 시 실시간 반영
  useEffect(() => {
    if (!termRef.current) return;
    const themeObj = TERMINAL_THEMES[terminalTheme] ?? TERMINAL_THEMES['default'];
    termRef.current.options.theme = themeObj;
    termRef.current.options.fontFamily = `"${terminalFont}", monospace`;
    termRef.current.options.fontSize = terminalFontSize;
    // fit() 을 다시 호출해 폰트 사이즈 변경에 따른 cols/rows 재계산
    requestAnimationFrame(() => {
      fitAddonRef.current?.fit();
    });
  }, [terminalTheme, terminalFont, terminalFontSize]);

  // M8-04: 파일 드롭 → 절대 경로 자동 입력
  const [dragOver, setDragOver] = useState(false);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);

    const files = e.dataTransfer.files;
    if (files.length > 0) {
      // Electron에서 file.path로 절대 경로 접근 가능
      const filePath = (files[0] as File & { path?: string }).path;
      if (filePath && termRef.current) {
        // 공백이 포함된 경로를 따옴표로 감싸기
        const escaped = filePath.includes(' ') ? `"${filePath}"` : filePath;
        trpcClient.session.sendInput.mutate({ sessionId, text: escaped });
      }
    }
  }, [sessionId]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOver(false);
  }, []);

  return (
    <div
      className="w-full h-full relative"
      onClick={() => termRef.current?.focus()}
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
    >
      {/* M8-04: 드래그 오버 시 시각 피드백 */}
      {dragOver && (
        <div
          className="absolute inset-0 z-20 flex items-center justify-center pointer-events-none"
          style={{
            backgroundColor: 'rgba(224,120,80,0.1)',
            border: '2px dashed var(--accent)',
            borderRadius: '8px',
          }}
        >
          <span className="text-sm font-medium" style={{ color: 'var(--accent)' }}>
            파일을 드롭하여 경로 입력
          </span>
        </div>
      )}
      <div
        ref={containerRef}
        className="w-full h-full"
        style={{ padding: '4px' }}
      />

      {/* F-M2-01: 터미널 내 검색 바 오버레이 */}
      {searchOpen && (
        <div
          className="absolute top-2 right-2 flex items-center gap-1 px-2 py-1.5 rounded-lg shadow-lg z-10"
          style={{
            backgroundColor: 'var(--bg-secondary)',
            border: '1px solid var(--border)',
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <input
            ref={searchInputRef}
            type="text"
            value={searchText}
            onChange={(e) => setSearchText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && e.shiftKey) {
                e.preventDefault();
                doFindPrevious();
              } else if (e.key === 'Enter') {
                e.preventDefault();
                doFindNext();
              } else if (e.key === 'Escape') {
                e.preventDefault();
                setSearchOpen(false);
                setSearchText('');
                searchAddonRef.current?.clearDecorations();
                termRef.current?.focus();
              }
            }}
            placeholder="Search..."
            className="text-xs px-2 py-1 rounded outline-none w-40"
            style={{
              backgroundColor: 'var(--bg-primary)',
              color: 'var(--text-primary)',
              border: '1px solid var(--border)',
            }}
          />
          {matchInfo && (
            <span className="text-[10px] px-1" style={{ color: 'var(--text-muted)' }}>
              {matchInfo}
            </span>
          )}
          <button
            onClick={doFindPrevious}
            className="w-6 h-6 flex items-center justify-center rounded text-xs transition-colors"
            style={{ color: 'var(--text-secondary)' }}
            title="Previous (Shift+Enter)"
          >
            ↑
          </button>
          <button
            onClick={doFindNext}
            className="w-6 h-6 flex items-center justify-center rounded text-xs transition-colors"
            style={{ color: 'var(--text-secondary)' }}
            title="Next (Enter)"
          >
            ↓
          </button>
          <button
            onClick={() => setSearchRegex(!searchRegex)}
            className="w-6 h-6 flex items-center justify-center rounded text-[10px] font-mono transition-colors"
            style={{
              color: searchRegex ? 'var(--accent)' : 'var(--text-muted)',
              backgroundColor: searchRegex ? 'rgba(224,120,80,0.15)' : 'transparent',
            }}
            title="Regex"
          >
            .*
          </button>
          <button
            onClick={() => setSearchCaseSensitive(!searchCaseSensitive)}
            className="w-6 h-6 flex items-center justify-center rounded text-[10px] font-semibold transition-colors"
            style={{
              color: searchCaseSensitive ? 'var(--accent)' : 'var(--text-muted)',
              backgroundColor: searchCaseSensitive ? 'rgba(224,120,80,0.15)' : 'transparent',
            }}
            title="Case Sensitive"
          >
            Aa
          </button>
          <button
            onClick={() => {
              setSearchOpen(false);
              setSearchText('');
              searchAddonRef.current?.clearDecorations();
              termRef.current?.focus();
            }}
            className="w-6 h-6 flex items-center justify-center rounded text-xs transition-colors"
            style={{ color: 'var(--text-muted)' }}
            title="Close (Escape)"
          >
            x
          </button>
        </div>
      )}
    </div>
  );
});
