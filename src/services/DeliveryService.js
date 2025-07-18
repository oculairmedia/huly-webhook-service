/**
 * Delivery service for Huly Webhook Service
 * Handles webhook delivery with HTTP client, retry logic and error handling
 */

const https = require('https');
const http = require('http');
const crypto = require('crypto');
const { URL } = require('url');
const logger = require('../utils/logger');

class DeliveryService {
  constructor (databaseService, config) {
    this.db = databaseService;
    this.config = config;
    this.stats = {
      pending: 0,
      processing: 0,
      failed: 0,
      succeeded: 0,
      totalDeliveries: 0,
      responseTimes: [],
      errorCounts: {},
      recentErrors: [],
      lastDelivery: null
    };

    // HTTP client configuration
    this.httpTimeout = config.delivery?.timeout || 30000;
    this.userAgent = config.delivery?.userAgent || 'Huly-Webhook-Service/1.0';
    this.maxRedirects = config.delivery?.maxRedirects || 5;
    this.maxPayloadSize = config.delivery?.maxPayloadSize || 1024 * 1024; // 1MB

    // Retry configuration
    this.baseRetryDelay = config.delivery?.baseRetryDelay || 1000;
    this.maxRetryDelay = config.delivery?.maxRetryDelay || 300000; // 5 minutes
    this.retryMultiplier = config.delivery?.retryMultiplier || 2;
    this.maxJitter = config.delivery?.maxJitter || 1000;

    // Keep track of active deliveries
    this.activeDeliveries = new Map();
  }

  /**
   * Deliver webhook with retry logic
   * @param {Object} webhook - Webhook configuration
   * @param {Object} payload - Payload to deliver
   * @param {number} attempt - Current attempt number
   * @returns {Object} - Delivery result
   */
  async deliverWebhook (webhook, payload, attempt = 1) {
    const deliveryId = this.generateDeliveryId();
    const startTime = Date.now();

    try {
      this.stats.processing++;
      this.activeDeliveries.set(deliveryId, {
        webhook,
        payload,
        attempt,
        startTime
      });

      logger.info(`Attempting webhook delivery ${deliveryId}`, {
        webhookId: webhook._id,
        url: webhook.url,
        attempt,
        maxAttempts: webhook.maxRetries || 3
      });

      // Prepare request
      const requestOptions = this.prepareRequest(webhook, payload);
      const requestBody = JSON.stringify(payload);

      // Perform HTTP request
      const result = await this.performHttpRequest(requestOptions, requestBody);

      // Handle response
      const deliveryResult = this.handleDeliveryResult(result, webhook, payload, attempt);

      // Update statistics
      this.updateStats(deliveryResult, Date.now() - startTime);

      // Store delivery attempt
      await this.storeDeliveryAttempt(webhook, payload, deliveryResult, attempt);

      return deliveryResult;
    } catch (error) {
      logger.error(`Webhook delivery ${deliveryId} failed:`, error);

      const deliveryResult = {
        success: false,
        error: error.message,
        statusCode: error.statusCode || 500,
        responseTime: Date.now() - startTime,
        attempt,
        deliveryId
      };

      // Update statistics
      this.updateStats(deliveryResult, Date.now() - startTime);

      // Store delivery attempt
      await this.storeDeliveryAttempt(webhook, payload, deliveryResult, attempt);

      return deliveryResult;
    } finally {
      this.stats.processing--;
      this.activeDeliveries.delete(deliveryId);
    }
  }

  /**
   * Prepare HTTP request options
   * @param {Object} webhook - Webhook configuration
   * @param {Object} payload - Payload to deliver
   * @returns {Object} - Request options
   */
  prepareRequest (webhook, payload) {
    const url = new URL(webhook.url);
    const isHttps = url.protocol === 'https:';

    const headers = {
      'Content-Type': 'application/json',
      'User-Agent': this.userAgent,
      'X-Huly-Webhook-Id': webhook._id,
      'X-Huly-Webhook-Timestamp': Math.floor(Date.now() / 1000).toString(),
      'X-Huly-Webhook-Event': payload.event,
      ...webhook.headers
    };

    // Add HMAC signature if secret is provided
    if (webhook.secret) {
      const signature = this.generateSignature(JSON.stringify(payload), webhook.secret);
      headers['X-Huly-Webhook-Signature'] = signature;
    }

    return {
      hostname: url.hostname,
      port: url.port || (isHttps ? 443 : 80),
      path: url.pathname + url.search,
      method: 'POST',
      headers,
      timeout: this.httpTimeout,
      protocol: url.protocol
    };
  }

