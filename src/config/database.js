const { PrismaClient } = require('@prisma/client');
const config = require('./index');
const logger = require('../utils/logger');

const prisma = new PrismaClient({
  datasources: {
    db: {
      url: config.mysql.url,
    },
  },
  log: ['error', 'warn'],
});

const connectDatabase = async () => {
  try {
    await prisma.$connect();
    logger.info('MySQL connected successfully');
    return true;
  } catch (error) {
    logger.error('MySQL connection failed:', error.message);
    return false;
  }
};

const closeDatabase = async () => {
  await prisma.$disconnect();
  logger.info('MySQL connection closed');
};

module.exports = {
  prisma,
  connectDatabase,
  closeDatabase,
};
