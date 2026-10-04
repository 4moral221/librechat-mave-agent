const os = require('os');
const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const { logger } = require('@librechat/data-schemas');

// node-pty is a native module; fail soft so a missing or failed compile
// cannot take the whole API server down at require time.
let pty = null;
try {
  pty = require('node-pty');
} catch (err) {
  logger.warn('[terminal-socket] node-pty unavailable — Mave terminal disabled:', err.message);
}

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
  if (!pty) {
    return null;
  }

  const io = new Server(server, {
    path: '/api/terminal-socket/',
    cors: {
      origin: '*',
      methods: ['GET', 'POST'],
    },
  });

  // Auth gate: every connection must present a valid LibreChat JWT (signed with JWT_SECRET).
  // Unauthenticated upgrades are rejected before any PTY is spawned.
  io.use((socket, next) => {
    const token = extractToken(socket);
    if (!token || !process.env.JWT_SECRET) {
      return next(new Error('unauthorized'));
    }
    try {
      jwt.verify(token, process.env.JWT_SECRET);
      return next();
    } catch (err) {
      return next(new Error('unauthorized'));
    }
  });

  io.on('connection', (socket) => {
    logger.info('Client connected to Mave Terminal Socket');

    const shell = os.platform() === 'win32' ? 'powershell.exe' : 'bash';
    const ptyProcess = pty.spawn(shell, [], {
      name: 'xterm-color',
      cols: 80,
      rows: 24,
      cwd: process.env.HOME || process.cwd(),
      env: buildSafeEnv(),
    });

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
      logger.info('Terminal Socket disconnected. Killing process...');
      ptyProcess.kill();
    });
  });

  return io;
}

module.exports = setupTerminalSocket;
