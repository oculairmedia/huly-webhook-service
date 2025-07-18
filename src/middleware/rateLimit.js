/**
 * Rate limiting middleware for Huly Webhook Service
 * Prevents abuse and ensures fair usage of the API
 */

const config = require('../config');
const logger = require('../utils/logger');

// In-memory store for rate limiting (consider Redis for production clusters)
class RateLimitStore {
  constructor () {
    this.requests = new Map();
    this.cleanup();
  }

  cleanup () {
    // Clean up expired entries every minute
    setInterval(() => {
      const now = Date.now();
      for (const [key, data] of this.requests.entries()) {
        if (now - data.resetTime > config.rateLimit.windowMs) {
          this.requests.delete(key);
        }
      }
    }, 60000);
  }

  getKey (req) {
    // Use IP address and API key for rate limiting
    const ip = req.ip || req.connection.remoteAddress;
    const apiKey = req.headers['x-api-key'] || 'anonymous';
    return `${ip}:${apiKey.substring(0, 8)}`;
  }

  get (key) {
    return this.requests.get(key);
  }

  set (key, data) {
    this.requests.set(key, data);
  }

  increment (key) {
    const data = this.get(key);
    if (data) {
      data.count++;
      return data;
    }

    const newData = {
      count: 1,
      resetTime: Date.now() + config.rateLimit.windowMs
    };
    this.set(key, newData);
    return newData;
  }

  reset (key) {
    this.requests.delete(key);
  }
}

const store = new RateLimitStore();

/**
 * Rate limiting middleware
 */
const rateLimitMiddleware = (req, res, next) => {
  // Skip rate limiting for health checks
  if (req.path === '/api/health') {
    return next();
  }

  const key = store.getKey(req);
  const data = store.increment(key);

  // Add rate limit headers
  res.setHeader('X-RateLimit-Limit', config.rateLimit.maxRequests);
  res.setHeader('X-RateLimit-Remaining', Math.max(0, config.rateLimit.maxRequests - data.count));
  res.setHeader('X-RateLimit-Reset', new Date(data.resetTime).toISOString());

  // Check if rate limit exceeded
  if (data.count > config.rateLimit.maxRequests) {
    const timeUntilReset = Math.ceil((data.resetTime - Date.now()) / 1000);

    logger.warn('Rate limit exceeded', {
      key: key.split(':')[0] + ':***', // Hide API key in logs
      count: data.count,
      limit: config.rateLimit.maxRequests,
      resetIn: timeUntilReset,
      ip: req.ip,
      userAgent: req.get('User-Agent'),
      url: req.url,
      method: req.method
    });

    res.setHeader('Retry-After', timeUntilReset);

    return res.status(429).json({
      error: 'Too Many Requests',
      message: 'Rate limit exceeded. Please retry after the reset time.',
      limit: config.rateLimit.maxRequests,
      remaining: 0,
      resetTime: new Date(data.resetTime).toISOString(),
      retryAfter: timeUntilReset,
      timestamp: new Date().toISOString()
    });
  }

  // Log high usage warning
  if (data.count > config.rateLimit.maxRequests * 0.8) {
    logger.warn('High API usage detected', {
      key: key.split(':')[0] + ':***',
      count: data.count,
      limit: config.rateLimit.maxRequests,
      usage: `${Math.round((data.count / config.rateLimit.maxRequests) * 100)}%`,
      ip: req.ip
    });
  }

  next();
};

/**
 * Rate limit bypass for specific IPs or API keys
 */
rateLimitMiddleware.bypass = (req) => {
  // Add bypass logic here if needed
  // For example, bypass for certain API keys or IPs
  return false;
};

/**
 * Reset rate limit for a specific key
 */
rateLimitMiddleware.reset = (req) => {
  const key = store.getKey(req);
  store.reset(key);
  logger.info('Rate limit reset', { key: key.split(':')[0] + ':***' });
};

/**
 * Get current rate limit status
 */
rateLimitMiddleware.getStatus = (req) => {
  const key = store.getKey(req);
  const data = store.get(key);

  if (!data) {
    return {
      count: 0,
      limit: config.rateLimit.maxRequests,
      remaining: config.rateLimit.maxRequests,
      resetTime: new Date(Date.now() + config.rateLimit.windowMs).toISOString()
    };
  }

  return {
    count: data.count,
    limit: config.rateLimit.maxRequests,
    remaining: Math.max(0, config.rateLimit.maxRequests - data.count),
    resetTime: new Date(data.resetTime).toISOString()
  };
};

module.exports = rateLimitMiddleware;
