/**
 * 🎓 Academic Intelligence Platform - Goal Controller
 * Handles student goal tracking endpoints
 */

const { prisma } = require('../config/database');
const { successResponse, asyncHandler, ApiError } = require('../utils/helpers');

/**
 * Create a new goal
 * POST /api/v1/goals/create
 */
const createGoal = asyncHandler(async (req, res) => {
  const {
    studentId,
    courseId,
    goalType,
    targetValue,
    targetDate,
    description,
  } = req.body;

  const goal = await prisma.goal.create({
    data: {
      studentId,
      courseId,
      goalType,
      targetValue: parseFloat(targetValue),
      targetDate: new Date(targetDate),
      description: description || '',
    },
  });

  successResponse(res, 201, 'Goal created successfully', goal);
});

/**
 * Get student goals
 * GET /api/v1/goals/student/:studentId
 */
const getStudentGoals = asyncHandler(async (req, res) => {
  const { studentId } = req.params;
  const { courseId, status } = req.query;

  const where = { studentId };
  if (courseId) where.courseId = courseId;
  if (status) where.status = status;

  const goals = await prisma.goal.findMany({
    where,
    include: { course: true },
    orderBy: { createdAt: 'desc' },
  });

  successResponse(res, 200, 'Goals retrieved successfully', goals);
});

/**
 * Update goal progress
 * POST /api/v1/goals/:goalId/update-progress
 */
const updateGoalProgress = asyncHandler(async (req, res) => {
  const { goalId } = req.params;
  const { currentValue, notes } = req.body;

  const goal = await prisma.goal.update({
    where: { id: goalId },
    data: {
      currentValue: parseFloat(currentValue),
      metadata: notes ? { notes, updatedAt: new Date() } : undefined,
    },
  });

  // Auto-complete goal if target reached
  if (goal.currentValue >= goal.targetValue && goal.status === 'active') {
    await prisma.goal.update({
      where: { id: goalId },
      data: { status: 'completed' },
    });
  }

  successResponse(res, 200, 'Goal progress updated', goal);
});

/**
 * Get goal details with history
 * GET /api/v1/goals/:goalId
 */
const getGoalDetails = asyncHandler(async (req, res) => {
  const { goalId } = req.params;

  const goal = await prisma.goal.findUnique({
    where: { id: goalId },
    include: { course: true },
  });

  if (!goal) {
    throw ApiError.notFound('Goal not found');
  }

  successResponse(res, 200, 'Goal details retrieved', goal);
});

/**
 * Get course goals summary
 * GET /api/v1/goals/course/:courseId/summary
 */
const getCourseGoalsSummary = asyncHandler(async (req, res) => {
  const { courseId } = req.params;

  const goals = await prisma.goal.findMany({
    where: { courseId },
  });

  const summary = {
    totalGoals: goals.length,
    active: goals.filter(g => g.status === 'active').length,
    completed: goals.filter(g => g.status === 'completed').length,
    cancelled: goals.filter(g => g.status === 'cancelled').length,
    expired: goals.filter(g => g.status === 'expired').length,
    averageProgress: goals.length > 0 
      ? (goals.reduce((sum, g) => sum + (g.currentValue / g.targetValue * 100), 0) / goals.length).toFixed(2)
      : 0,
    goals: goals.map(g => ({
      id: g.id,
      studentId: g.studentId,
      goalType: g.goalType,
      progress: (g.currentValue / g.targetValue * 100).toFixed(2),
      status: g.status,
      targetDate: g.targetDate,
    })),
  };

  successResponse(res, 200, 'Course goals summary retrieved', summary);
});

module.exports = {
  createGoal,
  getStudentGoals,
  updateGoalProgress,
  getGoalDetails,
  getCourseGoalsSummary,
};
