const authService = require('../services/authService');
const { successResponse, asyncHandler } = require('../utils/helpers');

/**
 * Register a new user
 * POST /api/v1/auth/register
 */
const register = asyncHandler(async (req, res) => {
  const userData = req.body;
  const user = await authService.register(userData);
  successResponse(res, 201, 'User registered successfully', user);
});

/**
 * Login user
 * POST /api/v1/auth/login
 */
const login = asyncHandler(async (req, res) => {
  const { email, password } = req.body;
  const metadata = {
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
    deviceInfo: req.body.deviceInfo,
  };
  const result = await authService.login(email, password, metadata);
  successResponse(res, 200, 'Login successful', result);
});

/**
 * Refresh access token
 * POST /api/v1/auth/refresh
 */
const refreshToken = asyncHandler(async (req, res) => {
  const { refreshToken } = req.body;
  const tokens = await authService.refreshToken(refreshToken);
  successResponse(res, 200, 'Token refreshed successfully', tokens);
});

/**
 * Logout user
 * POST /api/v1/auth/logout
 */
const logout = asyncHandler(async (req, res) => {
  await authService.logout(req.user.id);
  successResponse(res, 200, 'Logout successful');
});

/**
 * Request password reset
 * POST /api/v1/auth/forgot-password
 */
const forgotPassword = asyncHandler(async (req, res) => {
  const { email } = req.body;
  const result = await authService.forgotPassword(email);
  successResponse(res, 200, result.message);
});

/**
 * Reset password
 * POST /api/v1/auth/reset-password
 */
const resetPassword = asyncHandler(async (req, res) => {
  const { token, password } = req.body;
  const result = await authService.resetPassword(token, password);
  successResponse(res, 200, result.message);
});

/**
 * Change password
 * POST /api/v1/auth/change-password
 */
const changePassword = asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  const result = await authService.changePassword(req.user.id, currentPassword, newPassword);
  successResponse(res, 200, result.message);
});

/**
 * Get current user
 * GET /api/v1/auth/me
 */
const getCurrentUser = asyncHandler(async (req, res) => {
  successResponse(res, 200, 'User retrieved successfully', req.user);
});

/**
 * Get all users (Admin only)
 * GET /api/v1/auth/users
 */
const getAllUsers = asyncHandler(async (req, res) => {
  const filters = {
    role: req.query.role,
    institutionId: req.query.institutionId,
    isActive: req.query.isActive,
  };
  const users = await authService.getAllUsers(filters);
  successResponse(res, 200, 'Users retrieved successfully', users);
});

/**
 * Update user (Admin only)
 * PUT /api/v1/auth/users/:id
 */
const updateUser = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const updateData = req.body;
  const user = await authService.updateUser(id, updateData);
  successResponse(res, 200, 'User updated successfully', user);
});

/**
 * Get all institutions
 * GET /api/v1/auth/institutions
 */
const getInstitutions = asyncHandler(async (req, res) => {
  const institutions = await authService.getAllInstitutions();
  successResponse(res, 200, 'Institutions retrieved successfully', institutions);
});

module.exports = {
  register,
  login,
  refreshToken,
  logout,
  forgotPassword,
  resetPassword,
  changePassword,
  getCurrentUser,
  getAllUsers,
  updateUser,
  getInstitutions,
};
