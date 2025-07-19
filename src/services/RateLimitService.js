/**
 * Rate Limit Service for Huly Webhook Service
 * Implements rate limiting per webhook with multiple algorithms
 */

const logger = require('../utils/logger');

class RateLimitService {
  constructor (config) {
    this.config = config;
    this.limiters = new Map();
    this.globalLimiter = null;
    this.rateLimitStats = {
      totalRequests: 0,
      allowedRequests: 0,
      blockedRequests: 0,
      limitsByWebhook: {},
      limitsByType: {}
    };

    // Configuration
    this.defaultLimits = {
      windowMs: config.rateLimit?.windowMs || 60000, // 1 minute
      maxRequests: config.rateLimit?.maxRequests || 100,
      algorithm: config.rateLimit?.algorithm || 'sliding_window', // sliding_window, fixed_window, token_bucket
      burstLimit: config.rateLimit?.burstLimit || 20,
      refillRate: config.rateLimit?.refillRate || 10, // tokens per second for token bucket
      skipSuccessful: config.rateLimit?.skipSuccessful || false,
      skipFailedRequests: config.rateLimit?.skipFailedRequests || false
    };

    // Global rate limiting
    this.globalLimits = {
      windowMs: config.rateLimit?.global?.windowMs || 60000,
      maxRequests: config.rateLimit?.global?.maxRequests || 10000,
      enabled: config.rateLimit?.global?.enabled || true
    };

    this.initialize();
  }

  /**
   * Initialize rate limiting service
   */
  initialize () {
    logger.info('Initializing Rate Limit Service...');

    // Initialize global limiter
    if (this.globalLimits.enabled) {
      this.globalLimiter = this.createLimiter('global', this.globalLimits);
    }

    // Start cleanup interval
    this.startCleanupInterval();

    logger.info('Rate Limit Service initialized successfully');
  }

  /**
   * Check if request is allowed for webhook
   * @param {string} webhookId - Webhook ID
   * @param {Object} webhook - Webhook configuration
   * @param {Object} request - Request details
   * @returns {Object} - Rate limit result
   */
  async checkRateLimit (webhookId, webhook, request = {}) {
    try {
      this.rateLimitStats.totalRequests++;

      // Check global rate limit first
      if (this.globalLimiter) {
        const globalResult = await this.checkLimit(this.globalLimiter, 'global', request);
        if (!globalResult.allowed) {
          this.rateLimitStats.blockedRequests++;
          this.updateWebhookStats(webhookId, 'blocked');
          return {
            allowed: false,
            reason: 'global_rate_limit_exceeded',
            resetTime: globalResult.resetTime,
            remaining: globalResult.remaining,
            limit: globalResult.limit
          };
        }
      }

      // Get or create webhook-specific limiter
      const limiter = this.getOrCreateWebhookLimiter(webhookId, webhook);

      // Check webhook-specific rate limit
      const result = await this.checkLimit(limiter, webhookId, request);

      if (result.allowed) {
        this.rateLimitStats.allowedRequests++;
        this.updateWebhookStats(webhookId, 'allowed');
      } else {
        this.rateLimitStats.blockedRequests++;
        this.updateWebhookStats(webhookId, 'blocked');
      }

      return {
        allowed: result.allowed,
        reason: result.allowed ? 'allowed' : 'rate_limit_exceeded',
        resetTime: result.resetTime,
        remaining: result.remaining,
        limit: result.limit,
        retryAfter: result.retryAfter
      };
    } catch (error) {
      logger.error('Error checking rate limit:', error);
      // On error, allow the request (fail open)
      return {
        allowed: true,
        reason: 'rate_limit_check_failed',
        error: error.message
      };
    }
  }

  /**
   * Get or create webhook-specific limiter
   * @param {string} webhookId - Webhook ID
   * @param {Object} webhook - Webhook configuration
   * @returns {Object} - Rate limiter instance
   */
  getOrCreateWebhookLimiter (webhookId, webhook) {
    let limiter = this.limiters.get(webhookId);

    if (!limiter) {
      // Use webhook-specific limits or defaults
      const limits = {
        windowMs: webhook.rateLimit?.windowMs || this.defaultLimits.windowMs,
        maxRequests: webhook.rateLimit?.maxRequests || this.defaultLimits.maxRequests,
        algorithm: webhook.rateLimit?.algorithm || this.defaultLimits.algorithm,
        burstLimit: webhook.rateLimit?.burstLimit || this.defaultLimits.burstLimit,
        refillRate: webhook.rateLimit?.refillRate || this.defaultLimits.refillRate,
        skipSuccessful: webhook.rateLimit?.skipSuccessful || this.defaultLimits.skipSuccessful,
        skipFailedRequests: webhook.rateLimit?.skipFailedRequests || this.defaultLimits.skipFailedRequests
      };

      limiter = this.createLimiter(webhookId, limits);
      this.limiters.set(webhookId, limiter);

      logger.debug(`Created rate limiter for webhook ${webhookId}`, limits);
    }

    return limiter;
  }

