/**
 * Factory functions for creating DeliveryAttempt instances
 * This improves testability by providing controlled creation of delivery attempt objects
 */

const DeliveryAttempt = require('../DeliveryAttempt');
const { v4: uuidv4 } = require('uuid');

/**
 * Create a delivery attempt with default values
 * @param {Object} overrides - Values to override defaults
 * @returns {DeliveryAttempt} - New delivery attempt instance
 */
function createDeliveryAttempt (overrides = {}) {
  const data = {
    id: uuidv4(),
    webhookId: 'webhook-123',
    eventId: 'event-456',
    attemptNumber: 1,
    status: 'pending',
    httpStatus: null,
    responseBody: null,
    responseHeaders: {},
    errorMessage: null,
    duration: null,
    timestamp: new Date(),
    nextRetryAt: null,
    finalAttempt: false,
    deliveryId: uuidv4(),
    metadata: {},
    ...overrides
  };

  return new DeliveryAttempt(data);
}

/**
 * Create a successful delivery attempt
 * @param {number} httpStatus - HTTP status code (default 200)
 * @param {Object} overrides - Other values to override
 * @returns {DeliveryAttempt} - New successful delivery attempt
 */
function createSuccessfulAttempt (httpStatus = 200, overrides = {}) {
  const attempt = createDeliveryAttempt({
    status: 'success',
    httpStatus,
    responseBody: '{"success": true}',
    responseHeaders: {
      'content-type': 'application/json',
      'x-request-id': uuidv4()
    },
    duration: 250,
    finalAttempt: true,
    ...overrides
  });

  return attempt;
}

/**
 * Create a failed delivery attempt
 * @param {string} errorMessage - Error message
 * @param {number} httpStatus - HTTP status code
 * @param {Object} overrides - Other values to override
 * @returns {DeliveryAttempt} - New failed delivery attempt
 */
function createFailedAttempt (
  errorMessage = 'Connection timeout',
  httpStatus = null,
  overrides = {}
) {
  const attempt = createDeliveryAttempt({
    status: 'failed',
    httpStatus,
    errorMessage,
    duration: httpStatus ? 500 : null,
    ...overrides
  });

  return attempt;
}

/**
 * Create a retry delivery attempt
 * @param {number} attemptNumber - Current attempt number
 * @param {Date} nextRetryAt - Next retry time
 * @param {Object} overrides - Other values to override
 * @returns {DeliveryAttempt} - New retry delivery attempt
 */
function createRetryAttempt (
  attemptNumber = 1,
  nextRetryAt = null,
  overrides = {}
) {
  if (!nextRetryAt) {
    nextRetryAt = DeliveryAttempt.calculateNextRetryTime(attemptNumber);
  }

  const attempt = createDeliveryAttempt({
    attemptNumber,
    status: 'retry',
    nextRetryAt,
    errorMessage: 'Temporary failure, will retry',
    httpStatus: 503,
    duration: 1000,
    ...overrides
  });

  return attempt;
}

/**
 * Create a client error attempt (4xx)
 * @param {number} httpStatus - HTTP status code (default 400)
 * @param {string} errorMessage - Error message
 * @param {Object} overrides - Other values to override
 * @returns {DeliveryAttempt} - New client error attempt
 */
function createClientErrorAttempt (
  httpStatus = 400,
  errorMessage = 'Bad Request',
  overrides = {}
) {
  return createFailedAttempt(errorMessage, httpStatus, {
    responseBody: `{"error": "${errorMessage}"}`,
    responseHeaders: { 'content-type': 'application/json' },
    finalAttempt: true, // Client errors are typically not retried
    ...overrides
  });
}

/**
 * Create a server error attempt (5xx)
 * @param {number} httpStatus - HTTP status code (default 500)
 * @param {string} errorMessage - Error message
 * @param {Object} overrides - Other values to override
 * @returns {DeliveryAttempt} - New server error attempt
 */
function createServerErrorAttempt (
  httpStatus = 500,
  errorMessage = 'Internal Server Error',
  overrides = {}
) {
  return createFailedAttempt(errorMessage, httpStatus, {
    responseBody: 'Internal Server Error',
    responseHeaders: { 'content-type': 'text/plain' },
    ...overrides
  });
}

