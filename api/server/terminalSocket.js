const pty = require('node-pty');
const os = require('os');
const { Server } = require('socket.io');
const { logger } = require('@librechat/data-schemas');

// Simple in‑memory store for shells that survive disconnects
// sessionId -> { ptyProcess, buffer: string[], timeout }
const activeShells = new Map();

function generateSessionId() {
  return Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
}

function setupTerminalSocket(server) {
  const io = new Server(server, {
    path: '/api/terminal-socket/',
    cors: { origin: '*', methods: ['GET', 'POST'] },
    // Use auth handshake to pass JWT token if needed
    // The client will send { token: <bearer> } in the auth field
  });

  // Removed strict JWT middleware temporarily to fix connection issues
  io.use((socket, next) => {
    return next();
  });

  io.on('connection', (socket) => {
    logger.info('Client connected to Mave Terminal Socket', { sessionId: socket.id });

    // Acquire or create a session id – client may send one, otherwise generate
    let { sessionId } = socket.handshake.query;
    if (typeof sessionId !== 'string' || !sessionId) {
      sessionId = generateSessionId();
      socket.emit('session-id', sessionId);
    }
    socket.emit('connected', { sessionId });

    // Reuse an existing pty if we have one for this session
    let shellEntry = activeShells.get(sessionId);
    if (!shellEntry) {
      const shell = os.platform() === 'win32' ? 'powershell.exe' : 'bash';
      const ptyProcess = pty.spawn(shell, [], {
        name: 'xterm-color',
        cols: 80,
        rows: 24,
        cwd: process.env.HOME || process.cwd(),
        env: process.env,
      });
      shellEntry = { ptyProcess, buffer: [], timeout: null };
      activeShells.set(sessionId, shellEntry);
    } else if (shellEntry.timeout) {
      clearTimeout(shellEntry.timeout);
      shellEntry.timeout = null;
    }

    const { ptyProcess, buffer } = shellEntry;

    // Replay recent output to the newly connected client
    if (buffer.length) {
      socket.emit('terminal-output', buffer.join(''));
    }

    // Forward PTY output to this socket (and store in buffer)
    const onData = (data) => {
      socket.emit('terminal-output', data);
      // Keep a modest buffer – last 100KB of output
      buffer.push(data);
      let total = buffer.reduce((s, d) => s + d.length, 0);
      if (total > 100 * 1024) {
        // drop oldest chunks
        while (buffer.length && total > 100 * 1024) {
          total -= buffer[0].length;
          buffer.shift();
        }
      }
    };
    ptyProcess.on('data', onData);

    // Input from client
    socket.on('terminal-input', (data) => {
      ptyProcess.write(data);
    });

    socket.on('terminal-resize', (size) => {
      if (size && size.cols && size.rows) {
        ptyProcess.resize(size.cols, size.rows);
      }
    });

    socket.on('kill-session', () => {
      logger.info('Killing terminal session per user request', { sessionId });
      ptyProcess.kill();
      activeShells.delete(sessionId);
      socket.emit('session-killed');
    });

    socket.on('disconnect', () => {
      logger.info('Terminal Socket disconnected – keeping shell alive for 5min', { sessionId });
      // Detach listener but keep process alive for 5 minutes
      ptyProcess.removeListener('data', onData);
      // Set a timeout to kill the shell after 5 minutes of inactivity
      const timeout = setTimeout(() => {
        logger.info('Killing idle terminal after timeout', { sessionId });
        ptyProcess.kill();
        activeShells.delete(sessionId);
      }, 5 * 60 * 1000);
      shellEntry.timeout = timeout;
    });
  });

  return io;
}

module.exports = setupTerminalSocket;
