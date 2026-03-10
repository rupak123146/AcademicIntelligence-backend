/**
 * 🎓 Academic Intelligence Platform - Intervention Controller
 * Handles educator intervention tracking endpoints
 */

const { prisma } = require('../config/database');
const { successResponse, asyncHandler, ApiError } = require('../utils/helpers');
const { paginate, buildPaginationMeta } = require('../utils/helpers');
const { createNotification } = require('../services/notificationService');
const { getFlagValue } = require('../services/featureFlagService');

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
      courseId: courseId || null,
      interventionType,
      reason,
      plannedActions,
      targetMetrics: targetMetrics || {},
      estimatedDuration: estimatedDuration || null,
    },
  });

  if (getFlagValue('interventionsAndGoals')) {
    await createNotification({
      userId: studentId,
      courseId: courseId || null,
      notificationType: 'intervention_alert',
      title: 'New Learning Intervention',
      message: 'Your educator has created a support intervention for your progress.',
      priority: 'high',
      actionUrl: '/student/interventions',
      metadata: { interventionId: intervention.id },
    }).catch(() => {});
  }

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

  if (getFlagValue('interventionsAndGoals')) {
    await createNotification({
      userId: intervention.studentId,
      courseId: intervention.courseId,
      notificationType: 'intervention_alert',
      title: 'Intervention Started',
      message: 'Your intervention plan is now active.',
      priority: 'medium',
      actionUrl: '/student/interventions',
      metadata: { interventionId: intervention.id },
    }).catch(() => {});
  }

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

  if (getFlagValue('interventionsAndGoals')) {
    await createNotification({
      userId: intervention.studentId,
      courseId: intervention.courseId,
      notificationType: 'intervention_alert',
      title: 'Intervention Completed',
      message: 'Your intervention has been marked as completed.',
      priority: 'medium',
      actionUrl: '/student/interventions',
      metadata: { interventionId: intervention.id },
    }).catch(() => {});
  }

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
  const { courseId, status, interventionType, page, limit } = req.query;
  const pagination = paginate(page, limit);

  const where = { studentId };
  if (courseId) where.courseId = courseId;
  if (status) where.status = status;
  if (interventionType) where.interventionType = interventionType;

  const total = await prisma.intervention.count({ where });

  const interventions = await prisma.intervention.findMany({
    where,
    include: { checkins: true },
    orderBy: { createdAt: 'desc' },
    skip: pagination.offset,
    take: pagination.limit,
  });

  successResponse(res, 200, 'Student interventions retrieved', interventions, buildPaginationMeta(pagination.page, pagination.limit, total));
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

/**
 * Get educator's interventions
 * GET /api/v1/interventions/educator
 */
const getEducatorInterventions = asyncHandler(async (req, res) => {
  const educatorId = req.user.id;
  const { status, interventionType, page, limit } = req.query;
  const pagination = paginate(page, limit);

  const where = { educatorId };
  if (status) where.status = status;
  if (interventionType) where.interventionType = interventionType;

  const total = await prisma.intervention.count({ where });

  const interventions = await prisma.intervention.findMany({
    where,
    include: {
      checkins: { orderBy: { checkinDate: 'desc' } },
    },
    orderBy: { createdAt: 'desc' },
    skip: pagination.offset,
    take: pagination.limit,
  });

  // Enrich with student names
  const studentIds = [...new Set(interventions.map(i => i.studentId))];
  const students = await prisma.user.findMany({
    where: { id: { in: studentIds } },
    select: { id: true, firstName: true, lastName: true, studentId: true },
  });
  const studentMap = Object.fromEntries(students.map(s => [s.id, s]));

  const enriched = interventions.map(i => {
    const student = studentMap[i.studentId];
    return {
      ...i,
      studentName: student ? `${student.firstName} ${student.lastName}` : 'Unknown',
      studentUsn: student?.studentId || null,
    };
  });

  successResponse(res, 200, 'Educator interventions retrieved', enriched, buildPaginationMeta(pagination.page, pagination.limit, total));
});

/**
 * Get student's own interventions
 * GET /api/v1/interventions/my-interventions
 */
const getMyInterventions = asyncHandler(async (req, res) => {
  const studentId = req.user.id;
  const { status, page, limit } = req.query;
  const pagination = paginate(page, limit);

  const where = { studentId };
  if (status) where.status = status;

  const total = await prisma.intervention.count({ where });

  const interventions = await prisma.intervention.findMany({
    where,
    include: {
      checkins: { orderBy: { checkinDate: 'desc' } },
    },
    orderBy: { createdAt: 'desc' },
    skip: pagination.offset,
    take: pagination.limit,
  });

  // Enrich with educator names
  const educatorIds = [...new Set(interventions.map(i => i.educatorId))];
  const educators = await prisma.user.findMany({
    where: { id: { in: educatorIds } },
    select: { id: true, firstName: true, lastName: true },
  });
  const educatorMap = Object.fromEntries(educators.map(e => [e.id, e]));

  const enriched = interventions.map(i => {
    const educator = educatorMap[i.educatorId];
    return {
      ...i,
      educatorName: educator ? `${educator.firstName} ${educator.lastName}` : 'Unknown',
    };
  });

  successResponse(res, 200, 'Student interventions retrieved', enriched, buildPaginationMeta(pagination.page, pagination.limit, total));
});

module.exports = {
  createIntervention,
  startIntervention,
  addInterventionCheckin,
  recordInterventionOutcome,
  completeIntervention,
  getInterventionDetails,
  getStudentInterventions,
  getEducatorInterventions,
  getMyInterventions,
  getInterventionEffectiveness,
};
