'use client';

import { useEffect, useRef } from 'react';
import { registerOutputHandler } from '@/hooks/useAppInit';

interface Props {
  sessionId: string;
  isActive: boolean;
}

// Inject xterm CSS once
let xtermCssInjected = false;
function injectXtermCss() {
  if (xtermCssInjected || typeof document === 'undefined') return;
  xtermCssInjected = true;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = '/xterm.css';
  document.head.appendChild(link);
}

export function XTerminal({ sessionId, isActive }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const termRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fitAddonRef = useRef<any>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let terminal: any;
    let unregister: (() => void) | null = null;

    async function init() {
      injectXtermCss();
      const { Terminal } = await import('xterm');
      const { FitAddon } = await import('@xterm/addon-fit');

      terminal = new Terminal({
        fontFamily: 'var(--font-geist-mono), "Courier New", monospace',
        fontSize: 13,
        lineHeight: 1.4,
        theme: {
          background: '#030712',
          foreground: '#e5e7eb',
          cursor: '#60a5fa',
          selectionBackground: '#374151',
          black: '#1f2937',
          red: '#ef4444',
          green: '#22c55e',
          yellow: '#eab308',
          blue: '#3b82f6',
          magenta: '#a855f7',
          cyan: '#06b6d4',
          white: '#e5e7eb',
          brightBlack: '#374151',
          brightRed: '#f87171',
          brightGreen: '#4ade80',
          brightYellow: '#facc15',
          brightBlue: '#60a5fa',
          brightMagenta: '#c084fc',
          brightCyan: '#22d3ee',
          brightWhite: '#f9fafb',
        },
        cursorBlink: true,
        scrollback: 10000,
        allowTransparency: true,
      });

      const fitAddon = new FitAddon();
      terminal.loadAddon(fitAddon);

      if (containerRef.current) {
        terminal.open(containerRef.current);
        fitAddon.fit();
      }

      termRef.current = terminal;
      fitAddonRef.current = fitAddon;

      unregister = registerOutputHandler(sessionId, (data) => {
        terminal.write(data);
      });
    }

    init();

    return () => {
      unregister?.();
      termRef.current?.dispose();
      termRef.current = null;
      fitAddonRef.current = null;
    };
  }, [sessionId]);

  // Fit on resize
  useEffect(() => {
    if (!containerRef.current) return;

    const observer = new ResizeObserver(() => {
      fitAddonRef.current?.fit();
    });
    observer.observe(containerRef.current);

    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={containerRef}
      className="w-full h-full"
      style={{ padding: '4px' }}
    />
  );
}
