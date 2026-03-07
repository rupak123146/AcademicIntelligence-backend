/**
 * 🎓 Academic Intelligence Platform - Notification Controller
 * Handles student notification endpoints
 */

const { prisma } = require('../config/database');
const { successResponse, asyncHandler, ApiError } = require('../utils/helpers');

/**
 * Send notification to student
 * POST /api/v1/notifications/send
 */
const sendNotification = asyncHandler(async (req, res) => {
  const {
    studentId,
    courseId,
    notificationType,
    title,
    message,
    actionUrl,
    priority,
    metadata,
  } = req.body;

  const notification = await prisma.notification.create({
    data: {
      userId: studentId,
      courseId: courseId || null,
      notificationType,
      title,
      message,
      actionUrl: actionUrl || null,
      priority: priority || 'medium',
      metadata: metadata || {},
    },
  });

  successResponse(res, 201, 'Notification sent successfully', notification);
});

/**
 * Get user notifications
 * GET /api/v1/notifications/user/:userId
 */
const getUserNotifications = asyncHandler(async (req, res) => {
  const { userId } = req.params;
  const { unreadOnly, notificationType, limit } = req.query;

  const where = { userId };
  if (unreadOnly === 'true') where.isRead = false;
  if (notificationType) where.notificationType = notificationType;

  const notifications = await prisma.notification.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    take: limit ? parseInt(limit) : 50,
  });

  successResponse(res, 200, 'Notifications retrieved successfully', notifications);
});

/**
 * Mark notification as read
 * POST /api/v1/notifications/:notificationId/mark-read
 */
const markNotificationRead = asyncHandler(async (req, res) => {
  const { notificationId } = req.params;

  const notification = await prisma.notification.update({
    where: { id: notificationId },
    data: { 
      isRead: true,
      readAt: new Date(),
    },
  });

  successResponse(res, 200, 'Notification marked as read', notification);
});

/**
 * Set notification preferences
 * POST /api/v1/notifications/preferences
 */
const setNotificationPreferences = asyncHandler(async (req, res) => {
  const { studentId, preferences } = req.body;

  const prefs = await prisma.notificationPreferences.upsert({
    where: { studentId },
    create: {
      studentId,
      ...preferences,
    },
    update: preferences,
  });

  successResponse(res, 200, 'Notification preferences updated', prefs);
});

/**
 * Get notification preferences
 * GET /api/v1/notifications/preferences/:studentId
 */
const getNotificationPreferences = asyncHandler(async (req, res) => {
  const { studentId } = req.params;

  let preferences = await prisma.notificationPreferences.findUnique({
    where: { studentId },
  });

  // Create default preferences if not found
  if (!preferences) {
    preferences = await prisma.notificationPreferences.create({
      data: { studentId },
    });
  }

  successResponse(res, 200, 'Preferences retrieved successfully', preferences);
});

module.exports = {
  sendNotification,
  getUserNotifications,
  markNotificationRead,
  setNotificationPreferences,
  getNotificationPreferences,
};
