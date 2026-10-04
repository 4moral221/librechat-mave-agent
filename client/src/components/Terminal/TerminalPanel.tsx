import React, { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import { useAuthContext } from '~/hooks/AuthContext';

export default function TerminalPanel({ isVisible }: { isVisible: boolean }) {
  const { token } = useAuthContext();
  const terminalRef = useRef<HTMLDivElement>(null);
  const term = useRef<Terminal | null>(null);
  const fitAddon = useRef<FitAddon | null>(null);

  useEffect(() => {
    if (!terminalRef.current || term.current) return;

    term.current = new Terminal({
      cursorBlink: true,
      theme: {
        background: '#1e1e1e',
        foreground: '#f3f3f3',
      },
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
    });

    fitAddon.current = new FitAddon();
    term.current.loadAddon(fitAddon.current);
    term.current.open(terminalRef.current);
    fitAddon.current.fit();
    term.current.focus();

    return () => {
      term.current?.dispose();
      term.current = null;
    };
  }, []);

  // Connects with the app's existing auth token (from useAuthContext - never
  // stored in localStorage, never logged) and reconnects when the token rotates
  // (silent refresh) or the panel becomes visible, so the server always
  // verifies the CURRENT token.
  useEffect(() => {
    if (!term.current || !token || !isVisible) return;

    let disposed = false;
    let socket: import('socket.io-client').Socket | undefined;
    let dataDisposal: { dispose: () => void } | undefined;
    const handleResize = () => {
      if (!fitAddon.current || !term.current) return;
      fitAddon.current.fit();
      socket?.emit('terminal-resize', {
        cols: term.current.cols,
        rows: term.current.rows,
      });
    };

    // Dynamically import socket.io-client to avoid SSR issues if any
    import('socket.io-client').then(({ io }) => {
      if (disposed || !term.current) return;

      socket = io({
        path: '/api/terminal-socket/',
        auth: { token },
      });

      dataDisposal = term.current.onData((data) => {
        socket?.emit('terminal-input', data);
      });

      socket.on('terminal-output', (data) => {
        term.current?.write(data);
      });

      socket.on('connect', () => {
        handleResize();
      });

      window.addEventListener('resize', handleResize);
    });

    return () => {
      disposed = true;
      window.removeEventListener('resize', handleResize);
      dataDisposal?.dispose();
      socket?.disconnect();
    };
  }, [token, isVisible]);

  useEffect(() => {
    if (isVisible) {
      setTimeout(() => {
        fitAddon.current?.fit();
        term.current?.focus();
      }, 0);
    }
  }, [isVisible]);

  return (
    <div 
      className="flex flex-col w-full bg-[#1e1e1e] border-t border-gray-700 shadow-2xl rounded-t-xl overflow-hidden z-20"
      style={{ 
        minHeight: '300px', 
        flexBasis: '300px', 
        flexGrow: 0,
        display: isVisible ? 'flex' : 'none'
      }}
    >
      {/* macOS Style Title Bar */}
      <div className="flex items-center justify-between px-4 py-2 bg-[#2d2d2d] border-b border-[#111] relative">
        {/* Traffic Light Dots */}
        <div className="flex space-x-2">
          <div className="w-3 h-3 rounded-full bg-[#ff5f56]"></div>
          <div className="w-3 h-3 rounded-full bg-[#ffbd2e]"></div>
          <div className="w-3 h-3 rounded-full bg-[#27c93f]"></div>
        </div>
        
        {/* Avatar and Title */}
        <div className="flex items-center space-x-2 absolute left-1/2 transform -translate-x-1/2">
          <img 
            src="/assets/mave.jpg" 
            alt="Mave" 
            className="w-6 h-6 rounded-full border border-gray-500 shadow-sm"
          />
          <span className="text-xs font-semibold text-gray-300 tracking-wider">Mave Agent Terminal</span>
        </div>
        
        {/* Empty space for flex balance */}
        <div className="w-12"></div>
      </div>
      
      {/* Terminal Container */}
      <div className="flex-1 w-full relative">
        <div ref={terminalRef} className="absolute inset-0 p-3 pl-4" />
      </div>
    </div>
  );
}
