/**
 * 🎓 Academic Intelligence Platform - Concept Controller
 * Concept management endpoints
 */

const conceptService = require('../services/conceptService');
const { asyncHandler, successResponse } = require('../utils/helpers');

/**
 * Create a new concept
 * POST /api/v1/chapters/:chapterId/concepts
 */
const createConcept = asyncHandler(async (req, res) => {
  const concept = await conceptService.createConcept(
    { ...req.body, chapterId: req.params.chapterId },
    req.user.id
  );
  successResponse(res, 201, 'Concept created successfully', concept);
});

/**
 * Get concepts for a chapter
 * GET /api/v1/chapters/:chapterId/concepts
 */
const getConceptsByChapter = asyncHandler(async (req, res) => {
  const result = await conceptService.getConceptsByChapter(req.params.chapterId, {
    page: req.query.page,
    limit: req.query.limit,
    simple: req.query.simple === 'true',
  });
  successResponse(res, 200, 'Concepts retrieved successfully', result.concepts, result.meta);
});

/**
 * Get concept by ID
 * GET /api/v1/concepts/:id
 */
const getConceptById = asyncHandler(async (req, res) => {
  const concept = await conceptService.getConceptById(req.params.id);
  successResponse(res, 200, 'Concept retrieved successfully', concept);
});

/**
 * Update concept
 * PUT /api/v1/concepts/:id
 */
const updateConcept = asyncHandler(async (req, res) => {
  const concept = await conceptService.updateConcept(req.params.id, req.body);
  successResponse(res, 200, 'Concept updated successfully', concept);
});

/**
 * Delete concept
 * DELETE /api/v1/concepts/:id
 */
const deleteConcept = asyncHandler(async (req, res) => {
  await conceptService.deleteConcept(req.params.id);
  successResponse(res, 200, 'Concept deleted successfully');
});

module.exports = {
  createConcept,
  getConceptsByChapter,
  getConceptById,
  updateConcept,
  deleteConcept,
};
