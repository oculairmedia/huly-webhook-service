/**
 * Unit tests for Error Handler middleware
 */

const {
  AppError,
  ValidationError,
  NotFoundError,
  ConflictError,
  UnauthorizedError,
  ForbiddenError,
  RateLimitError,
  ServiceUnavailableError,
  errorHandler,
  asyncHandler,
  handleDatabaseError,
  handleWebhookDeliveryError,
  isOperationalError
} = require('../../../src/middleware/errorHandler');

// Mock dependencies
jest.mock('../../../src/utils/logger', () => ({
  error: jest.fn(),
  warn: jest.fn(),
  info: jest.fn(),
  debug: jest.fn()
}));

jest.mock('../../../src/config', () => ({
  env: 'test',
  app: {
    name: 'test-service'
  }
}));

const logger = require('../../../src/utils/logger');

describe('Error Handler Middleware', () => {
  let req, res, next;

  beforeEach(() => {
    jest.clearAllMocks();
    
    req = {
      method: 'GET',
      url: '/test',
      headers: {},
      query: {},
      body: {}
    };
    
    res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
      locals: {}
    };
    
    next = jest.fn();
  });

  describe('Custom Error Classes', () => {
    describe('AppError', () => {
      test('should create app error with defaults', () => {
        const error = new AppError('Test error');
        
        expect(error.message).toBe('Test error');
        expect(error.statusCode).toBe(500);
        expect(error.code).toBeNull();
        expect(error.isOperational).toBe(true);
        expect(error.stack).toBeDefined();
      });

      test('should create app error with custom values', () => {
        const error = new AppError('Custom error', 400, 'CUSTOM_ERROR');
        
        expect(error.message).toBe('Custom error');
        expect(error.statusCode).toBe(400);
        expect(error.code).toBe('CUSTOM_ERROR');
      });
    });

    describe('ValidationError', () => {
      test('should create validation error', () => {
        const error = new ValidationError('Invalid input');
        
        expect(error.message).toBe('Invalid input');
        expect(error.statusCode).toBe(400);
        expect(error.code).toBe('VALIDATION_ERROR');
        expect(error.details).toBeNull();
      });

      test('should create validation error with details', () => {
        const details = { field: 'email', reason: 'invalid format' };
        const error = new ValidationError('Invalid input', details);
        
        expect(error.details).toEqual(details);
      });
    });

    describe('NotFoundError', () => {
      test('should create not found error with default message', () => {
        const error = new NotFoundError();
        
        expect(error.message).toBe('Resource not found');
        expect(error.statusCode).toBe(404);
        expect(error.code).toBe('NOT_FOUND');
      });

      test('should create not found error with custom resource', () => {
        const error = new NotFoundError('Webhook');
        
        expect(error.message).toBe('Webhook not found');
      });
    });

    describe('ConflictError', () => {
      test('should create conflict error', () => {
        const error = new ConflictError('Duplicate webhook name');
        
        expect(error.message).toBe('Duplicate webhook name');
        expect(error.statusCode).toBe(409);
        expect(error.code).toBe('CONFLICT');
      });
    });

    describe('UnauthorizedError', () => {
      test('should create unauthorized error', () => {
        const error = new UnauthorizedError('Invalid token');
        
        expect(error.message).toBe('Invalid token');
        expect(error.statusCode).toBe(401);
        expect(error.code).toBe('UNAUTHORIZED');
      });
    });

    describe('ForbiddenError', () => {
      test('should create forbidden error', () => {
        const error = new ForbiddenError('Access denied');
        
        expect(error.message).toBe('Access denied');
        expect(error.statusCode).toBe(403);
        expect(error.code).toBe('FORBIDDEN');
      });
    });

    describe('RateLimitError', () => {
      test('should create rate limit error', () => {
        const error = new RateLimitError(60);
        
        expect(error.message).toBe('Rate limit exceeded. Try again in 60 seconds');
        expect(error.statusCode).toBe(429);
        expect(error.code).toBe('RATE_LIMIT_EXCEEDED');
        expect(error.retryAfter).toBe(60);
      });

      test('should create rate limit error with default retry', () => {
        const error = new RateLimitError();
        
        expect(error.retryAfter).toBe(60);
      });
    });

    describe('ServiceUnavailableError', () => {
      test('should create service unavailable error', () => {
        const error = new ServiceUnavailableError('Database connection failed');
        
        expect(error.message).toBe('Database connection failed');
        expect(error.statusCode).toBe(503);
        expect(error.code).toBe('SERVICE_UNAVAILABLE');
      });
    });
  });

  describe('errorHandler middleware', () => {
    test('should handle operational errors', () => {
      const error = new ValidationError('Invalid data');
      
      errorHandler(error, req, res, next);
      
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith({
        status: 'error',
        message: 'Invalid data',
        code: 'VALIDATION_ERROR',
        timestamp: expect.any(String)
      });
      expect(logger.warn).toHaveBeenCalled();
    });

    test('should handle non-operational errors in production', () => {
      const config = require('../../../src/config');
      config.env = 'production';
      
      const error = new Error('Internal error');
      
      errorHandler(error, req, res, next);
      
      expect(res.status).toHaveBeenCalledWith(500);
      expect(res.json).toHaveBeenCalledWith({
        status: 'error',
        message: 'An unexpected error occurred',
        code: 'INTERNAL_ERROR',
        timestamp: expect.any(String)
      });
      expect(logger.error).toHaveBeenCalled();
      
      config.env = 'test';
    });

    test('should include stack trace in development', () => {
      const config = require('../../../src/config');
      config.env = 'development';
      
      const error = new Error('Dev error');
      
      errorHandler(error, req, res, next);
      
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          stack: expect.any(String),
          request: expect.objectContaining({
            method: 'GET',
            url: '/test'
          })
        })
      );
      
      config.env = 'test';
    });

    test('should handle MongoDB duplicate key error', () => {
      const error = new Error('E11000 duplicate key error');
      error.code = 11000;
      
      errorHandler(error, req, res, next);
      
      expect(res.status).toHaveBeenCalledWith(409);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Duplicate key error',
          code: 'DUPLICATE_KEY'
        })
      );
    });

    test('should handle MongoDB validation error', () => {
      const error = new Error('Validation failed');
      error.name = 'ValidationError';
      error.errors = {
        name: { message: 'Name is required' }
      };
      
      errorHandler(error, req, res, next);
      
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          code: 'VALIDATION_ERROR',
          details: expect.any(Object)
        })
      );
    });

    test('should handle rate limit error with retry header', () => {
      const error = new RateLimitError(120);
      
      errorHandler(error, req, res, next);
      
      expect(res.status).toHaveBeenCalledWith(429);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          retryAfter: 120
        })
      );
    });

    test('should handle JSON syntax error', () => {
      const error = new SyntaxError('Unexpected token');
      error.status = 400;
      error.body = '{"invalid"}';
      
      errorHandler(error, req, res, next);
      
      expect(res.status).toHaveBeenCalledWith(400);
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'Invalid JSON in request body'
        })
      );
    });

    test('should use error statusCode if available', () => {
      const error = new Error('Custom error');
      error.statusCode = 418;
      
      errorHandler(error, req, res, next);
      
      expect(res.status).toHaveBeenCalledWith(418);
    });

    test('should handle errors without message', () => {
      const error = new Error();
      
      errorHandler(error, req, res, next);
      
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          message: 'An unexpected error occurred'
        })
      );
    });
  });

  describe('asyncHandler', () => {
    test('should handle successful async function', async () => {
      const asyncFn = jest.fn().mockResolvedValue('success');
      const wrapped = asyncHandler(asyncFn);
      
      await wrapped(req, res, next);
      
      expect(asyncFn).toHaveBeenCalledWith(req, res, next);
      expect(next).not.toHaveBeenCalled();
    });

    test('should catch and forward async errors', async () => {
      const error = new Error('Async error');
      const asyncFn = jest.fn().mockRejectedValue(error);
      const wrapped = asyncHandler(asyncFn);
      
      await wrapped(req, res, next);
      
      expect(next).toHaveBeenCalledWith(error);
    });

    test('should handle sync errors in async function', async () => {
      const error = new Error('Sync error');
      const asyncFn = jest.fn(() => {
        throw error;
      });
      const wrapped = asyncHandler(asyncFn);
      
      await wrapped(req, res, next);
      
      expect(next).toHaveBeenCalledWith(error);
    });
  });

  describe('handleDatabaseError', () => {
    test('should handle duplicate key error', () => {
      const error = new Error('E11000 duplicate key error');
      error.code = 11000;
      
      expect(() => handleDatabaseError(error)).toThrow(ConflictError);
    });

    test('should handle cast error', () => {
      const error = new Error('Cast error');
      error.name = 'CastError';
      error.path = 'id';
      error.value = 'invalid';
      
      expect(() => handleDatabaseError(error)).toThrow(ValidationError);
    });

    test('should handle validation error', () => {
      const error = new Error('Validation failed');
      error.name = 'ValidationError';
      error.errors = {
        name: { message: 'Required' }
      };
      
      expect(() => handleDatabaseError(error)).toThrow(ValidationError);
    });

    test('should handle connection errors', () => {
      const error = new Error('Connection failed');
      error.name = 'MongoNetworkError';
      
      expect(() => handleDatabaseError(error)).toThrow(ServiceUnavailableError);
    });

    test('should re-throw unknown errors', () => {
      const error = new Error('Unknown error');
      
      expect(() => handleDatabaseError(error)).toThrow('Unknown error');
    });
  });

  describe('handleWebhookDeliveryError', () => {
    test('should handle timeout error', () => {
      const error = new Error('Request timeout');
      error.code = 'ETIMEDOUT';
      
      const result = handleWebhookDeliveryError(error);
      
      expect(result.retry).toBe(true);
      expect(result.message).toContain('Request timeout');
    });

    test('should handle connection refused', () => {
      const error = new Error('Connection refused');
      error.code = 'ECONNREFUSED';
      
      const result = handleWebhookDeliveryError(error);
      
      expect(result.retry).toBe(true);
      expect(result.message).toContain('Connection refused');
    });

    test('should handle DNS errors', () => {
      const error = new Error('DNS lookup failed');
      error.code = 'ENOTFOUND';
      
      const result = handleWebhookDeliveryError(error);
      
      expect(result.retry).toBe(false);
      expect(result.message).toContain('DNS lookup failed');
    });

    test('should handle HTTP response errors', () => {
      const error = new Error('Bad Request');
      error.response = {
        status: 400,
        statusText: 'Bad Request',
        data: { error: 'Invalid payload' }
      };
      
      const result = handleWebhookDeliveryError(error);
      
      expect(result.httpStatus).toBe(400);
      expect(result.retry).toBe(false);
      expect(result.responseBody).toBeDefined();
    });

    test('should handle 5xx errors as retryable', () => {
      const error = new Error('Server Error');
      error.response = {
        status: 503,
        statusText: 'Service Unavailable'
      };
      
      const result = handleWebhookDeliveryError(error);
      
      expect(result.httpStatus).toBe(503);
      expect(result.retry).toBe(true);
    });

    test('should handle rate limit errors', () => {
      const error = new Error('Too Many Requests');
      error.response = {
        status: 429,
        headers: {
          'retry-after': '60'
        }
      };
      
      const result = handleWebhookDeliveryError(error);
      
      expect(result.httpStatus).toBe(429);
      expect(result.retry).toBe(true);
      expect(result.retryAfter).toBe(60);
    });

    test('should handle unknown errors', () => {
      const error = new Error('Unknown');
      
      const result = handleWebhookDeliveryError(error);
      
      expect(result.retry).toBe(false);
      expect(result.message).toBe('Unknown');
    });

    test('should truncate large response bodies', () => {
      const error = new Error('Error');
      error.response = {
        status: 400,
        data: 'x'.repeat(2000)
      };
      
      const result = handleWebhookDeliveryError(error);
      
      expect(result.responseBody.length).toBeLessThanOrEqual(1000);
    });
  });

  describe('isOperationalError', () => {
    test('should identify operational errors', () => {
      expect(isOperationalError(new AppError('Test'))).toBe(true);
      expect(isOperationalError(new ValidationError('Test'))).toBe(true);
      expect(isOperationalError(new NotFoundError())).toBe(true);
    });

    test('should identify non-operational errors', () => {
      expect(isOperationalError(new Error('Test'))).toBe(false);
      expect(isOperationalError(new TypeError('Test'))).toBe(false);
      expect(isOperationalError(null)).toBe(false);
      expect(isOperationalError(undefined)).toBe(false);
    });

    test('should handle errors with isOperational property', () => {
      const error = new Error('Test');
      error.isOperational = true;
      
      expect(isOperationalError(error)).toBe(true);
    });
  });
});