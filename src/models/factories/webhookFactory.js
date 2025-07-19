/**
 * Factory functions for creating Webhook instances
 * This improves testability by providing controlled creation of webhook objects
 */

const Webhook = require('../Webhook');
const { v4: uuidv4 } = require('uuid');

/**
 * Default values for webhook creation
 */
const defaults = {
  events: ['issue.created', 'issue.updated'],
  retryConfig: {
    maxAttempts: 3,
    backoffMultiplier: 2,
    initialDelay: 1000
  },
  timeout: 30000,
  deliveryStats: {
    totalDeliveries: 0,
    successfulDeliveries: 0,
    failedDeliveries: 0,
    lastSuccessAt: null,
    lastFailureAt: null
  }
};

/**
 * Create a webhook with default values
 * @param {Object} overrides - Values to override defaults
 * @returns {Webhook} - New webhook instance
 */
function createWebhook (overrides = {}) {
  const data = {
    id: uuidv4(),
    name: 'Test Webhook',
    url: 'https://example.com/webhook',
    secret: 'test-secret-key',
    events: defaults.events,
    filters: {},
    active: true,
    retryConfig: { ...defaults.retryConfig },
    timeout: defaults.timeout,
    headers: {},
    metadata: {},
    createdAt: new Date(),
    updatedAt: new Date(),
    createdBy: 'test-user',
    lastDelivery: null,
    deliveryStats: { ...defaults.deliveryStats },
    ...overrides
  };

  return new Webhook(data);
}

/**
 * Create a webhook with minimal required fields
 * @param {Object} overrides - Values to override minimal defaults
 * @returns {Webhook} - New webhook instance
 */
function createMinimalWebhook (overrides = {}) {
  const data = {
    name: 'Minimal Webhook',
    url: 'https://example.com/minimal',
    events: ['issue.created'],
    ...overrides
  };

  return new Webhook(data);
}

/**
 * Create an inactive webhook
 * @param {Object} overrides - Values to override
 * @returns {Webhook} - New inactive webhook instance
 */
function createInactiveWebhook (overrides = {}) {
  return createWebhook({
    active: false,
    name: 'Inactive Webhook',
    ...overrides
  });
}

/**
 * Create a webhook with filters
 * @param {Object} filters - Filter configuration
 * @param {Object} overrides - Other values to override
 * @returns {Webhook} - New webhook instance with filters
 */
function createFilteredWebhook (filters, overrides = {}) {
  return createWebhook({
    name: 'Filtered Webhook',
    filters,
    ...overrides
  });
}

/**
 * Create a webhook with custom headers
 * @param {Object} headers - Custom headers
 * @param {Object} overrides - Other values to override
 * @returns {Webhook} - New webhook instance with headers
 */
function createWebhookWithHeaders (headers, overrides = {}) {
  return createWebhook({
    name: 'Webhook with Headers',
    headers,
    ...overrides
  });
}

/**
 * Create a webhook with failed delivery stats
 * @param {number} failedCount - Number of failed deliveries
 * @param {Object} overrides - Other values to override
 * @returns {Webhook} - New webhook instance with failures
 */
function createWebhookWithFailures (failedCount = 5, overrides = {}) {
  const now = new Date();
  return createWebhook({
    name: 'Webhook with Failures',
    deliveryStats: {
      totalDeliveries: failedCount + 2,
      successfulDeliveries: 2,
      failedDeliveries: failedCount,
      lastSuccessAt: new Date(now - 3600000), // 1 hour ago
      lastFailureAt: now
    },
    lastDelivery: now,
    ...overrides
  });
}

/**
 * Create multiple webhooks
 * @param {number} count - Number of webhooks to create
 * @param {Function} customizer - Function to customize each webhook
 * @returns {Array<Webhook>} - Array of webhook instances
 */
function createMultipleWebhooks (count = 3, customizer = null) {
  const webhooks = [];

  for (let i = 0; i < count; i++) {
    const data = {
      name: `Webhook ${i + 1}`,
      url: `https://example.com/webhook${i + 1}`
    };

    if (customizer) {
      Object.assign(data, customizer(i));
    }

    webhooks.push(createWebhook(data));
  }

  return webhooks;
}

/**
 * Create a webhook from a plain object (e.g., from database)
 * @param {Object} document - Database document
 * @returns {Webhook} - New webhook instance
 */
function createWebhookFromDocument (document) {
  return Webhook.fromDocument(document);
}

module.exports = {
  createWebhook,
  createMinimalWebhook,
  createInactiveWebhook,
  createFilteredWebhook,
  createWebhookWithHeaders,
  createWebhookWithFailures,
  createMultipleWebhooks,
  createWebhookFromDocument,
  defaults
};
