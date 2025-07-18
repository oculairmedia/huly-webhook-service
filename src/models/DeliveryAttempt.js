/**
 * DeliveryAttempt model for MongoDB operations
 * Tracks webhook delivery attempts and their results
 */

const Joi = require('joi');
const { v4: uuidv4 } = require('uuid');

class DeliveryAttempt {
  constructor (data = {}) {
    this.id = data.id || uuidv4();
    this.webhookId = data.webhookId || '';
    this.eventId = data.eventId || '';
    this.attemptNumber = data.attemptNumber || 1;
    this.status = data.status || 'pending'; // pending, success, failed, retry
    this.httpStatus = data.httpStatus || null;
    this.responseBody = data.responseBody || null;
    this.responseHeaders = data.responseHeaders || {};
    this.errorMessage = data.errorMessage || null;
    this.duration = data.duration || null;
    this.timestamp = data.timestamp || new Date();
    this.nextRetryAt = data.nextRetryAt || null;
    this.finalAttempt = data.finalAttempt || false;
    this.deliveryId = data.deliveryId || null;
    this.metadata = data.metadata || {};
  }

  // Validation schema
  static get schema () {
    return Joi.object({
      id: Joi.string().uuid().optional(),
      webhookId: Joi.string().required(),
      eventId: Joi.string().required(),
      attemptNumber: Joi.number().integer().min(1).required(),
      status: Joi.string().valid('pending', 'success', 'failed', 'retry').default('pending'),
      httpStatus: Joi.number().integer().min(100).max(599).optional(),
      responseBody: Joi.string().max(10000).optional(),
      responseHeaders: Joi.object().optional(),
      errorMessage: Joi.string().max(1000).optional(),
      duration: Joi.number().integer().min(0).optional(),
      timestamp: Joi.date().default(() => new Date()),
      nextRetryAt: Joi.date().optional(),
      finalAttempt: Joi.boolean().default(false),
      deliveryId: Joi.string().optional(),
      metadata: Joi.object().optional()
    });
  }

  // Validation method
  validate () {
    const { error, value } = DeliveryAttempt.schema.validate(this.toObject());
    if (error) {
      throw new Error(`DeliveryAttempt validation failed: ${error.details[0].message}`);
    }
    return value;
  }

  // Convert to plain object for MongoDB
  toObject () {
    return {
      id: this.id,
      webhookId: this.webhookId,
      eventId: this.eventId,
      attemptNumber: this.attemptNumber,
      status: this.status,
      httpStatus: this.httpStatus,
      responseBody: this.responseBody,
      responseHeaders: this.responseHeaders,
      errorMessage: this.errorMessage,
      duration: this.duration,
      timestamp: this.timestamp,
      nextRetryAt: this.nextRetryAt,
      finalAttempt: this.finalAttempt,
      deliveryId: this.deliveryId,
      metadata: this.metadata
    };
  }

  // Convert to API response format
  toResponse () {
    return {
      id: this.id,
      webhookId: this.webhookId,
      eventId: this.eventId,
      attemptNumber: this.attemptNumber,
      status: this.status,
      httpStatus: this.httpStatus,
      responseBody: this.responseBody?.substring(0, 1000), // Truncate for API response
      errorMessage: this.errorMessage,
      duration: this.duration,
      timestamp: this.timestamp,
      nextRetryAt: this.nextRetryAt,
      finalAttempt: this.finalAttempt,
      deliveryId: this.deliveryId
    };
  }

  // Factory method from MongoDB document
  static fromDocument (doc) {
    return new DeliveryAttempt(doc);
  }

  // Factory method for creating new attempt
  static createAttempt (webhookId, eventId, attemptNumber = 1, deliveryId = null) {
    return new DeliveryAttempt({
      webhookId,
      eventId,
      attemptNumber,
      deliveryId: deliveryId || uuidv4(),
      status: 'pending',
      timestamp: new Date()
    });
  }

