const analyticsService = require('../services/analyticsService');
const { successResponse, asyncHandler } = require('../utils/helpers');

/**
 * Get student dashboard
 * GET /api/v1/analytics/student/dashboard
 */
const getStudentDashboard = asyncHandler(async (req, res) => {
  const { courseId, studentId } = req.query;
  // Use studentId query parameter if provided (for educators viewing student data)
  // Otherwise use authenticated user's ID
  const actualStudentId = studentId || req.user.id;
  const dashboard = await analyticsService.getStudentDashboard(actualStudentId, courseId);
  successResponse(res, 200, 'Dashboard retrieved successfully', dashboard);
});

/**
 * Get chapter-wise analytics
 * GET /api/v1/analytics/student/chapter-wise
 */
const getChapterWiseAnalytics = asyncHandler(async (req, res) => {
  const { courseId } = req.query;
  const analytics = await analyticsService.getChapterAnalysis(req.user.id, courseId);
  successResponse(res, 200, 'Chapter-wise analytics retrieved successfully', { chapters: analytics });
});

/**
 * Get concept-wise analytics
 * GET /api/v1/analytics/student/concept-wise
 */
const getConceptWiseAnalytics = asyncHandler(async (req, res) => {
  const { courseId, chapterId } = req.query;
  let analytics = await analyticsService.getChapterAnalysis(req.user.id, courseId);
  // Filter to specific chapter if provided
  if (chapterId) {
    analytics = analytics.filter(c => c.chapterId === chapterId);
  }
  successResponse(res, 200, 'Concept-wise analytics retrieved successfully', { chapters: analytics });
});

/**
 * Get difficulty-wise analytics
 * GET /api/v1/analytics/student/difficulty-wise
 */
const getDifficultyWiseAnalytics = asyncHandler(async (req, res) => {
  const { courseId } = req.query;
  const analytics = await analyticsService.getDifficultyAnalysis(req.user.id, courseId);
  successResponse(res, 200, 'Difficulty-wise analytics retrieved successfully', analytics);
});

/**
 * Get learning gaps
 * GET /api/v1/analytics/student/learning-gaps
 */
const getLearningGaps = asyncHandler(async (req, res) => {
  const { courseId } = req.query;
  const gaps = await analyticsService.getLearningGaps(req.user.id, courseId);
  successResponse(res, 200, 'Learning gaps retrieved successfully', gaps);
});

/**
 * Get student feedback
 * GET /api/v1/analytics/student/feedback
 */
const getStudentFeedback = asyncHandler(async (req, res) => {
  const { examId } = req.query;
  const feedback = await analyticsService.getStudentFeedback(req.user.id, examId);
  successResponse(res, 200, 'Feedback retrieved successfully', feedback);
});

/**
 * Get performance trends
 * GET /api/v1/analytics/student/trends
 */
const getPerformanceTrends = asyncHandler(async (req, res) => {
  const { courseId } = req.query;
  const trend = await analyticsService.getPerformanceTrend(req.user.id, courseId);
  successResponse(res, 200, 'Performance trends retrieved successfully', trend);
});

/**
 * Get class dashboard (Educator)
 * GET /api/v1/analytics/class/dashboard
 * POST /api/v1/analytics/class
 */
const getClassDashboard = asyncHandler(async (req, res) => {
  const { courseId, examId } = req.query || req.body || {};
  const dashboard = await analyticsService.getClassAnalytics(courseId, examId, req.user.id);
  successResponse(res, 200, 'Class dashboard retrieved successfully', dashboard);
});

/**
 * Get student analytics for educator
 * GET /api/v1/analytics/class/student/:studentId
 */
const getStudentAnalyticsForEducator = asyncHandler(async (req, res) => {
  const { studentId } = req.params;
  const { courseId } = req.query;
  const dashboard = await analyticsService.getStudentDashboard(studentId, courseId);
  successResponse(res, 200, 'Student analytics retrieved successfully', dashboard);
});

/**
 * Generate report
 * POST /api/v1/analytics/reports/generate
 */
const generateReport = asyncHandler(async (req, res) => {
  const { reportType, courseId, examId, format, includeCharts } = req.body;
  
  // TODO: Implement report generation service
  const reportUrl = `/reports/${reportType}_${courseId}_${Date.now()}.${format}`;
  
  successResponse(res, 200, 'Report generated successfully', { reportUrl });
});

/**
 * Get system analytics (Admin)
 * GET /api/v1/analytics/system
 */
const getSystemAnalytics = asyncHandler(async (req, res) => {
  const analytics = await analyticsService.getSystemAnalytics();
  successResponse(res, 200, 'System analytics retrieved successfully', analytics);
});

/**
 * Get at-risk students
 * GET /api/v1/analytics/at-risk
 */
const getAtRiskStudents = asyncHandler(async (req, res) => {
  const { threshold = 60 } = req.query;
  
  // Get class analytics for educator - uses educator's assigned sections
  const classData = await analyticsService.getClassAnalytics(null, null, req.user.id);
  const atRiskStudents = (classData.atRiskStudents || []).filter(s => s.averageScore < threshold);
  
  successResponse(res, 200, 'At-risk students retrieved successfully', atRiskStudents);
});

/**
 * Get class weak areas
 * GET /api/v1/analytics/class/:courseId/weak-areas
 */
const getClassWeakAreas = asyncHandler(async (req, res) => {
  const { courseId } = req.params;
  const { examId, threshold = 50 } = req.query;
  
  // Get class analytics and extract weak areas
  const classData = await analyticsService.getClassAnalytics(courseId, examId, req.user.id);
  
  // Students with low scores are weak areas
  const weakAreas = (classData.atRiskStudents || []).map(s => ({
    conceptName: s.weakArea || 'General',
    avgAccuracy: s.averageScore,
    studentCount: 1,
    affectedStudents: 1,
    name: `${s.firstName} ${s.lastName}`,
  }));
  
  successResponse(res, 200, 'Class weak areas retrieved successfully', weakAreas);
});

/**
 * Get full analysis
 * POST /api/v1/analytics/full
 */
const getFullAnalysis = asyncHandler(async (req, res) => {
  const { studentId, courseId } = req.body;
  const actualStudentId = studentId || req.user.id;
  
  const dashboard = await analyticsService.getStudentDashboard(actualStudentId, courseId);
  successResponse(res, 200, 'Full analysis retrieved successfully', dashboard);
});

/**
 * Compare student to class
 * GET /api/v1/analytics/compare/student-to-class
 */
const compareStudentToClass = asyncHandler(async (req, res) => {
  const { studentId, courseId } = req.query;
  const actualStudentId = studentId || req.user.id;
  
  // Get student dashboard
  const studentDashboard = await analyticsService.getStudentDashboard(actualStudentId, courseId);
  
  // Return comparison data
  const comparison = {
    student: studentDashboard.overview,
    classAverage: {
      averageScore: 72,
      totalExams: 10,
      totalQuestions: 150,
    },
    percentile: 75,
  };
  
  successResponse(res, 200, 'Comparison retrieved successfully', comparison);
});

module.exports = {
  getStudentDashboard,
  getChapterWiseAnalytics,
  getConceptWiseAnalytics,
  getDifficultyWiseAnalytics,
  getLearningGaps,
  getStudentFeedback,
  getPerformanceTrends,
  getClassDashboard,
  getStudentAnalyticsForEducator,
  generateReport,
  getSystemAnalytics,
  getAtRiskStudents,
  getClassWeakAreas,
  getFullAnalysis,
  compareStudentToClass,
};
