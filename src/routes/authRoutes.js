const express = require('express');
const router = express.Router();
const authController = require('../controllers/authController');
const { authenticate, authorize } = require('../middleware/auth');
const { authValidation } = require('../middleware/validation');

/**
 * @route POST /api/v1/auth/register
 * @desc Register a new user
 * @access Public (or Admin only in production)
 */
router.post('/register', authValidation.register, authController.register);

/**
 * @route POST /api/v1/auth/login
 * @desc Login user
 * @access Public
 */
router.post('/login', authValidation.login, authController.login);

/**
 * @route POST /api/v1/auth/refresh
 * @desc Refresh access token
 * @access Public
 */
router.post('/refresh', authValidation.refreshToken, authController.refreshToken);

/**
 * @route POST /api/v1/auth/logout
 * @desc Logout user
 * @access Private
 */
router.post('/logout', authenticate, authController.logout);

/**
 * @route POST /api/v1/auth/forgot-password
 * @desc Request password reset
 * @access Public
 */
router.post('/forgot-password', authValidation.forgotPassword, authController.forgotPassword);

/**
 * @route POST /api/v1/auth/reset-password
 * @desc Reset password with token
 * @access Public
 */
router.post('/reset-password', authValidation.resetPassword, authController.resetPassword);

/**
 * @route POST /api/v1/auth/change-password
 * @desc Change password (logged in user)
 * @access Private
 */
router.post('/change-password', authenticate, authController.changePassword);

/**
 * @route GET /api/v1/auth/me
 * @desc Get current user
 * @access Private
 */
router.get('/me', authenticate, authController.getCurrentUser);

/**
 * @route GET /api/v1/auth/users
 * @desc Get all users (Admin only)
 * @access Private (Admin)
 */
router.get('/users', authenticate, authorize('admin'), authController.getAllUsers);

/**
 * @route PUT /api/v1/auth/users/:id
 * @desc Update user (Admin only)
 * @access Private (Admin)
 */
router.put('/users/:id', authenticate, authorize('admin'), authController.updateUser);

/**
 * @route GET /api/v1/auth/institutions
 * @desc Get all institutions
 * @access Private
 */
router.get('/institutions', authenticate, authController.getInstitutions);

module.exports = router;
