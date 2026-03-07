/**
 * 🎓 Academic Intelligence Platform - Subject Controller
 * Subject management endpoints
 */

const subjectService = require('../services/subjectService');
const { asyncHandler, successResponse } = require('../utils/helpers');

/**
 * Get all subjects
 * GET /api/v1/subjects
 */
const getSubjects = asyncHandler(async (req, res) => {
  const result = await subjectService.getSubjects({
    page: req.query.page,
    limit: req.query.limit,
    simple: req.query.simple === 'true',
    institutionId: req.user?.institutionId,
  });
  successResponse(res, 200, 'Subjects retrieved successfully', result.subjects, result.meta);
});

/**
 * Get subject by ID
 * GET /api/v1/subjects/:id
 */
const getSubjectById = asyncHandler(async (req, res) => {
  const subject = await subjectService.getSubjectById(req.params.id);
  successResponse(res, 200, 'Subject retrieved successfully', subject);
});

module.exports = {
  getSubjects,
  getSubjectById,
};
