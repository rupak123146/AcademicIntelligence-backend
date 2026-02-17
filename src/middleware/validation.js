const { validationResult, body, param, query: queryValidator } = require('express-validator');
const { ApiError } = require('../utils/helpers');

/**
 * Validation error handler middleware
 */
const validate = (req, res, next) => {
  const errors = validationResult(req);
  
  if (!errors.isEmpty()) {
    const formattedErrors = errors.array().map((err) => ({
      field: err.path,
      message: err.msg,
      value: err.value,
    }));
    
    // Log validation errors for debugging
    console.log('Validation errors:', JSON.stringify(formattedErrors, null, 2));
    console.log('Request body:', JSON.stringify(req.body, null, 2));
    
    throw ApiError.badRequest('Validation failed', formattedErrors);
  }
  
  next();
};

/**
 * Common validation rules
 */
const rules = {
  // UUID validation
  uuid: (field, location = 'param') => {
    const validator = location === 'param' ? param(field) : 
                      location === 'body' ? body(field) : 
                      queryValidator(field);
    return validator
      .trim()
      .isUUID(4)
      .withMessage(`${field} must be a valid UUID`);
  },

  // Email validation
  email: () => body('email')
    .trim()
    .isEmail()
    .normalizeEmail()
    .withMessage('Please provide a valid email address'),

  // Password validation
  password: () => body('password')
    .isLength({ min: 8 })
    .withMessage('Password must be at least 8 characters long')
    .matches(/[a-z]/)
    .withMessage('Password must contain at least one lowercase letter')
    .matches(/[A-Z]/)
    .withMessage('Password must contain at least one uppercase letter')
    .matches(/[0-9]/)
    .withMessage('Password must contain at least one number'),

  // Name validation
  name: (field) => body(field)
    .trim()
    .isLength({ min: 2, max: 100 })
    .withMessage(`${field} must be between 2 and 100 characters`)
    .matches(/^[a-zA-Z\s'-]+$/)
    .withMessage(`${field} can only contain letters, spaces, hyphens, and apostrophes`),

  // Role validation
  role: () => body('role')
    .isIn(['student', 'educator', 'admin'])
    .withMessage('Role must be student, educator, or admin'),

  // Pagination validation
  pagination: () => [
    queryValidator('page')
      .optional()
      .isInt({ min: 1 })
      .withMessage('Page must be a positive integer'),
    queryValidator('limit')
      .optional()
      .isInt({ min: 1, max: 100 })
      .withMessage('Limit must be between 1 and 100'),
  ],

  // Required string
  requiredString: (field, min = 1, max = 255) => body(field)
    .trim()
    .isLength({ min, max })
    .withMessage(`${field} must be between ${min} and ${max} characters`),

  // Optional string
  optionalString: (field, max = 255) => body(field)
    .optional()
    .trim()
    .isLength({ max })
    .withMessage(`${field} must not exceed ${max} characters`),

  // Required integer
  requiredInt: (field, min = 1) => body(field)
    .isInt({ min })
    .withMessage(`${field} must be an integer greater than or equal to ${min}`),

  // Optional integer
  optionalInt: (field, min = 0) => body(field)
    .optional()
    .isInt({ min })
    .withMessage(`${field} must be an integer greater than or equal to ${min}`),

  // Boolean
  boolean: (field) => body(field)
    .optional()
    .isBoolean()
    .withMessage(`${field} must be a boolean`),

  // Array
  array: (field) => body(field)
    .optional()
    .isArray()
    .withMessage(`${field} must be an array`),

  // Date
  date: (field) => body(field)
    .optional()
    .isISO8601()
    .withMessage(`${field} must be a valid ISO 8601 date`),
};

/**
 * Auth validation schemas
 */
const authValidation = {
  register: [
    body('email')
      .trim()
      .isEmail()
      .withMessage('Please provide a valid email address'),
    body('password')
      .isLength({ min: 6 })
      .withMessage('Password must be at least 6 characters long'),
    body('firstName')
      .trim()
      .notEmpty()
      .withMessage('First name is required'),
    body('lastName')
      .trim()
      .notEmpty()
      .withMessage('Last name is required'),
    body('role')
      .optional(),
    body('institutionId')
      .optional(),
    body('departmentId')
      .optional(),
    validate,
  ],

  login: [
    rules.email(),
    body('password').notEmpty().withMessage('Password is required'),
    validate,
  ],

  refreshToken: [
    body('refreshToken')
      .notEmpty()
      .withMessage('Refresh token is required'),
    validate,
  ],

  forgotPassword: [
    rules.email(),
    validate,
  ],

  resetPassword: [
    body('token').notEmpty().withMessage('Reset token is required'),
    rules.password(),
    validate,
  ],
};

/**
 * User validation schemas
 */
const userValidation = {
  updateProfile: [
    rules.name('firstName').optional(),
    rules.name('lastName').optional(),
    rules.optionalString('phone', 20),
    validate,
  ],

  updateUser: [
    rules.uuid('id'),
    rules.name('firstName').optional(),
    rules.name('lastName').optional(),
    rules.boolean('isActive'),
    validate,
  ],
};

/**
 * Course validation schemas
 */
const courseValidation = {
  create: [
    rules.requiredString('code', 2, 50),
    rules.requiredString('name', 2, 255),
    rules.optionalString('description', 2000),
    rules.uuid('departmentId', 'body'),
    rules.optionalInt('credits', 1),
    rules.optionalString('semester', 20),
    rules.optionalString('academicYear', 20),
    validate,
  ],

  update: [
    rules.uuid('id'),
    rules.optionalString('code', 50),
    rules.optionalString('name', 255),
    rules.optionalString('description', 2000),
    rules.optionalInt('credits', 1),
    rules.boolean('isActive'),
    validate,
  ],
};

/**
 * Exam validation schemas
 */
const examValidation = {
  create: [
    rules.uuid('courseId', 'body').optional(),
    rules.requiredString('title', 2, 255),
    rules.optionalString('description', 2000),
    rules.optionalString('instructions', 5000),
    body('examType')
      .isIn(['quiz', 'unit_test', 'internal', 'midterm', 'final', 'practice', 'assignment'])
      .withMessage('Invalid exam type'),
    rules.requiredInt('durationMinutes', 1),
    body('totalMarks')
      .isFloat({ min: 0.01 })
      .withMessage('Total marks must be greater than 0'),
    body('passingMarks')
      .isFloat({ min: 0 })
      .withMessage('Passing marks must be non-negative'),
    rules.boolean('negativeMarking'),
    rules.boolean('shuffleQuestions'),
    rules.boolean('shuffleOptions'),
    rules.boolean('showResult'),
    rules.boolean('showAnswers'),
    rules.boolean('allowReview'),
    rules.optionalInt('maxAttempts', 1),
    rules.date('startTime'),
    rules.date('endTime'),
    validate,
  ],

  update: [
    rules.uuid('id'),
    rules.optionalString('title', 255),
    rules.optionalString('description', 2000),
    rules.optionalString('instructions', 5000),
    rules.optionalInt('durationMinutes', 1),
    rules.boolean('negativeMarking'),
    rules.boolean('shuffleQuestions'),
    rules.date('startTime'),
    rules.date('endTime'),
    validate,
  ],
};

/**
 * Question validation schemas
 */
const questionValidation = {
  create: [
    body('questionText')
      .trim()
      .isLength({ min: 5 })
      .withMessage('Question text must be at least 5 characters'),
    body('questionType')
      .isIn(['mcq', 'multiple_select', 'multiple_choice', 'true_false', 'short_answer', 'long_answer', 'fill_blank', 'numerical'])
      .withMessage('Invalid question type'),
    body('options')
      .optional()
      .isArray({ min: 2 })
      .withMessage('Options must be an array with at least 2 items'),
    body('correctAnswer')
      .optional()
      .notEmpty()
      .withMessage('Correct answer cannot be empty if provided'),
    body('marks')
      .isFloat({ min: 0.01 })
      .withMessage('Marks must be greater than 0'),
    body('difficulty')
      .optional()
      .isIn(['easy', 'medium', 'hard', 'expert'])
      .withMessage('Invalid difficulty level'),
    rules.uuid('subjectId', 'body').optional(),
    rules.uuid('chapterId', 'body').optional(),
    rules.uuid('conceptId', 'body').optional(),
    rules.optionalString('explanation', 2000),
    rules.optionalInt('orderIndex', 1),
    validate,
  ],

  bulkCreate: [
    body('questions')
      .isArray({ min: 1 })
      .withMessage('Questions must be a non-empty array'),
    validate,
  ],
};

/**
 * Exam attempt validation schemas
 */
const attemptValidation = {
  saveAnswer: [
    rules.uuid('examId'),
    rules.uuid('attemptId'),
    rules.uuid('questionId', 'body'),
    body('selectedOption')
      .optional()
      .notEmpty()
      .withMessage('Selected option cannot be empty if provided'),
    rules.optionalInt('timeSpentSeconds', 0),
    rules.boolean('isMarkedForReview'),
    validate,
  ],

  submit: [
    rules.uuid('examId'),
    rules.uuid('attemptId'),
    body('answers')
      .optional()
      .isArray()
      .withMessage('Answers must be an array'),
    validate,
  ],
};

/**
 * Analytics validation schemas
 */
const analyticsValidation = {
  studentDashboard: [
    rules.uuid('courseId', 'query').optional(),
    validate,
  ],

  classAnalytics: [
    rules.uuid('courseId', 'query'),
    rules.uuid('examId', 'query').optional(),
    validate,
  ],

  generateReport: [
    body('reportType')
      .isIn(['student_performance', 'class_performance', 'exam_analysis', 'learning_gaps'])
      .withMessage('Invalid report type'),
    rules.uuid('courseId', 'body'),
    rules.uuid('examId', 'body').optional(),
    body('format')
      .isIn(['pdf', 'excel', 'csv'])
      .withMessage('Invalid format'),
    rules.boolean('includeCharts'),
    validate,
  ],
};

module.exports = {
  validate,
  rules,
  authValidation,
  userValidation,
  courseValidation,
  examValidation,
  questionValidation,
  attemptValidation,
  analyticsValidation,
};
