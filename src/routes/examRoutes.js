const express = require('express');
const router = express.Router();
const examController = require('../controllers/examController');
const { authenticate, isEducator, isStudent, isEducatorOrAdmin, isAdmin } = require('../middleware/auth');
const { examValidation, attemptValidation } = require('../middleware/validation');

// =====================================================
// EXAM CRUD ROUTES
// =====================================================

/**
 * @route GET /api/v1/exams
 * @desc Get all exams (filtered by role)
 * @access Private
 */
router.get('/', authenticate, examController.getExams);

/**
 * @route GET /api/v1/exams/available
 * @desc Get available exams for students
 * @access Private (Student)
 */
router.get('/available', authenticate, isStudent, examController.getAvailableExams);

/**
 * @route GET /api/v1/exams/my-attempts
 * @desc Get student's exam attempts
 * @access Private (Student)
 */
router.get('/my-attempts', authenticate, isStudent, examController.getMyAttempts);

/**
 * @route POST /api/v1/exams
 * @desc Create a new exam
 * @access Private (Educator, Admin)
 */
router.post('/', authenticate, isEducatorOrAdmin, examValidation.create, examController.createExam);

/**
 * @route GET /api/v1/exams/:id
 * @desc Get exam by ID
 * @access Private
 */
router.get('/:id', authenticate, examController.getExamById);

/**
 * @route PUT /api/v1/exams/:id
 * @desc Update exam
 * @access Private (Educator, Admin)
 */
router.put('/:id', authenticate, isEducatorOrAdmin, examValidation.update, examController.updateExam);

/**
 * @route DELETE /api/v1/exams/:id
 * @desc Delete exam
 * @access Private (Educator, Admin)
 */
router.delete('/:id', authenticate, isEducatorOrAdmin, examController.deleteExam);

// =====================================================
// EXAM LIFECYCLE ROUTES
// =====================================================

/**
 * @route POST /api/v1/exams/:id/publish
 * @desc Publish exam (DRAFT -> PUBLISHED)
 * @access Private (Educator, Admin)
 */
router.post('/:id/publish', authenticate, isEducatorOrAdmin, examController.publishExam);

/**
 * @route POST /api/v1/exams/:id/activate
 * @desc Activate exam (PUBLISHED -> ACTIVE)
 * @access Private (Educator, Admin)
 */
router.post('/:id/activate', authenticate, isEducatorOrAdmin, examController.activateExam);

/**
 * @route POST /api/v1/exams/:id/close
 * @desc Close exam (ACTIVE -> COMPLETED)
 * @access Private (Educator, Admin)
 */
router.post('/:id/close', authenticate, isEducatorOrAdmin, examController.closeExam);

/**
 * @route POST /api/v1/exams/:id/archive
 * @desc Archive exam
 * @access Private (Educator, Admin)
 */
router.post('/:id/archive', authenticate, isEducatorOrAdmin, examController.archiveExam);

// =====================================================
// EXAM ASSIGNMENT ROUTES
// =====================================================

/**
 * @route POST /api/v1/exams/:id/assign
 * @desc Assign exam to sections/departments
 * @access Private (Educator, Admin)
 */
router.post('/:id/assign', authenticate, isEducatorOrAdmin, examController.assignExam);

/**
 * @route GET /api/v1/exams/:id/assignments
 * @desc Get exam assignment details
 * @access Private (Educator, Admin)
 */
router.get('/:id/assignments', authenticate, isEducatorOrAdmin, examController.getExamAssignments);

// =====================================================
// QUESTION MANAGEMENT ROUTES
// =====================================================

/**
 * @route GET /api/v1/exams/:id/questions
 * @desc Get exam questions (for editing)
 * @access Private (Educator, Admin)
 */
router.get('/:id/questions', authenticate, isEducatorOrAdmin, examController.getExamQuestions);

/**
 * @route POST /api/v1/exams/:id/questions
 * @desc Add questions to exam
 * @access Private (Educator, Admin)
 */
router.post('/:id/questions', authenticate, isEducatorOrAdmin, examController.addQuestions);

/**
 * @route DELETE /api/v1/exams/:id/questions
 * @desc Remove questions from exam
 * @access Private (Educator, Admin)
 */
