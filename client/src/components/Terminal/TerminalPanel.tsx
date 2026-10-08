import React, { useEffect, useRef, useState, useCallback } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';

const SESSION_STORAGE_KEY = 'mave-terminal-sessionId';

export default function TerminalPanel({
  isVisible,
  onClose,
}: {
  isVisible: boolean;
  onClose: () => void;
}) {
  const terminalRef = useRef<HTMLDivElement>(null);
  const term = useRef<Terminal | null>(null);
  const fitAddon = useRef<FitAddon | null>(null);
  const socketRef = useRef<ReturnType<typeof import('socket.io-client')['io']> | null>(null);

  // Sticky modifier state
  const [ctrlActive, setCtrlActive] = useState(false);
  const [altActive, setAltActive] = useState(false);

  // Sends data through the socket
  const sendInput = useCallback((data: string) => {
    socketRef.current?.emit('terminal-input', data);
  }, []);

  // Handle a key press, applying sticky Ctrl/Alt modifiers
  const handleKey = useCallback(
    (data: string) => {
      if (ctrlActive) {
        // Ctrl + letter: char code & 0x1f
        const ch = data.toLowerCase();
        if (ch >= 'a' && ch <= 'z') {
          sendInput(String.fromCharCode(ch.charCodeAt(0) & 0x1f));
        } else {
          sendInput(data);
        }
        setCtrlActive(false);
      } else if (altActive) {
        // Alt sends ESC prefix
        sendInput('\x1b' + data);
        setAltActive(false);
      } else {
        sendInput(data);
      }
    },
    [ctrlActive, altActive, sendInput],
  );

  // Boot xterm once on first mount
  useEffect(() => {
    if (!terminalRef.current || term.current) return;

    const t = new Terminal({
      cursorBlink: true,
      theme: { background: '#1e1e1e', foreground: '#f3f3f3' },
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      fontSize: 14,
    });
    const fit = new FitAddon();
    t.loadAddon(fit);
    t.open(terminalRef.current);
    fit.fit();

    term.current = t;
    fitAddon.current = fit;

    // Connect via socket.io
    import('socket.io-client').then(({ io }) => {
      const savedSession = localStorage.getItem(SESSION_STORAGE_KEY) || '';

      const socket = io(window.location.origin, {
        path: '/api/terminal-socket/',
        transports: ['websocket', 'polling'],
        query: savedSession ? { sessionId: savedSession } : {},
      });

      socketRef.current = socket;

      socket.on('connect', () => {
        t.write('\r\n\x1b[32m✓ Connected to Mave Agent Terminal\x1b[0m\r\n');
        fit.fit();
        socket.emit('terminal-resize', { cols: t.cols, rows: t.rows });
      });

      // Server assigns/confirms sessionId — persist it
      socket.on('session-id', (id: string) => {
        localStorage.setItem(SESSION_STORAGE_KEY, id);
      });
      socket.on('connected', (payload: { sessionId: string }) => {
        localStorage.setItem(SESSION_STORAGE_KEY, payload.sessionId);
      });

      socket.on('connect_error', (err: Error) => {
        t.write(`\r\n\x1b[31m✗ Connection error: ${err.message}\x1b[0m\r\n`);
      });

      socket.on('terminal-output', (data: string) => {
        t.write(data);
      });

      t.onData((data) => {
        socket.emit('terminal-input', data);
      });
    });

    return () => {
      t.dispose();
      term.current = null;
      socketRef.current?.disconnect();
      socketRef.current = null;
    };
  }, []);

  // Refit whenever visibility changes or viewport changes (keyboard on mobile, resize)
  useEffect(() => {
    if (!isVisible || !fitAddon.current || !term.current) return;

    const refit = () => {
      fitAddon.current?.fit();
      socketRef.current?.emit('terminal-resize', {
        cols: term.current?.cols ?? 80,
        rows: term.current?.rows ?? 24,
      });
    };

    // Small delay so the CSS transition finishes before measuring
    const tid = setTimeout(refit, 50);
    window.addEventListener('resize', refit);

    const vv = window.visualViewport;
    vv?.addEventListener('resize', refit);
    vv?.addEventListener('scroll', refit);

    return () => {
      clearTimeout(tid);
      window.removeEventListener('resize', refit);
      vv?.removeEventListener('resize', refit);
      vv?.removeEventListener('scroll', refit);
    };
  }, [isVisible]);

  if (!isVisible) return null;

  // ─── Extra-keys bar definition ───
  const extraKeys: Array<{ label: string; action: () => void; sticky?: boolean; active?: boolean }> =
    [
      { label: 'Esc', action: () => handleKey('\x1b') },
      { label: 'Tab', action: () => handleKey('\t') },
      { label: '↑', action: () => sendInput('\x1b[A') },
      { label: '↓', action: () => sendInput('\x1b[B') },
      { label: '←', action: () => sendInput('\x1b[D') },
      { label: '→', action: () => sendInput('\x1b[C') },
      { label: '|', action: () => handleKey('|') },
      { label: '~', action: () => handleKey('~') },
      { label: '/', action: () => handleKey('/') },
      { label: '-', action: () => handleKey('-') },
      { label: 'C-c', action: () => sendInput('\x03') },
      { label: 'C-d', action: () => sendInput('\x04') },
      { label: 'C-l', action: () => sendInput('\x0c') },
      {
        label: 'Ctrl',
        action: () => {
          setCtrlActive((v) => !v);
          setAltActive(false);
        },
        sticky: true,
        active: ctrlActive,
      },
      {
        label: 'Alt',
        action: () => {
          setAltActive((v) => !v);
          setCtrlActive(false);
        },
        sticky: true,
        active: altActive,
      },
    ];

  return (
    /* Fullscreen overlay */
    <div
      style={{
        position: 'fixed',
        inset: 0,
        height: '100dvh',
        width: '100dvw',
        zIndex: 9999,
        display: 'flex',
        flexDirection: 'column',
        background: '#1e1e1e',
      }}
    >
      {/* macOS-style title bar */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '8px 16px',
          background: '#2d2d2d',
          borderBottom: '1px solid #111',
          flexShrink: 0,
        }}
      >
        {/* Traffic-light dots */}
        <div style={{ display: 'flex', gap: 6 }}>
          <button
            aria-label="Close terminal"
            onClick={onClose}
            style={{
              width: 12,
              height: 12,
              borderRadius: '50%',
              background: '#ff5f56',
              border: 'none',
              cursor: 'pointer',
              padding: 0,
            }}
          />
          <div style={{ width: 12, height: 12, borderRadius: '50%', background: '#ffbd2e' }} />
          <div style={{ width: 12, height: 12, borderRadius: '50%', background: '#27c93f' }} />
        </div>

        {/* Centred avatar + title */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            position: 'absolute',
            left: '50%',
            transform: 'translateX(-50%)',
          }}
        >
          <img
            src="/assets/mave.jpg"
            alt="Mave"
            style={{ width: 22, height: 22, borderRadius: '50%', border: '1px solid #555' }}
          />
          <span style={{ fontSize: 12, fontWeight: 600, color: '#ccc', letterSpacing: 1 }}>
            Mave Agent Terminal
          </span>
        </div>

        {/* Close button (right side) */}
        <button
          onClick={onClose}
          aria-label="Close terminal"
          style={{
            background: 'transparent',
            border: '1px solid #555',
            color: '#aaa',
            borderRadius: 4,
            padding: '2px 10px',
            cursor: 'pointer',
            fontSize: 12,
          }}
        >
          ✕ Close
        </button>
      </div>

      {/* xterm.js container — takes all remaining space */}
      <div ref={terminalRef} style={{ flex: 1, overflow: 'hidden', padding: '4px 8px' }} />

      {/* ─── Extra-keys bar ─── */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 4,
          padding: '6px 8px',
          background: '#2d2d2d',
          borderTop: '1px solid #444',
          flexShrink: 0,
        }}
      >
        {extraKeys.map((k) => (
          <button
            key={k.label}
            // onPointerDown + preventDefault keeps the soft-keyboard open on mobile
            onPointerDown={(e) => {
              e.preventDefault();
              k.action();
              // Re-focus xterm so regular typing continues
              term.current?.focus();
            }}
            style={{
              background: k.active ? '#4a9eff' : '#3a3a3a',
              color: k.active ? '#fff' : '#ddd',
              border: k.active ? '1px solid #6ab0ff' : '1px solid #555',
              borderRadius: 4,
              padding: '4px 10px',
              fontSize: 13,
              fontFamily: 'monospace',
              cursor: 'pointer',
              minWidth: 34,
              textAlign: 'center',
              userSelect: 'none',
              WebkitTapHighlightColor: 'transparent',
            }}
          >
            {k.label}
          </button>
        ))}
      </div>
    </div>
  );
}
