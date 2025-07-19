/**
 * Unit tests for DeliveryAttempt model
 */

const DeliveryAttempt = require('../../../src/models/DeliveryAttempt');
const {
  createDeliveryAttempt,
  createSuccessfulAttempt,
  createFailedAttempt,
  createRetryAttempt,
  createClientErrorAttempt,
  createServerErrorAttempt,
  createTimeoutAttempt,
  createRateLimitedAttempt,
  createNetworkErrorAttempt,
  createFinalFailedAttempt,
  createAttemptSequence
} = require('../../../src/models/factories/deliveryAttemptFactory');

describe('DeliveryAttempt Model', () => {
  describe('Constructor', () => {
    test('should create attempt with default values', () => {
      const attempt = new DeliveryAttempt();
      
      expect(attempt.id).toBeDefined();
      expect(attempt.webhookId).toBe('');
      expect(attempt.eventId).toBe('');
      expect(attempt.attemptNumber).toBe(1);
      expect(attempt.status).toBe('pending');
      expect(attempt.httpStatus).toBeNull();
      expect(attempt.responseBody).toBeNull();
      expect(attempt.responseHeaders).toEqual({});
      expect(attempt.errorMessage).toBeNull();
      expect(attempt.duration).toBeNull();
      expect(attempt.timestamp).toBeInstanceOf(Date);
      expect(attempt.nextRetryAt).toBeNull();
      expect(attempt.finalAttempt).toBe(false);
      expect(attempt.deliveryId).toBeNull();
      expect(attempt.metadata).toEqual({});
    });

    test('should create attempt with provided data', () => {
      const data = {
        id: 'attempt-123',
        webhookId: 'webhook-456',
        eventId: 'event-789',
        attemptNumber: 2,
        status: 'failed',
        httpStatus: 500,
        errorMessage: 'Server error'
      };
      
      const attempt = new DeliveryAttempt(data);
      
      expect(attempt.id).toBe(data.id);
      expect(attempt.webhookId).toBe(data.webhookId);
      expect(attempt.eventId).toBe(data.eventId);
      expect(attempt.attemptNumber).toBe(data.attemptNumber);
      expect(attempt.status).toBe(data.status);
      expect(attempt.httpStatus).toBe(data.httpStatus);
      expect(attempt.errorMessage).toBe(data.errorMessage);
    });
  });

  describe('Validation', () => {
    test('should validate valid attempt', () => {
      const attempt = createDeliveryAttempt();
      
      expect(() => attempt.validate()).not.toThrow();
    });

    test('should fail validation without required fields', () => {
      const attempt = new DeliveryAttempt();
      
      expect(() => attempt.validate()).toThrow('DeliveryAttempt validation failed');
    });

    test('should fail validation with invalid status', () => {
      const attempt = createDeliveryAttempt({ status: 'invalid' });
      
      expect(() => attempt.validate()).toThrow();
    });

    test('should fail validation with invalid HTTP status', () => {
      const attempt = createDeliveryAttempt({ httpStatus: 999 });
      
      expect(() => attempt.validate()).toThrow('must be less than or equal to 599');
    });

    test('should fail validation with invalid attempt number', () => {
      const attempt = createDeliveryAttempt({ attemptNumber: 0 });
      
      expect(() => attempt.validate()).toThrow('must be greater than or equal to 1');
    });

    test('should validate all valid statuses', () => {
      const statuses = ['pending', 'success', 'failed', 'retry'];
      
      statuses.forEach(status => {
        const attempt = createDeliveryAttempt({ status });
        expect(() => attempt.validate()).not.toThrow();
      });
    });
  });

  describe('toObject', () => {
    test('should convert attempt to plain object', () => {
      const attempt = createDeliveryAttempt();
      const obj = attempt.toObject();
      
      expect(obj).toEqual({
        id: attempt.id,
        webhookId: attempt.webhookId,
        eventId: attempt.eventId,
        attemptNumber: attempt.attemptNumber,
        status: attempt.status,
        httpStatus: attempt.httpStatus,
        responseBody: attempt.responseBody,
        responseHeaders: attempt.responseHeaders,
        errorMessage: attempt.errorMessage,
        duration: attempt.duration,
        timestamp: attempt.timestamp,
        nextRetryAt: attempt.nextRetryAt,
        finalAttempt: attempt.finalAttempt,
        deliveryId: attempt.deliveryId,
        metadata: attempt.metadata
      });
    });
  });

  describe('toResponse', () => {
    test('should convert attempt to API response format', () => {
      const attempt = createDeliveryAttempt({
        responseBody: 'A'.repeat(2000) // Long response
      });
      
      const response = attempt.toResponse();
      
      // Response body should be truncated
      expect(response.responseBody.length).toBe(1000);
      
      // Should not include response headers or metadata
      expect(response.responseHeaders).toBeUndefined();
      expect(response.metadata).toBeUndefined();
    });
  });

  describe('fromDocument', () => {
    test('should create attempt from database document', () => {
      const doc = {
        id: 'attempt-123',
        webhookId: 'webhook-456',
        eventId: 'event-789',
        status: 'success',
        httpStatus: 200
      };
      
      const attempt = DeliveryAttempt.fromDocument(doc);
      
      expect(attempt).toBeInstanceOf(DeliveryAttempt);
      expect(attempt.id).toBe(doc.id);
      expect(attempt.status).toBe(doc.status);
    });
  });

  describe('createAttempt', () => {
    test('should create new attempt', () => {
      const attempt = DeliveryAttempt.createAttempt('webhook-123', 'event-456', 2);
      
      expect(attempt.webhookId).toBe('webhook-123');
      expect(attempt.eventId).toBe('event-456');
      expect(attempt.attemptNumber).toBe(2);
      expect(attempt.status).toBe('pending');
      expect(attempt.deliveryId).toBeDefined();
    });
  });

  describe('markAsSuccess', () => {
    test('should mark attempt as successful', () => {
      const attempt = createDeliveryAttempt();
      
      attempt.markAsSuccess(200, '{"ok":true}', { 'content-type': 'application/json' }, 150);
      
      expect(attempt.status).toBe('success');
      expect(attempt.httpStatus).toBe(200);
      expect(attempt.responseBody).toBe('{"ok":true}');
      expect(attempt.responseHeaders).toEqual({ 'content-type': 'application/json' });
      expect(attempt.duration).toBe(150);
      expect(attempt.errorMessage).toBeNull();
      expect(attempt.finalAttempt).toBe(true);
    });
  });

  describe('markAsFailed', () => {
    test('should mark attempt as failed', () => {
      const attempt = createDeliveryAttempt();
      
      attempt.markAsFailed('Connection refused', null, null, {}, 30000);
      
      expect(attempt.status).toBe('failed');
      expect(attempt.errorMessage).toBe('Connection refused');
      expect(attempt.duration).toBe(30000);
    });

    test('should mark attempt as failed with HTTP status', () => {
      const attempt = createDeliveryAttempt();
      
      attempt.markAsFailed('Not Found', 404, 'Page not found');
      
      expect(attempt.status).toBe('failed');
      expect(attempt.httpStatus).toBe(404);
      expect(attempt.responseBody).toBe('Page not found');
    });
  });

  describe('markForRetry', () => {
    test('should mark attempt for retry', () => {
      const attempt = createDeliveryAttempt();
      const nextRetry = new Date(Date.now() + 5000);
      
      attempt.markForRetry(nextRetry, 'Temporary failure', 503, 'Service Unavailable', 1000);
      
      expect(attempt.status).toBe('retry');
      expect(attempt.nextRetryAt).toBe(nextRetry);
      expect(attempt.errorMessage).toBe('Temporary failure');
      expect(attempt.httpStatus).toBe(503);
      expect(attempt.duration).toBe(1000);
      expect(attempt.finalAttempt).toBe(false);
    });
  });

  describe('markAsFinal', () => {
    test('should mark attempt as final', () => {
      const attempt = createRetryAttempt();
      
      attempt.markAsFinal();
      
      expect(attempt.finalAttempt).toBe(true);
      expect(attempt.status).toBe('failed'); // Retry status changes to failed
    });

    test('should keep successful status when marking as final', () => {
      const attempt = createSuccessfulAttempt();
      
      attempt.markAsFinal();
      
      expect(attempt.finalAttempt).toBe(true);
      expect(attempt.status).toBe('success');
    });
  });

  describe('Status Checks', () => {
    test('isSuccessful should check if attempt succeeded', () => {
      const success = createSuccessfulAttempt();
      const failed = createFailedAttempt();
      
      expect(success.isSuccessful()).toBe(true);
      expect(failed.isSuccessful()).toBe(false);
    });

    test('isFailed should check if attempt failed', () => {
      const success = createSuccessfulAttempt();
      const failed = createFailedAttempt();
      
      expect(success.isFailed()).toBe(false);
      expect(failed.isFailed()).toBe(true);
    });

    test('shouldRetry should check if attempt should be retried', () => {
      const retry = createRetryAttempt();
      const final = createFinalFailedAttempt();
      
      expect(retry.shouldRetry()).toBe(true);
      expect(final.shouldRetry()).toBe(false);
    });

    test('isRetryDue should check if retry time has passed', () => {
      const pastRetry = createRetryAttempt(1, new Date(Date.now() - 1000));
      const futureRetry = createRetryAttempt(1, new Date(Date.now() + 5000));
      
      expect(pastRetry.isRetryDue()).toBe(true);
      expect(futureRetry.isRetryDue()).toBe(false);
    });
  });

  describe('getHttpStatusCategory', () => {
    test('should categorize HTTP status codes', () => {
      expect(createSuccessfulAttempt(200).getHttpStatusCategory()).toBe('success');
      expect(createSuccessfulAttempt(201).getHttpStatusCategory()).toBe('success');
      expect(createSuccessfulAttempt(204).getHttpStatusCategory()).toBe('success');
      
      expect(createDeliveryAttempt({ httpStatus: 301 }).getHttpStatusCategory()).toBe('redirect');
      expect(createDeliveryAttempt({ httpStatus: 302 }).getHttpStatusCategory()).toBe('redirect');
      
      expect(createClientErrorAttempt(400).getHttpStatusCategory()).toBe('client_error');
      expect(createClientErrorAttempt(404).getHttpStatusCategory()).toBe('client_error');
      
      expect(createServerErrorAttempt(500).getHttpStatusCategory()).toBe('server_error');
      expect(createServerErrorAttempt(503).getHttpStatusCategory()).toBe('server_error');
      
      expect(createNetworkErrorAttempt().getHttpStatusCategory()).toBe('unknown');
    });
  });

  describe('isRetryableError', () => {
    test('should identify retryable errors', () => {
      // Network errors are retryable
      expect(createNetworkErrorAttempt().isRetryableError()).toBe(true);
      
      // 5xx errors are retryable
      expect(createServerErrorAttempt(500).isRetryableError()).toBe(true);
      expect(createServerErrorAttempt(503).isRetryableError()).toBe(true);
      
      // 408 and 429 are retryable 4xx errors
      expect(createDeliveryAttempt({ httpStatus: 408 }).isRetryableError()).toBe(true);
      expect(createRateLimitedAttempt().isRetryableError()).toBe(true);
      
      // Other 4xx errors are not retryable
      expect(createClientErrorAttempt(400).isRetryableError()).toBe(false);
      expect(createClientErrorAttempt(404).isRetryableError()).toBe(false);
    });
  });

  describe('Duration Methods', () => {
    test('getDuration should return duration', () => {
      const attempt = createDeliveryAttempt({ duration: 1500 });
      
      expect(attempt.getDuration()).toBe(1500);
    });

    test('getDuration should return 0 when no duration', () => {
      const attempt = createDeliveryAttempt({ duration: null });
      
      expect(attempt.getDuration()).toBe(0);
    });

    test('getFormattedDuration should format duration', () => {
      expect(createDeliveryAttempt({ duration: 500 }).getFormattedDuration()).toBe('500ms');
      expect(createDeliveryAttempt({ duration: 1500 }).getFormattedDuration()).toBe('1.50s');
      expect(createDeliveryAttempt({ duration: 30000 }).getFormattedDuration()).toBe('30.00s');
    });
  });

  describe('getErrorSummary', () => {
    test('should return null for successful attempts', () => {
      const attempt = createSuccessfulAttempt();
      
      expect(attempt.getErrorSummary()).toBeNull();
    });

    test('should return error summary for failed attempts', () => {
      expect(createFailedAttempt('Connection timeout').getErrorSummary())
        .toBe('Connection timeout');
      
      expect(createClientErrorAttempt(404, 'Not Found').getErrorSummary())
        .toBe('HTTP 404: Not Found');
      
      expect(createServerErrorAttempt(500).getErrorSummary())
        .toBe('HTTP 500: Internal Server Error');
      
      expect(createDeliveryAttempt({ status: 'failed' }).getErrorSummary())
        .toBe('Unknown error');
    });
  });

  describe('Metadata Methods', () => {
    test('should add and get metadata', () => {
      const attempt = createDeliveryAttempt();
      
      attempt.addMetadata('requestId', '123-456');
      attempt.addMetadata('region', 'us-east-1');
      
      expect(attempt.getMetadata('requestId')).toBe('123-456');
      expect(attempt.getMetadata('region')).toBe('us-east-1');
      expect(attempt.getMetadata('nonexistent')).toBeUndefined();
    });
  });

  describe('Static Methods', () => {
    test('calculateNextRetryTime should calculate exponential backoff', () => {
      const base = Date.now();
      
      // Mock Date.now to have consistent results
      const originalDateNow = Date.now;
      Date.now = jest.fn(() => base);
      
      const retry1 = DeliveryAttempt.calculateNextRetryTime(1);
      const retry2 = DeliveryAttempt.calculateNextRetryTime(2);
      const retry3 = DeliveryAttempt.calculateNextRetryTime(3);
      
      expect(retry1.getTime()).toBe(base + 1000); // 1s
      expect(retry2.getTime()).toBe(base + 2000); // 2s
      expect(retry3.getTime()).toBe(base + 4000); // 4s
      
      // Test max delay
      const retry10 = DeliveryAttempt.calculateNextRetryTime(10);
      expect(retry10.getTime()).toBe(base + 300000); // Max 5 minutes
      
      Date.now = originalDateNow;
    });

    test('isHttpSuccess should identify successful HTTP status', () => {
      expect(DeliveryAttempt.isHttpSuccess(200)).toBe(true);
      expect(DeliveryAttempt.isHttpSuccess(201)).toBe(true);
      expect(DeliveryAttempt.isHttpSuccess(204)).toBe(true);
      expect(DeliveryAttempt.isHttpSuccess(299)).toBe(true);
      
      expect(DeliveryAttempt.isHttpSuccess(300)).toBe(false);
      expect(DeliveryAttempt.isHttpSuccess(400)).toBe(false);
      expect(DeliveryAttempt.isHttpSuccess(500)).toBe(false);
    });

    test('isHttpRetryable should identify retryable HTTP status', () => {
      expect(DeliveryAttempt.isHttpRetryable(null)).toBe(true); // Network error
      expect(DeliveryAttempt.isHttpRetryable(408)).toBe(true); // Timeout
      expect(DeliveryAttempt.isHttpRetryable(429)).toBe(true); // Rate limit
      expect(DeliveryAttempt.isHttpRetryable(500)).toBe(true); // Server error
      expect(DeliveryAttempt.isHttpRetryable(503)).toBe(true); // Unavailable
      
      expect(DeliveryAttempt.isHttpRetryable(400)).toBe(false); // Bad request
      expect(DeliveryAttempt.isHttpRetryable(401)).toBe(false); // Unauthorized
      expect(DeliveryAttempt.isHttpRetryable(404)).toBe(false); // Not found
    });
  });

  describe('Factory Functions', () => {
    test('should create attempt sequence', () => {
      const sequence = createAttemptSequence(3, 'webhook-1', 'event-1');
      
      expect(sequence).toHaveLength(3);
      expect(sequence[0].attemptNumber).toBe(1);
      expect(sequence[0].status).toBe('retry');
      expect(sequence[1].attemptNumber).toBe(2);
      expect(sequence[1].status).toBe('retry');
      expect(sequence[2].attemptNumber).toBe(3);
      expect(sequence[2].status).toBe('success');
      
      // All should have same webhook/event/delivery IDs
      const deliveryId = sequence[0].deliveryId;
      expect(sequence.every(a => a.webhookId === 'webhook-1')).toBe(true);
      expect(sequence.every(a => a.eventId === 'event-1')).toBe(true);
      expect(sequence.every(a => a.deliveryId === deliveryId)).toBe(true);
    });

    test('should create timeout attempt', () => {
      const attempt = createTimeoutAttempt();
      
      expect(attempt.status).toBe('failed');
      expect(attempt.httpStatus).toBeNull();
      expect(attempt.duration).toBe(30000);
      expect(attempt.errorMessage).toContain('timeout');
    });

    test('should create rate limited attempt', () => {
      const attempt = createRateLimitedAttempt(120);
      
      expect(attempt.status).toBe('retry');
      expect(attempt.httpStatus).toBe(429);
      expect(attempt.responseHeaders['retry-after']).toBe('120');
      expect(attempt.nextRetryAt.getTime()).toBeGreaterThan(Date.now() + 119000);
    });
  });
});