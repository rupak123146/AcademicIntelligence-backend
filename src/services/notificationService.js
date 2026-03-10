/**
 * Notification helper service.
 */

const { prisma } = require('../config/database');
const { emitToUser, emitToInstitution } = require('./realtimeGateway');
const logger = require('../utils/logger');

const createNotification = async ({ userId, courseId, notificationType, title, message, priority = 'medium', actionUrl = null, metadata = {} }) => {
  const notificationDelegate = prisma?.notification;
  if (!notificationDelegate || typeof notificationDelegate.create !== 'function') {
    logger.warn('Notification delegate unavailable on Prisma client. Skipping persistent notification.', {
      userId,
      notificationType,
    });
    return null;
  }

  const notification = await notificationDelegate.create({
    data: {
      userId,
      courseId: courseId || null,
      notificationType,
      title,
      message,
      priority,
      actionUrl,
      metadata,
    },
  });

  emitToUser(userId, 'notification:new', notification);
  return notification;
};

const notifyInstitution = (institutionId, event, payload) => {
  emitToInstitution(institutionId, event, payload);
};

module.exports = {
  createNotification,
  notifyInstitution,
};
