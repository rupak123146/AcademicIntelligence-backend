/**
 * 🎓 Academic Intelligence Platform - Notification Routes
 * Routes for student notifications
 */

const express = require('express');
const router = express.Router();
const notificationController = require('../controllers/notificationController');
const { authenticate } = require('../middleware/auth');

// All routes require authentication
router.use(authenticate);

/**
 * @route   POST /api/v1/notifications/send
 * @desc    Send notification to student
 * @access  Private (System/Educator)
 */
router.post('/send', notificationController.sendNotification);

/**
 * @route   GET /api/v1/notifications/user/:userId
 * @desc    Get all notifications for a user
 * @access  Private (Student)
 */
router.get('/user/:userId', notificationController.getUserNotifications);

/**
 * @route   POST /api/v1/notifications/:notificationId/mark-read
 * @desc    Mark notification as read
 * @access  Private (Student)
 */
router.post('/:notificationId/mark-read', notificationController.markNotificationRead);

/**
 * @route   POST /api/v1/notifications/preferences
 * @desc    Set notification preferences
 * @access  Private (Student)
 */
router.post('/preferences', notificationController.setNotificationPreferences);

/**
 * @route   GET /api/v1/notifications/preferences/:studentId
 * @desc    Get notification preferences
 * @access  Private (Student)
 */
router.get('/preferences/:studentId', notificationController.getNotificationPreferences);

module.exports = router;
