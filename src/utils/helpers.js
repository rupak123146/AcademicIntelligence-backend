/**
 * Custom API Error class
 */
class ApiError extends Error {
  constructor(statusCode, message, errors = null, isOperational = true) {
    super(message);
    this.statusCode = statusCode;
    this.status = `${statusCode}`.startsWith('4') ? 'fail' : 'error';
    this.isOperational = isOperational;
    this.errors = errors;
    
    Error.captureStackTrace(this, this.constructor);
  }

  static badRequest(message, errors = null) {
    return new ApiError(400, message, errors);
  }

  static unauthorized(message = 'Unauthorized') {
    return new ApiError(401, message);
  }

  static forbidden(message = 'Forbidden') {
    return new ApiError(403, message);
  }

  static notFound(message = 'Not found') {
    return new ApiError(404, message);
  }

  static conflict(message, errors = null) {
    return new ApiError(409, message, errors);
  }

  static unprocessable(message, errors = null) {
    return new ApiError(422, message, errors);
  }

  static tooManyRequests(message = 'Too many requests') {
    return new ApiError(429, message);
  }

  static internal(message = 'Internal server error') {
    return new ApiError(500, message, null, false);
  }
}

/**
 * Success response helper
 */
const successResponse = (res, statusCode, message, data = null, meta = null) => {
  const response = {
    success: true,
    message,
    timestamp: new Date().toISOString(),
  };

  if (data !== null) {
    response.data = data;
  }

  if (meta !== null) {
    response.meta = meta;
  }

  return res.status(statusCode).json(response);
};

/**
 * Error response helper
 */
const errorResponse = (res, error) => {
  const statusCode = error.statusCode || 500;
  const response = {
    success: false,
    message: error.message || 'Internal server error',
    error: {
      code: error.code || 'INTERNAL_ERROR',
    },
    timestamp: new Date().toISOString(),
  };

  if (error.errors) {
    response.error.details = error.errors;
  }

  // Include stack trace in development
  if (process.env.NODE_ENV === 'development') {
    response.error.stack = error.stack;
  }

  return res.status(statusCode).json(response);
};

/**
 * Async handler wrapper to catch errors
 */
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

/**
 * Validate UUID format
 */
const isValidUUID = (str) => {
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return uuidRegex.test(str);
};

/**
 * Pagination helper
 */
const paginate = (page = 1, limit = 20, maxLimit = 100) => {
  const currentPage = Math.max(1, parseInt(page, 10));
  const perPage = Math.min(Math.max(1, parseInt(limit, 10)), maxLimit);
  const offset = (currentPage - 1) * perPage;

  return {
    page: currentPage,
    limit: perPage,
    offset,
  };
};

/**
 * Build pagination meta
 */
const buildPaginationMeta = (page, limit, total) => {
  const totalPages = Math.ceil(total / limit);
  
  return {
    page,
    limit,
    total,
    totalPages,
    hasNextPage: page < totalPages,
    hasPrevPage: page > 1,
  };
};

/**
 * Calculate percentage
 */
const calculatePercentage = (value, total) => {
  if (total === 0) return 0;
  return Math.round((value / total) * 10000) / 100; // 2 decimal places
};

/**
 * Calculate mastery level based on accuracy
 */
const calculateMasteryLevel = (accuracy) => {
  if (accuracy >= 90) return 'expert';
  if (accuracy >= 75) return 'advanced';
  if (accuracy >= 60) return 'intermediate';
  if (accuracy >= 40) return 'beginner';
  return 'novice';
};

/**
 * Calculate performance tag based on accuracy
 */
const calculatePerformanceTag = (accuracy) => {
  if (accuracy >= 80) return 'strong';
  if (accuracy >= 60) return 'average';
  return 'needs_improvement';
};

/**
 * Calculate trend direction
 */
const calculateTrend = (current, previous) => {
  if (!previous || previous === 0) return 'stable';
  const change = ((current - previous) / previous) * 100;
  if (change > 5) return 'improving';
  if (change < -5) return 'declining';
  return 'stable';
};

/**
 * Format duration in seconds to human readable
 */
const formatDuration = (seconds) => {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;

  if (hours > 0) {
    return `${hours}h ${minutes}m`;
  }
  if (minutes > 0) {
    return `${minutes}m ${secs}s`;
  }
  return `${secs}s`;
};

/**
 * Generate random string
 */
const generateRandomString = (length = 32) => {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  for (let i = 0; i < length; i++) {
    result += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return result;
};

/**
 * Sanitize object - remove undefined/null values
 */
const sanitizeObject = (obj) => {
  const sanitized = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value !== undefined && value !== null) {
      sanitized[key] = value;
    }
  }
  return sanitized;
};

/**
 * Deep clone object
 */
const deepClone = (obj) => {
  return JSON.parse(JSON.stringify(obj));
};

/**
 * Sleep helper for async operations
 */
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

module.exports = {
  ApiError,
  successResponse,
  errorResponse,
  asyncHandler,
  isValidUUID,
  paginate,
  buildPaginationMeta,
  calculatePercentage,
  calculateMasteryLevel,
  calculatePerformanceTag,
  calculateTrend,
  formatDuration,
  generateRandomString,
  sanitizeObject,
  deepClone,
  sleep,
};