  /**
   * Create rate limiter instance
   * @param {string} id - Limiter ID
   * @param {Object} limits - Rate limit configuration
   * @returns {Object} - Rate limiter instance
   */
  createLimiter (id, limits) {
    const limiter = {
      id,
      limits,
      requests: [],
      tokens: limits.maxRequests || 0,
      lastRefill: Date.now(),
      createdAt: Date.now()
    };

    // Initialize token bucket if using that algorithm
    if (limits.algorithm === 'token_bucket') {
      limiter.tokens = limits.burstLimit || limits.maxRequests || 0;
    }

    return limiter;
  }

  /**
   * Check rate limit for a specific limiter
   * @param {Object} limiter - Rate limiter instance
   * @param {string} limiterId - Limiter ID
   * @param {Object} request - Request details
   * @returns {Object} - Rate limit check result
   */
  async checkLimit (limiter, limiterId, request) {
    const now = Date.now();

    switch (limiter.limits.algorithm) {
    case 'sliding_window':
      return this.checkSlidingWindow(limiter, now, request);
    case 'fixed_window':
      return this.checkFixedWindow(limiter, now, request);
    case 'token_bucket':
      return this.checkTokenBucket(limiter, now, request);
    default:
      return this.checkSlidingWindow(limiter, now, request);
    }
  }

  /**
   * Check sliding window rate limit
   * @param {Object} limiter - Rate limiter instance
   * @param {number} now - Current timestamp
   * @param {Object} request - Request details
   * @returns {Object} - Rate limit result
   */
  checkSlidingWindow (limiter, now, _request) {
    const windowMs = limiter.limits.windowMs;
    const maxRequests = limiter.limits.maxRequests;

    // Clean old requests outside the window
    limiter.requests = limiter.requests.filter(req => now - req.timestamp < windowMs);

    // Check if we're under the limit
    if (limiter.requests.length < maxRequests) {
      // Allow request
      limiter.requests.push({
        timestamp: now,
        success: true, // Default to success
        statusCode: 200 // Default status code
      });

      return {
        allowed: true,
        remaining: maxRequests - limiter.requests.length,
        limit: maxRequests,
        resetTime: now + windowMs,
        retryAfter: 0
      };
    } else {
      // Reject request
      const oldestRequest = limiter.requests[0];
      const retryAfter = Math.ceil((oldestRequest.timestamp + windowMs - now) / 1000);

      return {
        allowed: false,
        remaining: 0,
        limit: maxRequests,
        resetTime: oldestRequest.timestamp + windowMs,
        retryAfter: Math.max(retryAfter, 1)
      };
    }
  }

  /**
   * Check fixed window rate limit
   * @param {Object} limiter - Rate limiter instance
   * @param {number} now - Current timestamp
   * @param {Object} request - Request details
   * @returns {Object} - Rate limit result
   */
  checkFixedWindow (limiter, now, _request) {
    const windowMs = limiter.limits.windowMs;
    const maxRequests = limiter.limits.maxRequests;

    // Calculate current window
    const currentWindow = Math.floor(now / windowMs);

    // Reset if we're in a new window
    if (!limiter.currentWindow || limiter.currentWindow !== currentWindow) {
      limiter.currentWindow = currentWindow;
      limiter.windowRequests = 0;
    }

    // Check if we're under the limit
    if (limiter.windowRequests < maxRequests) {
      // Allow request
      limiter.windowRequests++;

      return {
        allowed: true,
        remaining: maxRequests - limiter.windowRequests,
        limit: maxRequests,
        resetTime: (currentWindow + 1) * windowMs,
        retryAfter: 0
      };
    } else {
      // Reject request
      const resetTime = (currentWindow + 1) * windowMs;
      const retryAfter = Math.ceil((resetTime - now) / 1000);

      return {
        allowed: false,
        remaining: 0,
        limit: maxRequests,
        resetTime,
        retryAfter: Math.max(retryAfter, 1)
      };
    }
  }

