/**
 * Huly Webhook Service
 * Main application entry point
 */

require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');

const config = require('./config');
const logger = require('./utils/logger');
const { errorHandler } = require('./middleware/errorHandler');
const authMiddleware = require('./middleware/auth');
const rateLimitMiddleware = require('./middleware/rateLimit');

// Import services
const DatabaseService = require('./services/DatabaseService');
const ChangeStreamService = require('./services/ChangeStreamService');
const WebhookService = require('./services/WebhookService');
const DeliveryService = require('./services/DeliveryService');

// Import routes
const webhookRoutes = require('./routes/webhooks');
const healthRoutes = require('./routes/health');
const statsRoutes = require('./routes/stats');

class WebhookApp {
  constructor () {
    this.app = express();
    this.services = {};
    this.isShuttingDown = false;
  }

  async initialize () {
    try {
      logger.info('Initializing Huly Webhook Service...');

      // Setup Express middleware
      this.setupMiddleware();

      // Setup routes
      this.setupRoutes();

      // Initialize services
      await this.initializeServices();

      // Setup error handling
      this.setupErrorHandling();

      logger.info('Huly Webhook Service initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize application:', error);
      throw error;
    }
  }

  setupMiddleware () {
    // Security middleware
    this.app.use(helmet({
      contentSecurityPolicy: false, // API service
      crossOriginEmbedderPolicy: false
    }));

    // CORS configuration
    this.app.use(cors({
      origin: config.cors.origins,
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Content-Type', 'Authorization', 'X-API-Key', 'X-Hub-Signature-256']
    }));

    // Request logging
    this.app.use(morgan('combined', {
      stream: {
        write: (message) => logger.info(message.trim())
      }
    }));

    // Body parsing
    this.app.use(express.json({ limit: '10mb' }));
    this.app.use(express.urlencoded({ extended: true, limit: '10mb' }));

    // Rate limiting
    this.app.use(rateLimitMiddleware);

    // Request ID middleware
    this.app.use((req, res, next) => {
      req.id = require('uuid').v4();
      res.setHeader('X-Request-ID', req.id);
      next();
    });
  }

  setupRoutes () {
    // Health check (no auth required)
    this.app.use('/api/health', healthRoutes);

    // API routes with authentication
    this.app.use('/api/webhooks', authMiddleware, webhookRoutes);
    this.app.use('/api/stats', authMiddleware, statsRoutes);

    // Root endpoint
    this.app.get('/', (req, res) => {
      res.json({
        name: 'Huly Webhook Service',
        version: require('../package.json').version,
        status: 'running',
        timestamp: new Date().toISOString()
      });
    });

    // 404 handler
    this.app.use('*', (req, res) => {
      res.status(404).json({
        error: 'Not Found',
        message: `Route ${req.method} ${req.originalUrl} not found`,
        timestamp: new Date().toISOString()
      });
    });
  }

  async initializeServices () {
    logger.info('Initializing services...');

    // Initialize database service
    this.services.database = new DatabaseService();
    await this.services.database.connect();

    // Initialize webhook service
    this.services.webhook = new WebhookService(this.services.database);

    // Initialize delivery service
    this.services.delivery = new DeliveryService(this.services.database);

    // Initialize change stream service
    this.services.changeStream = new ChangeStreamService(
      this.services.database,
      this.services.delivery
    );

    // Start change stream monitoring
    await this.services.changeStream.start();

    // Make services available to routes
    this.app.locals.services = this.services;

    logger.info('All services initialized successfully');
  }

  setupErrorHandling () {
    // Global error handler
    this.app.use(errorHandler);

    // Graceful shutdown handling
    const gracefulShutdown = async (signal) => {
      if (this.isShuttingDown) {
        return;
      }

      this.isShuttingDown = true;
      logger.info(`Received ${signal}. Starting graceful shutdown...`);

      // Stop accepting new requests
      this.server.close(async () => {
        try {
          // Stop services
          if (this.services.changeStream) {
            await this.services.changeStream.stop();
          }

          if (this.services.database) {
            await this.services.database.disconnect();
          }

          logger.info('Graceful shutdown completed');
          process.exit(0);
        } catch (error) {
          logger.error('Error during shutdown:', error);
          process.exit(1);
        }
      });

      // Force shutdown after timeout
      setTimeout(() => {
        logger.error('Force shutdown due to timeout');
        process.exit(1);
      }, 30000);
    };

    process.on('SIGINT', () => gracefulShutdown('SIGINT'));
    process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

    // Handle uncaught exceptions
    process.on('uncaughtException', (error) => {
      logger.error('Uncaught exception:', error);
      process.exit(1);
    });

    process.on('unhandledRejection', (reason, promise) => {
      logger.error('Unhandled rejection at:', promise, 'reason:', reason);
      process.exit(1);
    });
  }

  async start () {
    try {
      await this.initialize();

      this.server = this.app.listen(config.server.port, config.server.host, () => {
        logger.info(`Huly Webhook Service listening on ${config.server.host}:${config.server.port}`);
        logger.info(`Environment: ${config.env}`);
        logger.info(`MongoDB: ${config.mongodb.url}`);
        logger.info('Service ready to accept requests');
      });

      return this.server;
    } catch (error) {
      logger.error('Failed to start server:', error);
      throw error;
    }
  }
}

// Start the application if this file is run directly
if (require.main === module) {
  const app = new WebhookApp();
  app.start().catch((error) => {
    logger.error('Failed to start application:', error);
    process.exit(1);
  });
}

module.exports = WebhookApp;
