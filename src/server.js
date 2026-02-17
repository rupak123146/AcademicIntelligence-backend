const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const compression = require('compression');

const config = require('./config');
const routes = require('./routes');
const { connectDatabase, closeDatabase } = require('./config/database');
const logger = require('./utils/logger');
const {
  errorHandler,
  notFoundHandler,
  rateLimiters,
  requestLogger,
  securityHeaders,
  sanitizeRequest,
} = require('./middleware/errorHandler');

// Create Express app
const app = express();

// Trust proxy (for rate limiting behind reverse proxy)
app.set('trust proxy', 1);

// Security middleware
app.use(helmet());
app.use(securityHeaders);

// CORS configuration
app.use(cors({
  origin: config.cors.origin,
  credentials: config.cors.credentials,
  methods: config.cors.methods,
  allowedHeaders: config.cors.allowedHeaders,
}));

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Compression
app.use(compression());

// Request sanitization
app.use(sanitizeRequest);

// Logging
if (config.env !== 'test') {
  app.use(morgan('combined', { stream: logger.stream }));
  app.use(requestLogger);
}

// Rate limiting (disabled in development for easier testing)
if (config.env === 'production') {
  app.use(rateLimiters.general);
}

// API routes
app.use(`/api/${config.apiVersion}`, routes);

// API documentation (development only)
if (config.env === 'development') {
  const swaggerUi = require('swagger-ui-express');
  const swaggerDocument = require('../docs/swagger.json');
  app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument));
}

// 404 handler
app.use(notFoundHandler);

// Error handler
app.use(errorHandler);

// Initialize database and start server
const startServer = async () => {
  try {
    // Connect to MySQL (primary database for SQL migration)
    const mysqlConnected = await connectDatabase();
    if (!mysqlConnected) {
      throw new Error('MySQL connection failed');
    }

    logger.info('Database connections initialized');

    // Start server
    const server = app.listen(config.port, () => {
      logger.info(`Server running in ${config.env} mode on port ${config.port}`);
      logger.info(`API available at http://localhost:${config.port}/api/${config.apiVersion}`);
      if (config.env === 'development') {
        logger.info(`API docs available at http://localhost:${config.port}/api-docs`);
      }
    });

    // Graceful shutdown
    const gracefulShutdown = async (signal) => {
      logger.info(`${signal} received. Starting graceful shutdown...`);
      
      server.close(async () => {
        logger.info('HTTP server closed');
        
        try {
          const { closeRedis } = require('./config/redis');

          await closeDatabase();
          await closeRedis();

          logger.info('All connections closed. Exiting...');
        } catch (error) {
          logger.error('Error during shutdown:', error);
        }
        process.exit(0);
      });

      // Force shutdown after 30 seconds
      setTimeout(() => {
        logger.error('Forced shutdown after timeout');
        process.exit(1);
      }, 30000);
    };

    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
    process.on('SIGINT', () => gracefulShutdown('SIGINT'));

  } catch (error) {
    logger.error('Failed to start server:', error);
    process.exit(1);
  }
};

// Start the server
startServer();

module.exports = app;
