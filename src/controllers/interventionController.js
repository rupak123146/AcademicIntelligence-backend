/**
 * 🎓 Academic Intelligence Platform - Intervention Controller
 * Handles educator intervention tracking endpoints
 */

const { prisma } = require('../config/database');
const { successResponse, asyncHandler, ApiError } = require('../utils/helpers');

/**
 * Create intervention
 * POST /api/v1/interventions/create
 */
const createIntervention = asyncHandler(async (req, res) => {
  const {
    studentId,
    educatorId,
    courseId,
    interventionType,
    reason,
    plannedActions,
    targetMetrics,
    estimatedDuration,
  } = req.body;

  const intervention = await prisma.intervention.create({
    data: {
      studentId,
      educatorId,
      courseId,
      interventionType,
      reason,
      plannedActions,
      targetMetrics: targetMetrics || {},
      estimatedDuration: estimatedDuration || null,
    },
  });

  successResponse(res, 201, 'Intervention created successfully', intervention);
});

/**
 * Start intervention
 * POST /api/v1/interventions/:interventionId/start
 */
const startIntervention = asyncHandler(async (req, res) => {
  const { interventionId } = req.params;
  const { actualStartDate, notes } = req.body;

  const intervention = await prisma.intervention.update({
    where: { id: interventionId },
    data: {
      status: 'active',
      actualStartDate: actualStartDate ? new Date(actualStartDate) : new Date(),
      notes: notes || '',
    },
  });

  successResponse(res, 200, 'Intervention started', intervention);
});

/**
 * Add intervention check-in
 * POST /api/v1/interventions/:interventionId/checkin
 */
const addInterventionCheckin = asyncHandler(async (req, res) => {
  const { interventionId } = req.params;
  const { progress, observations, nextSteps, metricsUpdate } = req.body;

  const checkin = await prisma.interventionCheckin.create({
    data: {
      interventionId,
      progress: progress || 'on_track',
      observations,
      nextSteps: nextSteps || '',
      metricsUpdate: metricsUpdate || {},
    },
  });

  successResponse(res, 201, 'Check-in recorded successfully', checkin);
});

/**
 * Record intervention outcome
 * POST /api/v1/interventions/:interventionId/outcome
 */
const recordInterventionOutcome = asyncHandler(async (req, res) => {
  const { interventionId } = req.params;
  const { outcome, finalMetrics, notes, recommendFollowup } = req.body;

  const intervention = await prisma.intervention.update({
    where: { id: interventionId },
    data: {
      outcome,
      notes: notes || '',
      targetMetrics: finalMetrics || {},
    },
  });

  successResponse(res, 200, 'Intervention outcome recorded', intervention);
});

/**
 * Complete intervention
 * POST /api/v1/interventions/:interventionId/complete
 */
const completeIntervention = asyncHandler(async (req, res) => {
  const { interventionId } = req.params;
  const { completionDate, finalNotes } = req.body;

  const intervention = await prisma.intervention.update({
    where: { id: interventionId },
    data: {
      status: 'completed',
      completionDate: completionDate ? new Date(completionDate) : new Date(),
      notes: finalNotes || '',
    },
  });

  successResponse(res, 200, 'Intervention completed', intervention);
});

/**
 * Get intervention details
 * GET /api/v1/interventions/:interventionId
 */
const getInterventionDetails = asyncHandler(async (req, res) => {
  const { interventionId } = req.params;
  const { includeCheckins } = req.query;

  const intervention = await prisma.intervention.findUnique({
    where: { id: interventionId },
    include: {
      checkins: includeCheckins !== 'false',
    },
  });

  if (!intervention) {
    throw ApiError.notFound('Intervention not found');
  }

  successResponse(res, 200, 'Intervention details retrieved', intervention);
});

/**
 * Get student interventions
 * GET /api/v1/interventions/student/:studentId
 */
const getStudentInterventions = asyncHandler(async (req, res) => {
  const { studentId } = req.params;
  const { courseId, status, interventionType } = req.query;

  const where = { studentId };
  if (courseId) where.courseId = courseId;
  if (status) where.status = status;
  if (interventionType) where.interventionType = interventionType;

  const interventions = await prisma.intervention.findMany({
    where,
    include: { checkins: true },
    orderBy: { createdAt: 'desc' },
  });

  successResponse(res, 200, 'Student interventions retrieved', interventions);
});

/**
 * Get intervention effectiveness
 * GET /api/v1/interventions/effectiveness
 */
const getInterventionEffectiveness = asyncHandler(async (req, res) => {
  const { courseId, educatorId, interventionType } = req.query;

  const where = {};
  if (courseId) where.courseId = courseId;
  if (educatorId) where.educatorId = educatorId;
  if (interventionType) where.interventionType = interventionType;

  const interventions = await prisma.intervention.findMany({
    where,
    include: { checkins: true },
  });

  // Calculate effectiveness metrics
  const total = interventions.length;
  const completed = interventions.filter(i => i.status === 'completed').length;
  const active = interventions.filter(i => i.status === 'active').length;
  const planned = interventions.filter(i => i.status === 'planned').length;
  const cancelled = interventions.filter(i => i.status === 'cancelled').length;

  const effectiveness = {
    totalInterventions: total,
    completed,
    active,
    planned,
    cancelled,
    completionRate: total > 0 ? (completed / total * 100).toFixed(2) : 0,
    interventions: interventions.map(i => ({
      id: i.id,
      studentId: i.studentId,
      type: i.interventionType,
      status: i.status,
      createdAt: i.createdAt,
      completedAt: i.completionDate,
      checkinCount: i.checkins?.length || 0,
    })),
  };

  successResponse(res, 200, 'Intervention effectiveness data retrieved', effectiveness);
});

module.exports = {
  createIntervention,
  startIntervention,
  addInterventionCheckin,
  recordInterventionOutcome,
  completeIntervention,
  getInterventionDetails,
  getStudentInterventions,
  getInterventionEffectiveness,
};
