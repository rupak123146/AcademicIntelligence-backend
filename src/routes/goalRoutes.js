/**
 * 🎓 Academic Intelligence Platform - Goal Routes
 * Routes for student goal tracking
 */

const express = require('express');
const router = express.Router();
const goalController = require('../controllers/goalController');
const { authenticate, isStudent, isEducatorOrAdmin } = require('../middleware/auth');

// All routes require authentication
router.use(authenticate);

/**
 * @route   POST /api/v1/goals/create
 * @desc    Create a new student goal
 * @access  Private (Student/Educator)
 */
router.post('/create', isStudent, goalController.createGoal);

/**
 * @route   GET /api/v1/goals/student/:studentId
 * @desc    Get all goals for a student
 * @access  Private (Student/Educator)
 */
router.get('/student/:studentId', goalController.getStudentGoals);

/**
 * @route   POST /api/v1/goals/:goalId/update-progress
 * @desc    Update goal progress
 * @access  Private (Student/Educator)
 */
router.post('/:goalId/update-progress', isStudent, goalController.updateGoalProgress);

/**
 * @route   GET /api/v1/goals/course/:courseId/summary
 * @desc    Get course-wide goals summary
 * @access  Private (Educator)
 */
router.get('/course/:courseId/summary', isEducatorOrAdmin, goalController.getCourseGoalsSummary);

/**
 * @route   GET /api/v1/goals/:goalId
 * @desc    Get goal details with history
 * @access  Private (Student/Educator)
 */
router.get('/:goalId', goalController.getGoalDetails);

module.exports = router;
