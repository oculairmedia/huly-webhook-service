/**
 * Authentication middleware for Huly Webhook Service
 * Handles API key authentication and security validations
 */

const config = require('../config');
const logger = require('../utils/logger');

/**
 * API Key authentication middleware
 * Validates X-API-Key header against configured API key
 */
const authenticateAPIKey = (req, res, next) => {
  const timer = logger.timeStart('auth');

  try {
    const apiKey = req.headers['x-api-key'] || req.headers.authorization?.replace('Bearer ', '');

    if (!apiKey) {
      logger.warn('Authentication failed: No API key provided', {
        ip: req.ip,
        userAgent: req.get('User-Agent'),
        url: req.url,
        method: req.method
      });

      return res.status(401).json({
        error: 'Unauthorized',
        message: 'API key required. Provide it in X-API-Key header or Authorization: Bearer header.',
        timestamp: new Date().toISOString()
      });
    }

    if (apiKey !== config.auth.apiKey) {
      logger.warn('Authentication failed: Invalid API key', {
        ip: req.ip,
        userAgent: req.get('User-Agent'),
        url: req.url,
        method: req.method,
        providedKeyPrefix: apiKey.substring(0, 8) + '...'
      });

      return res.status(401).json({
        error: 'Unauthorized',
        message: 'Invalid API key',
        timestamp: new Date().toISOString()
      });
    }

    // Add authentication info to request
    req.auth = {
      type: 'api-key',
      authenticated: true,
      timestamp: new Date()
    };

    timer.end('Authentication successful');
    next();
  } catch (error) {
    logger.error('Authentication error:', error);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'Authentication service error',
      timestamp: new Date().toISOString()
    });
  }
};

/**
 * IP whitelist middleware
 * Validates client IP against allowed IPs list
 */
const validateIPWhitelist = (req, res, next) => {
  // Skip IP validation if no whitelist is configured
  if (!config.security.allowedIPs || config.security.allowedIPs.length === 0) {
    return next();
  }

  const clientIP = req.ip || req.connection.remoteAddress;
  const forwardedFor = req.get('X-Forwarded-For');

  // Get real client IP (considering proxies)
  const realIP = forwardedFor ? forwardedFor.split(',')[0].trim() : clientIP;

  // Check if IP is in whitelist
  const isAllowed = config.security.allowedIPs.some(allowedIP => {
    // Support CIDR notation in the future
    return allowedIP === realIP || allowedIP === '0.0.0.0' || allowedIP === '*';
  });

  if (!isAllowed) {
    logger.warn('IP access denied', {
      clientIP: realIP,
      forwardedFor,
      userAgent: req.get('User-Agent'),
      url: req.url,
      method: req.method
    });

    return res.status(403).json({
      error: 'Forbidden',
      message: 'Access denied from this IP address',
      timestamp: new Date().toISOString()
    });
  }

  req.clientIP = realIP;
  next();
};

/**
 * Request validation middleware
 * Validates request size, content type, etc.
 */
const validateRequest = (req, res, next) => {
  // Validate content type for POST/PUT requests
  if (['POST', 'PUT', 'PATCH'].includes(req.method)) {
    const contentType = req.get('Content-Type');

    if (!contentType || !contentType.includes('application/json')) {
      return res.status(400).json({
        error: 'Bad Request',
        message: 'Content-Type must be application/json',
        timestamp: new Date().toISOString()
      });
    }
  }

  // Validate request body size (additional check beyond Express limit)
  const contentLength = parseInt(req.get('Content-Length') || '0');
  const maxSize = 10 * 1024 * 1024; // 10MB

  if (contentLength > maxSize) {
    return res.status(413).json({
      error: 'Payload Too Large',
      message: `Request body too large. Maximum size: ${maxSize} bytes`,
      timestamp: new Date().toISOString()
    });
  }

  next();
};

/**
 * Security headers middleware
 * Adds security-related headers to responses
 */
const addSecurityHeaders = (req, res, next) => {
  // Add security headers
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

  // Remove server header
  res.removeHeader('X-Powered-By');

  next();
};

/**
 * Combined authentication middleware
 * Combines all security checks
 */
const authMiddleware = [
  addSecurityHeaders,
  validateIPWhitelist,
  validateRequest,
  authenticateAPIKey
];

module.exports = authMiddleware;
