/**
 * 🎓 Academic Intelligence Platform - Exam Controller
 * Complete exam management and attempt handling
 */

const examService = require('../services/examService');
const attemptService = require('../services/attemptService');
const questionService = require('../services/questionService');
const { successResponse, asyncHandler } = require('../utils/helpers');

// =====================================================
// EXAM CRUD OPERATIONS
// =====================================================

/**
 * Create a new exam
 * POST /api/v1/exams
 */
const createExam = asyncHandler(async (req, res) => {
  const exam = await examService.createExam(req.body, req.user.id);
  successResponse(res, 201, 'Exam created successfully', exam);
});

/**
 * Get all exams (filtered by role)
 * GET /api/v1/exams
 */
const getExams = asyncHandler(async (req, res) => {
  const filters = {
    page: req.query.page,
    limit: req.query.limit,
    courseId: req.query.courseId,
    subjectId: req.query.subjectId,
    status: req.query.status,
    examType: req.query.examType,
    search: req.query.search,
    startDate: req.query.startDate,
    endDate: req.query.endDate,
  };
  const result = await examService.getExams(filters, req.user.id, req.user.role);
  successResponse(res, 200, 'Exams retrieved successfully', result.exams, result.meta);
});

/**
 * Get available exams for students (section/department based)
 * GET /api/v1/exams/available
 */
const getAvailableExams = asyncHandler(async (req, res) => {
  const result = await examService.getAvailableExams(req.user.id);
  successResponse(res, 200, 'Available exams retrieved successfully', result);
});

/**
 * Get student's exam attempts
 * GET /api/v1/exams/my-attempts
 */
const getMyAttempts = asyncHandler(async (req, res) => {
  const result = await attemptService.getStudentAttempts(req.user.id, req.query);
  successResponse(res, 200, 'Attempts retrieved successfully', result);
});

/**
 * Get exam by ID
 * GET /api/v1/exams/:id
 */
const getExamById = asyncHandler(async (req, res) => {
  const exam = await examService.getExamById(req.params.id, req.user.id, req.user.role);
  successResponse(res, 200, 'Exam retrieved successfully', exam);
});

/**
 * Update exam
 * PUT /api/v1/exams/:id
 */
const updateExam = asyncHandler(async (req, res) => {
  const exam = await examService.updateExam(req.params.id, req.body, req.user.id, req.user.role);
  successResponse(res, 200, 'Exam updated successfully', exam);
});

/**
 * Delete exam
 * DELETE /api/v1/exams/:id
 */
const deleteExam = asyncHandler(async (req, res) => {
  await examService.deleteExam(req.params.id, req.user.id, req.user.role);
  successResponse(res, 200, 'Exam deleted successfully');
});

// =====================================================
// EXAM LIFECYCLE MANAGEMENT
// =====================================================

/**
 * Publish exam (DRAFT -> PUBLISHED)
 * POST /api/v1/exams/:id/publish
 */
const publishExam = asyncHandler(async (req, res) => {
  const exam = await examService.publishExam(req.params.id, req.user.id, req.user.role);
  successResponse(res, 200, 'Exam published successfully', exam);
});

/**
 * Activate exam (PUBLISHED -> ACTIVE)
 * POST /api/v1/exams/:id/activate
 */
const activateExam = asyncHandler(async (req, res) => {
  const exam = await examService.activateExam(req.params.id, req.user.id, req.user.role);
  successResponse(res, 200, 'Exam activated successfully', exam);
});

/**
 * Close exam (ACTIVE -> COMPLETED)
 * POST /api/v1/exams/:id/close
 */
const closeExam = asyncHandler(async (req, res) => {
  const exam = await examService.closeExam(req.params.id, req.user.id, req.user.role);
  successResponse(res, 200, 'Exam closed successfully', exam);
});

/**
 * Archive exam
 * POST /api/v1/exams/:id/archive
 */
const archiveExam = asyncHandler(async (req, res) => {
  const exam = await examService.archiveExam(req.params.id, req.user.id, req.user.role);
  successResponse(res, 200, 'Exam archived successfully', exam);
});

// =====================================================
// EXAM ASSIGNMENT (SECTION/DEPARTMENT)
// =====================================================

/**
 * Assign exam to sections/departments
 * POST /api/v1/exams/:id/assign
 */
