/**
 * Health check routes for Huly Webhook Service
 * Provides service status and health monitoring endpoints
 */

const express = require('express');
const config = require('../config');
const logger = require('../utils/logger');
const { asyncHandler } = require('../middleware/errorHandler');

const router = express.Router();

/**
 * Basic health check endpoint
 * GET /api/health
 */
router.get('/', asyncHandler(async (req, res) => {
  const timer = logger.timeStart('health-check');

  try {
    const health = {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      version: require('../../package.json').version,
      environment: config.env,
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      services: {}
    };

    // Check database connection
    if (req.app.locals.services?.database) {
      try {
        await req.app.locals.services.database.ping();
        health.services.mongodb = 'connected';
      } catch (error) {
        health.services.mongodb = 'disconnected';
        health.status = 'degraded';
        logger.warn('Database health check failed:', error.message);
      }
    } else {
      health.services.mongodb = 'not_initialized';
      health.status = 'degraded';
    }

    // Check change streams status
    if (req.app.locals.services?.changeStream) {
      const isActive = req.app.locals.services.changeStream.isActive();
      health.services.changeStreams = isActive ? 'active' : 'inactive';
      if (!isActive) {
        health.status = 'degraded';
      }
    } else {
      health.services.changeStreams = 'not_initialized';
      health.status = 'degraded';
    }

    // Check webhook service
    if (req.app.locals.services?.webhook) {
      health.services.webhookService = 'active';
    } else {
      health.services.webhookService = 'not_initialized';
      health.status = 'degraded';
    }

    // Check delivery service
    if (req.app.locals.services?.delivery) {
      health.services.deliveryService = 'active';

      // Get delivery statistics
      try {
        const stats = await req.app.locals.services.delivery.getStats();
        health.services.deliveryStats = {
          pending: stats.pending || 0,
          processing: stats.processing || 0,
          failed: stats.failed || 0
        };
      } catch (error) {
        logger.debug('Could not get delivery stats:', error.message);
      }
    } else {
      health.services.deliveryService = 'not_initialized';
      health.status = 'degraded';
    }

    timer.end('Health check completed');

    // Return appropriate status code
    const statusCode = health.status === 'healthy'
      ? 200
      : health.status === 'degraded' ? 200 : 503;

    res.status(statusCode).json(health);
  } catch (error) {
    timer.end('Health check failed');
    logger.error('Health check error:', error);

    res.status(503).json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      error: error.message,
      version: require('../../package.json').version
    });
  }
}));

/**
 * Detailed health check endpoint
 * GET /api/health/detailed
 */
