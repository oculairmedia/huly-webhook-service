/**
 * Webhook service for Huly Webhook Service
 * Handles CRUD operations and management of webhooks
 */

const crypto = require('crypto');
const config = require('../config');
const logger = require('../utils/logger');
const { NotFoundError, ConflictError, ValidationError } = require('../middleware/errorHandler');

class WebhookService {
  constructor (databaseService) {
    this.db = databaseService;
    this.collectionName = 'webhooks';
  }

  /**
   * Create a new webhook
   */
  async createWebhook (webhookData) {
    try {
      const timer = logger.timeStart('create-webhook');

      // Generate secret if not provided
      if (!webhookData.secret) {
        webhookData.secret = this.generateSecret();
      }

      // Validate URL
      this.validateWebhookUrl(webhookData.url);

      // Check for duplicate names
      const existingWebhook = await this.db.findOne(this.collectionName, {
        name: webhookData.name
      });

      if (existingWebhook) {
        throw new ConflictError(`Webhook with name '${webhookData.name}' already exists`);
      }

      // Prepare webhook document
      const webhook = {
        ...webhookData,
        active: webhookData.active !== false, // Default to true
        retryConfig: {
          ...config.defaultWebhookConfig.retryConfig,
          ...webhookData.retryConfig
        },
        filters: webhookData.filters || {},
        headers: webhookData.headers || {},
        createdAt: new Date(),
        updatedAt: new Date(),
        lastDelivery: null,
        failureCount: 0,
        successCount: 0,
        totalDeliveries: 0
      };

      const result = await this.db.insertOne(this.collectionName, webhook);

      timer.end('Webhook created successfully');

      return this.sanitizeWebhook(result);
    } catch (error) {
      logger.error('Error creating webhook:', error);
      throw error;
    }
  }

  /**
   * Get webhook by ID
   */
  async getWebhook (webhookId) {
    try {
      const objectId = this.db.createObjectId(webhookId);
      const webhook = await this.db.findOne(this.collectionName, { _id: objectId });

      if (!webhook) {
        throw new NotFoundError('Webhook');
      }

      return this.sanitizeWebhook(webhook);
    } catch (error) {
      if (error instanceof NotFoundError) {
        throw error;
      }
      logger.error('Error getting webhook:', error);
      throw error;
    }
  }

  /**
   * List webhooks with filters and pagination
   */
  async listWebhooks (options = {}) {
    try {
      const timer = logger.timeStart('list-webhooks');

      const filter = {};

      // Apply filters
      if (options.active !== undefined) {
        filter.active = options.active;
      }

      const sortOptions = {
        name: { name: 1 },
        created: { createdAt: -1 },
        updated: { updatedAt: -1 }
      };

      const findOptions = {
        limit: options.limit || 50,
        offset: options.offset || 0,
        sort: sortOptions[options.sort] || sortOptions.created
      };

      const result = await this.db.find(this.collectionName, filter, findOptions);

      // Sanitize webhooks
      const webhooks = result.documents.map(webhook => this.sanitizeWebhook(webhook));

      timer.end(`Listed ${webhooks.length} webhooks`);

      return {
        ...result,
        documents: webhooks
      };
    } catch (error) {
      logger.error('Error listing webhooks:', error);
      throw error;
    }
  }

  /**
   * Update webhook
   */
  async updateWebhook (webhookId, updateData) {
    try {
      const timer = logger.timeStart('update-webhook');

      const objectId = this.db.createObjectId(webhookId);

      // Check if webhook exists
      const existingWebhook = await this.db.findOne(this.collectionName, { _id: objectId });
      if (!existingWebhook) {
        throw new NotFoundError('Webhook');
      }

      // Validate URL if being updated
      if (updateData.url) {
        this.validateWebhookUrl(updateData.url);
      }

      // Check for name conflicts if name is being updated
      if (updateData.name && updateData.name !== existingWebhook.name) {
        const nameConflict = await this.db.findOne(this.collectionName, {
          name: updateData.name,
          _id: { $ne: objectId }
        });

        if (nameConflict) {
          throw new ConflictError(`Webhook with name '${updateData.name}' already exists`);
        }
      }

      // Prepare update document
      const updateDoc = {
        $set: {
          ...updateData,
          updatedAt: new Date()
        }
      };

      // Handle nested objects
      if (updateData.retryConfig) {
        updateDoc.$set.retryConfig = {
          ...existingWebhook.retryConfig,
          ...updateData.retryConfig
        };
      }

      if (updateData.filters) {
        updateDoc.$set.filters = {
          ...existingWebhook.filters,
          ...updateData.filters
        };
      }

      if (updateData.headers) {
        updateDoc.$set.headers = {
          ...existingWebhook.headers,
          ...updateData.headers
        };
      }

      await this.db.updateOne(this.collectionName, { _id: objectId }, updateDoc);

      // Get updated webhook
      const updatedWebhook = await this.db.findOne(this.collectionName, { _id: objectId });

      timer.end('Webhook updated successfully');

      return this.sanitizeWebhook(updatedWebhook);
    } catch (error) {
      logger.error('Error updating webhook:', error);
      throw error;
    }
  }