const assignExam = asyncHandler(async (req, res) => {
  const { sectionIds, departmentIds, studentIds, assignmentMode } = req.body;
  const exam = await examService.assignExam(
    req.params.id,
    { sectionIds, departmentIds, studentIds, assignmentMode },
    req.user.id,
    req.user.role
  );
  successResponse(res, 200, 'Exam assigned successfully', exam);
});

/**
 * Get exam assignment details
 * GET /api/v1/exams/:id/assignments
 */
const getExamAssignments = asyncHandler(async (req, res) => {
  const assignments = await examService.getExamAssignments(req.params.id, req.user.id, req.user.role);
  successResponse(res, 200, 'Assignments retrieved successfully', assignments);
});

// =====================================================
// QUESTION MANAGEMENT
// =====================================================

/**
 * Get exam questions (for editing)
 * GET /api/v1/exams/:id/questions
 */
const getExamQuestions = asyncHandler(async (req, res) => {
  const questions = await examService.getExamQuestions(req.params.id, req.user.id, req.user.role);
  successResponse(res, 200, 'Questions retrieved successfully', questions);
});

/**
 * Add questions to exam
 * POST /api/v1/exams/:id/questions
 */
const addQuestions = asyncHandler(async (req, res) => {
  const { questionIds } = req.body;
  const exam = await examService.addQuestionsToExam(req.params.id, questionIds, req.user.id, req.user.role);
  successResponse(res, 200, 'Questions added successfully', exam);
});

/**
 * Remove questions from exam
 * DELETE /api/v1/exams/:id/questions
 */
const removeQuestions = asyncHandler(async (req, res) => {
  const { questionIds } = req.body;
  const exam = await examService.removeQuestionsFromExam(req.params.id, questionIds, req.user.id, req.user.role);
  successResponse(res, 200, 'Questions removed successfully', exam);
});

/**
 * Create a new question
 * POST /api/v1/questions
 */
const createQuestion = asyncHandler(async (req, res) => {
  const question = await questionService.createQuestion(req.body, req.user.id);
  successResponse(res, 201, 'Question created successfully', question);
});

/**
 * Get question bank
 * GET /api/v1/questions
 */
const getQuestions = asyncHandler(async (req, res) => {
  const filters = {
    subjectId: req.query.subjectId,
    chapterId: req.query.chapterId,
    conceptId: req.query.conceptId,
    difficulty: req.query.difficulty,
    questionType: req.query.questionType,
    search: req.query.search,
    page: req.query.page,
    limit: req.query.limit,
  };
  const result = await questionService.getQuestions(filters, req.user.id);
  successResponse(res, 200, 'Questions retrieved successfully', result.questions, result.meta);
});

/**
 * Update question
 * PUT /api/v1/questions/:id
 */
const updateQuestion = asyncHandler(async (req, res) => {
  const question = await questionService.updateQuestion(req.params.id, req.body, req.user.id);
  successResponse(res, 200, 'Question updated successfully', question);
});

/**
 * Delete question
 * DELETE /api/v1/questions/:id
 */
const deleteQuestion = asyncHandler(async (req, res) => {
  await questionService.deleteQuestion(req.params.id, req.user.id);
  successResponse(res, 200, 'Question deleted successfully');
});

// =====================================================
// EXAM ATTEMPT OPERATIONS
// =====================================================

/**
 * Start exam attempt
 * POST /api/v1/exams/:examId/start
 */
const startAttempt = asyncHandler(async (req, res) => {
  const metadata = {
    ipAddress: req.ip || req.connection?.remoteAddress,
    browserInfo: req.body.browserInfo || req.headers['user-agent'],
  };
  const result = await attemptService.startAttempt(req.params.examId, req.user.id, metadata);
  successResponse(res, 201, 'Exam started successfully', result);
});

/**
 * Resume an existing attempt
 * GET /api/v1/exams/:examId/resume
 * GET /api/v1/exams/:examId/attempts/:attemptId/resume
 */
const resumeAttempt = asyncHandler(async (req, res) => {
  const { examId, attemptId } = req.params;
  // If attemptId is provided, use it; otherwise find the in-progress attempt for this exam
  const result = await attemptService.resumeAttempt(attemptId || examId, req.user.id, !attemptId);
  successResponse(res, 200, 'Exam resumed successfully', result);
});

/**
 * Save answer for a question
 * PUT /api/v1/exams/:examId/attempts/:attemptId/answer
 * POST /api/v1/exams/attempts/:attemptId/answers
 */
