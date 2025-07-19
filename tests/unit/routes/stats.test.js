/**
 * Unit tests for stats routes
 */

const express = require('express');
const request = require('supertest');
const statsRouter = require('../../../src/routes/stats');

// Mock dependencies
jest.mock('../../../src/utils/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
  timeStart: jest.fn(() => ({
    end: jest.fn(() => 100)
  }))
}));

jest.mock('../../../src/config', () => ({
  env: 'test'
}));

jest.mock('../../../src/middleware/errorHandler', () => ({
  asyncHandler: (fn) => (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  },
  handleValidationError: (result) => {
    if (result.error) {
      const error = new Error(result.error.details.map(d => d.message).join(', '));
      error.name = 'ValidationError';
      error.details = result.error.details;
      throw error;
    }
    return result.value;
  }
}));

const logger = require('../../../src/utils/logger');

describe('Stats Routes', () => {
  let app;
  let mockServices;

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Reset the timer mock to ensure it returns the proper structure
    logger.timeStart.mockReturnValue({
      end: jest.fn(() => 100)
    });
    
    // Create Express app
    app = express();
    app.use(express.json());
    
    // Create mock services
    mockServices = {
      webhook: {
        getStats: jest.fn(),
        getDetailedStats: jest.fn(),
        getActiveWebhookCount: jest.fn()
      },
      delivery: {
        getStats: jest.fn(),
        getDetailedStats: jest.fn(),
        getPerformanceStats: jest.fn(),
        getErrorStats: jest.fn(),
        getHealthStats: jest.fn()
      },
      changeStream: {
        getPerformanceStats: jest.fn(),
        getEventStats: jest.fn(),
        getStatus: jest.fn()
      }
    };
    
    // Set services in app.locals
    app.locals.services = mockServices;
    
    // Mount routes
    app.use('/api/stats', statsRouter);
    
    // Add error handler
    app.use((err, req, res, next) => {
      // If it's a validation error from Joi
      if (err.name === 'ValidationError' || err.details) {
        return res.status(400).json({
          error: err.message || 'Validation failed'
        });
      }
      
      res.status(err.statusCode || 500).json({
        error: err.message || 'Internal Server Error'
      });
    });
  });

  describe('GET /api/stats', () => {
    test('should return overall statistics', async () => {
      const webhookStats = {
        total: 10,
        active: 8,
        inactive: 2
      };
      
      const deliveryStats = {
        total: 1000,
        success: 950,
        failed: 50,
        pending: 0
      };
      
      mockServices.webhook.getStats.mockResolvedValue(webhookStats);
      mockServices.delivery.getStats.mockResolvedValue(deliveryStats);
      
      const response = await request(app)
        .get('/api/stats')
        .expect(200);

      expect(response.body).toMatchObject({
        stats: {
          webhooks: webhookStats,
          deliveries: deliveryStats,
          system: {
            uptime: expect.any(Number),
            memory: expect.any(Object),
            timestamp: expect.any(String)
          }
        },
        query: {
          period: 'day',
          timezone: 'UTC'
        },
        timestamp: expect.any(String)
      });
      
      expect(mockServices.webhook.getStats).toHaveBeenCalled();
      expect(mockServices.delivery.getStats).toHaveBeenCalledWith('day');
    });

    test('should accept period and timezone parameters', async () => {
      mockServices.webhook.getStats.mockResolvedValue({});
      mockServices.delivery.getStats.mockResolvedValue({});
      
      const response = await request(app)
        .get('/api/stats')
        .query({ period: 'week', timezone: 'America/New_York' })
        .expect(200);

      expect(response.body.query).toEqual({
        period: 'week',
        timezone: 'America/New_York'
      });
      
      expect(mockServices.delivery.getStats).toHaveBeenCalledWith('week');
    });

    test('should validate period parameter', async () => {
      const response = await request(app)
        .get('/api/stats')
        .query({ period: 'invalid' })
        .expect(400);

      expect(response.body.error).toContain('must be one of');
    });

    test('should handle service errors', async () => {
      mockServices.webhook.getStats.mockRejectedValue(new Error('Database error'));
      
      const response = await request(app)
        .get('/api/stats')
        .expect(500);

      expect(response.body.error).toBe('Database error');
    });

    test('should handle delivery service error', async () => {
      mockServices.webhook.getStats.mockResolvedValue({});
      mockServices.delivery.getStats.mockRejectedValue(new Error('Delivery stats error'));
      
      const response = await request(app)
        .get('/api/stats')
        .expect(500);

      expect(response.body.error).toBe('Delivery stats error');
    });
  });

  describe('GET /api/stats/webhooks', () => {
    test('should return detailed webhook statistics', async () => {
      const detailedStats = {
        total: 10,
        byStatus: {
          active: 8,
          inactive: 2
        },
        byEvent: {
          'issue.created': 5,
          'issue.updated': 3,
          'project.created': 2
        }
      };
      
      mockServices.webhook.getDetailedStats.mockResolvedValue(detailedStats);
      
      const response = await request(app)
        .get('/api/stats/webhooks')
        .expect(200);

      expect(response.body).toMatchObject({
        stats: detailedStats,
        query: {
          includeInactive: false,
          groupBy: 'status'
        },
        timestamp: expect.any(String)
      });
    });

    test('should accept query parameters', async () => {
      mockServices.webhook.getDetailedStats.mockResolvedValue({});
      
      const response = await request(app)
        .get('/api/stats/webhooks')
        .query({ includeInactive: true, groupBy: 'event' })
        .expect(200);

      expect(mockServices.webhook.getDetailedStats).toHaveBeenCalledWith({
        includeInactive: true,
        groupBy: 'event'
      });
    });

    test('should validate groupBy parameter', async () => {
      const response = await request(app)
        .get('/api/stats/webhooks')
        .query({ groupBy: 'invalid' })
        .expect(400);

      expect(response.body.error).toContain('must be one of');
    });

    test('should handle webhook service error', async () => {
      mockServices.webhook.getDetailedStats.mockRejectedValue(new Error('Webhook stats error'));
      
      const response = await request(app)
        .get('/api/stats/webhooks')
        .expect(500);

      expect(response.body.error).toBe('Webhook stats error');
    });
  });

  describe('GET /api/stats/deliveries', () => {
    test('should return detailed delivery statistics', async () => {
      const detailedStats = {
        total: 1000,
        byStatus: {
          success: 950,
          failed: 50,
          pending: 0
        },
        avgResponseTime: 250,
        p95ResponseTime: 500
      };
      
      mockServices.delivery.getDetailedStats.mockResolvedValue(detailedStats);
      
      const response = await request(app)
        .get('/api/stats/deliveries')
        .expect(200);

      expect(response.body).toMatchObject({
        stats: detailedStats,
        query: {
          period: 'day',
          groupBy: 'status'
        },
        timestamp: expect.any(String)
      });
    });

    test('should accept multiple query parameters', async () => {
      mockServices.delivery.getDetailedStats.mockResolvedValue({});
      
      const query = {
        period: 'week',
        webhookId: 'webhook-123',
        eventType: 'issue.created',
        status: 'failed',
        groupBy: 'webhook'
      };
      
      const response = await request(app)
        .get('/api/stats/deliveries')
        .query(query)
        .expect(200);

      expect(mockServices.delivery.getDetailedStats).toHaveBeenCalledWith(query);
    });

    test('should validate status parameter', async () => {
      const response = await request(app)
        .get('/api/stats/deliveries')
        .query({ status: 'invalid' })
        .expect(400);

      expect(response.body.error).toContain('must be one of');
    });

    test('should handle delivery service error', async () => {
      mockServices.delivery.getDetailedStats.mockRejectedValue(new Error('Delivery stats error'));
      
      const response = await request(app)
        .get('/api/stats/deliveries')
        .expect(500);

      expect(response.body.error).toBe('Delivery stats error');
    });
  });

  describe('GET /api/stats/performance', () => {
    test('should return performance metrics', async () => {
      const deliveryPerf = {
        avgResponseTime: 250,
        p50: 200,
        p95: 500,
        p99: 1000,
        throughput: 100
      };
      
      const changeStreamPerf = {
        eventsProcessed: 5000,
        avgProcessingTime: 10,
        lag: 50
      };
      
      mockServices.delivery.getPerformanceStats.mockResolvedValue(deliveryPerf);
      mockServices.changeStream.getPerformanceStats.mockResolvedValue(changeStreamPerf);
      
      const response = await request(app)
        .get('/api/stats/performance')
        .expect(200);

      expect(response.body).toMatchObject({
        performance: {
          delivery: deliveryPerf,
          changeStream: changeStreamPerf,
          system: {
            uptime: expect.any(Number),
            memory: expect.any(Object),
            cpu: expect.any(Object)
          }
        },
        query: {
          period: 'hour',
          includePercentiles: true
        },
        timestamp: expect.any(String)
      });
    });

    test('should handle missing changeStream service', async () => {
      app.locals.services.changeStream = null;
      mockServices.delivery.getPerformanceStats.mockResolvedValue({});
      
      const response = await request(app)
        .get('/api/stats/performance')
        .expect(200);

      expect(response.body.performance.changeStream).toBeNull();
    });

    test('should accept query parameters', async () => {
      mockServices.delivery.getPerformanceStats.mockResolvedValue({});
      
      const response = await request(app)
        .get('/api/stats/performance')
        .query({ period: 'day', includePercentiles: false })
        .expect(200);

      expect(mockServices.delivery.getPerformanceStats).toHaveBeenCalledWith('day');
      expect(response.body.query.includePercentiles).toBe(false);
    });

    test('should handle delivery performance stats error', async () => {
      mockServices.delivery.getPerformanceStats.mockRejectedValue(new Error('Performance error'));
      mockServices.changeStream.getPerformanceStats.mockResolvedValue({});
      
      const response = await request(app)
        .get('/api/stats/performance')
        .expect(500);

      expect(response.body.error).toBe('Performance error');
    });

    test('should handle changeStream performance stats error', async () => {
      mockServices.delivery.getPerformanceStats.mockResolvedValue({});
      mockServices.changeStream.getPerformanceStats.mockRejectedValue(new Error('ChangeStream perf error'));
      
      const response = await request(app)
        .get('/api/stats/performance')
        .expect(500);

      expect(response.body.error).toBe('ChangeStream perf error');
    });
  });

  describe('GET /api/stats/events', () => {
    test('should return event processing statistics', async () => {
      const eventStats = {
        total: 10000,
        byType: {
          'issue.created': 4000,
          'issue.updated': 3000,
          'project.created': 2000,
          'user.created': 1000
        },
        byCollection: {
          issues: 7000,
          projects: 2000,
          users: 1000
        }
      };
      
      mockServices.changeStream.getEventStats.mockResolvedValue(eventStats);
      
      const response = await request(app)
        .get('/api/stats/events')
        .expect(200);

      expect(response.body).toMatchObject({
        stats: eventStats,
        query: {
          period: 'day'
        },
        timestamp: expect.any(String)
      });
    });

    test('should handle missing changeStream service', async () => {
      app.locals.services.changeStream = null;
      
      const response = await request(app)
        .get('/api/stats/events')
        .expect(200);

      expect(response.body.stats).toEqual({
        message: 'Change stream service not available'
      });
    });

    test('should accept filter parameters', async () => {
      mockServices.changeStream.getEventStats.mockResolvedValue({});
      
      const query = {
        period: 'week',
        eventType: 'issue.created',
        collection: 'issues'
      };
      
      const response = await request(app)
        .get('/api/stats/events')
        .query(query)
        .expect(200);

      expect(mockServices.changeStream.getEventStats).toHaveBeenCalledWith(query);
    });

    test('should handle changeStream getEventStats error', async () => {
      mockServices.changeStream.getEventStats.mockRejectedValue(new Error('Event stats error'));
      
      const response = await request(app)
        .get('/api/stats/events')
        .expect(500);

      expect(response.body.error).toBe('Event stats error');
    });
  });

  describe('GET /api/stats/errors', () => {
    test('should return error statistics', async () => {
      const errorStats = {
        total: 50,
        byType: {
          network: 20,
          timeout: 15,
          validation: 10,
          server: 5
        },
        recentErrors: [
          {
            timestamp: new Date().toISOString(),
            type: 'network',
            message: 'Connection refused',
            webhookId: 'webhook-123'
          }
        ]
      };
      
      mockServices.delivery.getErrorStats.mockResolvedValue(errorStats);
      
      const response = await request(app)
        .get('/api/stats/errors')
        .expect(200);

      expect(response.body).toMatchObject({
        errors: errorStats,
        query: {
          period: 'day',
          limit: 20,
          severity: 'error'
        },
        timestamp: expect.any(String)
      });
    });

    test('should accept query parameters', async () => {
      mockServices.delivery.getErrorStats.mockResolvedValue({});
      
      const query = {
        period: 'hour',
        limit: 50,
        severity: 'warn'
      };
      
      const response = await request(app)
        .get('/api/stats/errors')
        .query(query)
        .expect(200);

      expect(mockServices.delivery.getErrorStats).toHaveBeenCalledWith(query);
    });

    test('should validate limit parameter', async () => {
      const response = await request(app)
        .get('/api/stats/errors')
        .query({ limit: 200 })
        .expect(400);

      expect(response.body.error).toContain('must be less than or equal to 100');
    });

    test('should handle delivery getErrorStats error', async () => {
      mockServices.delivery.getErrorStats.mockRejectedValue(new Error('Error stats failed'));
      
      const response = await request(app)
        .get('/api/stats/errors')
        .expect(500);

      expect(response.body.error).toBe('Error stats failed');
    });
  });

  describe('GET /api/stats/health-summary', () => {
    test('should return health summary', async () => {
      mockServices.webhook.getActiveWebhookCount.mockResolvedValue(8);
      mockServices.delivery.getHealthStats.mockResolvedValue({
        successRate: 0.95,
        failureRate: 0.05,
        avgResponseTime: 250
      });
      mockServices.changeStream.getStatus.mockResolvedValue({
        active: true,
        eventsProcessed: 10000
      });
      
      const response = await request(app)
        .get('/api/stats/health-summary')
        .expect(200);

      expect(response.body).toMatchObject({
        webhooks: {
          active: 8,
          healthy: true
        },
        deliveries: {
          successRate: 0.95,
          failureRate: 0.05,
          avgResponseTime: 250
        },
        changeStreams: {
          active: true,
          eventsProcessed: 10000
        },
        overall: {
          status: 'healthy',
          timestamp: expect.any(String)
        }
      });
    });

    test('should mark as degraded when failure rate is high', async () => {
      mockServices.webhook.getActiveWebhookCount.mockResolvedValue(8);
      mockServices.delivery.getHealthStats.mockResolvedValue({
        failureRate: 0.15 // 15% failure rate
      });
      mockServices.changeStream.getStatus.mockResolvedValue({
        active: true
      });
      
      const response = await request(app)
        .get('/api/stats/health-summary')
        .expect(200);

      expect(response.body.overall.status).toBe('degraded');
    });

    test('should mark as degraded when change streams inactive', async () => {
      mockServices.webhook.getActiveWebhookCount.mockResolvedValue(8);
      mockServices.delivery.getHealthStats.mockResolvedValue({
        failureRate: 0.05
      });
      mockServices.changeStream.getStatus.mockResolvedValue({
        active: false
      });
      
      const response = await request(app)
        .get('/api/stats/health-summary')
        .expect(200);

      expect(response.body.overall.status).toBe('degraded');
    });

    test('should handle missing changeStream service', async () => {
      app.locals.services.changeStream = null;
      mockServices.webhook.getActiveWebhookCount.mockResolvedValue(8);
      mockServices.delivery.getHealthStats.mockResolvedValue({
        failureRate: 0.05
      });
      
      const response = await request(app)
        .get('/api/stats/health-summary')
        .expect(200);

      expect(response.body.changeStreams).toBeNull();
      expect(response.body.overall.status).toBe('degraded');
    });

    test('should handle webhook service error in health-summary', async () => {
      mockServices.webhook.getActiveWebhookCount.mockRejectedValue(new Error('Webhook count error'));
      mockServices.delivery.getHealthStats.mockResolvedValue({ failureRate: 0.05 });
      mockServices.changeStream.getStatus.mockResolvedValue({ active: true });
      
      const response = await request(app)
        .get('/api/stats/health-summary')
        .expect(500);

      expect(response.body.error).toBe('Webhook count error');
    });

    test('should handle delivery service error in health-summary', async () => {
      mockServices.webhook.getActiveWebhookCount.mockResolvedValue(8);
      mockServices.delivery.getHealthStats.mockRejectedValue(new Error('Health stats error'));
      mockServices.changeStream.getStatus.mockResolvedValue({ active: true });
      
      const response = await request(app)
        .get('/api/stats/health-summary')
        .expect(500);

      expect(response.body.error).toBe('Health stats error');
    });

    test('should handle changeStream service error in health-summary', async () => {
      mockServices.webhook.getActiveWebhookCount.mockResolvedValue(8);
      mockServices.delivery.getHealthStats.mockResolvedValue({ failureRate: 0.05 });
      mockServices.changeStream.getStatus.mockRejectedValue(new Error('Status error'));
      
      const response = await request(app)
        .get('/api/stats/health-summary')
        .expect(500);

      expect(response.body.error).toBe('Status error');
    });
  });

  describe('Error handling', () => {
    test('should handle async errors', async () => {
      mockServices.webhook.getStats.mockRejectedValue(new Error('Async error'));
      
      const response = await request(app)
        .get('/api/stats')
        .expect(500);

      expect(response.body.error).toBe('Async error');
    });

    test('should time all requests', async () => {
      const mockTimer = { end: jest.fn() };
      logger.timeStart.mockReturnValue(mockTimer);
      
      mockServices.webhook.getStats.mockResolvedValue({});
      mockServices.delivery.getStats.mockResolvedValue({});
      
      await request(app)
        .get('/api/stats')
        .expect(200);

      expect(logger.timeStart).toHaveBeenCalledWith('get-stats');
      expect(mockTimer.end).toHaveBeenCalledWith('Statistics retrieved');
    });
  });
});