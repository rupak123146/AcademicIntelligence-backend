const { verifyAccessToken } = require('../utils/auth');
const { ApiError } = require('../utils/helpers');
const { getCache, CacheKeys } = require('../config/redis');
const { prisma } = require('../config/database');
const logger = require('../utils/logger');

/**
 * Authentication middleware
 * Verifies JWT token and attaches user to request
 */
const authenticate = async (req, res, next) => {
  try {
    // Get token from header
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      throw ApiError.unauthorized('No token provided');
    }

    const token = authHeader.split(' ')[1];

    // Verify token
    const decoded = verifyAccessToken(token);
    
    if (!decoded) {
      throw ApiError.unauthorized('Invalid or expired token');
    }

    // Check if session is still valid (optional: check in Redis/DB)
    const sessionKey = CacheKeys.userSession(decoded.userId);
    const cachedSession = await getCache(sessionKey);
    
    // Get user from database to ensure they still exist and are active
    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        institutionId: true,
        departmentId: true,
        isActive: true,
      },
    });

    if (!user) {
      throw ApiError.unauthorized('User not found');
    }

    if (!user.isActive) {
      throw ApiError.unauthorized('Account has been deactivated');
    }

    // Attach user to request
    req.user = {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role,
      institutionId: user.institutionId,
      departmentId: user.departmentId,
    };

    next();
  } catch (error) {
    if (error instanceof ApiError) {
      next(error);
    } else {
      logger.error('Authentication error:', error);
      next(ApiError.unauthorized('Authentication failed'));
    }
  }
};

/**
 * Role-based authorization middleware
 * @param {string[]} allowedRoles - Array of allowed roles
 */
const authorize = (...allowedRoles) => {
  return (req, res, next) => {
    if (!req.user) {
      return next(ApiError.unauthorized('Not authenticated'));
    }

    if (!allowedRoles.includes(req.user.role)) {
      return next(ApiError.forbidden('You do not have permission to perform this action'));
    }

    next();
  };
};

/**
 * Check if user is student
 */
const isStudent = authorize('student');

/**
 * Check if user is educator
 */
const isEducator = authorize('educator');

/**
 * Check if user is admin
 */
const isAdmin = authorize('admin', 'super_admin');

/**
 * Check if user is educator or admin
 */
const isEducatorOrAdmin = authorize('educator', 'admin', 'super_admin');

/**
 * Check if user is any authenticated role
 */
const isAuthenticated = authorize('student', 'educator', 'admin', 'super_admin');

/**
 * Optional authentication - doesn't fail if no token
 */
const optionalAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return next();
    }

    const token = authHeader.split(' ')[1];
    const decoded = verifyAccessToken(token);
    
    if (decoded) {
      const user = await prisma.user.findFirst({
        where: {
          id: decoded.userId,
          isActive: true,
        },
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          role: true,
          institutionId: true,
          departmentId: true,
        },
      });

      if (user) {
        req.user = {
          id: user.id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          role: user.role,
          institutionId: user.institutionId,
          departmentId: user.departmentId,
        };
      }
    }

    next();
  } catch (error) {
    // Silently continue without authentication
    next();
  }
};

/**
 * Check resource ownership
 * @param {Function} getOwnerId - Function to get owner ID from request
 */
const checkOwnership = (getOwnerId) => {
  return async (req, res, next) => {
    try {
      if (!req.user) {
        return next(ApiError.unauthorized('Not authenticated'));
      }

      // Admins can access any resource
      if (['admin', 'super_admin'].includes(req.user.role)) {
        return next();
      }

      const ownerId = await getOwnerId(req);
      
      if (ownerId !== req.user.id) {
        return next(ApiError.forbidden('You do not have access to this resource'));
      }

      next();
    } catch (error) {
      next(error);
    }
  };
};

/**
 * Check same institution
 */
const checkSameInstitution = (getInstitutionId) => {
  return async (req, res, next) => {
    try {
      if (!req.user) {
        return next(ApiError.unauthorized('Not authenticated'));
      }

      // Super admins can access any institution
      if (req.user.role === 'super_admin') {
        return next();
      }

      const institutionId = await getInstitutionId(req);
      
      if (institutionId !== req.user.institutionId) {
        return next(ApiError.forbidden('You do not have access to this institution\'s resources'));
      }

      next();
    } catch (error) {
      next(error);
    }
  };
};

module.exports = {
  authenticate,
  authorize,
  isStudent,
  isEducator,
  isAdmin,
  isEducatorOrAdmin,
  isAuthenticated,
  optionalAuth,
  checkOwnership,
  checkSameInstitution,
};