const saveAnswer = asyncHandler(async (req, res) => {
  const { attemptId } = req.params;
  const { questionId, selectedOptionId, selectedAnswer, textAnswer, timeSpent, isMarkedForReview } = req.body;
  
  // Support both old and new format
  const answer = selectedOptionId || selectedAnswer || textAnswer;
  
  const metadata = {
    timeSpent,
    isMarkedForReview,
    ipAddress: req.ip,
  };
  
  const result = await attemptService.saveAnswer(attemptId, questionId, answer, req.user.id, metadata);
  successResponse(res, 200, 'Answer saved', result);
});

/**
 * Mark question for review
 * PUT /api/v1/exams/attempts/:attemptId/mark-review
 */
const markForReview = asyncHandler(async (req, res) => {
  const { questionId, isMarked } = req.body;
  const result = await attemptService.markForReview(req.params.attemptId, questionId, isMarked, req.user.id);
  successResponse(res, 200, 'Question marked for review', result);
});

/**
 * Submit exam attempt
 * POST /api/v1/exams/:examId/attempts/:attemptId/submit
 * POST /api/v1/exams/attempts/:attemptId/submit
 */
const submitAttempt = asyncHandler(async (req, res) => {
  const { attemptId } = req.params;
  const result = await attemptService.submitAttempt(attemptId, req.user.id);
  successResponse(res, 200, 'Exam submitted successfully', result);
});

/**
 * Get attempt result
 * GET /api/v1/exams/:examId/attempts/:attemptId/result
 * GET /api/v1/exams/attempts/:attemptId/results
 */
const getAttemptResult = asyncHandler(async (req, res) => {
  const { attemptId } = req.params;
  const result = await attemptService.getAttemptResult(attemptId, req.user.id, req.user.role);
  successResponse(res, 200, 'Result retrieved successfully', result);
});

/**
 * Get attempt details (for resuming)
 * GET /api/v1/exams/attempts/:attemptId
 */
const getAttempt = asyncHandler(async (req, res) => {
  const result = await attemptService.getAttemptDetails(req.params.attemptId, req.user.id, req.user.role);
  successResponse(res, 200, 'Attempt retrieved successfully', result);
});

// =====================================================
// EXAM ANALYTICS & REPORTING
// =====================================================

/**
 * Get exam analytics (for educators)
 * GET /api/v1/exams/:id/analytics
 */
const getExamAnalytics = asyncHandler(async (req, res) => {
  const analytics = await examService.getExamAnalytics(req.params.id, req.user.id, req.user.role);
  successResponse(res, 200, 'Analytics retrieved successfully', analytics);
});

/**
 * Get all attempts for an exam (educator view)
 * GET /api/v1/exams/:id/attempts
 */
const getExamAttempts = asyncHandler(async (req, res) => {
  const filters = {
    page: req.query.page,
    limit: req.query.limit,
    status: req.query.status,
    search: req.query.search,
  };
  const result = await examService.getExamAttempts(req.params.id, filters, req.user.id, req.user.role);
  successResponse(res, 200, 'Attempts retrieved successfully', result);
});

/**
 * Export exam results
 * GET /api/v1/exams/:id/export
 */
const exportExamResults = asyncHandler(async (req, res) => {
  const format = req.query.format || 'csv';
  const data = await examService.exportExamResults(req.params.id, format, req.user.id, req.user.role);
  
  if (format === 'csv') {
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename=exam-results-${req.params.id}.csv`);
    res.send(data);
  } else {
    successResponse(res, 200, 'Export successful', data);
  }
});

module.exports = {
  // Exam CRUD
  createExam,
  getExams,
  getAvailableExams,
  getExamById,
  updateExam,
  deleteExam,
  
  // Lifecycle
  publishExam,
  activateExam,
  closeExam,
  archiveExam,
  
  // Assignment
  assignExam,
  getExamAssignments,
  
  // Questions
  getExamQuestions,
  addQuestions,
  removeQuestions,
  createQuestion,
  getQuestions,
  updateQuestion,
  deleteQuestion,
  
  // Attempts
  startAttempt,
  resumeAttempt,
  saveAnswer,
  markForReview,
  submitAttempt,
  getAttemptResult,
  getAttempt,
  getMyAttempts,
  
  // Analytics
  getExamAnalytics,
  getExamAttempts,
  exportExamResults,
};
