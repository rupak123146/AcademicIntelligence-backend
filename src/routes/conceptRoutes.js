/**
 * 🎓 Academic Intelligence Platform - Concept Routes
 * Concept management endpoints
 */

const express = require('express');
const router = express.Router();
const conceptController = require('../controllers/conceptController');
const { authenticate, isEducatorOrAdmin } = require('../middleware/auth');
const { body } = require('express-validator');
const { validate } = require('../middleware/validation');

/**
 * @route GET /api/v1/concepts/:id
 * @desc Get concept by ID
 * @access Private (Educator, Admin)
 */
router.get('/:id', authenticate, conceptController.getConceptById);

/**
 * @route PUT /api/v1/concepts/:id
 * @desc Update concept
 * @access Private (Educator, Admin)
 */
router.put(
  '/:id',
  authenticate,
  isEducatorOrAdmin,
  [
    body('name').optional().trim().isLength({ min: 2, max: 200 }).withMessage('Concept name must be 2-200 characters'),
    body('description').optional().trim().isLength({ max: 1000 }).withMessage('Description cannot exceed 1000 characters'),
    body('difficultyLevel').optional().isIn(['easy', 'medium', 'hard', 'expert']).withMessage('Invalid difficulty level'),
    validate,
  ],
  conceptController.updateConcept
);

/**
 * @route DELETE /api/v1/concepts/:id
 * @desc Delete concept
 * @access Private (Educator, Admin)
 */
router.delete('/:id', authenticate, isEducatorOrAdmin, conceptController.deleteConcept);

module.exports = router;
