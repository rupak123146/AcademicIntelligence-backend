/**
 * 🎓 Academic Intelligence Platform - Subject Routes
 * Subject and chapter management endpoints
 */

const express = require('express');
const router = express.Router();
const subjectController = require('../controllers/subjectController');
const chapterController = require('../controllers/chapterController');
const conceptController = require('../controllers/conceptController');
const { authenticate, isEducatorOrAdmin } = require('../middleware/auth');
const { body } = require('express-validator');
const { validate } = require('../middleware/validation');

/**
 * @route GET /api/v1/subjects
 * @desc Get all subjects
 * @access Private
 */
router.get('/', authenticate, subjectController.getSubjects);

/**
 * @route GET /api/v1/subjects/:id
 * @desc Get subject by ID
 * @access Private
 */
router.get('/:id', authenticate, subjectController.getSubjectById);

/**
 * @route POST /api/v1/subjects/:subjectId/chapters
 * @desc Create a new chapter for a subject
 * @access Private (Educator, Admin)
 */
router.post(
  '/:subjectId/chapters',
  authenticate,
  isEducatorOrAdmin,
  [
    body('name').trim().isLength({ min: 2, max: 200 }).withMessage('Chapter name must be 2-200 characters'),
    body('chapterNumber').isInt({ min: 1 }).withMessage('Chapter number must be a positive integer'),
    body('description').optional().trim().isLength({ max: 1000 }).withMessage('Description cannot exceed 1000 characters'),
    validate,
  ],
  chapterController.createChapter
);

/**
 * @route GET /api/v1/subjects/:subjectId/chapters
 * @desc Get all chapters for a subject
 * @access Private
 */
router.get('/:subjectId/chapters', authenticate, chapterController.getChaptersBySubject);

/**
 * @route POST /api/v1/subjects/:subjectId/chapters/:chapterId/concepts
 * @desc Create a new concept for a chapter (nested route for convenience)
 * @access Private (Educator, Admin)
 */
router.post(
  '/:subjectId/chapters/:chapterId/concepts',
  authenticate,
  isEducatorOrAdmin,
  [
    body('name').trim().isLength({ min: 2, max: 200 }).withMessage('Concept name must be 2-200 characters'),
    body('description').optional().trim().isLength({ max: 1000 }).withMessage('Description cannot exceed 1000 characters'),
    body('difficultyLevel').optional().isIn(['easy', 'medium', 'hard', 'expert']).withMessage('Invalid difficulty level'),
    validate,
  ],
  (req, res, next) => {
    // Pass chapterId from params to controller
    req.params.chapterId = req.params.chapterId;
    next();
  },
  conceptController.createConcept
);

/**
 * @route GET /api/v1/subjects/:subjectId/chapters/:chapterId/concepts
 * @desc Get all concepts for a chapter (nested route for convenience)
 * @access Private
 */
router.get(
  '/:subjectId/chapters/:chapterId/concepts',
  authenticate,
  (req, res, next) => {
    req.params.chapterId = req.params.chapterId;
    next();
  },
  conceptController.getConceptsByChapter
);

module.exports = router;
