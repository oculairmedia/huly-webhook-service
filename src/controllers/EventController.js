/**
 * EventController
 * Handles webhook event-related operations
 */

const logger = require('../utils/logger');

class EventController {
  constructor (services) {
    this.services = services;
    this.eventService = services.event;
    this.database = services.database;
  }

  // GET /api/events
  async listEvents (req, res) {
    try {
      const {
        page = 1,
        limit = 50,
        type,
        workspace,
        processed,
        from,
        to
      } = req.query;

      const offset = (page - 1) * limit;
      const filters = {};

      // Add filters
      if (type) {
        filters.type = type;
      }

      if (workspace) {
        filters.workspace = workspace;
      }

      if (processed !== undefined) {
        filters.processed = processed === 'true';
      }

      if (from || to) {
        filters.timestamp = {};
        if (from) filters.timestamp.$gte = new Date(from);
        if (to) filters.timestamp.$lte = new Date(to);
      }

      const collection = this.database.db.collection('webhook_events');
      const events = await collection.find(filters)
        .sort({ timestamp: -1 })
        .skip(offset)
        .limit(parseInt(limit))
        .toArray();

      const total = await collection.countDocuments(filters);

      res.json({
        events: events.map(event => ({
          id: event.id,
          type: event.type,
          timestamp: event.timestamp,
          workspace: event.workspace,
          processed: event.processed,
          processedAt: event.processedAt,
          data: event.data
        })),
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / limit)
        }
      });
    } catch (error) {
      logger.error('Error listing events:', error);
      res.status(500).json({
        error: 'Internal Server Error',
        message: 'Failed to list events'
      });
    }
  }

  // GET /api/events/:id
  async getEvent (req, res) {
    try {
      const { id } = req.params;

      const collection = this.database.db.collection('webhook_events');
      const event = await collection.findOne({ id });

      if (!event) {
        return res.status(404).json({
          error: 'Not Found',
          message: 'Event not found'
        });
      }

      res.json(event);
    } catch (error) {
      logger.error('Error getting event:', error);
      res.status(500).json({
        error: 'Internal Server Error',
        message: 'Failed to get event'
      });
    }
  }

  // GET /api/events/:id/deliveries
  async getEventDeliveries (req, res) {
    try {
      const { id } = req.params;
      const {
        page = 1,
        limit = 50,
        status
      } = req.query;

      // Check if event exists
      const eventCollection = this.database.db.collection('webhook_events');
      const event = await eventCollection.findOne({ id });

      if (!event) {
        return res.status(404).json({
          error: 'Not Found',
          message: 'Event not found'
        });
      }

      const offset = (page - 1) * limit;
      const filters = { eventId: id };

      if (status) {
        filters.status = status;
      }

      const deliveryCollection = this.database.db.collection('delivery_attempts');
      const deliveries = await deliveryCollection.find(filters)
        .sort({ timestamp: -1 })
        .skip(offset)
        .limit(parseInt(limit))
        .toArray();

      const total = await deliveryCollection.countDocuments(filters);

      res.json({
        event: {
          id: event.id,
          type: event.type,
          timestamp: event.timestamp,
          workspace: event.workspace
        },
        deliveries: deliveries.map(delivery => ({
          id: delivery.id,
          webhookId: delivery.webhookId,
          attemptNumber: delivery.attemptNumber,
          status: delivery.status,
          httpStatus: delivery.httpStatus,
          errorMessage: delivery.errorMessage,
          duration: delivery.duration,
          timestamp: delivery.timestamp,
          nextRetryAt: delivery.nextRetryAt,
          finalAttempt: delivery.finalAttempt
        })),
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / limit)
        }
      });
    } catch (error) {
      logger.error('Error getting event deliveries:', error);
      res.status(500).json({
        error: 'Internal Server Error',
        message: 'Failed to get event deliveries'
      });
    }
  }

  // POST /api/events/:id/retry
  async retryEvent (req, res) {
    try {
      const { id } = req.params;
      const { webhookIds } = req.body;

      // Check if event exists
      const eventCollection = this.database.db.collection('webhook_events');
      const event = await eventCollection.findOne({ id });

      if (!event) {
        return res.status(404).json({
          error: 'Not Found',
          message: 'Event not found'
        });
      }

      let webhooksToRetry = [];

      if (webhookIds && webhookIds.length > 0) {
        // Retry specific webhooks
        const webhookService = this.services.webhook;
        for (const webhookId of webhookIds) {
          const webhook = await webhookService.findWebhookById(webhookId);
          if (webhook && webhook.active) {
            webhooksToRetry.push(webhook);
          }
        }
      } else {
        // Retry all active webhooks that match the event
        const webhookService = this.services.webhook;
        const allWebhooks = await webhookService.findWebhooks({ active: true });

        webhooksToRetry = allWebhooks.filter(webhook =>
          webhook.shouldProcessEvent(event.type) &&
          webhook.matchesFilters(event.data)
        );
      }

      if (webhooksToRetry.length === 0) {
        return res.status(400).json({
          error: 'Bad Request',
          message: 'No eligible webhooks found for retry'
        });
      }

      // Queue retry deliveries
      const deliveryService = this.services.delivery;
      const retryResults = [];

      for (const webhook of webhooksToRetry) {
        try {
          const result = await deliveryService.queueDelivery(webhook, event);
          retryResults.push({
            webhookId: webhook.id,
            webhookName: webhook.name,
            success: true,
            deliveryId: result.id
          });
        } catch (error) {
          retryResults.push({
            webhookId: webhook.id,
            webhookName: webhook.name,
            success: false,
            error: error.message
          });
        }
      }

      logger.info(`Event retry initiated: ${id} - ${retryResults.length} webhooks queued`);

      res.json({
        eventId: id,
        retryResults,
        summary: {
          totalWebhooks: webhooksToRetry.length,
          successfulQueues: retryResults.filter(r => r.success).length,
          failedQueues: retryResults.filter(r => !r.success).length
        }
      });
    } catch (error) {
      logger.error('Error retrying event:', error);
      res.status(500).json({
        error: 'Internal Server Error',
        message: 'Failed to retry event'
      });
    }
  }

  // GET /api/events/types
  async getEventTypes (req, res) {
    try {
      const config = require('../config');

      res.json({
        supportedTypes: config.supportedEventTypes,
        description: {
          'issue.created': 'New issue created',
          'issue.updated': 'Issue modified',
          'issue.deleted': 'Issue removed',
          'issue.status_changed': 'Issue status changed',
          'issue.assigned': 'Issue assignment changed',
          'project.created': 'New project created',
          'project.updated': 'Project settings modified',
          'project.archived': 'Project archived',
          'comment.created': 'Comment added to issue',
          'attachment.added': 'File attached to issue'
        }
      });
    } catch (error) {
      logger.error('Error getting event types:', error);
      res.status(500).json({
        error: 'Internal Server Error',
        message: 'Failed to get event types'
      });
    }
  }

  // GET /api/events/stats
  async getEventStats (req, res) {
    try {
      const { period = '7d' } = req.query;

      // Calculate date range
      const now = new Date();
      const periodMs = this.parsePeriod(period);
      const from = new Date(now.getTime() - periodMs);

      const eventCollection = this.database.db.collection('webhook_events');

      // Get event counts by type
      const eventsByType = await eventCollection.aggregate([
        {
          $match: {
            timestamp: { $gte: from, $lte: now }
          }
        },
        {
          $group: {
            _id: '$type',
            count: { $sum: 1 }
          }
        },
        {
          $sort: { count: -1 }
        }
      ]).toArray();

      // Get processed vs unprocessed counts
      const processingStats = await eventCollection.aggregate([
        {
          $match: {
            timestamp: { $gte: from, $lte: now }
          }
        },
        {
          $group: {
            _id: '$processed',
            count: { $sum: 1 }
          }
        }
      ]).toArray();

      // Get events by workspace
      const eventsByWorkspace = await eventCollection.aggregate([
        {
          $match: {
            timestamp: { $gte: from, $lte: now }
          }
        },
        {
          $group: {
            _id: '$workspace',
            count: { $sum: 1 }
          }
        },
        {
          $sort: { count: -1 }
        }
      ]).toArray();

      // Get total events
      const totalEvents = await eventCollection.countDocuments({
        timestamp: { $gte: from, $lte: now }
      });

      res.json({
        period: {
          from: from.toISOString(),
          to: now.toISOString(),
          duration: period
        },
        totalEvents,
        eventsByType: eventsByType.map(item => ({
          type: item._id,
          count: item.count
        })),
        processingStats: {
          processed: processingStats.find(item => item._id === true)?.count || 0,
          unprocessed: processingStats.find(item => item._id === false)?.count || 0
        },
        eventsByWorkspace: eventsByWorkspace.map(item => ({
          workspace: item._id,
          count: item.count
        }))
      });
    } catch (error) {
      logger.error('Error getting event stats:', error);
      res.status(500).json({
        error: 'Internal Server Error',
        message: 'Failed to get event stats'
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

module.exports = EventController;