router.delete('/:id/questions', authenticate, isEducatorOrAdmin, examController.removeQuestions);

// =====================================================
// EXAM ANALYTICS ROUTES
// =====================================================

/**
 * @route GET /api/v1/exams/:id/analytics
 * @desc Get exam analytics
 * @access Private (Educator, Admin)
 */
router.get('/:id/analytics', authenticate, isEducatorOrAdmin, examController.getExamAnalytics);

/**
 * @route GET /api/v1/exams/:id/attempts
 * @desc Get all attempts for an exam (educator view)
 * @access Private (Educator, Admin)
 */
router.get('/:id/attempts', authenticate, isEducatorOrAdmin, examController.getExamAttempts);

/**
 * @route GET /api/v1/exams/:id/export
 * @desc Export exam results
 * @access Private (Educator, Admin)
 */
router.get('/:id/export', authenticate, isEducatorOrAdmin, examController.exportExamResults);

// =====================================================
// EXAM ATTEMPT ROUTES (for students)
// =====================================================

/**
 * @route POST /api/v1/exams/:examId/start
 * @desc Start exam attempt
 * @access Private (Student)
 */
router.post('/:examId/start', authenticate, isStudent, examController.startAttempt);

/**
 * @route GET /api/v1/exams/:examId/resume
 * @desc Resume the current in-progress attempt (finds automatically)
 * @access Private (Student)
 */
router.get('/:examId/resume', authenticate, isStudent, examController.resumeAttempt);

/**
 * @route GET /api/v1/exams/:examId/attempts/:attemptId/resume
 * @desc Resume a specific attempt (legacy)
 * @access Private (Student)
 */
router.get('/:examId/attempts/:attemptId/resume', authenticate, isStudent, examController.resumeAttempt);

/**
 * @route PUT /api/v1/exams/:examId/attempts/:attemptId/answer
 * @desc Save answer for a question
 * @access Private (Student)
 */
router.put('/:examId/attempts/:attemptId/answer', authenticate, isStudent, examController.saveAnswer);

/**
 * @route PUT /api/v1/exams/:examId/attempts/:attemptId/mark-review
 * @desc Mark question for review
 * @access Private (Student)
 */
router.put('/:examId/attempts/:attemptId/mark-review', authenticate, isStudent, examController.markForReview);

/**
 * @route POST /api/v1/exams/:examId/attempts/:attemptId/submit
 * @desc Submit exam attempt
 * @access Private (Student)
 */
router.post('/:examId/attempts/:attemptId/submit', authenticate, isStudent, examController.submitAttempt);

/**
 * @route GET /api/v1/exams/:examId/attempts/:attemptId/result
 * @desc Get attempt result
 * @access Private
 */
router.get('/:examId/attempts/:attemptId/result', authenticate, examController.getAttemptResult);

// =====================================================
// ALTERNATIVE ATTEMPT ROUTES (without examId in path)
// =====================================================

/**
 * @route GET /api/v1/exams/attempts/:attemptId
 * @desc Get attempt details
 * @access Private
 */
router.get('/attempts/:attemptId', authenticate, examController.getAttempt);

/**
 * @route GET /api/v1/exams/attempts/:attemptId/results
 * @desc Get attempt results (by attemptId only)
 * @access Private
 */
router.get('/attempts/:attemptId/results', authenticate, examController.getAttemptResult);

/**
 * @route POST /api/v1/exams/attempts/:attemptId/answers
 * @desc Save answer (alternative endpoint)
 * @access Private (Student)
 */
router.post('/attempts/:attemptId/answers', authenticate, isStudent, examController.saveAnswer);

/**
 * @route PUT /api/v1/exams/attempts/:attemptId/mark-review
 * @desc Mark question for review (alternative endpoint)
 * @access Private (Student)
 */
router.put('/attempts/:attemptId/mark-review', authenticate, isStudent, examController.markForReview);

/**
 * @route POST /api/v1/exams/attempts/:attemptId/submit
 * @desc Submit exam (alternative endpoint)
 * @access Private (Student)
 */
router.post('/attempts/:attemptId/submit', authenticate, isStudent, examController.submitAttempt);

module.exports = router;
