/**
 * Unit tests for DeliveryService
 */

const https = require('https');
const http = require('http');
const crypto = require('crypto');
const { EventEmitter } = require('events');
const DeliveryService = require('../../../src/services/DeliveryService');
const { createMockDatabaseService } = require('../../helpers/mockServices');

// Mock dependencies
jest.mock('https');
jest.mock('http');
jest.mock('../../../src/utils/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn()
}));

describe('DeliveryService', () => {
  let service;
  let mockDatabaseService;
  let mockConfig;
  let mockRequest;
  let mockResponse;

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();

    // Mock config
    mockConfig = {
      delivery: {
        timeout: 30000,
        userAgent: 'Test-Agent/1.0',
        maxRedirects: 5,
        maxPayloadSize: 1024 * 1024,
        baseRetryDelay: 1000,
        maxRetryDelay: 300000,
        retryMultiplier: 2,
        maxJitter: 1000
      }
    };

    // Mock database service
    mockDatabaseService = createMockDatabaseService();

    // Mock HTTP request/response
    mockResponse = new EventEmitter();
    mockResponse.statusCode = 200;
    mockResponse.headers = { 'content-type': 'application/json' };

    mockRequest = new EventEmitter();
    mockRequest.write = jest.fn();
    mockRequest.end = jest.fn();
    mockRequest.destroy = jest.fn();

    // Create service instance
    service = new DeliveryService(mockDatabaseService, mockConfig);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('initialization', () => {
    it('should initialize with default config', () => {
      const serviceWithDefaults = new DeliveryService(mockDatabaseService, {});
      
      expect(serviceWithDefaults.httpTimeout).toBe(30000);
      expect(serviceWithDefaults.userAgent).toBe('Huly-Webhook-Service/1.0');
      expect(serviceWithDefaults.maxRedirects).toBe(5);
      expect(serviceWithDefaults.maxPayloadSize).toBe(1024 * 1024);
      expect(serviceWithDefaults.baseRetryDelay).toBe(1000);
      expect(serviceWithDefaults.maxRetryDelay).toBe(300000);
      expect(serviceWithDefaults.retryMultiplier).toBe(2);
      expect(serviceWithDefaults.maxJitter).toBe(1000);
    });

    it('should initialize with custom config', () => {
      expect(service.httpTimeout).toBe(30000);
      expect(service.userAgent).toBe('Test-Agent/1.0');
      expect(service.stats).toEqual({
        pending: 0,
        processing: 0,
        failed: 0,
        succeeded: 0,
        totalDeliveries: 0,
        responseTimes: [],
        errorCounts: {},
        recentErrors: [],
        lastDelivery: null
      });
    });
  });

  describe('deliverWebhook', () => {
    const mockWebhook = {
      _id: 'webhook123',
      url: 'https://example.com/webhook',
      secret: 'test-secret',
      headers: { 'X-Custom': 'value' },
      maxRetries: 3
    };

    const mockPayload = {
      event: 'issue.created',
      data: { id: 'issue123', title: 'Test Issue' }
    };

    // Helper to setup HTTP mock for a test
    const setupHttpMock = (responseData, statusCode = 200) => {
      mockResponse.statusCode = statusCode;
      
      const requestHandler = (options, callback) => {
        callback(mockResponse);
        // Emit response data after callback
        setImmediate(() => {
          if (responseData instanceof Error) {
            mockResponse.emit('error', responseData);
          } else {
            mockResponse.emit('data', typeof responseData === 'string' ? responseData : JSON.stringify(responseData));
            mockResponse.emit('end');
          }
        });
        return mockRequest;
      };

      https.request.mockImplementation(requestHandler);
      http.request.mockImplementation(requestHandler);
    };

    it('should successfully deliver webhook', async () => {
      setupHttpMock({ success: true });

      const result = await service.deliverWebhook(mockWebhook, mockPayload);

      expect(result.success).toBe(true);
      expect(result.statusCode).toBe(200);
      expect(result.deliveryId).toMatch(/^delivery_\d+_[a-f0-9]+$/);
      expect(https.request).toHaveBeenCalledWith(
        expect.objectContaining({
          hostname: 'example.com',
          port: 443,
          path: '/webhook',
          method: 'POST',
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            'User-Agent': 'Test-Agent/1.0',
            'X-Huly-Webhook-Id': 'webhook123',
            'X-Huly-Webhook-Event': 'issue.created',
            'X-Custom': 'value'
          })
        }),
        expect.any(Function)
      );
      expect(mockRequest.write).toHaveBeenCalledWith(JSON.stringify(mockPayload));
      expect(mockRequest.end).toHaveBeenCalled();
    });

    it('should handle HTTP (non-HTTPS) webhooks', async () => {
      const httpWebhook = { ...mockWebhook, url: 'http://example.com/webhook' };
      setupHttpMock({ success: true });

      await service.deliverWebhook(httpWebhook, mockPayload);

      expect(http.request).toHaveBeenCalledWith(
        expect.objectContaining({
          hostname: 'example.com',
          port: 80,
          protocol: 'http:'
        }),
        expect.any(Function)
      );
    });

    it('should include HMAC signature when secret is provided', async () => {
      setupHttpMock({ success: true });

      await service.deliverWebhook(mockWebhook, mockPayload);

      const requestOptions = https.request.mock.calls[0][0];
      expect(requestOptions.headers['X-Huly-Webhook-Signature']).toBeDefined();
      expect(requestOptions.headers['X-Huly-Webhook-Signature']).toMatch(/^sha256=[a-f0-9]{64}$/);
    });

    it('should handle delivery failure with retryable error', async () => {
      setupHttpMock('Service Unavailable', 503);

      const result = await service.deliverWebhook(mockWebhook, mockPayload);

      expect(result.success).toBe(false);
      expect(result.statusCode).toBe(503);
      expect(result.retryable).toBe(true);
      expect(result.error).toBe('HTTP 503: Service Unavailable');
    });

    it('should handle delivery failure with non-retryable error', async () => {
      setupHttpMock('Not Found', 404);

      const result = await service.deliverWebhook(mockWebhook, mockPayload);

      expect(result.success).toBe(false);
      expect(result.statusCode).toBe(404);
      expect(result.retryable).toBe(false);
      expect(result.error).toBe('HTTP 404: Not Found');
    });

    it('should handle request timeout', async () => {
      const requestHandler = (options, callback) => {
        callback(mockResponse);
        setImmediate(() => {
          mockRequest.emit('timeout');
        });
        return mockRequest;
      };

      https.request.mockImplementation(requestHandler);

      const result = await service.deliverWebhook(mockWebhook, mockPayload);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Request timeout');
      expect(mockRequest.destroy).toHaveBeenCalled();
    });

    it('should handle network error', async () => {
      const requestHandler = (options, callback) => {
        callback(mockResponse);
        setImmediate(() => {
          mockRequest.emit('error', new Error('ECONNREFUSED'));
        });
        return mockRequest;
      };

      https.request.mockImplementation(requestHandler);

      const result = await service.deliverWebhook(mockWebhook, mockPayload);

      expect(result.success).toBe(false);
      expect(result.error).toBe('ECONNREFUSED');
    });

    it('should handle response size limit', async () => {
      service.maxPayloadSize = 10; // Set very small limit
      
      const requestHandler = (options, callback) => {
        callback(mockResponse);
        setImmediate(() => {
          mockResponse.emit('data', 'This is a very long response that exceeds the limit');
        });
        return mockRequest;
      };

      https.request.mockImplementation(requestHandler);

      const result = await service.deliverWebhook(mockWebhook, mockPayload);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Response size exceeds limit');
      expect(mockRequest.destroy).toHaveBeenCalled();
    });

    it('should update statistics on success', async () => {
      setupHttpMock({ success: true });

      await service.deliverWebhook(mockWebhook, mockPayload);

      expect(service.stats.totalDeliveries).toBe(1);
      expect(service.stats.succeeded).toBe(1);
      expect(service.stats.failed).toBe(0);
      expect(service.stats.responseTimes).toHaveLength(1);
      expect(service.stats.lastDelivery).toBeInstanceOf(Date);
    });

    it('should update statistics on failure', async () => {
      setupHttpMock('Internal Server Error', 500);

      await service.deliverWebhook(mockWebhook, mockPayload);

      expect(service.stats.totalDeliveries).toBe(1);
      expect(service.stats.succeeded).toBe(0);
      expect(service.stats.failed).toBe(1);
      expect(service.stats.errorCounts.HTTP_500).toBe(1);
      expect(service.stats.recentErrors).toHaveLength(1);
    });

    it('should store delivery attempt in database', async () => {
      setupHttpMock({ success: true });

      await service.deliverWebhook(mockWebhook, mockPayload);

      expect(mockDatabaseService.create).toHaveBeenCalledWith(
        'webhook_deliveries',
        expect.objectContaining({
          webhookId: 'webhook123',
          eventType: 'issue.created',
          url: 'https://example.com/webhook',
          payload: mockPayload,
          success: true,
          statusCode: 200,
          attempt: 1
        })
      );
    });

    it('should track active deliveries', async () => {
      expect(service.activeDeliveries.size).toBe(0);
      
      setupHttpMock({ success: true });
      
      const deliveryPromise = service.deliverWebhook(mockWebhook, mockPayload);

      // Check that delivery is tracked while in progress
      expect(service.activeDeliveries.size).toBe(1);
      expect(service.stats.processing).toBe(1);

      await deliveryPromise;

      // Check that delivery is no longer tracked after completion
      expect(service.activeDeliveries.size).toBe(0);
      expect(service.stats.processing).toBe(0);
    });
  });

  describe('prepareRequest', () => {
    it('should prepare HTTPS request options', () => {
      const webhook = {
        _id: 'webhook123',
        url: 'https://example.com:8443/webhook?param=value',
        headers: { 'X-Custom': 'value' },
        secret: 'test-secret'
      };
      const payload = { event: 'test.event', data: {} };

      const options = service.prepareRequest(webhook, payload);

      expect(options.hostname).toBe('example.com');
      expect(options.port).toBe('8443');
      expect(options.path).toBe('/webhook?param=value');
      expect(options.method).toBe('POST');
      expect(options.protocol).toBe('https:');
      expect(options.timeout).toBe(30000);
      expect(options.headers).toMatchObject({
        'Content-Type': 'application/json',
        'User-Agent': 'Test-Agent/1.0',
        'X-Huly-Webhook-Id': 'webhook123',
        'X-Huly-Webhook-Event': 'test.event',
        'X-Custom': 'value',
        'X-Huly-Webhook-Signature': expect.stringMatching(/^sha256=[a-f0-9]{64}$/)
      });
      expect(options.headers['X-Huly-Webhook-Timestamp']).toBeDefined();
    });

    it('should use default ports when not specified', () => {
      const httpsWebhook = { _id: '1', url: 'https://example.com/webhook', headers: {} };
      const httpWebhook = { _id: '2', url: 'http://example.com/webhook', headers: {} };
      const payload = { event: 'test', data: {} };

      const httpsOptions = service.prepareRequest(httpsWebhook, payload);
      const httpOptions = service.prepareRequest(httpWebhook, payload);

      expect(httpsOptions.port).toBe(443);
      expect(httpOptions.port).toBe(80);
    });

    it('should not include signature when secret is not provided', () => {
      const webhook = {
        _id: 'webhook123',
        url: 'https://example.com/webhook',
        headers: {}
        // No secret
      };
      const payload = { event: 'test', data: {} };

      const options = service.prepareRequest(webhook, payload);

      expect(options.headers['X-Huly-Webhook-Signature']).toBeUndefined();
    });
  });

  describe('generateSignature', () => {
    it('should generate valid HMAC SHA256 signature', () => {
      const payload = JSON.stringify({ event: 'test', data: { id: '123' } });
      const secret = 'test-secret';

      const signature = service.generateSignature(payload, secret);

      expect(signature).toMatch(/^sha256=[a-f0-9]{64}$/);

      // Verify signature is consistent
      const signature2 = service.generateSignature(payload, secret);
      expect(signature2).toBe(signature);

      // Verify signature changes with different payload
      const signature3 = service.generateSignature('different-payload', secret);
      expect(signature3).not.toBe(signature);
    });
  });

  describe('isRetryableError', () => {
    it('should identify retryable status codes', () => {
      const retryableCodes = [408, 429, 500, 502, 503, 504, 507, 509, 510];
      
      retryableCodes.forEach(code => {
        expect(service.isRetryableError(code)).toBe(true);
      });
    });

    it('should identify non-retryable status codes', () => {
      const nonRetryableCodes = [200, 201, 204, 400, 401, 403, 404, 405, 409, 410];
      
      nonRetryableCodes.forEach(code => {
        expect(service.isRetryableError(code)).toBe(false);
      });
    });
  });

  describe('calculateRetryDelay', () => {
    let originalRandom;
    
    beforeEach(() => {
      // Mock Math.random for consistent tests
      originalRandom = Math.random;
      Math.random = jest.fn().mockReturnValue(0.5);
    });

    afterEach(() => {
      Math.random = originalRandom;
    });

    it('should calculate exponential backoff with jitter', () => {
      // First attempt: base delay + jitter
      const delay1 = service.calculateRetryDelay(1);
      expect(delay1).toBe(1000 + 500); // baseDelay * 2^0 + jitter(0.5 * 1000)

      // Second attempt: base * 2 + jitter
      const delay2 = service.calculateRetryDelay(2);
      expect(delay2).toBe(2000 + 500); // baseDelay * 2^1 + jitter

      // Third attempt: base * 4 + jitter
      const delay3 = service.calculateRetryDelay(3);
      expect(delay3).toBe(4000 + 500); // baseDelay * 2^2 + jitter
    });

    it('should not exceed max retry delay', () => {
      // Very high attempt number
      const delay = service.calculateRetryDelay(20);
      expect(delay).toBeLessThanOrEqual(service.maxRetryDelay);
    });

    it('should add random jitter', () => {
      Math.random = jest.fn().mockReturnValue(0);
      const delayMin = service.calculateRetryDelay(1);
      
      Math.random = jest.fn().mockReturnValue(0.99);
      const delayMax = service.calculateRetryDelay(1);

      expect(delayMax - delayMin).toBeCloseTo(service.maxJitter * 0.99, 0);
    });
  });

  describe('testWebhook', () => {
    const mockWebhook = {
      _id: 'webhook123',
      url: 'https://example.com/webhook'
    };

    const setupHttpMock = (responseData, statusCode = 200) => {
      mockResponse.statusCode = statusCode;
      
      const requestHandler = (options, callback) => {
        callback(mockResponse);
        setImmediate(() => {
          mockResponse.emit('data', typeof responseData === 'string' ? responseData : JSON.stringify(responseData));
          mockResponse.emit('end');
        });
        return mockRequest;
      };

      https.request.mockImplementation(requestHandler);
    };

    it('should send test payload and return success', async () => {
      setupHttpMock({ success: true });

      const result = await service.testWebhook(mockWebhook, 'test.event', { custom: 'data' });

      expect(result.success).toBe(true);
      expect(result.statusCode).toBe(200);
      expect(result.message).toBe('Test successful');
      expect(result.details).toBeDefined();

      // Verify test payload structure
      const sentPayload = JSON.parse(mockRequest.write.mock.calls[0][0]);
      expect(sentPayload).toMatchObject({
        id: expect.stringMatching(/^test_\d+$/),
        event: 'test.event',
        timestamp: expect.any(String),
        version: '1.0',
        source: {
          service: 'huly-webhook-service',
          test: true
        },
        data: { custom: 'data' }
      });
    });

    it('should use default test data when not provided', async () => {
      setupHttpMock({ success: true });

      await service.testWebhook(mockWebhook, 'test.event');

      const sentPayload = JSON.parse(mockRequest.write.mock.calls[0][0]);
      expect(sentPayload.data).toEqual({
        id: 'test-id',
        type: 'test',
        operation: 'test'
      });
    });

    it('should return failure result on error', async () => {
      setupHttpMock('Internal Server Error', 500);

      const result = await service.testWebhook(mockWebhook, 'test.event');

      expect(result.success).toBe(false);
      expect(result.statusCode).toBe(500);
      expect(result.message).toBe('Test failed: HTTP 500: Internal Server Error');
    });
  });

  describe('statistics methods', () => {
    beforeEach(() => {
      // Populate some test statistics
      service.stats = {
        pending: 5,
        processing: 2,
        failed: 10,
        succeeded: 90,
        totalDeliveries: 100,
        responseTimes: [100, 200, 150, 175, 125],
        errorCounts: { HTTP_500: 5, HTTP_503: 3, UNKNOWN: 2 },
        recentErrors: [
          { timestamp: new Date(), error: 'Test error', statusCode: 500, attempt: 1 }
        ],
        lastDelivery: new Date()
      };
    });

    describe('getStats', () => {
      it('should return basic statistics', async () => {
        const stats = await service.getStats();

        expect(stats).toEqual({
          pending: 5,
          processing: 2,
          failed: 10,
          succeeded: 90
        });
      });
    });

    describe('getDetailedStats', () => {
      it('should return detailed statistics', async () => {
        const stats = await service.getDetailedStats({});

        expect(stats).toEqual({
          totalDeliveries: 100,
          successRate: 0.9,
          failureRate: 0.1,
          averageResponseTime: 150
        });
      });

      it('should handle empty response times', async () => {
        service.stats.responseTimes = [];
        
        const stats = await service.getDetailedStats({});

        expect(stats.averageResponseTime).toBe(0);
      });
    });

    describe('getPerformanceStats', () => {
      it('should calculate performance metrics for given period', async () => {
        jest.spyOn(Date, 'now').mockReturnValue(3600000); // 1 hour in ms
        
        const stats = await service.getPerformanceStats('1h');

        expect(stats).toEqual({
          deliveriesPerSecond: 100 / 3600, // 100 deliveries in 1 hour
          averageLatency: 150,
          errorRate: 1 / 100 // 1 recent error out of 100 deliveries
        });
      });

      it('should parse different period formats', () => {
        expect(service.parsePeriod('30s')).toBe(30000);
        expect(service.parsePeriod('5m')).toBe(300000);
        expect(service.parsePeriod('2h')).toBe(7200000);
        expect(service.parsePeriod('1d')).toBe(86400000);
        expect(service.parsePeriod('invalid')).toBe(3600000); // Default
      });
    });

    describe('getHealthStats', () => {
      it('should report healthy when failure rate is low', async () => {
        // Set a failure rate below 10%
        service.stats.failed = 5;
        service.stats.succeeded = 95;
        
        const stats = await service.getHealthStats();

        expect(stats.healthy).toBe(true);
        expect(stats.queueDepth).toBe(5);
        expect(stats.failureRate).toBe(0.05);
        expect(stats.lastDelivery).toBeInstanceOf(Date);
      });

      it('should report unhealthy when failure rate is high', async () => {
        service.stats.failed = 20;
        service.stats.succeeded = 80;
        
        const stats = await service.getHealthStats();

        expect(stats.healthy).toBe(false);
        expect(stats.failureRate).toBe(0.2);
      });
    });

    describe('getErrorStats', () => {
      it('should return error statistics', async () => {
        // Add more recent errors
        for (let i = 0; i < 60; i++) {
          service.stats.recentErrors.push({
            timestamp: new Date(),
            error: `Error ${i}`,
            statusCode: 500,
            attempt: 1
          });
        }

        const stats = await service.getErrorStats({});

        expect(stats.recentErrors).toHaveLength(50); // Returns last 50
        expect(stats.errorsByType).toEqual({
          HTTP_500: 5,
          HTTP_503: 3,
          UNKNOWN: 2
        });
        expect(stats.errorRate).toBe(0.1);
      });
    });
  });

  describe('getWebhookDeliveries', () => {
    it('should retrieve deliveries with filters', async () => {
      const mockDeliveries = [
        { _id: '1', webhookId: 'webhook123', eventType: 'issue.created', success: true },
        { _id: '2', webhookId: 'webhook123', eventType: 'issue.updated', success: false }
      ];
      mockDatabaseService.findMany.mockResolvedValue(mockDeliveries);

      const deliveries = await service.getWebhookDeliveries('webhook123', {
        eventType: 'issue.created',
        success: true,
        limit: 50,
        skip: 0
      });

      expect(mockDatabaseService.findMany).toHaveBeenCalledWith(
        'webhook_deliveries',
        {
          webhookId: 'webhook123',
          eventType: 'issue.created',
          success: true
        },
        {
          limit: 50,
          skip: 0,
          sort: { timestamp: -1 }
        }
      );
      expect(deliveries).toEqual(mockDeliveries);
    });

    it('should use default values when query params not provided', async () => {
      await service.getWebhookDeliveries('webhook123', {});

      expect(mockDatabaseService.findMany).toHaveBeenCalledWith(
        'webhook_deliveries',
        { webhookId: 'webhook123' },
        {
          limit: 100,
          skip: 0,
          sort: { timestamp: -1 }
        }
      );
    });

    it('should handle database errors gracefully', async () => {
      mockDatabaseService.findMany.mockRejectedValue(new Error('Database error'));

      const deliveries = await service.getWebhookDeliveries('webhook123', {});

      expect(deliveries).toEqual([]);
    });
  });

  describe('replayDelivery', () => {
    const setupHttpMock = (responseData, statusCode = 200) => {
      mockResponse.statusCode = statusCode;
      
      const requestHandler = (options, callback) => {
        callback(mockResponse);
        setImmediate(() => {
          mockResponse.emit('data', typeof responseData === 'string' ? responseData : JSON.stringify(responseData));
          mockResponse.emit('end');
        });
        return mockRequest;
      };

      https.request.mockImplementation(requestHandler);
    };

    it('should successfully replay a delivery', async () => {
      const mockDelivery = {
        _id: 'delivery123',
        webhookId: 'webhook123',
        payload: { event: 'issue.created', data: { id: '123' } },
        result: { deliveryId: 'original_delivery_123' }
      };
      const mockWebhook = {
        _id: 'webhook123',
        url: 'https://example.com/webhook'
      };

      mockDatabaseService.findOne
        .mockResolvedValueOnce(mockDelivery) // Find delivery
        .mockResolvedValueOnce(mockWebhook); // Find webhook

      setupHttpMock({ success: true });

      const result = await service.replayDelivery('original_delivery_123');

      expect(result.success).toBe(true);
      expect(result.message).toBe('Delivery replayed successfully');
      expect(result.result).toBeDefined();
    });

    it('should handle delivery not found', async () => {
      mockDatabaseService.findOne.mockResolvedValue(null);

      const result = await service.replayDelivery('nonexistent_delivery');

      expect(result.success).toBe(false);
      expect(result.message).toBe('Replay failed: Delivery not found');
    });

    it('should handle webhook not found', async () => {
      const mockDelivery = {
        _id: 'delivery123',
        webhookId: 'webhook123',
        payload: { event: 'test' },
        result: { deliveryId: 'original_delivery_123' }
      };

      mockDatabaseService.findOne
        .mockResolvedValueOnce(mockDelivery) // Find delivery
        .mockResolvedValueOnce(null); // Webhook not found

      const result = await service.replayDelivery('original_delivery_123');

      expect(result.success).toBe(false);
      expect(result.message).toBe('Replay failed: Webhook not found');
    });

    it('should handle replay failure', async () => {
      const mockDelivery = {
        _id: 'delivery123',
        webhookId: 'webhook123',
        payload: { event: 'test' },
        result: { deliveryId: 'original_delivery_123' }
      };
      const mockWebhook = {
        _id: 'webhook123',
        url: 'https://example.com/webhook'
      };

      mockDatabaseService.findOne
        .mockResolvedValueOnce(mockDelivery)
        .mockResolvedValueOnce(mockWebhook);

      setupHttpMock('Internal Server Error', 500);

      const result = await service.replayDelivery('original_delivery_123');

      expect(result.success).toBe(false);
      expect(result.message).toMatch(/Replay failed: HTTP 500/);
    });
  });

  describe('edge cases and error handling', () => {
    it('should handle malformed URLs gracefully', async () => {
      const webhook = {
        _id: 'webhook123',
        url: 'not-a-valid-url',
        headers: {}
      };
      const payload = { event: 'test' };

      const result = await service.deliverWebhook(webhook, payload);
      
      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid URL');
    });

    it('should limit response times array size', async () => {
      // Add more than 1000 response times
      for (let i = 0; i < 1100; i++) {
        service.updateStats({ success: true }, 100);
      }

      expect(service.stats.responseTimes).toHaveLength(1000);
      expect(service.stats.totalDeliveries).toBe(1100);
    });

    it('should limit recent errors array size', async () => {
      // Add more than 100 errors
      for (let i = 0; i < 110; i++) {
        service.updateStats({ 
          success: false, 
          error: `Error ${i}`,
          statusCode: 500,
          attempt: 1
        }, 100);
      }

      expect(service.stats.recentErrors).toHaveLength(100);
    });

    it('should handle response stream errors', async () => {
      const webhook = {
        _id: 'webhook123',
        url: 'https://example.com/webhook'
      };
      const payload = { event: 'test' };

      const requestHandler = (options, callback) => {
        callback(mockResponse);
        setImmediate(() => {
          mockResponse.emit('error', new Error('Stream error'));
        });
        return mockRequest;
      };

      https.request.mockImplementation(requestHandler);

      const result = await service.deliverWebhook(webhook, payload);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Stream error');
    });

    it('should generate unique delivery IDs', () => {
      const ids = new Set();
      
      for (let i = 0; i < 1000; i++) {
        ids.add(service.generateDeliveryId());
      }

      expect(ids.size).toBe(1000); // All IDs should be unique
    });

    it('should handle database errors when storing delivery attempts', async () => {
      mockDatabaseService.create.mockRejectedValue(new Error('Database error'));

      const webhook = {
        _id: 'webhook123',
        url: 'https://example.com/webhook'
      };
      const payload = { event: 'test' };

      const requestHandler = (options, callback) => {
        callback(mockResponse);
        setImmediate(() => {
          mockResponse.emit('data', '{"success": true}');
          mockResponse.emit('end');
        });
        return mockRequest;
      };

      https.request.mockImplementation(requestHandler);

      const result = await service.deliverWebhook(webhook, payload);

      // Should still return success even if database storage fails
      expect(result.success).toBe(true);
    });
  });

  describe('concurrent deliveries', () => {
    it('should track multiple concurrent deliveries', async () => {
      const webhooks = [
        { _id: 'webhook1', url: 'https://example1.com/webhook' },
        { _id: 'webhook2', url: 'https://example2.com/webhook' },
        { _id: 'webhook3', url: 'https://example3.com/webhook' }
      ];
      const payload = { event: 'test' };

      const requestHandler = (options, callback) => {
        callback(mockResponse);
        // Don't emit end immediately to keep requests pending
        return mockRequest;
      };

      https.request.mockImplementation(requestHandler);

      // Start multiple deliveries
      const promises = webhooks.map(webhook => 
        service.deliverWebhook(webhook, payload)
      );

      // All should be processing
      expect(service.activeDeliveries.size).toBe(3);
      expect(service.stats.processing).toBe(3);

      // Complete all deliveries
      setImmediate(() => {
        mockResponse.emit('data', '{"success": true}');
        mockResponse.emit('end');
      });

      await Promise.all(promises);

      // All should be completed
      expect(service.activeDeliveries.size).toBe(0);
      expect(service.stats.processing).toBe(0);
    });
  });

  describe('getStatusMessage', () => {
    it('should return correct status messages', () => {
      expect(service.getStatusMessage(200)).toBe('OK');
      expect(service.getStatusMessage(404)).toBe('Not Found');
      expect(service.getStatusMessage(500)).toBe('Internal Server Error');
      expect(service.getStatusMessage(999)).toBe('Unknown Status');
    });
  });
});