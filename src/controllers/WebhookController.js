/**
 * WebhookController
 * Handles CRUD operations for webhook configurations
 */

const logger = require('../utils/logger');
const Webhook = require('../models/Webhook');

class WebhookController {
  constructor (services) {
    this.services = services;
    this.webhookService = services.webhook;
    this.database = services.database;
  }

  // GET /api/webhooks
  async listWebhooks (req, res) {
    try {
      const {
        page = 1,
        limit = 50,
        active,
        events,
        search
      } = req.query;

      const offset = (page - 1) * limit;
      const filters = {};

      // Add filters
      if (active !== undefined) {
        filters.active = active === 'true';
      }

      if (events) {
        filters.events = { $in: events.split(',') };
      }

      if (search) {
        filters.$or = [
          { name: { $regex: search, $options: 'i' } },
          { url: { $regex: search, $options: 'i' } }
        ];
      }

      const webhooks = await this.webhookService.findWebhooks(filters, {
        skip: offset,
        limit: parseInt(limit),
        sort: { createdAt: -1 }
      });

      const total = await this.webhookService.countWebhooks(filters);

      res.json({
        webhooks: webhooks.map(webhook => webhook.toResponse()),
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / limit)
        }
      });
    } catch (error) {
      logger.error('Error listing webhooks:', error);
      res.status(500).json({
        error: 'Internal Server Error',
        message: 'Failed to list webhooks'
      });
    }
  }

  // GET /api/webhooks/:id
  async getWebhook (req, res) {
    try {
      const { id } = req.params;

      const webhook = await this.webhookService.findWebhookById(id);
      if (!webhook) {
        return res.status(404).json({
          error: 'Not Found',
          message: 'Webhook not found'
        });
      }

      res.json(webhook.toResponse());
    } catch (error) {
      logger.error('Error getting webhook:', error);
      res.status(500).json({
        error: 'Internal Server Error',
        message: 'Failed to get webhook'
      });
    }
  }

  // POST /api/webhooks
  async createWebhook (req, res) {
    try {
      const webhookData = req.body;

      // Create webhook instance and validate
      const webhook = new Webhook(webhookData);
      webhook.validate();

      // Check for duplicate URLs
      const existingWebhook = await this.webhookService.findWebhookByUrl(webhook.url);
      if (existingWebhook) {
        return res.status(400).json({
          error: 'Bad Request',
          message: 'Webhook with this URL already exists'
        });
      }

      // Create webhook
      const createdWebhook = await this.webhookService.createWebhook(webhook);

      logger.info(`Webhook created: ${createdWebhook.id} - ${createdWebhook.name}`);

      res.status(201).json(createdWebhook.toResponse());
    } catch (error) {
      logger.error('Error creating webhook:', error);

      if (error.message.includes('validation failed')) {
        return res.status(400).json({
          error: 'Bad Request',
          message: error.message
        });
      }

      res.status(500).json({
        error: 'Internal Server Error',
        message: 'Failed to create webhook'
      });
    }
  }

  // PUT /api/webhooks/:id
  async updateWebhook (req, res) {
    try {
      const { id } = req.params;
      const updateData = req.body;

      const existingWebhook = await this.webhookService.findWebhookById(id);
      if (!existingWebhook) {
        return res.status(404).json({
          error: 'Not Found',
          message: 'Webhook not found'
        });
      }

      // Check for URL conflicts if URL is being updated
      if (updateData.url && updateData.url !== existingWebhook.url) {
        const duplicateWebhook = await this.webhookService.findWebhookByUrl(updateData.url);
        if (duplicateWebhook && duplicateWebhook.id !== id) {
          return res.status(400).json({
            error: 'Bad Request',
            message: 'Webhook with this URL already exists'
          });
        }
      }

      // Update webhook
      const updatedWebhook = await this.webhookService.updateWebhook(id, updateData);

      logger.info(`Webhook updated: ${updatedWebhook.id} - ${updatedWebhook.name}`);

      res.json(updatedWebhook.toResponse());
    } catch (error) {
      logger.error('Error updating webhook:', error);

      if (error.message.includes('validation failed')) {
        return res.status(400).json({
          error: 'Bad Request',
          message: error.message
        });
      }

      res.status(500).json({
        error: 'Internal Server Error',
        message: 'Failed to update webhook'
      });
    }
  }

  // DELETE /api/webhooks/:id
  async deleteWebhook (req, res) {
    try {
      const { id } = req.params;

      const webhook = await this.webhookService.findWebhookById(id);
      if (!webhook) {
        return res.status(404).json({
          error: 'Not Found',
          message: 'Webhook not found'
        });
      }

      await this.webhookService.deleteWebhook(id);

      logger.info(`Webhook deleted: ${id} - ${webhook.name}`);

      res.status(204).send();
    } catch (error) {
      logger.error('Error deleting webhook:', error);
      res.status(500).json({
        error: 'Internal Server Error',
        message: 'Failed to delete webhook'
      });
    }
  }

  // POST /api/webhooks/:id/test
  async testWebhook (req, res) {
    try {
      const { id } = req.params;

      const webhook = await this.webhookService.findWebhookById(id);
      if (!webhook) {
        return res.status(404).json({
          error: 'Not Found',
          message: 'Webhook not found'
        });
      }

      // Create test event
      const testEvent = {
        id: 'test-event-' + Date.now(),
        type: 'webhook.test',
        timestamp: new Date().toISOString(),
        workspace: 'test',
        data: {
          message: 'This is a test webhook delivery',
          webhook: {
            id: webhook.id,
            name: webhook.name
          }
        }
      };

      // Attempt delivery
      const deliveryService = this.services.delivery;
      const result = await deliveryService.deliverToWebhook(webhook, testEvent);

      res.json({
        success: result.success,
        status: result.status,
        duration: result.duration,
        message: result.success ? 'Test webhook delivered successfully' : result.error
      });
    } catch (error) {
      logger.error('Error testing webhook:', error);
      res.status(500).json({
        error: 'Internal Server Error',
        message: 'Failed to test webhook'
      });
    }
  }

  // GET /api/webhooks/:id/deliveries
  async getWebhookDeliveries (req, res) {
    try {
      const { id } = req.params;
      const {
        page = 1,
        limit = 50,
        status,
        from,
        to
      } = req.query;

      const webhook = await this.webhookService.findWebhookById(id);
      if (!webhook) {
        return res.status(404).json({
          error: 'Not Found',
          message: 'Webhook not found'
        });
      }

      const offset = (page - 1) * limit;
      const filters = { webhookId: id };

      if (status) {
        filters.status = status;
      }

      if (from || to) {
        filters.timestamp = {};
        if (from) filters.timestamp.$gte = new Date(from);
        if (to) filters.timestamp.$lte = new Date(to);
      }

      const deliveryHistoryService = this.services.deliveryHistory;
      const deliveries = await deliveryHistoryService.findDeliveries(filters, {
        skip: offset,
        limit: parseInt(limit),
        sort: { timestamp: -1 }
      });

      const total = await deliveryHistoryService.countDeliveries(filters);

      res.json({
        deliveries: deliveries.map(delivery => delivery.toResponse()),
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / limit)
        }
      });
    } catch (error) {
      logger.error('Error getting webhook deliveries:', error);
      res.status(500).json({
        error: 'Internal Server Error',
        message: 'Failed to get webhook deliveries'
      });
    }
  }

  // GET /api/webhooks/:id/stats
  async getWebhookStats (req, res) {
    try {
      const { id } = req.params;
      const { period = '7d' } = req.query;

      const webhook = await this.webhookService.findWebhookById(id);
      if (!webhook) {
        return res.status(404).json({
          error: 'Not Found',
          message: 'Webhook not found'
        });
      }

      // Calculate date range
      const now = new Date();
      const periodMs = this.parsePeriod(period);
      const from = new Date(now.getTime() - periodMs);

      const deliveryHistoryService = this.services.deliveryHistory;
      const stats = await deliveryHistoryService.getWebhookStats(id, from, now);

      res.json({
        webhook: {
          id: webhook.id,
          name: webhook.name
        },
        period: {
          from: from.toISOString(),
          to: now.toISOString(),
          duration: period
        },
        stats
      });
    } catch (error) {
      logger.error('Error getting webhook stats:', error);
      res.status(500).json({
        error: 'Internal Server Error',
        message: 'Failed to get webhook stats'
      });
    }
  }

  // Helper method to parse period string
  parsePeriod (period) {
    const match = period.match(/^(\d+)([hdwmy])$/);
    if (!match) throw new Error('Invalid period format');

    const [, number, unit] = match;
    const num = parseInt(number);

    switch (unit) {
    case 'h': return num * 60 * 60 * 1000;
    case 'd': return num * 24 * 60 * 60 * 1000;
    case 'w': return num * 7 * 24 * 60 * 60 * 1000;
    case 'm': return num * 30 * 24 * 60 * 60 * 1000;
    case 'y': return num * 365 * 24 * 60 * 60 * 1000;
    default: throw new Error('Invalid period unit');
    }
  }
}

module.exports = WebhookController;
