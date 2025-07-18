/**
 * Statistics and monitoring routes for Huly Webhook Service
 * Provides webhook delivery statistics and performance metrics
 */

const express = require('express');
const Joi = require('joi');
const logger = require('../utils/logger');
const { asyncHandler, handleValidationError } = require('../middleware/errorHandler');

const router = express.Router();

/**
 * GET /api/stats
 * Get overall webhook statistics
 */
router.get('/', asyncHandler(async (req, res) => {
  const timer = logger.timeStart('get-stats');

  const querySchema = Joi.object({
    period: Joi.string().valid('hour', 'day', 'week', 'month').default('day'),
    timezone: Joi.string().default('UTC')
  });

  const query = handleValidationError(querySchema.validate(req.query));

  const webhookService = req.app.locals.services.webhook;
  const deliveryService = req.app.locals.services.delivery;

  // Get basic statistics
  const [webhookStats, deliveryStats] = await Promise.all([
    webhookService.getStats(),
    deliveryService.getStats(query.period)
  ]);

  const stats = {
    webhooks: webhookStats,
    deliveries: deliveryStats,
    system: {
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      timestamp: new Date().toISOString()
    }
  };

  timer.end('Statistics retrieved');

  res.json({
    stats,
    query,
    timestamp: new Date().toISOString()
  });
}));

/**
 * GET /api/stats/webhooks
 * Get detailed webhook statistics
 */
router.get('/webhooks', asyncHandler(async (req, res) => {
  const timer = logger.timeStart('get-webhook-stats');

  const querySchema = Joi.object({
    includeInactive: Joi.boolean().default(false),
    groupBy: Joi.string().valid('event', 'status').default('status')
  });

  const query = handleValidationError(querySchema.validate(req.query));

  const webhookService = req.app.locals.services.webhook;
  const stats = await webhookService.getDetailedStats(query);

  timer.end('Webhook statistics retrieved');

  res.json({
    stats,
    query,
    timestamp: new Date().toISOString()
  });
}));

/**
 * GET /api/stats/deliveries
 * Get detailed delivery statistics
 */
router.get('/deliveries', asyncHandler(async (req, res) => {
  const timer = logger.timeStart('get-delivery-stats');

  const querySchema = Joi.object({
    period: Joi.string().valid('hour', 'day', 'week', 'month').default('day'),
    webhookId: Joi.string(),
    eventType: Joi.string(),
    status: Joi.string().valid('pending', 'success', 'failed'),
    groupBy: Joi.string().valid('status', 'webhook', 'event', 'time').default('status')
  });

  const query = handleValidationError(querySchema.validate(req.query));

  const deliveryService = req.app.locals.services.delivery;
  const stats = await deliveryService.getDetailedStats(query);

  timer.end('Delivery statistics retrieved');

  res.json({
    stats,
    query,
    timestamp: new Date().toISOString()
  });
}));

/**
 * GET /api/stats/performance
 * Get performance metrics
 */
router.get('/performance', asyncHandler(async (req, res) => {
  const timer = logger.timeStart('get-performance-stats');

  const querySchema = Joi.object({
    period: Joi.string().valid('hour', 'day', 'week').default('hour'),
    includePercentiles: Joi.boolean().default(true)
  });

  const query = handleValidationError(querySchema.validate(req.query));

  const deliveryService = req.app.locals.services.delivery;
  const changeStreamService = req.app.locals.services.changeStream;

  const [deliveryPerf, changeStreamPerf] = await Promise.all([
    deliveryService.getPerformanceStats(query.period),
    changeStreamService ? changeStreamService.getPerformanceStats(query.period) : null
  ]);

  const performance = {
    delivery: deliveryPerf,
    changeStream: changeStreamPerf,
    system: {
      uptime: process.uptime(),
      memory: process.memoryUsage(),
      cpu: process.cpuUsage()
    }
  };

  timer.end('Performance statistics retrieved');

  res.json({
    performance,
    query,
    timestamp: new Date().toISOString()
  });
}));

/**
 * GET /api/stats/events
 * Get event processing statistics
 */
router.get('/events', asyncHandler(async (req, res) => {
  const timer = logger.timeStart('get-event-stats');

  const querySchema = Joi.object({
    period: Joi.string().valid('hour', 'day', 'week', 'month').default('day'),
    eventType: Joi.string(),
    collection: Joi.string()
  });

  const query = handleValidationError(querySchema.validate(req.query));

  const changeStreamService = req.app.locals.services.changeStream;
  const stats = changeStreamService
    ? await changeStreamService.getEventStats(query)
    : { message: 'Change stream service not available' };

  timer.end('Event statistics retrieved');

  res.json({
    stats,
    query,
    timestamp: new Date().toISOString()
  });
}));

/**
 * GET /api/stats/errors
 * Get error statistics and recent errors
 */
router.get('/errors', asyncHandler(async (req, res) => {
  const timer = logger.timeStart('get-error-stats');

  const querySchema = Joi.object({
    period: Joi.string().valid('hour', 'day', 'week').default('day'),
    limit: Joi.number().integer().min(1).max(100).default(20),
    severity: Joi.string().valid('warn', 'error').default('error')
  });

  const query = handleValidationError(querySchema.validate(req.query));

  const deliveryService = req.app.locals.services.delivery;
  const errorStats = await deliveryService.getErrorStats(query);

  timer.end('Error statistics retrieved');

  res.json({
    errors: errorStats,
    query,
    timestamp: new Date().toISOString()
  });
}));

/**
 * GET /api/stats/health-summary
 * Get health summary for monitoring systems
 */
router.get('/health-summary', asyncHandler(async (req, res) => {
  const timer = logger.timeStart('get-health-summary');

  const webhookService = req.app.locals.services.webhook;
  const deliveryService = req.app.locals.services.delivery;
  const changeStreamService = req.app.locals.services.changeStream;

  const [webhookCount, deliveryStats, changeStreamStatus] = await Promise.all([
    webhookService.getActiveWebhookCount(),
    deliveryService.getHealthStats(),
    changeStreamService ? changeStreamService.getStatus() : null
  ]);

  const summary = {
    webhooks: {
      active: webhookCount,
      healthy: true // Add logic to determine health
    },
    deliveries: deliveryStats,
    changeStreams: changeStreamStatus,
    overall: {
      status: 'healthy', // Add logic to determine overall status
      timestamp: new Date().toISOString()
    }
  };

  // Determine overall health
  if (deliveryStats.failureRate > 0.1) { // More than 10% failure rate
    summary.overall.status = 'degraded';
  }

  if (!changeStreamStatus?.active) {
    summary.overall.status = 'degraded';
  }

  timer.end('Health summary retrieved');

  res.json(summary);
}));

module.exports = router;
