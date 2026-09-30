const pty = require('node-pty');
const os = require('os');
const { Server } = require('socket.io');
const { logger } = require('@librechat/data-schemas');

function setupTerminalSocket(server) {
  const io = new Server(server, {
    path: '/api/terminal-socket/',
    cors: {
      origin: "*",
      methods: ["GET", "POST"]
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
      env: process.env
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
