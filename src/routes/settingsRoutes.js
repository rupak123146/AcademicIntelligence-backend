const express = require('express');
const router = express.Router();
const { authenticate, authorize } = require('../middleware/auth');
const { successResponse, asyncHandler } = require('../utils/helpers');
const { prisma } = require('../config/database');

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

module.exports = router;