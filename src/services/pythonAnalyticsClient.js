/**
 * 🎓 Academic Intelligence Platform - Python Analytics Client
 * Bridge service to connect Node.js backend with Python FastAPI analytics service
 */

const axios = require('axios');
const logger = require('../utils/logger');

const PYTHON_ANALYTICS_URL = process.env.PYTHON_ANALYTICS_URL || 'http://localhost:8000';

class PythonAnalyticsClient {
  constructor() {
    this.client = axios.create({
      baseURL: `${PYTHON_ANALYTICS_URL}/api/v1/analytics`,
      timeout: 60000, // 60 second timeout for complex analytics
      headers: {
        'Content-Type': 'application/json',
      },
    });

    // Add request interceptor for logging
    this.client.interceptors.request.use(
      (config) => {
        logger.info(`Python Analytics Request: ${config.method?.toUpperCase()} ${config.url}`);
        return config;
      },
      (error) => {
        logger.error('Python Analytics Request Error:', error);
        return Promise.reject(error);
      }
    );

    // Add response interceptor for error handling
    this.client.interceptors.response.use(
      (response) => response,
      (error) => {
        if (error.code === 'ECONNREFUSED') {
          logger.error('Python Analytics Service is not running!');
          throw new Error('Analytics service unavailable. Please ensure Python service is running.');
        }
        logger.error('Python Analytics Error:', error.response?.data || error.message);
        throw error;
      }
    );
  }

  /**
   * Check if Python analytics service is available
   */
  async healthCheck() {
    try {
      const response = await axios.get(`${PYTHON_ANALYTICS_URL}/health`);
      return response.status === 200;
    } catch (error) {
      logger.error('Python Analytics Service health check failed:', error.message);
      return false;
    }
  }

  // ==========================================
  // PHASE 1-2: Advanced Analytics Services
  // ==========================================

  /**
   * Get chapter-wise analysis
   */
  async getChapterAnalysis(studentId, courseId, examId = null) {
    try {
      const response = await this.client.post('/chapter', {
        student_id: parseInt(studentId),
        course_id: parseInt(courseId),
        exam_id: examId ? parseInt(examId) : null,
      });
      return response.data.data;
    } catch (error) {
      logger.error('Chapter analysis error:', error.message);
      throw error;
    }
  }

  /**
   * Get concept-wise analysis
   */
  async getConceptAnalysis(studentId, courseId, chapterId = null) {
    try {
      const response = await this.client.post('/concept', {
        student_id: parseInt(studentId),
        course_id: parseInt(courseId),
        chapter_id: chapterId ? parseInt(chapterId) : null,
      });
      return response.data.data;
    } catch (error) {
      logger.error('Concept analysis error:', error.message);
      throw error;
    }
  }

  /**
   * Get difficulty-wise analysis
   */
  async getDifficultyAnalysis(studentId, courseId, examId = null) {
    try {
      const response = await this.client.post('/difficulty', {
        student_id: parseInt(studentId),
        course_id: parseInt(courseId),
        exam_id: examId ? parseInt(examId) : null,
      });
      return response.data.data;
    } catch (error) {
      logger.error('Difficulty analysis error:', error.message);
      throw error;
    }
  }

  /**
   * Detect learning gaps
   */
  async getLearningGaps(studentId, courseId) {
    try {
      const response = await this.client.post('/gaps', {
        student_id: parseInt(studentId),
        course_id: parseInt(courseId),
      });
      return response.data.data;
    } catch (error) {
      logger.error('Learning gaps detection error:', error.message);
      throw error;
    }
  }

  /**
   * Get performance trend analysis
   */
  async getPerformanceTrend(studentId, courseId, windowSize = 5) {
    try {
      const response = await this.client.post('/trend', {
        student_id: parseInt(studentId),
        course_id: parseInt(courseId),
      }, {
        params: { window_size: windowSize },
      });
      return response.data.data;
    } catch (error) {
      logger.error('Performance trend error:', error.message);
      throw error;
    }
  }

  /**
   * Generate personalized feedback
   */
  async getFeedback(studentId, courseId, examId = null) {
    try {
      const response = await this.client.post('/feedback', {
        student_id: parseInt(studentId),
        course_id: parseInt(courseId),
        exam_id: examId ? parseInt(examId) : null,
      });
      return response.data.data;
    } catch (error) {
      logger.error('Feedback generation error:', error.message);
      throw error;
    }
  }

  /**
   * Get full comprehensive analysis
   */
  async getFullAnalysis(studentId, courseId, examId = null, options = {}) {
    try {
      const response = await this.client.post('/full', {
        student_id: parseInt(studentId),
        course_id: parseInt(courseId),
        exam_id: examId ? parseInt(examId) : null,
        include_chapters: options.includeChapters !== false,
        include_concepts: options.includeConcepts !== false,
        include_difficulty: options.includeDifficulty !== false,
        include_gaps: options.includeGaps !== false,
        include_trend: options.includeTrend !== false,
        include_feedback: options.includeFeedback !== false,
      });
      return response.data.data;
    } catch (error) {
      logger.error('Full analysis error:', error.message);
      throw error;
    }
  }

  /**
   * Get class analytics (educator)
   */
  async getClassAnalytics(courseId, educatorId, examId = null) {
    try {
      const response = await this.client.post('/class', {
        course_id: parseInt(courseId),
        educator_id: parseInt(educatorId),
        exam_id: examId ? parseInt(examId) : null,
      });
      return response.data.data;
    } catch (error) {
      logger.error('Class analytics error:', error.message);
      throw error;
    }
  }

  // ==========================================
  // PHASE 3: Advanced Features
  // ==========================================

  /**
   * Generate randomized exam
   */
  async generateRandomizedExam(examId, studentId, seed = null) {
    try {
      const response = await this.client.post('/randomization/generate', {
        exam_id: parseInt(examId),
        student_id: parseInt(studentId),
        seed: seed,
      });
      return response.data.data;
    } catch (error) {
      logger.error('Randomization generation error:', error.message);
      throw error;
    }
  }

  /**
   * Verify randomized answer
   */
  async verifyRandomizedAnswer(versionId, questionId, selectedOption) {
    try {
      const response = await this.client.post('/randomization/verify', {
        version_id: versionId,
        question_id: parseInt(questionId),
        selected_option: selectedOption,
      });
      return response.data.data;
    } catch (error) {
      logger.error('Answer verification error:', error.message);
      throw error;
    }
  }

  /**
   * Get randomization statistics
   */
  async getRandomizationStats(examId) {
    try {
      const response = await this.client.get(`/randomization/stats/${examId}`);
      return response.data.data;
    } catch (error) {
      logger.error('Randomization stats error:', error.message);
      throw error;
    }
  }

  /**
   * Get student response time analysis
   */
  async getStudentTimingAnalysis(studentId, params = {}) {
    try {
      const response = await this.client.get(`/timing/student/${studentId}`, { params });
      return response.data.data;
    } catch (error) {
      logger.error('Student timing analysis error:', error.message);
      throw error;
    }
  }

  /**
   * Get exam timing patterns
   */
  async getExamTimingAnalysis(examId, params = {}) {
    try {
      const response = await this.client.get(`/timing/exam/${examId}`, { params });
      return response.data.data;
    } catch (error) {
      logger.error('Exam timing analysis error:', error.message);
      throw error;
    }
  }
}

// Singleton instance
const pythonAnalyticsClient = new PythonAnalyticsClient();

module.exports = pythonAnalyticsClient;
