/**
 * Global error handler middleware for Huly Webhook Service
 * Provides consistent error responses and logging
 */

const config = require('../config');
const logger = require('../utils/logger');

/**
 * Error types and their corresponding HTTP status codes
 */
const ERROR_TYPES = {
  ValidationError: 400,
  CastError: 400,
  UnauthorizedError: 401,
  ForbiddenError: 403,
  NotFoundError: 404,
  ConflictError: 409,
  RateLimitError: 429,
  InternalServerError: 500,
  ServiceUnavailableError: 503
};

/**
 * Custom error classes
 */
class AppError extends Error {
  constructor (message, statusCode = 500, code = null) {
    super(message);
    this.statusCode = statusCode;
    this.code = code;
    this.isOperational = true;
    Error.captureStackTrace(this, this.constructor);
  }
}

class ValidationError extends AppError {
  constructor (message, details = null) {
    super(message, 400, 'VALIDATION_ERROR');
    this.details = details;
  }
}

class NotFoundError extends AppError {
  constructor (resource = 'Resource') {
    super(`${resource} not found`, 404, 'NOT_FOUND');
  }
}

class ConflictError extends AppError {
  constructor (message) {
    super(message, 409, 'CONFLICT');
  }
}

class ServiceUnavailableError extends AppError {
  constructor (message = 'Service temporarily unavailable') {
    super(message, 503, 'SERVICE_UNAVAILABLE');
  }
}

/**
 * Format error response based on environment
 */
const formatErrorResponse = (error, req) => {
  const response = {
    error: error.name || 'Error',
    message: error.message,
    timestamp: new Date().toISOString(),
    requestId: req.id
  };

  // Add error code if available
  if (error.code) {
    response.code = error.code;
  }

  // Add validation details if available
  if (error.details) {
    response.details = error.details;
  }

  // Include stack trace in development
  if (config.validate.isDevelopment()) {
    response.stack = error.stack;
  }

  return response;
};

/**
 * Get HTTP status code from error
 */
const getStatusCode = (error) => {
  // Check if error has explicit status code
  if (error.statusCode) {
    return error.statusCode;
  }

  // Check by error type/name
  const statusCode = ERROR_TYPES[error.name] || ERROR_TYPES[error.constructor.name];
  if (statusCode) {
    return statusCode;
  }

  // MongoDB specific errors
  if (error.name === 'MongoError') {
    if (error.code === 11000) return 409; // Duplicate key
    if (error.code === 11001) return 409; // Duplicate key
    return 500;
  }

  // Joi validation errors
  if (error.name === 'ValidationError' && error.isJoi) {
    return 400;
  }

  // Default to 500
  return 500;
};

/**
 * Log error with appropriate level
 */
const logError = (error, req, _res) => {
  const statusCode = getStatusCode(error);
  const logData = {
    error: error.message,
    statusCode,
    method: req.method,
    url: req.url,
    ip: req.ip,
    userAgent: req.get('User-Agent'),
    requestId: req.id
  };

  // Add error code if available
  if (error.code) {
    logData.errorCode = error.code;
  }

  // Log based on severity
  if (statusCode >= 500) {
    logger.error('Server error occurred', logData, error.stack);
  } else if (statusCode >= 400) {
    logger.warn('Client error occurred', logData);
  } else {
    logger.info('Request completed with error', logData);
  }
};

/**
 * Handle async errors
 */
const asyncHandler = (fn) => {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};

/**
 * Main error handler middleware
 */
const errorHandler = (error, req, res, next) => {
  // If response was already sent, delegate to default Express error handler
  if (res.headersSent) {
    return next(error);
  }

  try {
    const statusCode = getStatusCode(error);

    // Log the error
    logError(error, req, res);

    // Format response
    const response = formatErrorResponse(error, req);

    // Send error response
    res.status(statusCode).json(response);
  } catch (handlerError) {
    // Fallback error handling
    logger.error('Error in error handler:', handlerError);
    res.status(500).json({
      error: 'Internal Server Error',
      message: 'An unexpected error occurred',
      timestamp: new Date().toISOString(),
      requestId: req.id
    });
  }
};

/**
 * 404 handler for unmatched routes
 */
const notFoundHandler = (req, res, next) => {
  const error = new NotFoundError(`Route ${req.method} ${req.originalUrl}`);
  next(error);
};

/**
 * Validation error helper
 */
const handleValidationError = (joiResult) => {
  if (joiResult.error) {
    const details = joiResult.error.details.map(detail => ({
      field: detail.path.join('.'),
      message: detail.message,
      value: detail.context?.value
    }));

    throw new ValidationError('Validation failed', details);
  }
  return joiResult.value;
};

/**
 * Database error helper
 */
const handleDatabaseError = (error) => {
  if (error.name === 'MongoError' || error.name === 'MongoServerError') {
    if (error.code === 11000) {
      const field = Object.keys(error.keyPattern || {})[0] || 'field';
      throw new ConflictError(`Duplicate value for ${field}`);
    }
  }

  if (error.name === 'CastError') {
    throw new ValidationError(`Invalid ${error.path}: ${error.value}`);
  }

  throw error;
};

module.exports = {
  errorHandler,
  notFoundHandler,
  asyncHandler,
  handleValidationError,
  handleDatabaseError,

  // Error classes
  AppError,
  ValidationError,
  NotFoundError,
  ConflictError,
  ServiceUnavailableError
};
