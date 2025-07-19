/**
 * Unit tests for health check routes
 */

// Mock dependencies first before requiring modules
jest.mock('../../../src/utils/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
  timeStart: jest.fn(() => ({
    end: jest.fn(() => 100) // Return a mock duration
  }))
}));

jest.mock('../../../src/config', () => ({
  env: 'test',
  app: {
    name: 'test-service'
  },
  server: {
    port: 3456
  },
  logging: {
    level: 'info'
  },
  dlq: {
    enabled: true
  },
  metrics: {
    enabled: true
  }
}));

jest.mock('../../../../package.json', () => ({
  version: '1.0.0'
}), { virtual: true });

jest.mock('../../../src/middleware/errorHandler', () => ({
  asyncHandler: (fn) => (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  }
}));

// Now require modules after all mocks
const express = require('express');
const request = require('supertest');
const healthRouter = require('../../../src/routes/health');
const logger = require('../../../src/utils/logger');

describe('Health Routes', () => {
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
      database: {
        ping: jest.fn(),
        getInfo: jest.fn(),
        isConnectedToDatabase: jest.fn()
      },
      changeStream: {
        isActive: jest.fn(),
        getStats: jest.fn(),
        getStatus: jest.fn()
      },
      webhook: {
        getActiveWebhookCount: jest.fn()
      },
      delivery: {
        getStats: jest.fn()
      }
    };
    
    // Set services in app.locals
    app.locals.services = mockServices;
    
    // Mount routes
    app.use('/api/health', healthRouter);
    
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

  describe('GET /api/health', () => {
    test('should return healthy status when all services are up', async () => {
      mockServices.database.ping.mockResolvedValue(true);
      mockServices.changeStream.isActive.mockReturnValue(true);
      mockServices.delivery.getStats.mockResolvedValue({
        pending: 0,
        processing: 0,
        failed: 0
      });
      
      const response = await request(app)
        .get('/api/health')
        .expect(200);

      expect(response.body).toMatchObject({
        status: 'healthy',
        timestamp: expect.any(String),
        version: '1.0.0',
        environment: 'test',
        uptime: expect.any(Number),
        memory: expect.objectContaining({
          rss: expect.any(Number),
          heapTotal: expect.any(Number),
          heapUsed: expect.any(Number)
        }),
        services: {
          mongodb: 'connected',
          changeStreams: 'active',
          webhookService: 'active',
          deliveryService: 'active',
          deliveryStats: {
            pending: 0,
            processing: 0,
            failed: 0
          }
        }
      });
    });

    test('should return degraded status when database is down', async () => {
      mockServices.database.ping.mockRejectedValue(new Error('Connection failed'));
      mockServices.changeStream.isActive.mockReturnValue(true);
      
      const response = await request(app)
        .get('/api/health')
        .expect(200);

      expect(response.body.status).toBe('degraded');
      expect(response.body.services.mongodb).toBe('disconnected');
      expect(logger.warn).toHaveBeenCalledWith(
        'Database health check failed:',
        'Connection failed'
      );
    });

    test('should handle missing database service', async () => {
      app.locals.services.database = null;
      
      const response = await request(app)
        .get('/api/health')
        .expect(200);

      expect(response.body.status).toBe('degraded');
      expect(response.body.services.mongodb).toBe('not_initialized');
    });

    test('should handle change stream inactive', async () => {
      mockServices.database.ping.mockResolvedValue(true);
      mockServices.changeStream.isActive.mockReturnValue(false);
      
      const response = await request(app)
        .get('/api/health')
        .expect(200);

      expect(response.body.status).toBe('degraded');
      expect(response.body.services.changeStreams).toBe('inactive');
    });

    test('should handle missing change stream service', async () => {
      mockServices.database.ping.mockResolvedValue(true);
      app.locals.services.changeStream = null;
      
      const response = await request(app)
        .get('/api/health')
        .expect(200);

      expect(response.body.services.changeStreams).toBe('not_initialized');
    });

    test('should handle database getInfo error', async () => {
      mockServices.database.ping.mockResolvedValue(true);
      mockServices.database.getInfo.mockRejectedValue(new Error('Info error'));
      mockServices.changeStream.isActive.mockReturnValue(true);
      
      const response = await request(app)
        .get('/api/health')
        .expect(200);

      expect(response.body.status).toBe('healthy');
      expect(response.body.services.mongodb).toBe('connected');
    });

    test('should return degraded when critical services are down', async () => {
      mockServices.database.ping.mockRejectedValue(new Error('DB down'));
      mockServices.changeStream.isActive.mockReturnValue(false);
      app.locals.services.webhook = null;
      app.locals.services.delivery = null;
      
      const response = await request(app)
        .get('/api/health')
        .expect(200);

      expect(response.body.status).toBe('degraded');
      expect(response.body.services).toMatchObject({
        mongodb: 'disconnected',
        changeStreams: 'inactive',
        webhookService: 'not_initialized',
        deliveryService: 'not_initialized'
      });
    });

    test('should handle missing webhook service', async () => {
      mockServices.database.ping.mockResolvedValue(true);
      mockServices.changeStream.isActive.mockReturnValue(true);
      app.locals.services.webhook = null;
      
      const response = await request(app)
        .get('/api/health')
        .expect(200);

      expect(response.body.status).toBe('degraded');
      expect(response.body.services.webhookService).toBe('not_initialized');
    });

    test('should handle missing delivery service', async () => {
      mockServices.database.ping.mockResolvedValue(true);
      mockServices.changeStream.isActive.mockReturnValue(true);
      app.locals.services.delivery = null;
      
      const response = await request(app)
        .get('/api/health')
        .expect(200);

      expect(response.body.status).toBe('degraded');
      expect(response.body.services.deliveryService).toBe('not_initialized');
    });

    test('should handle delivery service getStats error', async () => {
      mockServices.database.ping.mockResolvedValue(true);
      mockServices.changeStream.isActive.mockReturnValue(true);
      mockServices.webhook = { };
      mockServices.delivery = {
        getStats: jest.fn().mockRejectedValue(new Error('Stats error'))
      };
      
      const response = await request(app)
        .get('/api/health')
        .expect(200);

      // Should still report service as active, just without stats
      expect(response.body.services.deliveryService).toBe('active');
      expect(response.body.services.deliveryStats).toBeUndefined();
      expect(logger.debug).toHaveBeenCalledWith('Could not get delivery stats:', 'Stats error');
    });

    test('should handle complete health check failure', async () => {
      // Make all services throw errors to test the health check's error handling
      app.locals.services = null;
      
      const response = await request(app)
        .get('/api/health')
        .expect(200);

      // When services are null, all checks fail but route still returns degraded status
      expect(response.body).toMatchObject({
        status: 'degraded',
        timestamp: expect.any(String),
        version: '1.0.0',
        services: {
          mongodb: 'not_initialized',
          changeStreams: 'not_initialized',
          webhookService: 'not_initialized',
          deliveryService: 'not_initialized'
        }
      });
    });
  });

  describe('GET /api/health/live', () => {
    test('should return 200 OK for liveness check', async () => {
      const response = await request(app)
        .get('/api/health/live')
        .expect(200);

      expect(response.body).toEqual({
        alive: true,
        timestamp: expect.any(String),
        uptime: expect.any(Number)
      });
    });

    test('should include uptime in liveness response', async () => {
      const response = await request(app)
        .get('/api/health/live')
        .expect(200);

      expect(response.body.uptime).toBeGreaterThan(0);
      expect(response.body.uptime).toBeLessThan(process.uptime() + 1);
    });
  });

  describe('GET /api/health/ready', () => {
    test('should return ready when all services are initialized', async () => {
      mockServices.database.ping.mockResolvedValue(true);
      mockServices.changeStream.isActive.mockReturnValue(true);
      
      const response = await request(app)
        .get('/api/health/ready')
        .expect(200);

      expect(response.body).toMatchObject({
        ready: true,
        timestamp: expect.any(String),
        checks: expect.arrayContaining([
          expect.objectContaining({ service: 'database', ready: true }),
          expect.objectContaining({ service: 'changeStreams', ready: true })
        ])
      });
    });

    test('should return not ready when database is not connected', async () => {
      mockServices.database.ping.mockRejectedValue(new Error('Not connected'));
      mockServices.changeStream.isActive.mockReturnValue(true);
      
      const response = await request(app)
        .get('/api/health/ready')
        .expect(503);

      expect(response.body).toMatchObject({
        ready: false,
        timestamp: expect.any(String),
        checks: expect.arrayContaining([
          expect.objectContaining({ service: 'database', ready: false })
        ])
      });
    });

    test('should return not ready when change streams are not active', async () => {
      mockServices.database.ping.mockResolvedValue(true);
      mockServices.changeStream.isActive.mockReturnValue(false);
      
      const response = await request(app)
        .get('/api/health/ready')
        .expect(503);

      expect(response.body).toMatchObject({
        ready: false,
        timestamp: expect.any(String),
        checks: expect.arrayContaining([
          expect.objectContaining({ service: 'changeStreams', ready: false })
        ])
      });
    });

    test('should handle database ping error in ready check', async () => {
      mockServices.database.ping.mockRejectedValue(new Error('Connection refused'));
      mockServices.changeStream.isActive.mockReturnValue(true);
      
      const response = await request(app)
        .get('/api/health/ready')
        .expect(503);

      expect(response.body).toMatchObject({
        ready: false,
        timestamp: expect.any(String),
        checks: [
          { service: 'database', ready: false, error: 'Connection refused' },
          { service: 'changeStreams', ready: true }
        ]
      });
    });

    test('should handle missing database service in ready check', async () => {
      app.locals.services.database = null;
      mockServices.changeStream.isActive.mockReturnValue(true);
      
      const response = await request(app)
        .get('/api/health/ready')
        .expect(503);

      expect(response.body).toMatchObject({
        ready: false,
        timestamp: expect.any(String),
        checks: [
          { service: 'database', ready: false, error: 'Not initialized' },
          { service: 'changeStreams', ready: true }
        ]
      });
    });

    test('should handle missing change stream service in ready check', async () => {
      mockServices.database.ping.mockResolvedValue(true);
      app.locals.services.changeStream = null;
      
      const response = await request(app)
        .get('/api/health/ready')
        .expect(503);

      expect(response.body).toMatchObject({
        ready: false,
        timestamp: expect.any(String),
        checks: [
          { service: 'database', ready: true },
          { service: 'changeStreams', ready: false }
        ]
      });
    });

    test('should handle unexpected error in ready check', async () => {
      // Make services null to trigger the error handling path
      app.locals.services = null;
      
      const response = await request(app)
        .get('/api/health/ready')
        .expect(503);

      expect(response.body).toMatchObject({
        ready: false,
        timestamp: expect.any(String),
        checks: [
          { service: 'database', ready: false, error: 'Not initialized' },
          { service: 'changeStreams', ready: false }
        ]
      });
    });
  });

  describe('GET /api/health/detailed', () => {
    test('should return detailed health information when all services are healthy', async () => {
      // Mock all service methods
      mockServices.database.ping.mockResolvedValue(true);
      mockServices.database.getInfo.mockResolvedValue({
        database: 'test_db',
        collections: 5,
        dataSize: 1000000
      });
      
      mockServices.changeStream.isActive.mockReturnValue(true);
      mockServices.changeStream.getStatus.mockReturnValue({
        eventsReceived: 1000,
        eventsProcessed: 950,
        lastEventTime: new Date().toISOString()
      });
      
      // Add webhook service mocks
      mockServices.webhook = {
        getActiveWebhookCount: jest.fn().mockResolvedValue(10)
      };
      
      // Add delivery service mocks
      mockServices.delivery = {
        getStats: jest.fn().mockResolvedValue({
          pending: 10,
          processing: 2,
          failed: 5,
          success: 1000
        })
      };
      
      const response = await request(app)
        .get('/api/health/detailed')
        .expect(200);

      expect(response.body).toMatchObject({
        status: 'healthy',
        timestamp: expect.any(String),
        version: '1.0.0',
        environment: 'test',
        node: {
          version: expect.any(String),
          uptime: expect.any(Number),
          memory: expect.any(Object),
          cpu: expect.any(Object)
        },
        configuration: {
          port: expect.any(Number),
          logLevel: expect.any(String),
          rateLimitEnabled: true,
          dlqEnabled: expect.any(Boolean),
          metricsEnabled: expect.any(Boolean)
        },
        services: {
          mongodb: {
            status: 'connected',
            database: 'test_db',
            collections: 5,
            dataSize: 1000000
          },
          changeStreams: {
            status: 'active',
            eventsReceived: 1000,
            eventsProcessed: 950,
            lastEventTime: expect.any(String)
          },
          webhookService: {
            status: 'active',
            activeWebhooks: 10
          },
          deliveryService: {
            status: 'active',
            pending: 10,
            processing: 2,
            failed: 5,
            success: 1000
          }
        },
        checks: [
          {
            name: 'database',
            status: 'pass',
            responseTime: expect.any(Number)
          },
          {
            name: 'changeStreams',
            status: 'pass',
            message: 'Active and monitoring'
          },
          {
            name: 'webhookService',
            status: 'pass',
            message: '10 active webhooks'
          },
          {
            name: 'deliveryService',
            status: 'pass',
            message: '10 pending, 2 processing'
          }
        ]
      });
    });

    test('should handle database ping failure in detailed check', async () => {
      mockServices.database.ping.mockRejectedValue(new Error('Connection timeout'));
      mockServices.changeStream.isActive.mockReturnValue(true);
      mockServices.changeStream.getStatus.mockReturnValue({ active: true });
      
      const response = await request(app)
        .get('/api/health/detailed')
        .expect(200);

      expect(response.body.status).toBe('degraded');
      expect(response.body.services.mongodb).toMatchObject({
        status: 'error',
        error: 'Connection timeout'
      });
      expect(response.body.checks).toContainEqual({
        name: 'database',
        status: 'fail',
        message: 'Connection timeout'
      });
    });

    test('should handle database getInfo error', async () => {
      mockServices.database.ping.mockResolvedValue(true);
      mockServices.database.getInfo.mockRejectedValue(new Error('Permission denied'));
      mockServices.changeStream.isActive.mockReturnValue(true);
      mockServices.changeStream.getStatus.mockReturnValue({ active: true });
      
      const response = await request(app)
        .get('/api/health/detailed')
        .expect(200);

      // When getInfo fails, the entire database health check is marked as error
      expect(response.body.status).toBe('degraded');
      expect(response.body.services.mongodb).toEqual({
        status: 'error',
        error: 'Permission denied'
      });
      expect(response.body.checks[0]).toEqual({
        name: 'database',
        status: 'fail',
        message: 'Permission denied'
      });
    });

    test('should handle missing database service in detailed check', async () => {
      app.locals.services.database = null;
      
      const response = await request(app)
        .get('/api/health/detailed')
        .expect(200);

      expect(response.body.status).toBe('degraded');
      expect(response.body.services.mongodb).toEqual({ status: 'not_initialized' });
      expect(response.body.checks).toContainEqual({
        name: 'database',
        status: 'fail',
        message: 'Database service not initialized'
      });
    });

    test('should handle change stream inactive in detailed check', async () => {
      mockServices.database.ping.mockResolvedValue(true);
      mockServices.database.getInfo.mockResolvedValue({ database: 'test' });
      mockServices.changeStream.isActive.mockReturnValue(false);
      mockServices.changeStream.getStatus.mockReturnValue({ 
        active: false,
        reason: 'Not started'
      });
      
      const response = await request(app)
        .get('/api/health/detailed')
        .expect(200);

      expect(response.body.status).toBe('degraded');
      expect(response.body.services.changeStreams).toMatchObject({
        status: 'inactive',
        active: false,
        reason: 'Not started'
      });
      expect(response.body.checks).toContainEqual({
        name: 'changeStreams',
        status: 'warn',
        message: 'Not active'
      });
    });

    test('should handle missing change stream service in detailed check', async () => {
      mockServices.database.ping.mockResolvedValue(true);
      app.locals.services.changeStream = null;
      
      const response = await request(app)
        .get('/api/health/detailed')
        .expect(200);

      expect(response.body.status).toBe('degraded');
      expect(response.body.services.changeStreams).toEqual({ status: 'not_initialized' });
      expect(response.body.checks).toContainEqual({
        name: 'changeStreams',
        status: 'fail',
        message: 'Change stream service not initialized'
      });
    });

    test('should handle change stream getStatus error', async () => {
      mockServices.database.ping.mockResolvedValue(true);
      mockServices.changeStream.isActive.mockReturnValue(true);
      mockServices.changeStream.getStatus.mockImplementation(() => {
        throw new Error('Status unavailable');
      });
      
      const response = await request(app)
        .get('/api/health/detailed')
        .expect(200);

      expect(response.body.status).toBe('degraded');
      expect(response.body.services.changeStreams).toMatchObject({
        status: 'error',
        error: 'Status unavailable'
      });
      expect(response.body.checks).toContainEqual({
        name: 'changeStreams',
        status: 'fail',
        message: 'Status unavailable'
      });
    });

    test('should handle missing webhook service in detailed check', async () => {
      mockServices.database.ping.mockResolvedValue(true);
      mockServices.changeStream.isActive.mockReturnValue(true);
      app.locals.services.webhook = null;
      
      const response = await request(app)
        .get('/api/health/detailed')
        .expect(200);

      expect(response.body.status).toBe('degraded');
      expect(response.body.services.webhookService).toEqual({ status: 'not_initialized' });
      expect(response.body.checks).toContainEqual({
        name: 'webhookService',
        status: 'fail',
        message: 'Webhook service not initialized'
      });
    });

    test('should handle webhook service error in detailed check', async () => {
      mockServices.database.ping.mockResolvedValue(true);
      mockServices.changeStream.isActive.mockReturnValue(true);
      mockServices.webhook = {
        getActiveWebhookCount: jest.fn().mockRejectedValue(new Error('Database query failed'))
      };
      
      const response = await request(app)
        .get('/api/health/detailed')
        .expect(200);

      expect(response.body.status).toBe('degraded');
      expect(response.body.services.webhookService).toMatchObject({
        status: 'error',
        error: 'Database query failed'
      });
      expect(response.body.checks).toContainEqual({
        name: 'webhookService',
        status: 'fail',
        message: 'Database query failed'
      });
    });

    test('should handle missing delivery service in detailed check', async () => {
      mockServices.database.ping.mockResolvedValue(true);
      mockServices.changeStream.isActive.mockReturnValue(true);
      app.locals.services.delivery = null;
      
      const response = await request(app)
        .get('/api/health/detailed')
        .expect(200);

      expect(response.body.status).toBe('degraded');
      expect(response.body.services.deliveryService).toEqual({ status: 'not_initialized' });
      expect(response.body.checks).toContainEqual({
        name: 'deliveryService',
        status: 'fail',
        message: 'Delivery service not initialized'
      });
    });

    test('should handle delivery service error in detailed check', async () => {
      mockServices.database.ping.mockResolvedValue(true);
      mockServices.changeStream.isActive.mockReturnValue(true);
      mockServices.delivery = {
        getStats: jest.fn().mockRejectedValue(new Error('Stats calculation failed'))
      };
      
      const response = await request(app)
        .get('/api/health/detailed')
        .expect(200);

      expect(response.body.status).toBe('degraded');
      expect(response.body.services.deliveryService).toMatchObject({
        status: 'error',
        error: 'Stats calculation failed'
      });
      expect(response.body.checks).toContainEqual({
        name: 'deliveryService',
        status: 'fail',
        message: 'Stats calculation failed'
      });
    });

    test('should handle multiple service failures', async () => {
      mockServices.database.ping.mockRejectedValue(new Error('DB down'));
      mockServices.changeStream.isActive.mockReturnValue(false);
      app.locals.services.webhook = null;
      app.locals.services.delivery = null;
      
      const response = await request(app)
        .get('/api/health/detailed')
        .expect(200);

      expect(response.body.status).toBe('degraded');
      expect(response.body.services.mongodb.status).toBe('error');
      expect(response.body.services.changeStreams.status).toBe('inactive');
      expect(response.body.services.webhookService.status).toBe('not_initialized');
      expect(response.body.services.deliveryService.status).toBe('not_initialized');
      
      // Should have 4 failed checks
      const failedChecks = response.body.checks.filter(check => 
        check.status === 'fail' || check.status === 'warn'
      );
      expect(failedChecks).toHaveLength(4);
    });

    test('should handle unexpected error in detailed health check', async () => {
      // Make all services null to test the degraded status
      app.locals.services = null;
      
      const response = await request(app)
        .get('/api/health/detailed')
        .expect(200);

      expect(response.body).toMatchObject({
        status: 'degraded',
        timestamp: expect.any(String),
        version: '1.0.0',
        services: {
          mongodb: { status: 'not_initialized' },
          changeStreams: { status: 'not_initialized' },
          webhookService: { status: 'not_initialized' },
          deliveryService: { status: 'not_initialized' }
        }
      });
    });

    test('should time detailed health check execution', async () => {
      const mockTimer = { end: jest.fn().mockReturnValue(150) };
      logger.timeStart.mockReturnValue(mockTimer);
      
      mockServices.database.ping.mockResolvedValue(true);
      mockServices.database.getInfo.mockResolvedValue({ database: 'test' });
      
      await request(app)
        .get('/api/health/detailed')
        .expect(200);

      expect(logger.timeStart).toHaveBeenCalledWith('detailed-health-check');
      expect(logger.timeStart).toHaveBeenCalledWith('db-health-check');
      expect(mockTimer.end).toHaveBeenCalledWith('Detailed health check completed');
    });
  });

  describe('Error handling', () => {
    test('should handle unexpected errors in health check', async () => {
      // The health route catches errors and returns degraded status
      mockServices.database.ping.mockImplementation(() => {
        throw new Error('Unexpected error');
      });
      
      const response = await request(app)
        .get('/api/health')
        .expect(200);

      expect(response.body.status).toBe('degraded');
      expect(response.body.services.mongodb).toBe('disconnected');
      expect(logger.warn).toHaveBeenCalledWith(
        'Database health check failed:',
        'Unexpected error'
      );
    });

    test('should time health checks', async () => {
      const mockTimer = { end: jest.fn() };
      logger.timeStart.mockReturnValue(mockTimer);
      
      await request(app)
        .get('/api/health')
        .expect(200);

      expect(logger.timeStart).toHaveBeenCalledWith('health-check');
      expect(mockTimer.end).toHaveBeenCalled();
    });
  });

  describe('Process metrics', () => {
    test('should include process metrics in health response', async () => {
      const response = await request(app)
        .get('/api/health')
        .expect(200);

      expect(response.body.memory).toMatchObject({
        rss: expect.any(Number),
        heapTotal: expect.any(Number),
        heapUsed: expect.any(Number),
        external: expect.any(Number)
      });
      
      expect(response.body.uptime).toBeGreaterThan(0);
    });
  });
});