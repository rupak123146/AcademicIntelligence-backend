/**
 * 🎓 Academic Intelligence Platform - Chapter Routes
 * Chapter management endpoints
 */

const express = require('express');
const router = express.Router();
const chapterController = require('../controllers/chapterController');
const conceptController = require('../controllers/conceptController');
const { authenticate, isEducatorOrAdmin } = require('../middleware/auth');
const { body } = require('express-validator');
const { validate, rules } = require('../middleware/validation');

/**
 * @route GET /api/v1/chapters/:id
 * @desc Get chapter by ID
 * @access Private (Educator, Admin)
 */
router.get('/:id', authenticate, chapterController.getChapterById);

/**
 * @route PUT /api/v1/chapters/:id
 * @desc Update chapter
 * @access Private (Educator, Admin)
 */
router.put(
  '/:id',
  authenticate,
  isEducatorOrAdmin,
  [
    body('name').optional().trim().isLength({ min: 2, max: 200 }).withMessage('Chapter name must be 2-200 characters'),
    body('chapterNumber').optional().isInt({ min: 1 }).withMessage('Chapter number must be a positive integer'),
    body('description').optional().trim().isLength({ max: 1000 }).withMessage('Description cannot exceed 1000 characters'),
    validate,
  ],
  chapterController.updateChapter
);

/**
 * @route DELETE /api/v1/chapters/:id
 * @desc Delete chapter
 * @access Private (Educator, Admin)
 */
router.delete('/:id', authenticate, isEducatorOrAdmin, chapterController.deleteChapter);

/**
 * @route POST /api/v1/chapters/:chapterId/concepts
 * @desc Create a new concept for a chapter
 * @access Private (Educator, Admin)
 */
router.post(
  '/:chapterId/concepts',
  authenticate,
  isEducatorOrAdmin,
  [
    body('name').trim().isLength({ min: 2, max: 200 }).withMessage('Concept name must be 2-200 characters'),
    body('description').optional().trim().isLength({ max: 1000 }).withMessage('Description cannot exceed 1000 characters'),
    body('difficultyLevel').optional().isIn(['easy', 'medium', 'hard', 'expert']).withMessage('Invalid difficulty level'),
    validate,
  ],
  conceptController.createConcept
);

/**
 * @route GET /api/v1/chapters/:chapterId/concepts
 * @desc Get all concepts for a chapter
 * @access Private
 */
router.get('/:chapterId/concepts', authenticate, conceptController.getConceptsByChapter);

module.exports = router;
