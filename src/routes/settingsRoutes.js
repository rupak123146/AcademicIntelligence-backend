const express = require('express');
const router = express.Router();
const { authenticate, authorize } = require('../middleware/auth');
const { successResponse, asyncHandler, ApiError } = require('../utils/helpers');
const { prisma } = require('../config/database');
const { listFlags, setFlag } = require('../services/featureFlagService');

/**
 * @route GET /api/v1/settings/institution
 * @desc Get institution settings for the logged-in user's institution
 * @access Private (Admin)
 */
router.get('/institution', authenticate, authorize('admin'), asyncHandler(async (req, res) => {
  const { institutionId } = req.user;

  let institution = null;
  if (institutionId) {
    institution = await prisma.institution.findUnique({
      where: { id: institutionId },
    });
  }

  const settings = {
    institution: institution ? {
      id: institution.id,
      name: institution.name,
      code: institution.code,
      address: institution.address,
      isActive: institution.isActive,
    } : null,
    preferences: {
      defaultExamDuration: 60,
      passingScore: 40,
      allowLateSubmissions: false,
      autoGrading: true,
      showResultsImmediately: true,
      emailNotifications: true,
    },
    branding: {
      primaryColor: '#6366f1',
      secondaryColor: '#8b5cf6',
      logoUrl: null,
    },
  };

  successResponse(res, 200, 'Institution settings retrieved successfully', settings);
}));

/**
 * @route PUT /api/v1/settings/institution
 * @desc Update institution settings
 * @access Private (Admin)
 */
router.put('/institution', authenticate, authorize('admin'), asyncHandler(async (req, res) => {
  const { institutionId } = req.user;
  const { name, address } = req.body;

  if (institutionId) {
    const institution = await prisma.institution.findUnique({
      where: { id: institutionId },
    });
    if (institution) {
      await prisma.institution.update({
        where: { id: institutionId },
        data: {
          name: name || institution.name,
          address: address || institution.address,
        },
      });
    }
  }

  successResponse(res, 200, 'Institution settings updated successfully', {
    message: 'Settings saved',
  });
}));

/**
 * @route GET /api/v1/settings/feature-flags
 * @desc Get current feature flags
 * @access Private (Admin)
 */
router.get('/feature-flags', authenticate, authorize('admin'), asyncHandler(async (_req, res) => {
  successResponse(res, 200, 'Feature flags retrieved', listFlags());
}));

/**
 * @route PUT /api/v1/settings/feature-flags/:flagName
 * @desc Update a feature flag
 * @access Private (Admin)
 */
router.put('/feature-flags/:flagName', authenticate, authorize('admin'), asyncHandler(async (req, res) => {
  const { flagName } = req.params;
  const { enabled } = req.body;
  const updated = setFlag(flagName, !!enabled);

  if (!updated) {
    throw ApiError.badRequest(`Unknown feature flag: ${flagName}`);
  }

  successResponse(res, 200, 'Feature flag updated', {
    flagName,
    enabled: !!enabled,
  });
}));

module.exports = router;