  /**
   * Generate HMAC signature for payload
   * @param {string} payload - Payload string
   * @param {string} secret - Webhook secret
   * @returns {string} - HMAC signature
   */
  generateSignature (payload, secret) {
    const hmac = crypto.createHmac('sha256', secret);
    hmac.update(payload);
    return 'sha256=' + hmac.digest('hex');
  }

  /**
   * Perform HTTP request
   * @param {Object} options - Request options
   * @param {string} body - Request body
   * @returns {Promise<Object>} - Response data
   */
  async performHttpRequest (options, body) {
    return new Promise((resolve, reject) => {
      const client = options.protocol === 'https:' ? https : http;

      const req = client.request(options, (res) => {
        let responseData = '';
        let responseSize = 0;

        res.on('data', (chunk) => {
          responseSize += chunk.length;

          // Check response size limit
          if (responseSize > this.maxPayloadSize) {
            req.destroy();
            reject(new Error('Response size exceeds limit'));
            return;
          }

          responseData += chunk;
        });

        res.on('end', () => {
          resolve({
            statusCode: res.statusCode,
            headers: res.headers,
            body: responseData,
            size: responseSize
          });
        });

        res.on('error', (error) => {
          reject(error);
        });
      });

      req.on('error', (error) => {
        reject(error);
      });

      req.on('timeout', () => {
        req.destroy();
        reject(new Error('Request timeout'));
      });

      // Write request body
      if (body) {
        req.write(body);
      }

      req.end();
    });
  }

  /**
   * Handle delivery result
   * @param {Object} result - HTTP response result
   * @param {Object} webhook - Webhook configuration
   * @param {Object} payload - Payload
   * @param {number} attempt - Attempt number
   * @returns {Object} - Delivery result
   */
  handleDeliveryResult (result, webhook, payload, attempt) {
    const deliveryId = this.generateDeliveryId();
    const isSuccess = result.statusCode >= 200 && result.statusCode < 300;

    const deliveryResult = {
      success: isSuccess,
      statusCode: result.statusCode,
      responseTime: Date.now() - Date.now(), // Will be updated by caller
      headers: result.headers,
      body: result.body,
      size: result.size,
      attempt,
      deliveryId
    };

    if (!isSuccess) {
      deliveryResult.error = `HTTP ${result.statusCode}: ${this.getStatusMessage(result.statusCode)}`;

      // Determine if this is a retryable error
      deliveryResult.retryable = this.isRetryableError(result.statusCode);
    }

    return deliveryResult;
  }

  /**
   * Check if error is retryable
   * @param {number} statusCode - HTTP status code
   * @returns {boolean} - Whether error is retryable
   */
  isRetryableError (statusCode) {
    // Retryable status codes
    const retryableStatus = [
      408, // Request Timeout
      429, // Too Many Requests
      500, // Internal Server Error
      502, // Bad Gateway
      503, // Service Unavailable
      504, // Gateway Timeout
      507, // Insufficient Storage
      509, // Bandwidth Limit Exceeded
      510 // Not Extended
    ];

    return retryableStatus.includes(statusCode);
  }

  /**
   * Get status message for HTTP status code
   * @param {number} statusCode - HTTP status code
   * @returns {string} - Status message
   */
  getStatusMessage (statusCode) {
    const statusMessages = {
      200: 'OK',
      201: 'Created',
      204: 'No Content',
      400: 'Bad Request',
      401: 'Unauthorized',
      403: 'Forbidden',
      404: 'Not Found',
      405: 'Method Not Allowed',
      408: 'Request Timeout',
      409: 'Conflict',
      410: 'Gone',
      422: 'Unprocessable Entity',
      429: 'Too Many Requests',
      500: 'Internal Server Error',
      502: 'Bad Gateway',
      503: 'Service Unavailable',
      504: 'Gateway Timeout'
    };

    return statusMessages[statusCode] || 'Unknown Status';
  }

