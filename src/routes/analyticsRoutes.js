const express = require('express');
const router = express.Router();
const analyticsController = require('../controllers/analyticsController');
const { authenticate, authorize, isStudent, isEducatorOrAdmin } = require('../middleware/auth');
const { analyticsValidation } = require('../middleware/validation');


/**
 * System Analytics (Admin)
 */

/**
 * @route GET /api/v1/analytics/system
 * @desc Get system-wide analytics for admin dashboard
 * @access Private (Admin)
 */
router.get('/system', 
  authenticate, 
  authorize('admin'),
  analyticsController.getSystemAnalytics
);


/**
 * Simplified Analytics Routes for Frontend (no IDs needed)
 * These routes automatically use the logged-in user's ID
 */

/**
 * @route GET /api/v1/analytics/my-analytics
 * @desc Get current user's overall analytics
 * @access Private
 */
router.get('/my-analytics', 
  authenticate, 
  analyticsController.getStudentDashboard
);

/**
 * @route GET /api/v1/analytics/my-chapter-performance
 * @desc Get current user's chapter performance
 * @access Private
 */
router.get('/my-chapter-performance', 
  authenticate, 
  analyticsController.getChapterWiseAnalytics
);

/**
 * @route GET /api/v1/analytics/my-concept-mastery
 * @desc Get current user's concept mastery
 * @access Private
 */
router.get('/my-concept-mastery', 
  authenticate, 
  analyticsController.getConceptWiseAnalytics
);

/**
 * @route GET /api/v1/analytics/my-difficulty-analysis
 * @desc Get current user's difficulty analysis
 * @access Private
 */
router.get('/my-difficulty-analysis', 
  authenticate, 
  analyticsController.getDifficultyWiseAnalytics
);

/**
 * @route GET /api/v1/analytics/my-performance-trend
 * @desc Get current user's performance trend
 * @access Private
 */
router.get('/my-performance-trend', 
  authenticate, 
  analyticsController.getPerformanceTrends
);

/**
 * @route GET /api/v1/analytics/my-learning-gaps
 * @desc Get current user's learning gaps
 * @access Private
 */
router.get('/my-learning-gaps', 
  authenticate, 
  analyticsController.getLearningGaps
);

/**
 * Student Analytics Routes
 */

/**
 * @route GET /api/v1/analytics/student/dashboard
 * @desc Get student dashboard analytics
 * @access Private (Student)
 */
router.get('/student/dashboard', 
  authenticate, 
  isStudent, 
  analyticsController.getStudentDashboard
);

/**
 * @route GET /api/v1/analytics/student/chapter-wise
 * @desc Get chapter-wise performance analytics
 * @access Private (Student)
 */
router.get('/student/chapter-wise', 
  authenticate, 
  isStudent,
  analyticsController.getChapterWiseAnalytics
);

/**
 * @route GET /api/v1/analytics/student/concept-wise
 * @desc Get concept-wise performance analytics
 * @access Private (Student)
 */
router.get('/student/concept-wise', 
  authenticate, 
  isStudent,
  analyticsController.getConceptWiseAnalytics
);

/**
 * @route GET /api/v1/analytics/student/difficulty-wise
 * @desc Get difficulty-wise performance analytics
 * @access Private (Student)
 */
router.get('/student/difficulty-wise', 
  authenticate, 
  isStudent,
  analyticsController.getDifficultyWiseAnalytics
);

/**
 * @route GET /api/v1/analytics/student/learning-gaps
 * @desc Get learning gaps analysis
 * @access Private (Student)
 */
router.get('/student/learning-gaps', 
  authenticate, 
  isStudent,
  analyticsController.getLearningGaps
);

/**
 * @route GET /api/v1/analytics/student/feedback
 * @desc Get personalized feedback
 * @access Private (Student)
 */
router.get('/student/feedback', 
  authenticate, 
  isStudent,
  analyticsController.getStudentFeedback
);

/**
 * @route GET /api/v1/analytics/student/trends
 * @desc Get performance trends
 * @access Private (Student)
 */
router.get('/student/trends', 
  authenticate, 
  isStudent,
  analyticsController.getPerformanceTrends
);

/**
 * Educator Analytics Routes
 */

/**
 * @route GET /api/v1/analytics/class/dashboard
 * @desc Get class-level analytics dashboard
 * @access Private (Educator, Admin)
 */
router.get('/class/dashboard', 
  authenticate, 
  isEducatorOrAdmin,
  analyticsValidation.classAnalytics,
  analyticsController.getClassDashboard
);

/**
 * @route POST /api/v1/analytics/class
 * @desc Get class analytics (alternative POST endpoint for frontend)
 * @access Private (Educator, Admin)
 */
router.post('/class', 
  authenticate, 
  isEducatorOrAdmin,
  analyticsController.getClassDashboard
);

/**
 * @route GET /api/v1/analytics/at-risk
 * @desc Get at-risk students for educator's classes
 * @access Private (Educator, Admin)
 */
router.get('/at-risk', 
  authenticate, 
  isEducatorOrAdmin,
  analyticsController.getAtRiskStudents
);

/**
 * @route GET /api/v1/analytics/class/:courseId/weak-areas
 * @desc Get weak areas in a class
 * @access Private (Educator, Admin)
 */
router.get('/class/:courseId/weak-areas', 
  authenticate, 
  isEducatorOrAdmin,
  analyticsController.getClassWeakAreas
);

/**
 * @route GET /api/v1/analytics/class/student/:studentId
 * @desc Get specific student analytics (for educator)
 * @access Private (Educator, Admin)
 */
router.get('/class/student/:studentId', 
  authenticate, 
  isEducatorOrAdmin,
  analyticsController.getStudentAnalyticsForEducator
);

/**
 * @route POST /api/v1/analytics/full
 * @desc Get full analysis for a student
 * @access Private
 */
router.post('/full', 
  authenticate,
  analyticsController.getFullAnalysis
);

/**
 * @route GET /api/v1/analytics/compare/student-to-class
 * @desc Compare student performance to class average
 * @access Private
 */
router.get('/compare/student-to-class', 
  authenticate,
  analyticsController.compareStudentToClass
);

/**
 * Reports Routes
 */

/**
 * @route GET /api/v1/analytics/dashboard
 * @desc Get student dashboard with studentId parameter (for educators viewing student data)
 * @access Private
 */
router.get('/dashboard',
  authenticate,
  analyticsController.getStudentDashboard
);

/**
 * @route POST /api/v1/analytics/reports/generate
 * @desc Generate downloadable report
 * @access Private (Educator, Admin)
 */
router.post('/reports/generate', 
  authenticate, 
  isEducatorOrAdmin,
  analyticsValidation.generateReport,
  analyticsController.generateReport
);

module.exports = router;