  /**
   * Delete webhook
   */
  async deleteWebhook (webhookId) {
    try {
      const timer = logger.timeStart('delete-webhook');

      const objectId = this.db.createObjectId(webhookId);

      // Check if webhook exists
      const webhook = await this.db.findOne(this.collectionName, { _id: objectId });
      if (!webhook) {
        throw new NotFoundError('Webhook');
      }

      // Delete the webhook
      await this.db.deleteOne(this.collectionName, { _id: objectId });

      // Note: We intentionally keep delivery history for audit purposes
      // Consider adding a cleanup job to remove old delivery records

      timer.end('Webhook deleted successfully');

      return true;
    } catch (error) {
      logger.error('Error deleting webhook:', error);
      throw error;
    }
  }

  /**
   * Get webhooks by event type
   */
  async getWebhooksByEvent (eventType, filters = {}) {
    try {
      const filter = {
        active: true,
        events: eventType,
        ...filters
      };

      const result = await this.db.find(this.collectionName, filter, {
        limit: 1000, // Large limit to get all matching webhooks
        sort: { createdAt: 1 }
      });

      return result.documents.map(webhook => this.sanitizeWebhook(webhook));
    } catch (error) {
      logger.error('Error getting webhooks by event:', error);
      throw error;
    }
  }

  /**
   * Get active webhook count
   */
  async getActiveWebhookCount () {
    try {
      return await this.db.countDocuments(this.collectionName, { active: true });
    } catch (error) {
      logger.error('Error getting active webhook count:', error);
      return 0;
    }
  }

  /**
   * Get webhook statistics
   */
  async getStats () {
    try {
      const timer = logger.timeStart('get-webhook-stats');

      const pipeline = [
        {
          $group: {
            _id: null,
            total: { $sum: 1 },
            active: { $sum: { $cond: [{ $eq: ['$active', true] }, 1, 0] } },
            inactive: { $sum: { $cond: [{ $eq: ['$active', false] }, 1, 0] } },
            totalSuccessCount: { $sum: '$successCount' },
            totalFailureCount: { $sum: '$failureCount' },
            totalDeliveries: { $sum: '$totalDeliveries' }
          }
        }
      ];

      const [stats] = await this.db.aggregate(this.collectionName, pipeline);

      timer.end('Webhook statistics retrieved');

      return stats || {
        total: 0,
        active: 0,
        inactive: 0,
        totalSuccessCount: 0,
        totalFailureCount: 0,
        totalDeliveries: 0
      };
    } catch (error) {
      logger.error('Error getting webhook stats:', error);
      return {
        total: 0,
        active: 0,
        inactive: 0,
        totalSuccessCount: 0,
        totalFailureCount: 0,
        totalDeliveries: 0
      };
    }
  }

