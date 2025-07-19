/**
 * Webhook management routes for Huly Webhook Service
 * Handles CRUD operations for webhooks
 */

const express = require('express');
const { asyncHandler } = require('../middleware/errorHandler');
const WebhookController = require('../controllers/WebhookController');

const router = express.Router();

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
