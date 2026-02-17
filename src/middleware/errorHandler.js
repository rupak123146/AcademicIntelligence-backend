const rateLimit = require('express-rate-limit');
const { Prisma } = require('@prisma/client');
const { ApiError, errorResponse } = require('../utils/helpers');
const logger = require('../utils/logger');
const config = require('../config');

/**
 * Global error handler middleware
 */
const errorHandler = (err, req, res, next) => {
  // Log error
  logger.error('Error:', {
    message: err.message,
    stack: err.stack,
    path: req.path,
    method: req.method,
    userId: req.user?.id,
  });

  // Handle specific error types
  if (err instanceof ApiError) {
    return errorResponse(res, err);
  }

  // Handle Mongoose validation errors
  if (err.name === 'ValidationError') {
    const errors = Object.values(err.errors).map((e) => ({
      field: e.path,
      message: e.message,
    }));
    return errorResponse(res, ApiError.badRequest('Validation error', errors));
  }

  // Handle duplicate key errors
  if (err.code === 11000 || err.code === '23505') {
    return errorResponse(res, ApiError.conflict('Duplicate entry'));
  }

  // Handle Prisma errors
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') {
      return errorResponse(res, ApiError.conflict('Duplicate entry'));
    }
    if (err.code === 'P2003') {
      return errorResponse(res, ApiError.badRequest('Invalid relation reference'));
    }
    if (err.code === 'P2025') {
      return errorResponse(res, ApiError.notFound('Record not found'));
    }
  }

  // Handle JWT errors
  if (err.name === 'JsonWebTokenError') {
    return errorResponse(res, ApiError.unauthorized('Invalid token'));
  }

  if (err.name === 'TokenExpiredError') {
    return errorResponse(res, ApiError.unauthorized('Token expired'));
  }

  // Handle PostgreSQL errors
  if (err.code && err.code.startsWith('22')) {
    return errorResponse(res, ApiError.badRequest('Invalid data format'));
  }

  if (err.code && err.code.startsWith('23')) {
    return errorResponse(res, ApiError.badRequest('Database constraint violation'));
  }

  // Default to 500 internal server error
  const error = ApiError.internal(
    config.env === 'development' ? err.message : 'Internal server error'
  );
  
  return errorResponse(res, error);
};

/**
 * 404 Not Found handler
 */
const notFoundHandler = (req, res, next) => {
  const error = ApiError.notFound(`Route ${req.originalUrl} not found`);
  next(error);
};

/**
 * Rate limiter configuration
 */
const createRateLimiter = (options = {}) => {
  const defaultOptions = {
    windowMs: config.rateLimit.windowMs,
    max: config.rateLimit.maxRequests,
    message: {
      success: false,
      message: 'Too many requests, please try again later',
      error: { code: 'RATE_LIMIT_EXCEEDED' },
    },
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res, next, options) => {
      logger.warn('Rate limit exceeded:', {
        ip: req.ip,
        path: req.path,
        userId: req.user?.id,
      });
      res.status(429).json(options.message);
    },
  };

  return rateLimit({ ...defaultOptions, ...options });
};

/**
 * Specific rate limiters
 */
const rateLimiters = {
  // General API rate limiter
  general: createRateLimiter(),

  // Auth endpoints (stricter)
  auth: createRateLimiter({
    windowMs: 60 * 1000, // 1 minute
    max: 20, // Increased for development
    message: {
      success: false,
      message: 'Too many authentication attempts, please try again in a minute',
      error: { code: 'AUTH_RATE_LIMIT_EXCEEDED' },
    },
  }),

  // Exam start (very strict)
  examStart: createRateLimiter({
    windowMs: 60 * 1000, // 1 minute
    max: 1,
    message: {
      success: false,
      message: 'Please wait before starting another exam',
      error: { code: 'EXAM_START_RATE_LIMIT' },
    },
  }),

  // Answer submission (allow more)
  answerSubmission: createRateLimiter({
    windowMs: 60 * 1000, // 1 minute
    max: 60,
    message: {
      success: false,
      message: 'Submitting answers too quickly',
      error: { code: 'ANSWER_RATE_LIMIT' },
    },
  }),

  // Analytics (moderate)
  analytics: createRateLimiter({
    windowMs: 60 * 1000, // 1 minute
    max: 200, // High for development
  }),

  // Report generation (strict)
  reportGeneration: createRateLimiter({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 5,
    message: {
      success: false,
      message: 'Report generation limit reached, please try again later',
      error: { code: 'REPORT_RATE_LIMIT' },
    },
  }),
};

/**
 * Request logger middleware
 */
const requestLogger = (req, res, next) => {
  const start = Date.now();
  
  res.on('finish', () => {
    const duration = Date.now() - start;
    logger.info('Request completed', {
      method: req.method,
      path: req.path,
      statusCode: res.statusCode,
      duration: `${duration}ms`,
      userId: req.user?.id,
      ip: req.ip,
    });
  });
  
  next();
};

/**
 * Security headers middleware
 */
const securityHeaders = (req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
};

/**
 * Request sanitization middleware
 */
const sanitizeRequest = (req, res, next) => {
  // Remove any HTML tags from string values in body
  const sanitize = (obj) => {
    if (typeof obj === 'string') {
      return obj.replace(/<[^>]*>/g, '');
    }
    if (Array.isArray(obj)) {
      return obj.map(sanitize);
    }
    if (obj && typeof obj === 'object') {
      const sanitized = {};
      for (const [key, value] of Object.entries(obj)) {
        sanitized[key] = sanitize(value);
      }
      return sanitized;
    }
    return obj;
  };

  if (req.body) {
    req.body = sanitize(req.body);
  }

  next();
};

/**
 * CORS preflight handler
 */
const corsPreflightHandler = (req, res, next) => {
  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }
  next();
};

module.exports = {
  errorHandler,
  notFoundHandler,
  rateLimiters,
  requestLogger,
  securityHeaders,
  sanitizeRequest,
  corsPreflightHandler,
};
