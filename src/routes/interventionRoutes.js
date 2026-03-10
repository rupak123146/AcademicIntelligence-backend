/**
 * 🎓 Academic Intelligence Platform - Intervention Routes
 * Routes for educator intervention tracking
 */

const express = require('express');
const router = express.Router();
const interventionController = require('../controllers/interventionController');
const { authenticate, isEducatorOrAdmin } = require('../middleware/auth');

// All routes require authentication
router.use(authenticate);

/**
 * @route   GET /api/v1/interventions/my-interventions
 * @desc    Get logged-in student's own interventions
 * @access  Private (Student)
 */
router.get('/my-interventions', interventionController.getMyInterventions);

// Routes below require educator or admin role
router.use(isEducatorOrAdmin);

/**
 * @route   GET /api/v1/interventions/educator
 * @desc    Get all interventions created by the logged-in educator
 * @access  Private (Educator)
 */
router.get('/educator', interventionController.getEducatorInterventions);

/**
 * @route   POST /api/v1/interventions/create
 * @desc    Create a new intervention
 * @access  Private (Educator)
 */
router.post('/create', interventionController.createIntervention);

/**
 * @route   POST /api/v1/interventions/:interventionId/start
 * @desc    Start an intervention
 * @access  Private (Educator)
 */
router.post('/:interventionId/start', interventionController.startIntervention);

/**
 * @route   POST /api/v1/interventions/:interventionId/checkin
 * @desc    Add intervention check-in
 * @access  Private (Educator)
 */
router.post('/:interventionId/checkin', interventionController.addInterventionCheckin);

/**
 * @route   POST /api/v1/interventions/:interventionId/outcome
 * @desc    Record intervention outcome
 * @access  Private (Educator)
 */
router.post('/:interventionId/outcome', interventionController.recordInterventionOutcome);

/**
 * @route   POST /api/v1/interventions/:interventionId/complete
 * @desc    Complete intervention
 * @access  Private (Educator)
 */
router.post('/:interventionId/complete', interventionController.completeIntervention);

/**
 * @route   GET /api/v1/interventions/student/:studentId
 * @desc    Get all interventions for a student
 * @access  Private (Educator)
 */
router.get('/student/:studentId', interventionController.getStudentInterventions);

/**
 * @route   GET /api/v1/interventions/effectiveness
 * @desc    Get intervention effectiveness analytics
 * @access  Private (Educator/Admin)
 */
router.get('/effectiveness', interventionController.getInterventionEffectiveness);

/**
 * @route   GET /api/v1/interventions/:interventionId
 * @desc    Get intervention details
 * @access  Private (Educator)
 */
router.get('/:interventionId', interventionController.getInterventionDetails);

module.exports = router;
