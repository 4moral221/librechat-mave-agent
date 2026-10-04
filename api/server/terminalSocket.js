const os = require('os');
const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const { logger } = require('@librechat/data-schemas');

// node-pty is a native module and is loaded LAZILY on first connection
// (see the connection handler). A failed native compile must never take the
// API server down at boot; it only disables the terminal.
let pty = null;

// Only a minimal, secret-free environment is passed into the PTY process.
const SAFE_ENV_KEYS = ['HOME', 'PATH', 'SHELL', 'TERM', 'LANG', 'LC_ALL', 'TMPDIR', 'USER'];

function buildSafeEnv() {
  const env = {};
  for (const key of SAFE_ENV_KEYS) {
    if (process.env[key] !== undefined) {
      env[key] = process.env[key];
    }
  }
  return env;
}

function extractToken(socket) {
  const auth = socket.handshake?.auth || {};
  if (auth.token) {
    return auth.token;
  }
  const header = socket.handshake?.headers?.authorization;
  if (header && /^Bearer\s+/i.test(header)) {
    return header.replace(/^Bearer\s+/i, '').trim();
  }
  const cookie = socket.handshake?.headers?.cookie;
  if (cookie) {
    const match = cookie.match(/(?:^|;\s*)token=([^;]+)/);
    if (match) {
      try {
        return decodeURIComponent(match[1]);
      } catch (err) {
        return match[1];
      }
    }
  }
  return '';
}

function setupTerminalSocket(server) {
  const io = new Server(server, {
    path: '/api/terminal-socket/',
    cors: {
      origin: '*',
      methods: ['GET', 'POST'],
    },
  });

  // Auth gate: every connection must present a valid LibreChat JWT signed with
  // JWT_SECRET. Rejected before any PTY is spawned.
  io.use((socket, next) => {
    const token = extractToken(socket);
    if (!token) {
      logger.warn('[terminal-socket] auth rejected: no token presented', { socketId: socket.id });
      return next(new Error('unauthorized'));
    }
    if (!process.env.JWT_SECRET) {
      logger.warn('[terminal-socket] auth rejected: JWT_SECRET is not set on the server');
      return next(new Error('unauthorized'));
    }
    try {
      jwt.verify(token, process.env.JWT_SECRET);
    } catch (err) {
      // err.message is the verification reason (e.g. jwt expired), never the token.
      logger.warn('[terminal-socket] auth rejected: verification failed', {
        socketId: socket.id,
        reason: err.message,
      });
      return next(new Error('unauthorized'));
    }
    return next();
  });

  io.on('connection', (socket) => {
    logger.info('[terminal-socket] client connected', { socketId: socket.id });

    // Lazy-load node-pty on the first connection: a failed native compile
    // must not have taken the server down at boot - it just disables the terminal.
    if (!pty) {
      try {
        pty = require('node-pty');
        logger.info('[terminal-socket] node-pty loaded on first connection');
      } catch (err) {
        logger.warn('[terminal-socket] node-pty unavailable - terminal disabled:', err.message);
        socket.emit('terminal-output', 'terminal unavailable: native pty failed to load\r\n');
        socket.disconnect(true);
        return;
      }
    }

    const shell = os.platform() === 'win32' ? 'powershell.exe' : 'bash';
    let ptyProcess;
    try {
      ptyProcess = pty.spawn(shell, [], {
        name: 'xterm-color',
        cols: 80,
        rows: 24,
        cwd: process.env.HOME || process.cwd(),
        env: buildSafeEnv(),
      });
      logger.info('[terminal-socket] PTY started', { socketId: socket.id, shell, pid: ptyProcess.pid });
    } catch (err) {
      logger.error('[terminal-socket] PTY failed to start', { shell, error: err.message });
      socket.emit('terminal-output', 'terminal unavailable: ' + err.message + '\r\n');
      socket.disconnect(true);
      return;
    }

    ptyProcess.on('data', (data) => {
      socket.emit('terminal-output', data);
    });

    socket.on('terminal-input', (data) => {
      ptyProcess.write(data);
    });

    socket.on('terminal-resize', (size) => {
      if (size && size.cols && size.rows) {
        ptyProcess.resize(size.cols, size.rows);
      }
    });

    socket.on('disconnect', () => {
      logger.info('[terminal-socket] client disconnected; killing PTY', { socketId: socket.id });
      ptyProcess.kill();
    });
  });

  return io;
}

module.exports = setupTerminalSocket;