  /**
   * Calculate retry delay with exponential backoff
   * @param {number} attempt - Attempt number
   * @returns {number} - Delay in milliseconds
   */
  calculateRetryDelay (attempt) {
    const exponentialDelay = this.baseRetryDelay * Math.pow(this.retryMultiplier, attempt - 1);
    const jitter = Math.random() * this.maxJitter;
    return Math.min(exponentialDelay + jitter, this.maxRetryDelay);
  }

  /**
   * Update delivery statistics
   * @param {Object} result - Delivery result
   * @param {number} responseTime - Response time in milliseconds
   */
  updateStats (result, responseTime) {
    this.stats.totalDeliveries++;
    this.stats.lastDelivery = new Date();

    // Update response times
    this.stats.responseTimes.push(responseTime);
    if (this.stats.responseTimes.length > 1000) {
      this.stats.responseTimes.shift();
    }

    if (result.success) {
      this.stats.succeeded++;
    } else {
      this.stats.failed++;

      // Track error counts
      const errorType = result.statusCode ? `HTTP_${result.statusCode}` : 'UNKNOWN';
      this.stats.errorCounts[errorType] = (this.stats.errorCounts[errorType] || 0) + 1;

      // Track recent errors
      this.stats.recentErrors.push({
        timestamp: new Date(),
        error: result.error,
        statusCode: result.statusCode,
        attempt: result.attempt
      });

      // Keep only last 100 errors
      if (this.stats.recentErrors.length > 100) {
        this.stats.recentErrors.shift();
      }
    }
  }

  /**
   * Store delivery attempt in database
   * @param {Object} webhook - Webhook configuration
   * @param {Object} payload - Payload
   * @param {Object} result - Delivery result
   * @param {number} attempt - Attempt number
   */
  async storeDeliveryAttempt (webhook, payload, result, attempt) {
    try {
      const deliveryRecord = {
        webhookId: webhook._id,
        eventType: payload.event,
        url: webhook.url,
        payload,
        result,
        attempt,
        timestamp: new Date(),
        statusCode: result.statusCode,
        success: result.success,
        responseTime: result.responseTime
      };

      await this.db.create('webhook_deliveries', deliveryRecord);
    } catch (error) {
      logger.error('Error storing delivery attempt:', error);
    }
  }