/**
 * Create a timeout attempt
 * @param {string} errorMessage - Error message
 * @param {Object} overrides - Other values to override
 * @returns {DeliveryAttempt} - New timeout attempt
 */
function createTimeoutAttempt (
  errorMessage = 'Request timeout after 30s',
  overrides = {}
) {
  return createFailedAttempt(errorMessage, null, {
    duration: 30000,
    ...overrides
  });
}

/**
 * Create a rate limited attempt
 * @param {number} retryAfter - Retry after time in seconds
 * @param {Object} overrides - Other values to override
 * @returns {DeliveryAttempt} - New rate limited attempt
 */
function createRateLimitedAttempt (retryAfter = 60, overrides = {}) {
  const nextRetryAt = new Date(Date.now() + (retryAfter * 1000));

  return createRetryAttempt(1, nextRetryAt, {
    httpStatus: 429,
    errorMessage: 'Too Many Requests',
    responseHeaders: {
      'retry-after': retryAfter.toString(),
      'x-ratelimit-limit': '100',
      'x-ratelimit-remaining': '0'
    },
    ...overrides
  });
}

/**
 * Create a network error attempt
 * @param {string} errorCode - Network error code
 * @param {Object} overrides - Other values to override
 * @returns {DeliveryAttempt} - New network error attempt
 */
function createNetworkErrorAttempt (errorCode = 'ECONNREFUSED', overrides = {}) {
  return createFailedAttempt(`Network error: ${errorCode}`, null, {
    metadata: { errorCode },
    ...overrides
  });
}

/**
 * Create multiple delivery attempts for the same webhook/event
 * @param {number} count - Number of attempts to create
 * @param {string} webhookId - Webhook ID
 * @param {string} eventId - Event ID
 * @param {Function} customizer - Function to customize each attempt
 * @returns {Array<DeliveryAttempt>} - Array of delivery attempt instances
 */
function createAttemptSequence (
  count = 3,
  webhookId = 'webhook-123',
  eventId = 'event-456',
  customizer = null
) {
  const attempts = [];
  const deliveryId = uuidv4();

  for (let i = 0; i < count; i++) {
    const attemptNumber = i + 1;
    const isLast = attemptNumber === count;

    let attempt;
    if (customizer) {
      attempt = customizer(attemptNumber, isLast);
    } else {
      // Default sequence: retry until last attempt succeeds
      if (isLast) {
        attempt = createSuccessfulAttempt(200, {
          attemptNumber,
          webhookId,
          eventId,
          deliveryId
        });
      } else {
        const nextRetryAt = DeliveryAttempt.calculateNextRetryTime(attemptNumber);
        attempt = createRetryAttempt(attemptNumber, nextRetryAt, {
          webhookId,
          eventId,
          deliveryId
        });
      }
    }

    attempts.push(attempt);
  }

  return attempts;
}

/**
 * Create a delivery attempt with custom metadata
 * @param {Object} metadata - Metadata to add
 * @param {Object} overrides - Other values to override
 * @returns {DeliveryAttempt} - New delivery attempt with metadata
 */
function createAttemptWithMetadata (metadata, overrides = {}) {
  return createDeliveryAttempt({
    metadata,
    ...overrides
  });
}

/**
 * Create a final failed attempt
 * @param {string} errorMessage - Error message
 * @param {number} attemptNumber - Attempt number
 * @param {Object} overrides - Other values to override
 * @returns {DeliveryAttempt} - New final failed attempt
 */
function createFinalFailedAttempt (
  errorMessage = 'Max retries exceeded',
  attemptNumber = 3,
  overrides = {}
) {
  return createFailedAttempt(errorMessage, null, {
    attemptNumber,
    finalAttempt: true,
    metadata: {
      reason: 'max_retries_exceeded'
    },
    ...overrides
  });
}

module.exports = {
  createDeliveryAttempt,
  createSuccessfulAttempt,
  createFailedAttempt,
  createRetryAttempt,
  createClientErrorAttempt,
  createServerErrorAttempt,
  createTimeoutAttempt,
  createRateLimitedAttempt,
  createNetworkErrorAttempt,
  createAttemptSequence,
  createAttemptWithMetadata,
  createFinalFailedAttempt
};