  /**
   * Check token bucket rate limit
   * @param {Object} limiter - Rate limiter instance
   * @param {number} now - Current timestamp
   * @param {Object} request - Request details
   * @returns {Object} - Rate limit result
   */
  checkTokenBucket (limiter, now, _request) {
    const refillRate = limiter.limits.refillRate;
    const burstLimit = limiter.limits.burstLimit;

    // Calculate tokens to add based on time elapsed
    const timeElapsed = (now - limiter.lastRefill) / 1000;
    const tokensToAdd = Math.floor(timeElapsed * refillRate);

    if (tokensToAdd > 0) {
      limiter.tokens = Math.min(burstLimit, limiter.tokens + tokensToAdd);
      limiter.lastRefill = now;
    }

    // Check if we have tokens available
    if (limiter.tokens >= 1) {
      // Allow request
      limiter.tokens--;

      return {
        allowed: true,
        remaining: limiter.tokens,
        limit: burstLimit,
        resetTime: now + (burstLimit - limiter.tokens) / refillRate * 1000,
        retryAfter: 0
      };
    } else {
      // Reject request
      const retryAfter = Math.ceil((1 - limiter.tokens) / refillRate);

      return {
        allowed: false,
        remaining: 0,
        limit: burstLimit,
        resetTime: now + retryAfter * 1000,
        retryAfter
      };
    }
  }

  /**
   * Update webhook statistics
   * @param {string} webhookId - Webhook ID
   * @param {string} type - Request type (allowed/blocked)
   */
  updateWebhookStats (webhookId, type) {
    if (!this.rateLimitStats.limitsByWebhook[webhookId]) {
      this.rateLimitStats.limitsByWebhook[webhookId] = {
        allowed: 0,
        blocked: 0,
        total: 0
      };
    }

    this.rateLimitStats.limitsByWebhook[webhookId][type]++;
    this.rateLimitStats.limitsByWebhook[webhookId].total++;
  }

  /**
   * Get rate limit status for webhook
   * @param {string} webhookId - Webhook ID
   * @returns {Object} - Rate limit status
   */
  getRateLimitStatus (webhookId) {
    const limiter = this.limiters.get(webhookId);
    const stats = this.rateLimitStats.limitsByWebhook[webhookId];

    if (!limiter) {
      return {
        exists: false,
        webhookId
      };
    }

    const now = Date.now();
    let remaining = 0;
    let resetTime = 0;
    let limit = limiter.limits.maxRequests;

    switch (limiter.limits.algorithm) {
    case 'sliding_window':
      // Clean old requests
      limiter.requests = limiter.requests.filter(req => now - req.timestamp < limiter.limits.windowMs);
      remaining = Math.max(0, limiter.limits.maxRequests - limiter.requests.length);
      resetTime = limiter.requests.length > 0 ? limiter.requests[0].timestamp + limiter.limits.windowMs : now;
      break;
    case 'fixed_window':
      remaining = Math.max(0, limiter.limits.maxRequests - (limiter.windowRequests || 0));
      resetTime = limiter.currentWindow ? (limiter.currentWindow + 1) * limiter.limits.windowMs : now;
      break;
    case 'token_bucket': {
      // Update tokens
      const timeElapsed = (now - limiter.lastRefill) / 1000;
      const tokensToAdd = Math.floor(timeElapsed * limiter.limits.refillRate);
      limiter.tokens = Math.min(limiter.limits.burstLimit, limiter.tokens + tokensToAdd);
      remaining = Math.floor(limiter.tokens);
      limit = limiter.limits.burstLimit;
      resetTime = now + (limiter.limits.burstLimit - limiter.tokens) / limiter.limits.refillRate * 1000;
      break;
    }
    }

    return {
      exists: true,
      webhookId,
      algorithm: limiter.limits.algorithm,
      remaining,
      limit,
      resetTime,
      windowMs: limiter.limits.windowMs,
      stats: stats || { allowed: 0, blocked: 0, total: 0 },
      createdAt: limiter.createdAt
    };
  }

  /**
   * Get rate limiting statistics
   * @returns {Object} - Rate limiting statistics
   */
  getRateLimitStats () {
    return {
      ...this.rateLimitStats,
      activeLimiters: this.limiters.size,
      globalLimiterEnabled: !!this.globalLimiter,
      allowedRate: this.rateLimitStats.totalRequests > 0
        ? this.rateLimitStats.allowedRequests / this.rateLimitStats.totalRequests
        : 0,
      blockedRate: this.rateLimitStats.totalRequests > 0
        ? this.rateLimitStats.blockedRequests / this.rateLimitStats.totalRequests
        : 0
    };
  }