  /**
   * Get detailed webhook statistics
   */
  async getDetailedStats (options = {}) {
    try {
      const timer = logger.timeStart('get-detailed-webhook-stats');

      const matchStage = {};
      if (!options.includeInactive) {
        matchStage.active = true;
      }

      let groupBy = '_id';
      if (options.groupBy === 'event') {
        groupBy = '$events';
      } else if (options.groupBy === 'status') {
        groupBy = '$active';
      }

      const pipeline = [
        { $match: matchStage },
        { $unwind: options.groupBy === 'event' ? '$events' : '$_id' },
        {
          $group: {
            _id: groupBy,
            count: { $sum: 1 },
            successCount: { $sum: '$successCount' },
            failureCount: { $sum: '$failureCount' },
            totalDeliveries: { $sum: '$totalDeliveries' },
            avgFailureRate: {
              $avg: {
                $cond: [
                  { $gt: ['$totalDeliveries', 0] },
                  { $divide: ['$failureCount', '$totalDeliveries'] },
                  0
                ]
              }
            }
          }
        },
        { $sort: { count: -1 } }
      ];

      const stats = await this.db.aggregate(this.collectionName, pipeline);

      timer.end('Detailed webhook statistics retrieved');

      return stats;
    } catch (error) {
      logger.error('Error getting detailed webhook stats:', error);
      return [];
    }
  }

  /**
   * Update webhook delivery statistics
   */
  async updateWebhookStats (webhookId, success = true) {
    try {
      const objectId = this.db.createObjectId(webhookId);

      const updateDoc = {
        $inc: {
          totalDeliveries: 1,
          successCount: success ? 1 : 0,
          failureCount: success ? 0 : 1
        },
        $set: {
          lastDelivery: new Date(),
          updatedAt: new Date()
        }
      };

      await this.db.updateOne(this.collectionName, { _id: objectId }, updateDoc);
    } catch (error) {
      logger.error('Error updating webhook stats:', error);
      // Don't throw - stats update is not critical
    }
  }

  /**
   * Validate webhook URL
   */
  validateWebhookUrl (url) {
    try {
      const parsedUrl = new URL(url);

      // Check protocol
      if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
        throw new ValidationError('Webhook URL must use HTTP or HTTPS protocol');
      }

      // Prevent localhost/private network access in production
      if (config.validate.isProduction()) {
        const hostname = parsedUrl.hostname;
        if (
          hostname === 'localhost' ||
          hostname === '127.0.0.1' ||
          hostname === '::1' ||
          hostname.startsWith('192.168.') ||
          hostname.startsWith('10.') ||
          hostname.startsWith('172.')
        ) {
          throw new ValidationError('Webhook URL cannot target private networks in production');
        }
      }

      return true;
    } catch (error) {
      if (error instanceof ValidationError) {
        throw error;
      }
      throw new ValidationError('Invalid webhook URL format');
    }
  }

  /**
   * Generate a secure webhook secret
   */
  generateSecret (length = 32) {
    return crypto.randomBytes(length).toString('hex');
  }

  /**
   * Generate HMAC signature for webhook payload
   */
  generateSignature (payload, secret) {
    const hmac = crypto.createHmac('sha256', secret);
    hmac.update(payload, 'utf8');
    return 'sha256=' + hmac.digest('hex');
  }

  /**
   * Verify webhook signature
   */
  verifySignature (payload, signature, secret) {
    const expectedSignature = this.generateSignature(payload, secret);
    return crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expectedSignature)
    );
  }

  /**
   * Check if webhook should receive event based on filters
   */
  shouldReceiveEvent (webhook, event) {
    // Check if event type is in webhook's events list
    if (!webhook.events.includes(event.type)) {
      return false;
    }

    // Apply filters
    const filters = webhook.filters || {};

    // Project filter
    if (filters.projects && filters.projects.length > 0) {
      if (!event.data.project?.id || !filters.projects.includes(event.data.project.id)) {
        return false;
      }
    }

    // Issue type filter (if applicable)
    if (filters.issueTypes && filters.issueTypes.length > 0) {
      if (event.type.startsWith('issue.') && event.data.issue?.type) {
        if (!filters.issueTypes.includes(event.data.issue.type)) {
          return false;
        }
      }
    }

    // Custom filters (extensible)
    if (filters.customFilters) {
      // Implement custom filter logic here
      // This could include complex matching rules
    }

    return true;
  }

  /**
   * Remove sensitive information from webhook before returning
   */
  sanitizeWebhook (webhook) {
    if (!webhook) return null;

    const sanitized = { ...webhook };

    // Remove or mask sensitive information
    if (sanitized.secret) {
      sanitized.secret = sanitized.secret.substring(0, 8) + '...';
    }

    return sanitized;
  }
}

module.exports = WebhookService;