router.get('/detailed', asyncHandler(async (req, res) => {
  const timer = logger.timeStart('detailed-health-check');

  try {
    const health = {
      status: 'healthy',
      timestamp: new Date().toISOString(),
      version: require('../../package.json').version,
      environment: config.env,
      node: {
        version: process.version,
        uptime: process.uptime(),
        memory: process.memoryUsage(),
        cpu: process.cpuUsage()
      },
      configuration: {
        port: config.server.port,
        logLevel: config.logging.level,
        rateLimitEnabled: true,
        dlqEnabled: config.dlq.enabled,
        metricsEnabled: config.metrics.enabled
      },
      services: {},
      checks: []
    };

    // Database health check
    try {
      if (req.app.locals.services?.database) {
        const dbTimer = logger.timeStart('db-health-check');
        await req.app.locals.services.database.ping();
        const dbInfo = await req.app.locals.services.database.getInfo();
        health.services.mongodb = {
          status: 'connected',
          ...dbInfo
        };
        health.checks.push({
          name: 'database',
          status: 'pass',
          responseTime: dbTimer.end()
        });
      } else {
        health.services.mongodb = { status: 'not_initialized' };
        health.checks.push({
          name: 'database',
          status: 'fail',
          message: 'Database service not initialized'
        });
        health.status = 'degraded';
      }
    } catch (error) {
      health.services.mongodb = { status: 'error', error: error.message };
      health.checks.push({
        name: 'database',
        status: 'fail',
        message: error.message
      });
      health.status = 'degraded';
    }

    // Change streams health check
    try {
      if (req.app.locals.services?.changeStream) {
        const isActive = req.app.locals.services.changeStream.isActive();
        const status = req.app.locals.services.changeStream.getStatus();
        health.services.changeStreams = {
          status: isActive ? 'active' : 'inactive',
          ...status
        };
        health.checks.push({
          name: 'changeStreams',
          status: isActive ? 'pass' : 'warn',
          message: isActive ? 'Active and monitoring' : 'Not active'
        });
        if (!isActive) {
          health.status = 'degraded';
        }
      } else {
        health.services.changeStreams = { status: 'not_initialized' };
        health.checks.push({
          name: 'changeStreams',
          status: 'fail',
          message: 'Change stream service not initialized'
        });
        health.status = 'degraded';
      }
    } catch (error) {
      health.services.changeStreams = { status: 'error', error: error.message };
      health.checks.push({
        name: 'changeStreams',
        status: 'fail',
        message: error.message
      });
      health.status = 'degraded';
    }

    // Webhook service health check
    try {
      if (req.app.locals.services?.webhook) {
        const webhookCount = await req.app.locals.services.webhook.getActiveWebhookCount();
        health.services.webhookService = {
          status: 'active',
          activeWebhooks: webhookCount
        };
        health.checks.push({
          name: 'webhookService',
          status: 'pass',
          message: `${webhookCount} active webhooks`
        });
      } else {
        health.services.webhookService = { status: 'not_initialized' };
        health.checks.push({
          name: 'webhookService',
          status: 'fail',
          message: 'Webhook service not initialized'
        });
        health.status = 'degraded';
      }
    } catch (error) {
      health.services.webhookService = { status: 'error', error: error.message };
      health.checks.push({
        name: 'webhookService',
        status: 'fail',
        message: error.message
      });
      health.status = 'degraded';
    }

    // Delivery service health check
    try {
      if (req.app.locals.services?.delivery) {
        const stats = await req.app.locals.services.delivery.getStats();
        health.services.deliveryService = {
          status: 'active',
          ...stats
        };
        health.checks.push({
          name: 'deliveryService',
          status: 'pass',
          message: `${stats.pending || 0} pending, ${stats.processing || 0} processing`
        });
      } else {
        health.services.deliveryService = { status: 'not_initialized' };
        health.checks.push({
          name: 'deliveryService',
          status: 'fail',
          message: 'Delivery service not initialized'
        });
        health.status = 'degraded';
      }
    } catch (error) {
      health.services.deliveryService = { status: 'error', error: error.message };
      health.checks.push({
        name: 'deliveryService',
        status: 'fail',
        message: error.message
      });
      health.status = 'degraded';
    }

    timer.end('Detailed health check completed');

    // Return appropriate status code
    const statusCode = health.status === 'healthy'
      ? 200
      : health.status === 'degraded' ? 200 : 503;

    res.status(statusCode).json(health);
  } catch (error) {
    timer.end('Detailed health check failed');
    logger.error('Detailed health check error:', error);

    res.status(503).json({
      status: 'unhealthy',
      timestamp: new Date().toISOString(),
      error: error.message,
      version: require('../../package.json').version
    });
  }
}));

/**
 * Readiness probe endpoint
 * GET /api/health/ready
 */
router.get('/ready', asyncHandler(async (req, res) => {
  try {
    // Check if all critical services are ready
    const checks = [];
    let allReady = true;

    // Database readiness
    if (req.app.locals.services?.database) {
      try {
        await req.app.locals.services.database.ping();
        checks.push({ service: 'database', ready: true });
      } catch (error) {
        checks.push({ service: 'database', ready: false, error: error.message });
        allReady = false;
      }
    } else {
      checks.push({ service: 'database', ready: false, error: 'Not initialized' });
      allReady = false;
    }

    // Change streams readiness
    if (req.app.locals.services?.changeStream?.isActive()) {
      checks.push({ service: 'changeStreams', ready: true });
    } else {
      checks.push({ service: 'changeStreams', ready: false });
      allReady = false;
    }

    const response = {
      ready: allReady,
      timestamp: new Date().toISOString(),
      checks
    };

    res.status(allReady ? 200 : 503).json(response);
  } catch (error) {
    logger.error('Readiness check error:', error);
    res.status(503).json({
      ready: false,
      timestamp: new Date().toISOString(),
      error: error.message
    });
  }
}));

/**
 * Liveness probe endpoint
 * GET /api/health/live
 */
router.get('/live', (req, res) => {
  // Simple liveness check - if we can respond, we're alive
  res.json({
    alive: true,
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

module.exports = router;
