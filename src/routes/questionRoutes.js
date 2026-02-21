/**
 * 🎓 Academic Intelligence Platform - Question Routes
 * Question bank management endpoints
 */

const express = require('express');
const router = express.Router();
const examController = require('../controllers/examController');
const { authenticate, isEducatorOrAdmin } = require('../middleware/auth');
const { questionValidation } = require('../middleware/validation');

/**
 * @route GET /api/v1/questions
 * @desc Get all questions (question bank)
 * @access Private (Educator, Admin)
 */
router.get('/', authenticate, isEducatorOrAdmin, examController.getQuestions);

/**
 * @route POST /api/v1/questions
 * @desc Create a new question
 * @access Private (Educator, Admin)
 */
router.post('/', authenticate, isEducatorOrAdmin, questionValidation.create, examController.createQuestion);

/**
 * @route PUT /api/v1/questions/:id
 * @desc Update a question
 * @access Private (Educator, Admin)
 */
router.put('/:id', authenticate, isEducatorOrAdmin, examController.updateQuestion);

/**
 * @route DELETE /api/v1/questions/:id
 * @desc Delete a question
 * @access Private (Educator, Admin)
 */
router.delete('/:id', authenticate, isEducatorOrAdmin, examController.deleteQuestion);

module.exports = router;