  /**
   * Generate unique delivery ID
   * @returns {string} - Unique delivery ID
   */
  generateDeliveryId () {
    return `delivery_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  }

  /**
   * Test webhook endpoint
   * @param {Object} webhook - Webhook configuration
   * @param {string} eventType - Event type to test
   * @param {Object} testData - Test data
   * @returns {Object} - Test result
   */
  async testWebhook (webhook, eventType, testData) {
    const testPayload = {
      id: `test_${Date.now()}`,
      event: eventType,
      timestamp: new Date().toISOString(),
      version: '1.0',
      source: {
        service: 'huly-webhook-service',
        test: true
      },
      data: testData || {
        id: 'test-id',
        type: 'test',
        operation: 'test'
      }
    };

    logger.info('Testing webhook', {
      webhookId: webhook._id,
      eventType,
      url: webhook.url
    });

    const result = await this.deliverWebhook(webhook, testPayload, 1);

    return {
      success: result.success,
      statusCode: result.statusCode,
      responseTime: result.responseTime,
      message: result.success ? 'Test successful' : `Test failed: ${result.error}`,
      details: result
    };
  }

  /**
   * Get delivery statistics
   * @returns {Object} - Current statistics
   */
  async getStats () {
    return {
      pending: this.stats.pending,
      processing: this.stats.processing,
      failed: this.stats.failed,
      succeeded: this.stats.succeeded
    };
  }

  /**
   * Get detailed delivery statistics
   * @param {Object} query - Query parameters
   * @returns {Object} - Detailed statistics
   */
  async getDetailedStats (query) {
    const responseTimes = this.stats.responseTimes;
    const averageResponseTime = responseTimes.length > 0
      ? responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length
      : 0;

    const totalDeliveries = this.stats.totalDeliveries;
    const successRate = totalDeliveries > 0 ? this.stats.succeeded / totalDeliveries : 0;
    const failureRate = totalDeliveries > 0 ? this.stats.failed / totalDeliveries : 0;

    return {
      totalDeliveries,
      successRate,
      failureRate,
      averageResponseTime
    };
  }

  /**
   * Get performance statistics
   * @param {string} period - Time period
   * @returns {Object} - Performance statistics
   */
  async getPerformanceStats (period) {
    const now = Date.now();
    const periodMs = this.parsePeriod(period);
    const cutoff = now - periodMs;

    // This is a simplified implementation
    // In production, you'd want to track time-series data
    const recentErrors = this.stats.recentErrors.filter(e => e.timestamp.getTime() > cutoff);
    const errorRate = recentErrors.length / Math.max(this.stats.totalDeliveries, 1);

    return {
      deliveriesPerSecond: this.stats.totalDeliveries / (periodMs / 1000),
      averageLatency: this.stats.responseTimes.length > 0
        ? this.stats.responseTimes.reduce((a, b) => a + b, 0) / this.stats.responseTimes.length
        : 0,
      errorRate
    };
  }

  /**
   * Get health statistics
   * @returns {Object} - Health statistics
   */
  async getHealthStats () {
    const totalDeliveries = this.stats.totalDeliveries;
    const failureRate = totalDeliveries > 0 ? this.stats.failed / totalDeliveries : 0;
    const healthy = failureRate < 0.1; // Consider healthy if failure rate < 10%

    return {
      healthy,
      queueDepth: this.stats.pending,
      failureRate,
      lastDelivery: this.stats.lastDelivery
    };
  }

  /**
   * Get error statistics
   * @param {Object} query - Query parameters
   * @returns {Object} - Error statistics
   */
  async getErrorStats (query) {
    const totalDeliveries = this.stats.totalDeliveries;
    const errorRate = totalDeliveries > 0 ? this.stats.failed / totalDeliveries : 0;

    return {
      recentErrors: this.stats.recentErrors.slice(-50), // Last 50 errors
      errorsByType: { ...this.stats.errorCounts },
      errorRate
    };
  }

  /**
   * Get webhook deliveries
   * @param {string} webhookId - Webhook ID
   * @param {Object} query - Query parameters
   * @returns {Array} - Delivery records
   */
  async getWebhookDeliveries (webhookId, query) {
    try {
      const filter = { webhookId };

      if (query.eventType) {
        filter.eventType = query.eventType;
      }

      if (query.success !== undefined) {
        filter.success = query.success;
      }

      const deliveries = await this.db.findMany('webhook_deliveries', filter, {
        limit: query.limit || 100,
        skip: query.skip || 0,
        sort: { timestamp: -1 }
      });

      return deliveries;
    } catch (error) {
      logger.error('Error getting webhook deliveries:', error);
      return [];
    }
  }

  /**
   * Replay delivery
   * @param {string} deliveryId - Delivery ID
   * @returns {Object} - Replay result
   */
  async replayDelivery (deliveryId) {
    try {
      const delivery = await this.db.findOne('webhook_deliveries', { 'result.deliveryId': deliveryId });
      if (!delivery) {
        throw new Error('Delivery not found');
      }

      const webhook = await this.db.findOne('webhooks', { _id: delivery.webhookId });
      if (!webhook) {
        throw new Error('Webhook not found');
      }

      logger.info('Replaying delivery', { deliveryId, webhookId: webhook._id });

      const result = await this.deliverWebhook(webhook, delivery.payload, 1);

      return {
        success: result.success,
        message: result.success ? 'Delivery replayed successfully' : `Replay failed: ${result.error}`,
        result
      };
    } catch (error) {
      logger.error('Error replaying delivery:', error);
      return {
        success: false,
        message: `Replay failed: ${error.message}`
      };
    }
  }

  /**
   * Parse period string to milliseconds
   * @param {string} period - Period string (e.g., '1h', '30m', '1d')
   * @returns {number} - Period in milliseconds
   */
  parsePeriod (period) {
    const match = period.match(/^(\d+)([smhd])$/);
    if (!match) return 3600000; // Default to 1 hour

    const value = parseInt(match[1]);
    const unit = match[2];

    switch (unit) {
    case 's': return value * 1000;
    case 'm': return value * 60 * 1000;
    case 'h': return value * 60 * 60 * 1000;
    case 'd': return value * 24 * 60 * 60 * 1000;
    default: return 3600000;
    }
  }
}

module.exports = DeliveryService;
