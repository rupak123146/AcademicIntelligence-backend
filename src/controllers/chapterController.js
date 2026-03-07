/**
 * 🎓 Academic Intelligence Platform - Chapter Controller
 * Chapter management endpoints
 */

const chapterService = require('../services/chapterService');
const { asyncHandler, successResponse } = require('../utils/helpers');

/**
 * Create a new chapter
 * POST /api/v1/subjects/:subjectId/chapters
 */
const createChapter = asyncHandler(async (req, res) => {
  const chapter = await chapterService.createChapter(
    { ...req.body, subjectId: req.params.subjectId },
    req.user.id
  );
  successResponse(res, 201, 'Chapter created successfully', chapter);
});

/**
 * Get chapters for a subject
 * GET /api/v1/subjects/:subjectId/chapters
 */
const getChaptersBySubject = asyncHandler(async (req, res) => {
  const result = await chapterService.getChaptersBySubject(req.params.subjectId, {
    page: req.query.page,
    limit: req.query.limit,
    simple: req.query.simple === 'true',
  });
  successResponse(res, 200, 'Chapters retrieved successfully', result.chapters, result.meta);
});

/**
 * Get chapter by ID
 * GET /api/v1/chapters/:id
 */
const getChapterById = asyncHandler(async (req, res) => {
  const chapter = await chapterService.getChapterById(req.params.id);
  successResponse(res, 200, 'Chapter retrieved successfully', chapter);
});

/**
 * Update chapter
 * PUT /api/v1/chapters/:id
 */
const updateChapter = asyncHandler(async (req, res) => {
  const chapter = await chapterService.updateChapter(req.params.id, req.body);
  successResponse(res, 200, 'Chapter updated successfully', chapter);
});

/**
 * Delete chapter
 * DELETE /api/v1/chapters/:id
 */
const deleteChapter = asyncHandler(async (req, res) => {
  await chapterService.deleteChapter(req.params.id);
  successResponse(res, 200, 'Chapter deleted successfully');
});

module.exports = {
  createChapter,
  getChaptersBySubject,
  getChapterById,
  updateChapter,
  deleteChapter,
};
