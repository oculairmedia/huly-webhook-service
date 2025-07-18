/**
 * Configuration module for Huly Webhook Service
 * Centralizes all environment variable handling and validation
 */

const Joi = require('joi');

// Configuration schema for validation
const configSchema = Joi.object({
  // Environment
  NODE_ENV: Joi.string().valid('development', 'test', 'production').default('development'),

  // Server
  PORT: Joi.number().integer().min(1).max(65535).default(3456),
  HOST: Joi.string().default('0.0.0.0'),

  // MongoDB
  MONGODB_URL: Joi.string().uri().required(),
  MONGODB_DB_NAME: Joi.string().default('huly'),

  // Authentication
  WEBHOOK_SECRET_KEY: Joi.string().min(32).required(),
  API_KEY: Joi.string().min(16).required(),

  // Security
  ALLOWED_IPS: Joi.string().allow('').default(''),
  CORS_ORIGINS: Joi.string().default('*'),

  // Webhook Delivery
  RETRY_MAX_ATTEMPTS: Joi.number().integer().min(1).max(10).default(3),
  RETRY_BACKOFF_MULTIPLIER: Joi.number().min(1).max(10).default(2),
  RETRY_INITIAL_DELAY: Joi.number().integer().min(100).default(1000),
  DELIVERY_TIMEOUT: Joi.number().integer().min(1000).default(30000),
  BATCH_SIZE: Joi.number().integer().min(1).max(100).default(10),
  BATCH_TIMEOUT: Joi.number().integer().min(1000).default(5000),

  // Dead Letter Queue
  DLQ_ENABLED: Joi.boolean().default(true),
  DLQ_MAX_SIZE: Joi.number().integer().min(100).default(1000),

  // Logging
  LOG_LEVEL: Joi.string().valid('error', 'warn', 'info', 'debug').default('info'),
  LOG_FILE_PATH: Joi.string().default('./logs/webhook.log'),
  LOG_MAX_FILES: Joi.number().integer().min(1).default(7),
  LOG_MAX_SIZE: Joi.string().default('10m'),

  // Health Check
  HEALTH_CHECK_INTERVAL: Joi.number().integer().min(5000).default(30000),

  // Rate Limiting
  RATE_LIMIT_WINDOW_MS: Joi.number().integer().min(60000).default(900000), // 15 minutes
  RATE_LIMIT_MAX_REQUESTS: Joi.number().integer().min(10).default(100),

  // Event Processing
  EVENT_PROCESSING_INTERVAL: Joi.number().integer().min(100).default(1000),
  CHANGE_STREAM_RESUME_AFTER: Joi.boolean().default(true),

  // Monitoring
  METRICS_ENABLED: Joi.boolean().default(true),
  METRICS_PORT: Joi.number().integer().min(1).max(65535).default(3457)
});

// Validate environment variables
const { error, value: envVars } = configSchema.validate(process.env, {
  allowUnknown: true,
  stripUnknown: true
});

if (error) {
  throw new Error(`Config validation error: ${error.message}`);
}

// Parse arrays from environment variables
const parseArray = (str, defaultValue = []) => {
  if (!str || str.trim() === '') return defaultValue;
  return str.split(',').map(item => item.trim()).filter(item => item);
};

// Configuration object
const config = {
  env: envVars.NODE_ENV,

  server: {
    port: envVars.PORT,
    host: envVars.HOST
  },

  mongodb: {
    url: envVars.MONGODB_URL,
    dbName: envVars.MONGODB_DB_NAME,
    options: {
      maxPoolSize: 10,
      serverSelectionTimeoutMS: 5000,
      socketTimeoutMS: 45000,
      maxIdleTimeMS: 30000,
      retryWrites: true,
      retryReads: true
    }
  },

  auth: {
    webhookSecretKey: envVars.WEBHOOK_SECRET_KEY,
    apiKey: envVars.API_KEY
  },

  security: {
    allowedIPs: parseArray(envVars.ALLOWED_IPS),
    trustedProxies: ['127.0.0.1', '::1'] // For reverse proxy setups
  },

  cors: {
    origins: envVars.CORS_ORIGINS === '*' ? true : parseArray(envVars.CORS_ORIGINS)
  },

  delivery: {
    retry: {
      maxAttempts: envVars.RETRY_MAX_ATTEMPTS,
      backoffMultiplier: envVars.RETRY_BACKOFF_MULTIPLIER,
      initialDelay: envVars.RETRY_INITIAL_DELAY
    },
    timeout: envVars.DELIVERY_TIMEOUT,
    batch: {
      size: envVars.BATCH_SIZE,
      timeout: envVars.BATCH_TIMEOUT
    }
  },

  dlq: {
    enabled: envVars.DLQ_ENABLED,
    maxSize: envVars.DLQ_MAX_SIZE
  },

  logging: {
    level: envVars.LOG_LEVEL,
    file: {
      path: envVars.LOG_FILE_PATH,
      maxFiles: envVars.LOG_MAX_FILES,
      maxSize: envVars.LOG_MAX_SIZE
    }
  },

  healthCheck: {
    interval: envVars.HEALTH_CHECK_INTERVAL
  },

  rateLimit: {
    windowMs: envVars.RATE_LIMIT_WINDOW_MS,
    maxRequests: envVars.RATE_LIMIT_MAX_REQUESTS
  },

  events: {
    processingInterval: envVars.EVENT_PROCESSING_INTERVAL,
    changeStreamResumeAfter: envVars.CHANGE_STREAM_RESUME_AFTER
  },

  metrics: {
    enabled: envVars.METRICS_ENABLED,
    port: envVars.METRICS_PORT
  },

  // Event types that are supported
  supportedEventTypes: [
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
  ],

  // Collections to monitor in MongoDB
  monitoredCollections: [
    'tracker:class:Issue',
    'core:class:Space', // Projects
    'chunter:class:Comment',
    'attachment:class:Attachment'
  ],

  // Default webhook configuration
  defaultWebhookConfig: {
    active: true,
    retryConfig: {
      maxAttempts: envVars.RETRY_MAX_ATTEMPTS,
      backoffMultiplier: envVars.RETRY_BACKOFF_MULTIPLIER
    },
    timeout: envVars.DELIVERY_TIMEOUT
  }
};

// Validation helper functions
config.validate = {
  isProduction: () => config.env === 'production',
  isDevelopment: () => config.env === 'development',
  isTest: () => config.env === 'test'
};

// Export configuration
module.exports = config;
