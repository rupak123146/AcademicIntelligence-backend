/**
 * 🎓 Academic Intelligence Platform - Redis/Cache Configuration
 * In-memory caching with optional Redis support
 */

const config = require('./index');
const logger = require('../utils/logger');

// In-memory cache (used when Redis is not available)
const memoryCache = new Map();

// Create mock Redis client for local caching
const createMockRedis = () => ({
  get: async (key) => {
    const item = memoryCache.get(key);
    if (!item) return null;
    if (item.expiry && Date.now() > item.expiry) {
      memoryCache.delete(key);
      return null;
    }
    return item.value;
  },
  set: async (key, value) => {
    memoryCache.set(key, { value, expiry: null });
    return 'OK';
  },
  setex: async (key, seconds, value) => {
    memoryCache.set(key, { value, expiry: Date.now() + seconds * 1000 });
    return 'OK';
  },
  del: async (key) => {
    memoryCache.delete(key);
    return 1;
  },
  exists: async (key) => memoryCache.has(key) ? 1 : 0,
  expire: async () => 1,
  ttl: async () => -1,
  keys: async (pattern) => {
    const regex = new RegExp(pattern.replace(/\*/g, '.*'));
    return Array.from(memoryCache.keys()).filter(k => regex.test(k));
  },
  mget: async (keys) => keys.map(k => {
    const item = memoryCache.get(k);
    return item ? item.value : null;
  }),
  ping: async () => 'PONG',
  quit: async () => 'OK',
  hset: async (key, field, value) => {
    const hash = memoryCache.get(key)?.value || {};
    hash[field] = value;
    memoryCache.set(key, { value: hash, expiry: null });
    return 1;
  },
  hget: async (key, field) => {
    const hash = memoryCache.get(key)?.value;
    return hash ? hash[field] : null;
  },
  hgetall: async (key) => memoryCache.get(key)?.value || {},
  hdel: async (key, field) => {
    const hash = memoryCache.get(key)?.value;
    if (hash && hash[field]) {
      delete hash[field];
      return 1;
    }
    return 0;
  },
  on: function() { return this; },
});

// Use in-memory cache (Redis is optional)
const redis = createMockRedis();
logger.info('Using in-memory cache (Redis disabled)');

// Cache key generators
const CacheKeys = {
  userSession: (userId) => `session:${userId}`,
  examDetails: (examId) => `exam:${examId}`,
  activeAttempt: (studentId, examId) => `attempt:${studentId}:${examId}`,
  questionBank: (subjectId) => `questions:${subjectId}`,
  userProfile: (userId) => `user:${userId}`,
  courseEnrollments: (courseId) => `enrollments:${courseId}`,
  leaderboard: (examId) => `leaderboard:${examId}`,
  analyticsCache: (type, id) => `analytics:${type}:${id}`,
};

// Cache helper functions
const setCache = async (key, value, expirySeconds = null) => {
  try {
    const serialized = JSON.stringify(value);
    if (expirySeconds) {
      await redis.setex(key, expirySeconds, serialized);
    } else {
      await redis.set(key, serialized);
    }
    return true;
  } catch (error) {
    logger.error('Cache set error:', error.message);
    return false;
  }
};

const getCache = async (key) => {
  try {
    const data = await redis.get(key);
    return data ? JSON.parse(data) : null;
  } catch (error) {
    logger.error('Cache get error:', error.message);
    return null;
  }
};

const deleteCache = async (key) => {
  try {
    await redis.del(key);
    return true;
  } catch (error) {
    logger.error('Cache delete error:', error.message);
    return false;
  }
};

const setHashField = async (key, field, value) => {
  try {
    await redis.hset(key, field, JSON.stringify(value));
    return true;
  } catch (error) {
    logger.error('Cache hash set error:', error.message);
    return false;
  }
};

const getHashField = async (key, field) => {
  try {
    const data = await redis.hget(key, field);
    return data ? JSON.parse(data) : null;
  } catch (error) {
    logger.error('Cache hash get error:', error.message);
    return null;
  }
};

const getHashAll = async (key) => {
  try {
    const data = await redis.hgetall(key);
    const result = {};
    for (const [field, value] of Object.entries(data)) {
      result[field] = JSON.parse(value);
    }
    return result;
  } catch (error) {
    logger.error('Cache hash getall error:', error.message);
    return {};
  }
};

const closeRedis = async () => {
  await redis.quit();
  logger.info('Cache connection closed');
};

module.exports = {
  redis,
  CacheKeys,
  setCache,
  getCache,
  deleteCache,
  setHashField,
  getHashField,
  getHashAll,
  closeRedis,
};
