/**
 * Webhook management routes for Huly Webhook Service
 * Handles CRUD operations for webhooks
 */

const express = require('express');
const Joi = require('joi');
const logger = require('../utils/logger');
const { asyncHandler, handleValidationError } = require('../middleware/errorHandler');
const config = require('../config');
const WebhookController = require('../controllers/WebhookController');

const router = express.Router();

// Webhook validation schemas
const webhookCreateSchema = Joi.object({
  name: Joi.string().min(1).max(100).required(),
  url: Joi.string().uri().required(),
  events: Joi.array().items(Joi.string().valid(...config.supportedEventTypes)).min(1).required(),
  active: Joi.boolean().default(true),
  secret: Joi.string().min(8).max(100),
  filters: Joi.object({
    projects: Joi.array().items(Joi.string()),
    issueTypes: Joi.array().items(Joi.string()),
    customFilters: Joi.object()
  }).default({}),
  headers: Joi.object().default({}),
  retryConfig: Joi.object({
    maxAttempts: Joi.number().integer().min(1).max(10).default(config.delivery.retry.maxAttempts),
    backoffMultiplier: Joi.number().min(1).max(10).default(config.delivery.retry.backoffMultiplier)
  }).default({})
});

const webhookUpdateSchema = Joi.object({
  name: Joi.string().min(1).max(100),
  url: Joi.string().uri(),
  events: Joi.array().items(Joi.string().valid(...config.supportedEventTypes)).min(1),
  active: Joi.boolean(),
  secret: Joi.string().min(8).max(100),
  filters: Joi.object({
    projects: Joi.array().items(Joi.string()),
    issueTypes: Joi.array().items(Joi.string()),
    customFilters: Joi.object()
  }),
  headers: Joi.object(),
  retryConfig: Joi.object({
    maxAttempts: Joi.number().integer().min(1).max(10),
    backoffMultiplier: Joi.number().min(1).max(10)
  })
});

// Initialize controller with services
const initController = (req, res, next) => {
  req.controller = new WebhookController(req.app.locals.services);
  next();
};

router.use(initController);

/**
 * GET /api/webhooks
 * List all webhooks
 */
router.get('/', asyncHandler(async (req, res) => {
  await req.controller.listWebhooks(req, res);
}));

/**
 * POST /api/webhooks
 * Create a new webhook
 */
router.post('/', asyncHandler(async (req, res) => {
  await req.controller.createWebhook(req, res);
}));

/**
 * GET /api/webhooks/:id
 * Get a specific webhook
 */
router.get('/:id', asyncHandler(async (req, res) => {
  await req.controller.getWebhook(req, res);
}));

/**
 * PUT /api/webhooks/:id
 * Update a webhook
 */
router.put('/:id', asyncHandler(async (req, res) => {
  await req.controller.updateWebhook(req, res);
}));

/**
 * DELETE /api/webhooks/:id
 * Delete a webhook
 */
router.delete('/:id', asyncHandler(async (req, res) => {
  await req.controller.deleteWebhook(req, res);
}));

/**
 * POST /api/webhooks/:id/test
 * Test webhook delivery
 */
router.post('/:id/test', asyncHandler(async (req, res) => {
  await req.controller.testWebhook(req, res);
}));

/**
 * GET /api/webhooks/:id/deliveries
 * Get webhook delivery history
 */
router.get('/:id/deliveries', asyncHandler(async (req, res) => {
  await req.controller.getWebhookDeliveries(req, res);
}));

/**
 * GET /api/webhooks/:id/stats
 * Get webhook statistics
 */
router.get('/:id/stats', asyncHandler(async (req, res) => {
  await req.controller.getWebhookStats(req, res);
}));

module.exports = router;
