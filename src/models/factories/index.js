/**
 * Main export for all model factory functions
 *
 * This module provides a convenient way to import all factory functions
 * for creating test instances of our models.
 */

const webhookFactory = require('./webhookFactory');
const webhookEventFactory = require('./webhookEventFactory');
const deliveryAttemptFactory = require('./deliveryAttemptFactory');

module.exports = {
  // Webhook factories
  ...webhookFactory,

  // WebhookEvent factories
  ...webhookEventFactory,

  // DeliveryAttempt factories
  ...deliveryAttemptFactory
};
