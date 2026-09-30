import React, { useEffect, useRef } from 'react';
import { Terminal } from 'xterm';
import { FitAddon } from '@xterm/addon-fit';
import 'xterm/css/xterm.css';

export default function TerminalPanel({ isVisible }: { isVisible: boolean }) {
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

    // Dynamically import socket.io-client to avoid SSR issues if any
    import('socket.io-client').then(({ io }) => {
      const socket = io({ path: '/api/terminal-socket/' });

      term.current?.onData((data) => {
        socket.emit('terminal-input', data);
      });

      socket.on('terminal-output', (data) => {
        term.current?.write(data);
      });

      const handleResize = () => {
        if (!fitAddon.current || !term.current) return;
        fitAddon.current.fit();
        socket.emit('terminal-resize', {
          cols: term.current.cols,
          rows: term.current.rows,
        });
      };

      window.addEventListener('resize', handleResize);
      
      // Emit initial size
      handleResize();

      term.current?.onDispose(() => {
        window.removeEventListener('resize', handleResize);
        socket.disconnect();
      });
    });

    return () => {
      term.current?.dispose();
      term.current = null;
    };
  }, []);

  useEffect(() => {
    if (isVisible) {
      setTimeout(() => fitAddon.current?.fit(), 0);
    }
  }, [isVisible]);

  if (!isVisible) return null;

  return (
    <div 
      className="flex flex-col w-full bg-[#1e1e1e] border-t border-gray-700 shadow-2xl rounded-t-xl overflow-hidden z-20"
      style={{ minHeight: '300px', flexBasis: '300px', flexGrow: 0 }}
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
