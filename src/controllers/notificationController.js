/**
 * 🎓 Academic Intelligence Platform - Notification Controller
 * Handles student notification endpoints
 */

const { prisma } = require('../config/database');
const { successResponse, asyncHandler, ApiError, paginate, buildPaginationMeta } = require('../utils/helpers');

const getNotificationDelegate = () => {
  if (!prisma?.notification) {
    throw ApiError.internal('Notification storage is not available. Please regenerate Prisma client and restart backend.');
  }
  return prisma.notification;
};

const getNotificationPreferencesDelegate = () => {
  if (!prisma?.notificationPreferences) {
    throw ApiError.internal('Notification preferences storage is not available. Please regenerate Prisma client and restart backend.');
  }
  return prisma.notificationPreferences;
};

/**
 * Send notification to student
 * POST /api/v1/notifications/send
 */
const sendNotification = asyncHandler(async (req, res) => {
  if (!['educator', 'admin', 'super_admin'].includes(req.user.role)) {
    throw ApiError.forbidden('Only educators and admins can send notifications');
  }

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

  const notificationDelegate = getNotificationDelegate();

  const notification = await notificationDelegate.create({
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
  const { unreadOnly, notificationType, page, limit } = req.query;

  if (req.user.role === 'student' && req.user.id !== userId) {
    throw ApiError.forbidden('You can only view your own notifications');
  }

  const pagination = paginate(page, limit, 100);
  const notificationDelegate = getNotificationDelegate();

  const where = { userId };
  if (unreadOnly === 'true') where.isRead = false;
  if (notificationType) where.notificationType = notificationType;

  const total = await notificationDelegate.count({ where });

  const notifications = await notificationDelegate.findMany({
    where,
    orderBy: { createdAt: 'desc' },
    skip: pagination.offset,
    take: pagination.limit,
  });

  successResponse(
    res,
    200,
    'Notifications retrieved successfully',
    notifications,
    buildPaginationMeta(pagination.page, pagination.limit, total)
  );
});

/**
 * Mark notification as read
 * POST /api/v1/notifications/:notificationId/mark-read
 */
const markNotificationRead = asyncHandler(async (req, res) => {
  const { notificationId } = req.params;

  const notificationDelegate = getNotificationDelegate();

  const existing = await notificationDelegate.findUnique({
    where: { id: notificationId },
    select: { id: true, userId: true },
  });

  if (!existing) {
    throw ApiError.notFound('Notification not found');
  }

  if (req.user.id !== existing.userId) {
    throw ApiError.forbidden('You can only mark your own notifications');
  }

  const notification = await notificationDelegate.update({
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

  if (req.user.role === 'student' && req.user.id !== studentId) {
    throw ApiError.forbidden('You can only update your own preferences');
  }

  const notificationPreferencesDelegate = getNotificationPreferencesDelegate();

  const prefs = await notificationPreferencesDelegate.upsert({
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

  if (req.user.role === 'student' && req.user.id !== studentId) {
    throw ApiError.forbidden('You can only view your own preferences');
  }

  const notificationPreferencesDelegate = getNotificationPreferencesDelegate();

  let preferences = await notificationPreferencesDelegate.findUnique({
    where: { studentId },
  });

  // Create default preferences if not found
  if (!preferences) {
    preferences = await notificationPreferencesDelegate.create({
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