  /**
   * Clear rate limiter for webhook
   * @param {string} webhookId - Webhook ID
   */
  clearWebhookRateLimit (webhookId) {
    this.limiters.delete(webhookId);
    logger.info(`Cleared rate limiter for webhook: ${webhookId}`);
  }

  /**
   * Update webhook rate limit configuration
   * @param {string} webhookId - Webhook ID
   * @param {Object} newLimits - New rate limit configuration
   */
  updateWebhookRateLimit (webhookId, newLimits) {
    const limiter = this.limiters.get(webhookId);
    if (limiter) {
      limiter.limits = { ...limiter.limits, ...newLimits };

      // Reset token bucket if limits changed
      if (newLimits.burstLimit || newLimits.maxRequests) {
        limiter.tokens = newLimits.burstLimit || newLimits.maxRequests || limiter.tokens;
      }

      logger.info(`Updated rate limiter for webhook ${webhookId}`, newLimits);
    }
  }

  /**
   * Get all active rate limiters
   * @returns {Array} - Active rate limiters
   */
  getActiveLimiters () {
    const limiters = [];

    for (const [webhookId] of this.limiters) {
      const status = this.getRateLimitStatus(webhookId);
      limiters.push(status);
    }

    return limiters;
  }

  /**
   * Reset all rate limiting statistics
   */
  resetStats () {
    this.rateLimitStats = {
      totalRequests: 0,
      allowedRequests: 0,
      blockedRequests: 0,
      limitsByWebhook: {},
      limitsByType: {}
    };
    logger.info('Rate limiting statistics reset');
  }

  /**
   * Start cleanup interval
   */
  startCleanupInterval () {
    // Clean up old limiters every 5 minutes
    setInterval(() => {
      this.cleanupInactiveLimiters();
    }, 5 * 60 * 1000);
  }

  /**
   * Clean up inactive rate limiters
   */
  cleanupInactiveLimiters () {
    const now = Date.now();
    const inactiveThreshold = 24 * 60 * 60 * 1000; // 24 hours

    let cleaned = 0;
    for (const [webhookId, limiter] of this.limiters) {
      // Check if limiter has been inactive
      const lastActivity = this.getLastActivity(limiter);

      if (now - lastActivity > inactiveThreshold) {
        this.limiters.delete(webhookId);
        cleaned++;
      }
    }

    if (cleaned > 0) {
      logger.info(`Cleaned up ${cleaned} inactive rate limiters`);
    }
  }

  /**
   * Get last activity timestamp for limiter
   * @param {Object} limiter - Rate limiter instance
   * @returns {number} - Last activity timestamp
   */
  getLastActivity (limiter) {
    switch (limiter.limits.algorithm) {
    case 'sliding_window':
      return limiter.requests.length > 0
        ? Math.max(...limiter.requests.map(r => r.timestamp))
        : limiter.createdAt;
    case 'fixed_window':
      return limiter.lastRefill || limiter.createdAt;
    case 'token_bucket':
      return limiter.lastRefill || limiter.createdAt;
    default:
      return limiter.createdAt;
    }
  }

  /**
   * Test rate limiting for webhook
   * @param {string} webhookId - Webhook ID
   * @param {Object} webhook - Webhook configuration
   * @param {number} requestCount - Number of requests to simulate
   * @returns {Object} - Test results
   */
  async testRateLimit (webhookId, webhook, requestCount = 10) {
    const results = [];

    for (let i = 0; i < requestCount; i++) {
      const result = await this.checkRateLimit(webhookId, webhook, {
        success: true,
        statusCode: 200
      });

      results.push({
        requestNumber: i + 1,
        allowed: result.allowed,
        remaining: result.remaining,
        reason: result.reason
      });

      // Small delay between requests
      await new Promise(resolve => setTimeout(resolve, 10));
    }

    const status = this.getRateLimitStatus(webhookId);

    return {
      webhookId,
      requestCount,
      results,
      finalStatus: status,
      summary: {
        allowed: results.filter(r => r.allowed).length,
        blocked: results.filter(r => !r.allowed).length,
        successRate: results.filter(r => r.allowed).length / results.length
      }
    };
  }

  /**
   * Shutdown the service
   */
  async shutdown () {
    try {
      logger.info('Shutting down Rate Limit Service...');

      // Clear all limiters
      this.limiters.clear();
      this.globalLimiter = null;

      logger.info('Rate Limit Service shut down successfully');
    } catch (error) {
      logger.error('Error shutting down Rate Limit Service:', error);
      throw error;
    }
  }
}

module.exports = RateLimitService;
