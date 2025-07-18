/**
 * Winston logger configuration for Huly Webhook Service
 * Provides structured logging with file rotation and console output
 */

const winston = require('winston');
const path = require('path');
const fs = require('fs');
const config = require('../config');

// Ensure logs directory exists
const logsDir = path.dirname(config.logging.file.path);
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

// Custom log format
const logFormat = winston.format.combine(
  winston.format.timestamp({
    format: 'YYYY-MM-DD HH:mm:ss.SSS'
  }),
  winston.format.errors({ stack: true }),
  winston.format.printf(({ timestamp, level, message, stack, ...meta }) => {
    let logMessage = `${timestamp} [${level.toUpperCase()}]: ${message}`;

    // Add metadata if present
    if (Object.keys(meta).length > 0) {
      logMessage += ` ${JSON.stringify(meta)}`;
    }

    // Add stack trace for errors
    if (stack) {
      logMessage += `\n${stack}`;
    }

    return logMessage;
  })
);

// Console format (colorized for development)
const consoleFormat = winston.format.combine(
  winston.format.colorize(),
  winston.format.timestamp({
    format: 'HH:mm:ss'
  }),
  winston.format.printf(({ timestamp, level, message, stack, ...meta }) => {
    let logMessage = `${timestamp} ${level}: ${message}`;

    // Add metadata if present (pretty print in development)
    if (Object.keys(meta).length > 0) {
      if (config.validate.isDevelopment()) {
        logMessage += `\n${JSON.stringify(meta, null, 2)}`;
      } else {
        logMessage += ` ${JSON.stringify(meta)}`;
      }
    }

    // Add stack trace for errors
    if (stack) {
      logMessage += `\n${stack}`;
    }

    return logMessage;
  })
);

// Create transports
const transports = [
  // Console transport
  new winston.transports.Console({
    level: config.logging.level,
    format: consoleFormat,
    handleExceptions: true,
    handleRejections: true
  })
];

// File transport (only in production or if explicitly configured)
if (config.validate.isProduction() || process.env.LOG_TO_FILE === 'true') {
  transports.push(
    new winston.transports.File({
      level: config.logging.level,
      filename: config.logging.file.path,
      format: logFormat,
      maxsize: parseSize(config.logging.file.maxSize),
      maxFiles: config.logging.file.maxFiles,
      handleExceptions: true,
      handleRejections: true
    })
  );
}

// Error log file (always enabled)
transports.push(
  new winston.transports.File({
    level: 'error',
    filename: path.join(logsDir, 'error.log'),
    format: logFormat,
    maxsize: parseSize(config.logging.file.maxSize),
    maxFiles: config.logging.file.maxFiles,
    handleExceptions: true,
    handleRejections: true
  })
);

// Create logger instance
const logger = winston.createLogger({
  level: config.logging.level,
  format: logFormat,
  transports,
  exitOnError: false
});

// Helper function to parse size strings (e.g., "10m", "1g")
function parseSize (sizeStr) {
  const units = {
    b: 1,
    k: 1024,
    m: 1024 * 1024,
    g: 1024 * 1024 * 1024
  };

  const match = sizeStr.toString().toLowerCase().match(/^(\d+)([bkmg]?)$/);
  if (!match) {
    return 5 * 1024 * 1024; // Default 5MB
  }

  const [, size, unit] = match;
  return parseInt(size) * (units[unit] || 1);
}

// Add helper methods for structured logging
logger.logRequest = (req, res, message = 'Request processed') => {
  const meta = {
    method: req.method,
    url: req.url,
    ip: req.ip,
    userAgent: req.get('User-Agent'),
    requestId: req.id,
    statusCode: res.statusCode,
    responseTime: res.get('X-Response-Time')
  };

  if (res.statusCode >= 400) {
    logger.warn(message, meta);
  } else {
    logger.info(message, meta);
  }
};

logger.logWebhookDelivery = (webhook, delivery, success, error = null) => {
  const meta = {
    webhookId: webhook.id || webhook._id,
    webhookName: webhook.name,
    deliveryId: delivery.id || delivery._id,
    url: webhook.url,
    eventType: delivery.eventType,
    attempts: delivery.attempts,
    success
  };

  if (error) {
    meta.error = error.message || error;
  }

  if (success) {
    logger.info('Webhook delivered successfully', meta);
  } else {
    logger.warn('Webhook delivery failed', meta);
  }
};

logger.logChangeStreamEvent = (event, processed = true) => {
  const meta = {
    operationType: event.operationType,
    collection: event.ns?.coll,
    documentId: event.documentKey?._id,
    processed
  };

  if (processed) {
    logger.debug('Change stream event processed', meta);
  } else {
    logger.warn('Change stream event skipped', meta);
  }
};

logger.logServiceStatus = (serviceName, status, details = {}) => {
  const meta = {
    service: serviceName,
    status,
    ...details
  };

  if (status === 'started' || status === 'healthy') {
    logger.info(`Service ${serviceName} ${status}`, meta);
  } else if (status === 'stopped' || status === 'stopping') {
    logger.warn(`Service ${serviceName} ${status}`, meta);
  } else {
    logger.error(`Service ${serviceName} ${status}`, meta);
  }
};

// Add performance timing helper
logger.timeStart = (label) => {
  const startTime = Date.now();
  return {
    end: (message = `Operation ${label} completed`) => {
      const duration = Date.now() - startTime;
      logger.debug(message, { operation: label, duration: `${duration}ms` });
      return duration;
    }
  };
};

// Handle logger errors
logger.on('error', (error) => {
  console.error('Logger error:', error);
});

module.exports = logger;
