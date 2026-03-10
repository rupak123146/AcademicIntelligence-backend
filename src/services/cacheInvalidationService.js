/**
 * Advanced cache invalidation utilities.
 */

const { redis, deleteCache, CacheKeys } = require('../config/redis');
const logger = require('../utils/logger');

const deleteByPattern = async (pattern) => {
  const keys = await redis.keys(pattern);
  if (!keys || keys.length === 0) {
    return 0;
  }
  await Promise.all(keys.map((key) => deleteCache(key)));
  return keys.length;
};

const invalidateExamCache = async (examId, institutionId) => {
  await deleteCache(CacheKeys.examDetails(examId));
  await deleteByPattern(`exam:list:*`);
  if (institutionId) {
    await deleteByPattern(`available_exams:${institutionId}:*`);
  }
};

const invalidateStudentAnalytics = async (studentId) => {
  await deleteByPattern(`analytics:*:${studentId}`);
  await deleteByPattern(`analytics:dashboard:${studentId}*`);
};

const invalidateExamAnalytics = async (examId) => {
  await deleteByPattern(`analytics:exam:${examId}*`);
};

const invalidateOnAttemptSubmit = async (examId, studentId) => {
  try {
    await Promise.all([
      invalidateStudentAnalytics(studentId),
      invalidateExamAnalytics(examId),
      deleteCache(CacheKeys.activeAttempt(studentId, examId)),
    ]);
  } catch (error) {
    logger.warn('Cache invalidation failed', { examId, studentId, error: error.message });
  }
};

module.exports = {
  deleteByPattern,
  invalidateExamCache,
  invalidateStudentAnalytics,
  invalidateExamAnalytics,
  invalidateOnAttemptSubmit,
};
