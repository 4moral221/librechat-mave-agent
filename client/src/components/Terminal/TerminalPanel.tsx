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
  const [shiftActive, setShiftActive] = useState(false);

  // Sends data through the socket
  const sendInput = useCallback((data: string) => {
    socketRef.current?.emit('terminal-input', data);
  }, []);

  // Handle a key press, applying sticky Ctrl/Alt/Shift modifiers
  const handleKey = useCallback(
    (data: string, bypassModifiers: boolean = false) => {
      let output = data;

      if (!bypassModifiers) {
        if (shiftActive && data.length === 1 && data >= 'a' && data <= 'z') {
          output = data.toUpperCase();
        }
        
        if (ctrlActive) {
          // Ctrl + letter: char code & 0x1f
          const ch = output.toLowerCase();
          if (ch >= 'a' && ch <= 'z') {
            output = String.fromCharCode(ch.charCodeAt(0) & 0x1f);
          }
          setCtrlActive(false);
        } else if (altActive) {
          // Alt sends ESC prefix
          output = '\x1b' + output;
          setAltActive(false);
        }
      }

      sendInput(output);
      if (!bypassModifiers) {
        setShiftActive(false); // Reset shift after 1 character usually, or keep it sticky? Let's reset.
      }
    },
    [ctrlActive, altActive, shiftActive, sendInput],
  );

  const initTerminal = useCallback(() => {
    if (term.current) {
      term.current.dispose();
      term.current = null;
    }
    if (socketRef.current) {
      socketRef.current.disconnect();
      socketRef.current = null;
    }

    if (!terminalRef.current) return;

    const t = new Terminal({
      cursorBlink: true,
      theme: { background: '#1e1e1e', foreground: '#f3f3f3' },
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      fontSize: 13,
      scrollback: 5000, // Make sure scrolling works well
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

      socket.on('session-killed', () => {
        t.write('\r\n\x1b[33mSession ended by user.\x1b[0m\r\n');
        localStorage.removeItem(SESSION_STORAGE_KEY);
      });

      t.onData((data) => {
        socket.emit('terminal-input', data);
      });
    });
  }, []);

  // Boot xterm once on first mount
  useEffect(() => {
    initTerminal();
    return () => {
      term.current?.dispose();
      term.current = null;
      socketRef.current?.disconnect();
      socketRef.current = null;
    };
  }, [initTerminal]);

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

  // Session Handlers
  const handleNewSession = () => {
    localStorage.removeItem(SESSION_STORAGE_KEY);
    initTerminal();
  };

  const handleEndSession = () => {
    socketRef.current?.emit('kill-session');
    localStorage.removeItem(SESSION_STORAGE_KEY);
  };

  // Keyboard layout builder
  const renderKey = (label: string, action: () => void, isActive?: boolean, flex?: number) => (
    <button
      key={label}
      onPointerDown={(e) => {
        e.preventDefault();
        action();
        term.current?.focus();
      }}
      style={{
        background: isActive ? '#4a9eff' : '#3a3a3a',
        color: isActive ? '#fff' : '#ddd',
        border: isActive ? '1px solid #6ab0ff' : '1px solid #555',
        borderRadius: 4,
        padding: '6px 4px',
        fontSize: 13,
        fontFamily: 'monospace',
        cursor: 'pointer',
        flex: flex || 1,
        minWidth: flex ? 'auto' : 30,
        textAlign: 'center',
        userSelect: 'none',
        WebkitTapHighlightColor: 'transparent',
      }}
    >
      {label}
    </button>
  );

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
        {/* Actions (Left side) */}
        <div style={{ display: 'flex', gap: 8 }}>
          <button
            onClick={handleNewSession}
            style={{
              background: '#4CAF50', color: '#fff', border: 'none', borderRadius: 4, padding: '4px 8px', cursor: 'pointer', fontSize: 12
            }}
          >
            + New Session
          </button>
          <button
            onClick={handleEndSession}
            style={{
              background: '#f44336', color: '#fff', border: 'none', borderRadius: 4, padding: '4px 8px', cursor: 'pointer', fontSize: 12
            }}
          >
            End Session
          </button>
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
            Mave Terminal
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
            padding: '4px 10px',
            cursor: 'pointer',
            fontSize: 12,
          }}
        >
          ✕ Close
        </button>
      </div>

      {/* xterm.js container — takes all remaining space */}
      <div ref={terminalRef} style={{ flex: 1, overflow: 'hidden', padding: '4px 8px' }} />

      {/* ─── Full Virtual Keyboard ─── */}
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 4,
          padding: '6px 4px',
          background: '#2d2d2d',
          borderTop: '1px solid #444',
          flexShrink: 0,
        }}
      >
        {/* Row 0: Utilities / Scroll / Esc */}
        <div style={{ display: 'flex', gap: 4 }}>
          {renderKey('Esc', () => handleKey('\x1b', true))}
          {renderKey('C-c', () => sendInput('\x03'))}
          {renderKey('C-d', () => sendInput('\x04'))}
          {renderKey('C-l', () => sendInput('\x0c'))}
          {renderKey('PgUp', () => term.current?.scrollPages(-1))}
          {renderKey('PgDn', () => term.current?.scrollPages(1))}
          {renderKey('ScrlUp', () => term.current?.scrollLines(-1))}
          {renderKey('ScrlDn', () => term.current?.scrollLines(1))}
        </div>

        {/* Row 1: Numbers */}
        <div style={{ display: 'flex', gap: 4 }}>
          {['1','2','3','4','5','6','7','8','9','0','-','='].map(k => renderKey(k, () => handleKey(k)))}
          {renderKey('Bksp', () => sendInput('\x7f'), false, 1.5)}
        </div>

        {/* Row 2: QWERTY Top */}
        <div style={{ display: 'flex', gap: 4 }}>
          {renderKey('Tab', () => handleKey('\t'), false, 1.2)}
          {['q','w','e','r','t','y','u','i','o','p','[',']','\\'].map(k => renderKey(k, () => handleKey(k)))}
        </div>

        {/* Row 3: QWERTY Middle */}
        <div style={{ display: 'flex', gap: 4 }}>
          <div style={{ flex: 0.3 }}></div>
          {['a','s','d','f','g','h','j','k','l',';','\''].map(k => renderKey(k, () => handleKey(k)))}
          {renderKey('Enter', () => sendInput('\r'), false, 1.5)}
        </div>

        {/* Row 4: QWERTY Bottom + Arrows */}
        <div style={{ display: 'flex', gap: 4 }}>
          {renderKey('Shift', () => setShiftActive(!shiftActive), shiftActive, 1.5)}
          {['z','x','c','v','b','n','m',',','.','/'].map(k => renderKey(k, () => handleKey(k)))}
          {renderKey('↑', () => sendInput('\x1b[A'))}
        </div>

        {/* Row 5: Modifiers & Space */}
        <div style={{ display: 'flex', gap: 4 }}>
          {renderKey('Ctrl', () => { setCtrlActive(!ctrlActive); setAltActive(false); }, ctrlActive, 1.2)}
          {renderKey('Alt', () => { setAltActive(!altActive); setCtrlActive(false); }, altActive, 1.2)}
          {renderKey('Space', () => handleKey(' '), false, 5)}
          {renderKey('←', () => sendInput('\x1b[D'))}
          {renderKey('↓', () => sendInput('\x1b[B'))}
          {renderKey('→', () => sendInput('\x1b[C'))}
        </div>
      </div>
    </div>
  );
}