  // Mark as successful
  markAsSuccess (httpStatus, responseBody = null, responseHeaders = {}, duration = null) {
    this.status = 'success';
    this.httpStatus = httpStatus;
    this.responseBody = responseBody;
    this.responseHeaders = responseHeaders;
    this.duration = duration;
    this.errorMessage = null;
    this.finalAttempt = true;
  }

  // Mark as failed
  markAsFailed (errorMessage, httpStatus = null, responseBody = null, responseHeaders = {}, duration = null) {
    this.status = 'failed';
    this.httpStatus = httpStatus;
    this.responseBody = responseBody;
    this.responseHeaders = responseHeaders;
    this.errorMessage = errorMessage;
    this.duration = duration;
  }

  // Mark for retry
  markForRetry (nextRetryAt, errorMessage = null, httpStatus = null, responseBody = null, duration = null) {
    this.status = 'retry';
    this.nextRetryAt = nextRetryAt;
    this.errorMessage = errorMessage;
    this.httpStatus = httpStatus;
    this.responseBody = responseBody;
    this.duration = duration;
    this.finalAttempt = false;
  }

  // Mark as final attempt
  markAsFinal () {
    this.finalAttempt = true;
    if (this.status === 'retry') {
      this.status = 'failed';
    }
  }

  // Check if attempt was successful
  isSuccessful () {
    return this.status === 'success';
  }

  // Check if attempt failed
  isFailed () {
    return this.status === 'failed';
  }

  // Check if attempt should be retried
  shouldRetry () {
    return this.status === 'retry' && !this.finalAttempt;
  }

  // Check if retry is due
  isRetryDue () {
    if (!this.shouldRetry() || !this.nextRetryAt) {
      return false;
    }
    return new Date() >= this.nextRetryAt;
  }

  // Get HTTP status category
  getHttpStatusCategory () {
    if (!this.httpStatus) return 'unknown';

    if (this.httpStatus >= 200 && this.httpStatus < 300) return 'success';
    if (this.httpStatus >= 300 && this.httpStatus < 400) return 'redirect';
    if (this.httpStatus >= 400 && this.httpStatus < 500) return 'client_error';
    if (this.httpStatus >= 500) return 'server_error';

    return 'unknown';
  }

  // Check if error is retryable based on HTTP status
  isRetryableError () {
    if (!this.httpStatus) return true; // Network errors are retryable

    // 4xx errors (except 408, 429) are generally not retryable
    if (this.httpStatus >= 400 && this.httpStatus < 500) {
      return [408, 429].includes(this.httpStatus);
    }

    // 5xx errors are retryable
    return this.httpStatus >= 500;
  }

  // Get attempt duration in milliseconds
  getDuration () {
    return this.duration || 0;
  }

  // Get formatted duration
  getFormattedDuration () {
    const duration = this.getDuration();
    if (duration < 1000) {
      return `${duration}ms`;
    }
    return `${(duration / 1000).toFixed(2)}s`;
  }

  // Get error summary
  getErrorSummary () {
    if (this.isSuccessful()) {
      return null;
    }

    let summary = '';

    if (this.httpStatus) {
      summary += `HTTP ${this.httpStatus}`;
    }

    if (this.errorMessage) {
      summary += summary ? `: ${this.errorMessage}` : this.errorMessage;
    }

    return summary || 'Unknown error';
  }

  // Add metadata
  addMetadata (key, value) {
    this.metadata[key] = value;
  }

  // Get metadata
  getMetadata (key) {
    return this.metadata[key];
  }

  // Static method to calculate next retry time
  static calculateNextRetryTime (attemptNumber, baseDelay = 1000, multiplier = 2, maxDelay = 300000) {
    const delay = Math.min(baseDelay * Math.pow(multiplier, attemptNumber - 1), maxDelay);
    return new Date(Date.now() + delay);
  }

  // Static method to determine if HTTP status is success
  static isHttpSuccess (status) {
    return status >= 200 && status < 300;
  }

  // Static method to determine if HTTP status is retryable
  static isHttpRetryable (status) {
    if (!status) return true; // Network errors
    if (status >= 400 && status < 500) return [408, 429].includes(status);
    return status >= 500;
  }
}

module.exports = DeliveryAttempt;
