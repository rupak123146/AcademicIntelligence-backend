const express = require('express');
const router = express.Router();

// Import route modules
const authRoutes = require('./authRoutes');
const examRoutes = require('./examRoutes');
const questionRoutes = require('./questionRoutes');
const analyticsRoutes = require('./analyticsRoutes');
const settingsRoutes = require('./settingsRoutes');
const userRoutes = require('./userRoutes');
const taskRoutes = require('./taskRoutes');

// Phase 3 route modules
const goalRoutes = require('./goalRoutes');
const notificationRoutes = require('./notificationRoutes');
const interventionRoutes = require('./interventionRoutes');

// Subject, Chapter, Concept route modules
const subjectRoutes = require('./subjectRoutes');
const chapterRoutes = require('./chapterRoutes');
const conceptRoutes = require('./conceptRoutes');

// API welcome/info endpoint
router.get('/', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'Academic Intelligence Platform API',
    version: process.env.API_VERSION || 'v1',
    endpoints: {
      auth: '/api/v1/auth',
      exams: '/api/v1/exams',
      questions: '/api/v1/questions',
      analytics: '/api/v1/analytics',
      users: '/api/v1/users',
      tasks: '/api/v1/tasks',
      goals: '/api/v1/goals',
      notifications: '/api/v1/notifications',
      interventions: '/api/v1/interventions',
      subjects: '/api/v1/subjects',
      chapters: '/api/v1/chapters',
      concepts: '/api/v1/concepts',
      health: '/api/v1/health',
      docs: '/api-docs',
    },
    timestamp: new Date().toISOString(),
  });
});

// Health check endpoint
router.get('/health', (req, res) => {
  res.status(200).json({
    success: true,
    message: 'API is running',
    timestamp: new Date().toISOString(),
    version: process.env.API_VERSION || 'v1',
  });
});

// Mount routes
router.use('/auth', authRoutes);
router.use('/exams', examRoutes);
router.use('/questions', questionRoutes);
router.use('/analytics', analyticsRoutes);
router.use('/settings', settingsRoutes);
router.use('/users', userRoutes);
router.use('/tasks', taskRoutes);

// Mount Phase 3 routes
router.use('/goals', goalRoutes);
router.use('/notifications', notificationRoutes);
router.use('/interventions', interventionRoutes);

// Mount Subject, Chapter, Concept routes
router.use('/subjects', subjectRoutes);
router.use('/chapters', chapterRoutes);
router.use('/concepts', conceptRoutes);

module.exports = router;
