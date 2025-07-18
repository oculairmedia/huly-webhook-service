/**
 * Webhook model for MongoDB operations
 * Defines the structure and validation for webhook configurations
 */

const Joi = require('joi');
const { v4: uuidv4 } = require('uuid');

class Webhook {
  constructor (data = {}) {
    this.id = data.id || uuidv4();
    this.name = data.name || '';
    this.url = data.url || '';
    this.secret = data.secret || '';
    this.events = data.events || [];
    this.filters = data.filters || {};
    this.active = data.active !== undefined ? data.active : true;
    this.retryConfig = data.retryConfig || {
      maxAttempts: 3,
      backoffMultiplier: 2,
      initialDelay: 1000
    };
    this.timeout = data.timeout || 30000;
    this.headers = data.headers || {};
    this.metadata = data.metadata || {};
    this.createdAt = data.createdAt || new Date();
    this.updatedAt = data.updatedAt || new Date();
    this.createdBy = data.createdBy || null;
    this.lastDelivery = data.lastDelivery || null;
    this.deliveryStats = data.deliveryStats || {
      totalDeliveries: 0,
      successfulDeliveries: 0,
      failedDeliveries: 0,
      lastSuccessAt: null,
      lastFailureAt: null
    };
  }

  // Validation schema
  static get schema () {
    return Joi.object({
      id: Joi.string().uuid().optional(),
      name: Joi.string().min(1).max(100).required(),
      url: Joi.string().uri().required(),
      secret: Joi.string().min(8).max(255).optional(),
      events: Joi.array().items(Joi.string().valid(
        'issue.created',
        'issue.updated',
        'issue.deleted',
        'issue.status_changed',
        'issue.assigned',
        'project.created',
        'project.updated',
        'project.archived',
        'comment.created',
        'attachment.added'
      )).min(1).required(),
      filters: Joi.object({
        projects: Joi.array().items(Joi.string()).optional(),
        statuses: Joi.array().items(Joi.string()).optional(),
        priorities: Joi.array().items(Joi.string()).optional(),
        assignees: Joi.array().items(Joi.string()).optional(),
        tags: Joi.array().items(Joi.string()).optional(),
        custom: Joi.object().optional()
      }).optional(),
      active: Joi.boolean().default(true),
      retryConfig: Joi.object({
        maxAttempts: Joi.number().integer().min(1).max(10).default(3),
        backoffMultiplier: Joi.number().min(1).max(10).default(2),
        initialDelay: Joi.number().integer().min(100).default(1000)
      }).optional(),
      timeout: Joi.number().integer().min(1000).max(120000).default(30000),
      headers: Joi.object().pattern(Joi.string(), Joi.string()).optional(),
      metadata: Joi.object().optional(),
      createdBy: Joi.string().optional(),
      deliveryStats: Joi.object({
        totalDeliveries: Joi.number().integer().min(0).default(0),
        successfulDeliveries: Joi.number().integer().min(0).default(0),
        failedDeliveries: Joi.number().integer().min(0).default(0),
        lastSuccessAt: Joi.date().optional(),
        lastFailureAt: Joi.date().optional()
      }).optional()
    });
  }

  // Validation method
  validate () {
    const { error, value } = Webhook.schema.validate(this.toObject());
    if (error) {
      throw new Error(`Webhook validation failed: ${error.details[0].message}`);
    }
    return value;
  }

  // Convert to plain object for MongoDB
  toObject () {
    return {
      id: this.id,
      name: this.name,
      url: this.url,
      secret: this.secret,
      events: this.events,
      filters: this.filters,
      active: this.active,
      retryConfig: this.retryConfig,
      timeout: this.timeout,
      headers: this.headers,
      metadata: this.metadata,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
      createdBy: this.createdBy,
      lastDelivery: this.lastDelivery,
      deliveryStats: this.deliveryStats
    };
  }

  // Convert to API response format
  toResponse () {
    return {
      id: this.id,
      name: this.name,
      url: this.url,
      events: this.events,
      filters: this.filters,
      active: this.active,
      retryConfig: this.retryConfig,
      timeout: this.timeout,
      headers: this.headers,
      metadata: this.metadata,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
      createdBy: this.createdBy,
      lastDelivery: this.lastDelivery,
      deliveryStats: this.deliveryStats
    };
  }

  // Factory method from MongoDB document
  static fromDocument (doc) {
    return new Webhook(doc);
  }

  // Update delivery statistics
  updateDeliveryStats (success, timestamp = new Date()) {
    this.deliveryStats.totalDeliveries++;
    if (success) {
      this.deliveryStats.successfulDeliveries++;
      this.deliveryStats.lastSuccessAt = timestamp;
    } else {
      this.deliveryStats.failedDeliveries++;
      this.deliveryStats.lastFailureAt = timestamp;
    }
    this.lastDelivery = timestamp;
    this.updatedAt = timestamp;
  }

  // Check if webhook matches event filters
  matchesFilters (eventData) {
    const { filters } = this;

    // No filters means match all
    if (!filters || Object.keys(filters).length === 0) {
      return true;
    }

    // Check project filter
    if (filters.projects && filters.projects.length > 0) {
      const projectId = eventData.project?.id || eventData.projectId;
      if (!projectId || !filters.projects.includes(projectId)) {
        return false;
      }
    }

    // Check status filter
    if (filters.statuses && filters.statuses.length > 0) {
      const status = eventData.status || eventData.data?.status;
      if (!status || !filters.statuses.includes(status)) {
        return false;
      }
    }

    // Check priority filter
    if (filters.priorities && filters.priorities.length > 0) {
      const priority = eventData.priority || eventData.data?.priority;
      if (!priority || !filters.priorities.includes(priority)) {
        return false;
      }
    }

    // Check assignee filter
    if (filters.assignees && filters.assignees.length > 0) {
      const assignee = eventData.assignee || eventData.data?.assignee;
      if (!assignee || !filters.assignees.includes(assignee)) {
        return false;
      }
    }

    // Check tags filter
    if (filters.tags && filters.tags.length > 0) {
      const tags = eventData.tags || eventData.data?.tags || [];
      if (!tags.some(tag => filters.tags.includes(tag))) {
        return false;
      }
    }

    // Custom filters can be implemented here
    if (filters.custom) {
      // Implement custom filter logic as needed
    }

    return true;
  }

  // Check if webhook should process this event type
  shouldProcessEvent (eventType) {
    return this.active && this.events.includes(eventType);
  }
}

module.exports = Webhook;
