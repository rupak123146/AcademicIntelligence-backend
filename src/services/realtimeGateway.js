/**
 * Real-time gateway for WebSocket notifications and analytics events.
 */

const { Server } = require('socket.io');
const logger = require('../utils/logger');

let io = null;

const initializeRealtimeGateway = (httpServer, corsConfig = {}) => {
  if (io) {
    return io;
  }

  io = new Server(httpServer, {
    cors: {
      origin: corsConfig.origin || '*',
      credentials: !!corsConfig.credentials,
      methods: corsConfig.methods || ['GET', 'POST'],
    },
  });

  io.on('connection', (socket) => {
    const { userId, institutionId } = socket.handshake.query || {};

    if (userId) {
      socket.join(`user:${userId}`);
    }

    if (institutionId) {
      socket.join(`institution:${institutionId}`);
    }

    socket.on('join_exam', (examId) => {
      if (examId) {
        socket.join(`exam:${examId}`);
      }
    });

    socket.on('leave_exam', (examId) => {
      if (examId) {
        socket.leave(`exam:${examId}`);
      }
    });

    socket.on('disconnect', () => {
      logger.debug('WebSocket client disconnected', { socketId: socket.id });
    });
  });

  logger.info('Realtime gateway initialized');
  return io;
};

const emitToUser = (userId, event, payload) => {
  if (!io || !userId) return;
  io.to(`user:${userId}`).emit(event, payload);
};

const emitToInstitution = (institutionId, event, payload) => {
  if (!io || !institutionId) return;
  io.to(`institution:${institutionId}`).emit(event, payload);
};

const emitToExamRoom = (examId, event, payload) => {
  if (!io || !examId) return;
  io.to(`exam:${examId}`).emit(event, payload);
};

module.exports = {
  initializeRealtimeGateway,
  emitToUser,
  emitToInstitution,
  emitToExamRoom,
};
