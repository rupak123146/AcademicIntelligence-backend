/**
 * HTML/XSS Sanitization Middleware
 * Issue #24: Prevent XSS attacks by sanitizing user input
 */

const stripHtml = require('string-strip-html');
const logger = require('../utils/logger');

/**
 * Sanitize input string to prevent XSS
 */
const sanitizeInput = (input) => {
  if (!input || typeof input !== 'string') {
    return input;
  }
  
  try {
    // Strip HTML tags and entities
    const sanitized = stripHtml(input, {
      stripTogetherWithTheirContents: ['script', 'style'],
    }).result;
    
    return sanitized.trim();
  } catch (err) {
    logger.warn('Sanitization error:', { input, error: err.message });
    return input;
  }
};

/**
 * Recursively sanitize object properties
 */
const sanitizeObject = (obj) => {
  if (!obj || typeof obj !=='object') {
    return obj;
  }

  if (Array.isArray(obj)) {
    return obj.map(sanitizeObject);
  }

  const sanitized = {};
  for (const [key, value] of Object.entries(obj)) {
    if (typeof value === 'string') {
      sanitized[key] = sanitizeInput(value);
    } else if (typeof value === 'object' && value !== null) {
      sanitized[key] = sanitizeObject(value);
    } else {
      sanitized[key] = value;
    }
  }
  return sanitized;
};

/**
 * Middleware to sanitize request body and query
 */
const sanitizationMiddleware = (req, res, next) => {
  try {
    if (req.body) {
      req.body = sanitizeObject(req.body);
    }
    if (req.query) {
      req.query = sanitizeObject(req.query);
    }
  } catch (err) {
    logger.error('Sanitization middleware error:', err);
  }
  next();
};

module.exports = {
  sanitizeInput,
  sanitizeObject,
  sanitizationMiddleware,
};
