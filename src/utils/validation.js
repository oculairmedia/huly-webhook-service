/**
 * Validation utilities for webhook service
 */

const Joi = require('joi');

class ValidationUtils {
  /**
   * Validate webhook URL
   * @param {string} url - The URL to validate
   * @returns {boolean} True if valid
   */
  static isValidUrl (url) {
    try {
      const parsed = new URL(url);
      return ['http:', 'https:'].includes(parsed.protocol);
    } catch {
      return false;
    }
  }

  /**
   * Validate webhook secret
   * @param {string} secret - The secret to validate
   * @returns {boolean} True if valid
   */
  static isValidSecret (secret) {
    if (typeof secret !== 'string') return false;
    if (secret.length < 8) return false;
    if (secret.length > 255) return false;
    return true;
  }

  /**
   * Validate event type
   * @param {string} eventType - The event type to validate
   * @returns {boolean} True if valid
   */
  static isValidEventType (eventType) {
    const validTypes = [
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
    ];
    return validTypes.includes(eventType);
  }

  /**
   * Validate UUID format
   * @param {string} uuid - The UUID to validate
   * @returns {boolean} True if valid
   */
  static isValidUUID (uuid) {
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    return uuidRegex.test(uuid);
  }

  /**
   * Validate email format
   * @param {string} email - The email to validate
   * @returns {boolean} True if valid
   */
  static isValidEmail (email) {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }

  /**
   * Validate IP address format
   * @param {string} ip - The IP address to validate
   * @returns {boolean} True if valid
   */
  static isValidIP (ip) {
    const ipv4Regex = /^(\d{1,3}\.){3}\d{1,3}$/;
    const ipv6Regex = /^([0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}$/;
    return ipv4Regex.test(ip) || ipv6Regex.test(ip);
  }

  /**
   * Validate HTTP headers
   * @param {object} headers - The headers object to validate
   * @returns {boolean} True if valid
   */
  static isValidHeaders (headers) {
    if (!headers || typeof headers !== 'object') return false;

    for (const [key, value] of Object.entries(headers)) {
      if (typeof key !== 'string' || typeof value !== 'string') {
        return false;
      }

      // Check for forbidden headers
      const lowerKey = key.toLowerCase();
      if (['host', 'content-length', 'user-agent', 'accept-encoding'].includes(lowerKey)) {
        return false;
      }
    }

    return true;
  }

  /**
   * Validate timeout value
   * @param {number} timeout - The timeout value in milliseconds
   * @returns {boolean} True if valid
   */
  static isValidTimeout (timeout) {
    return typeof timeout === 'number' &&
           timeout >= 1000 &&
           timeout <= 120000; // 1 second to 2 minutes
  }

  /**
   * Validate retry configuration
   * @param {object} retryConfig - The retry configuration object
   * @returns {boolean} True if valid
   */
  static isValidRetryConfig (retryConfig) {
    if (!retryConfig || typeof retryConfig !== 'object') return false;

    const { maxAttempts, backoffMultiplier, initialDelay } = retryConfig;

    if (typeof maxAttempts !== 'number' || maxAttempts < 1 || maxAttempts > 10) {
      return false;
    }

    if (typeof backoffMultiplier !== 'number' || backoffMultiplier < 1 || backoffMultiplier > 10) {
      return false;
    }

    if (typeof initialDelay !== 'number' || initialDelay < 100) {
      return false;
    }

    return true;
  }

  /**
   * Validate webhook filters
   * @param {object} filters - The filters object to validate
   * @returns {boolean} True if valid
   */
  static isValidFilters (filters) {
    if (!filters || typeof filters !== 'object') return true; // Filters are optional

    const { projects, statuses, priorities, assignees, tags } = filters;

    if (projects && !Array.isArray(projects)) return false;
    if (statuses && !Array.isArray(statuses)) return false;
    if (priorities && !Array.isArray(priorities)) return false;
    if (assignees && !Array.isArray(assignees)) return false;
    if (tags && !Array.isArray(tags)) return false;

    return true;
  }

  /**
   * Validate webhook name
   * @param {string} name - The name to validate
   * @returns {boolean} True if valid
   */
  static isValidWebhookName (name) {
    if (typeof name !== 'string') return false;
    if (name.length < 1 || name.length > 100) return false;

    // Allow letters, numbers, spaces, hyphens, underscores
    const nameRegex = /^[a-zA-Z0-9\s\-_]+$/;
    return nameRegex.test(name);
  }

  /**
   * Validate API key format
   * @param {string} apiKey - The API key to validate
   * @returns {boolean} True if valid
   */
  static isValidApiKey (apiKey) {
    if (typeof apiKey !== 'string') return false;
    if (apiKey.length < 16) return false;
    if (apiKey.length > 255) return false;

    // Allow alphanumeric and some special characters
    const apiKeyRegex = /^[a-zA-Z0-9\-_=+/]+$/;
    return apiKeyRegex.test(apiKey);
  }

  /**
   * Validate pagination parameters
   * @param {object} params - The pagination parameters
   * @returns {object} Validated and sanitized parameters
   */
  static validatePagination (params) {
    const { page = 1, limit = 50 } = params;

    const validatedPage = Math.max(1, parseInt(page) || 1);
    const validatedLimit = Math.min(100, Math.max(1, parseInt(limit) || 50));

    return {
      page: validatedPage,
      limit: validatedLimit,
      offset: (validatedPage - 1) * validatedLimit
    };
  }

  /**
   * Validate date range
   * @param {string} from - Start date string
   * @param {string} to - End date string
   * @returns {object} Validated date range or null
   */
  static validateDateRange (from, to) {
    let fromDate, toDate;

    if (from) {
      fromDate = new Date(from);
      if (isNaN(fromDate.getTime())) return null;
    }

    if (to) {
      toDate = new Date(to);
      if (isNaN(toDate.getTime())) return null;
    }

    if (fromDate && toDate && fromDate > toDate) {
      return null;
    }

    return { from: fromDate, to: toDate };
  }

  /**
   * Validate webhook event data
   * @param {object} eventData - The event data to validate
   * @returns {boolean} True if valid
   */
  static isValidEventData (eventData) {
    if (!eventData || typeof eventData !== 'object') return false;

    const requiredFields = ['id', 'type', 'timestamp', 'workspace', 'data'];
    for (const field of requiredFields) {
      if (!(field in eventData)) return false;
    }

    if (!this.isValidEventType(eventData.type)) return false;
    if (!this.isValidUUID(eventData.id)) return false;

    const timestamp = new Date(eventData.timestamp);
    if (isNaN(timestamp.getTime())) return false;

    return true;
  }

  /**
   * Sanitize string input
   * @param {string} input - The input to sanitize
   * @param {number} maxLength - Maximum length
   * @returns {string} Sanitized string
   */
  static sanitizeString (input, maxLength = 255) {
    if (typeof input !== 'string') return '';

    // Remove null bytes and control characters
    // eslint-disable-next-line no-control-regex
    let sanitized = input.replace(/[\x00-\x1F\x7F]/g, '');

    // Trim whitespace
    sanitized = sanitized.trim();

    // Truncate if too long
    if (sanitized.length > maxLength) {
      sanitized = sanitized.substring(0, maxLength);
    }

    return sanitized;
  }

  /**
   * Validate JSON payload
   * @param {string} payload - The JSON payload to validate
   * @returns {object|null} Parsed JSON or null if invalid
   */
  static validateJSON (payload) {
    try {
      return JSON.parse(payload);
    } catch {
      return null;
    }
  }

  /**
   * Validate webhook signature format
   * @param {string} signature - The signature to validate
   * @returns {boolean} True if valid format
   */
  static isValidSignatureFormat (signature) {
    if (typeof signature !== 'string') return false;

    // Check for sha256= prefix
    if (!signature.startsWith('sha256=')) return false;

    // Check hex format (64 characters after prefix)
    const hex = signature.substring(7);
    return /^[a-f0-9]{64}$/i.test(hex);
  }

  /**
   * Validate MongoDB connection string
   * @param {string} connectionString - The connection string to validate
   * @returns {boolean} True if valid
   */
  static isValidMongoConnectionString (connectionString) {
    if (typeof connectionString !== 'string') return false;

    // Basic MongoDB connection string format
    const mongoRegex = /^mongodb:\/\/[^/]+\/[^?]*$/;
    return mongoRegex.test(connectionString);
  }

  /**
   * Create Joi schema for webhook creation
   * @returns {Joi.ObjectSchema} Joi schema
   */
  static createWebhookSchema () {
    return Joi.object({
      name: Joi.string().min(1).max(100).required(),
      url: Joi.string().uri().required(),
      secret: Joi.string().min(8).max(255).optional(),
      events: Joi.array().items(
        Joi.string().valid(
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
        )
      ).min(1).required(),
      filters: Joi.object({
        projects: Joi.array().items(Joi.string()).optional(),
        statuses: Joi.array().items(Joi.string()).optional(),
        priorities: Joi.array().items(Joi.string()).optional(),
        assignees: Joi.array().items(Joi.string()).optional(),
        tags: Joi.array().items(Joi.string()).optional()
      }).optional(),
      active: Joi.boolean().default(true),
      retryConfig: Joi.object({
        maxAttempts: Joi.number().integer().min(1).max(10).default(3),
        backoffMultiplier: Joi.number().min(1).max(10).default(2),
        initialDelay: Joi.number().integer().min(100).default(1000)
      }).optional(),
      timeout: Joi.number().integer().min(1000).max(120000).default(30000),
      headers: Joi.object().pattern(Joi.string(), Joi.string()).optional(),
      metadata: Joi.object().optional()
    });
  }

  /**
   * Create Joi schema for webhook update
   * @returns {Joi.ObjectSchema} Joi schema
   */
  static createWebhookUpdateSchema () {
    return this.createWebhookSchema().fork(
      ['name', 'url', 'events'],
      (schema) => schema.optional()
    );
  }
}

module.exports = ValidationUtils;
