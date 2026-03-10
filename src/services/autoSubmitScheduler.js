/**
 * Issue #4: Auto-Submit Scheduler for Expired Exams
 * Runs periodically to auto-submit exams that have exceeded their time limit
 */

const { prisma } = require('../config/database');
const { AttemptService } = require('./attemptService');
const logger = require('../utils/logger');

class AutoSubmitScheduler {
  constructor(intervalMs = 10000) {
    this.intervalMs = intervalMs;
    this.timerId = null;
    this.attemptService = null;
    this.isRunning = false;
    this.failureCount = 0;
    this.suspendedUntil = 0;
  }

  isTransientDatabaseError(error) {
    const code = error?.code;
    const msg = String(error?.message || '').toLowerCase();

    return (
      ['P1001', 'P1017', 'P2024'].includes(code) ||
      msg.includes('timed out fetching a new connection') ||
      msg.includes("can't reach database server") ||
      msg.includes('server has closed the connection')
    );
  }

  computeBackoffMs() {
    const baseMs = 15000;
    const cappedStep = Math.min(this.failureCount, 6);
    return baseMs * Math.pow(2, cappedStep);
  }

  /**
   * Start the auto-submit scheduler
   */
  start() {
    if (this.timerId) {
      logger.warn('Auto-submit scheduler already running');
      return;
    }

    logger.info('Starting auto-submit scheduler', { interval: this.intervalMs });
    this.timerId = setInterval(() => this.tick(), this.intervalMs);
  }

  async tick() {
    if (this.isRunning) {
      logger.warn('Auto-submit scheduler tick skipped (previous run still active)');
      return;
    }

    const nowMs = Date.now();
    if (this.suspendedUntil > nowMs) {
      return;
    }

    this.isRunning = true;
    try {
      await this.checkAndAutoSubmitExams();
      this.failureCount = 0;
      this.suspendedUntil = 0;
    } catch (err) {
      if (this.isTransientDatabaseError(err)) {
        this.failureCount += 1;
        const backoffMs = this.computeBackoffMs();
        this.suspendedUntil = Date.now() + backoffMs;
        logger.warn('Auto-submit scheduler entering backoff due to DB connectivity/pool issue', {
          failureCount: this.failureCount,
          backoffMs,
          resumeAt: new Date(this.suspendedUntil).toISOString(),
          code: err.code,
        });
      } else {
        logger.error('Auto-submit scheduler tick failed', { error: err.message, stack: err.stack });
      }
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Stop the auto-submit scheduler
   */
  stop() {
    if (this.timerId) {
      clearInterval(this.timerId);
      this.timerId = null;
      logger.info('Auto-submit scheduler stopped');
    }
  }

  /**
   * Check for expired attempts and auto-submit them
   */
  async checkAndAutoSubmitExams() {
    const now = new Date();

    // Find all active attempts
    const activeAttempts = await prisma.examAttempt.findMany({
      where: {
        status: { in: ['started', 'in_progress'] },
      },
      include: {
        exam: { select: { durationMinutes: true } },
      },
    });

    if (activeAttempts.length === 0) {
      return;
    }

    logger.debug('Checking for expired attempts', { count: activeAttempts.length });

    const expiredAttempts = [];

    for (const attempt of activeAttempts) {
      const endTime = new Date(attempt.startedAt);
      endTime.setMinutes(endTime.getMinutes() + attempt.exam.durationMinutes);

      // If end time has passed, mark for auto-submission
      if (now > endTime) {
        expiredAttempts.push(attempt);
      }
    }

    if (expiredAttempts.length > 0) {
      logger.info('Found expired attempts', { count: expiredAttempts.length, attemptIds: expiredAttempts.map(a => a.id) });

      // Auto-submit all expired attempts
      for (const attempt of expiredAttempts) {
        try {
          await this.autoSubmitAttempt(attempt.id);
        } catch (err) {
          logger.error('Failed to auto-submit attempt', { attemptId: attempt.id, error: err.message });
        }
      }
    }
  }

  /**
   * Auto-submit a single attempt
   */
  async autoSubmitAttempt(attemptId) {
    try {
      // Import here to avoid circular dependencies
      const { AttemptService } = require('./attemptService');
      const attemptService = new AttemptService();

      const result = await attemptService.finalizeAttempt(attemptId, 'auto_submitted');
      logger.info('Attempt auto-submitted', { attemptId, totalScore: result.totalScore, grade: result.grade });
      return result;
    } catch (err) {
      logger.error('Error auto-submitting attempt', { attemptId, error: err.message });
      throw err;
    }
  }
}

// Create singleton instance
let schedulerInstance = null;

const getScheduler = (intervalMs) => {
  if (!schedulerInstance) {
    schedulerInstance = new AutoSubmitScheduler(intervalMs || process.env.EXAM_AUTO_SUBMIT_INTERVAL || 10000);
  }
  return schedulerInstance;
};

module.exports = {
  AutoSubmitScheduler,
  getScheduler,
};
