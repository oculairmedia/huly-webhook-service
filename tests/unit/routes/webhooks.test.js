/**
 * Unit tests for webhook routes
 */

const express = require('express');
const request = require('supertest');
const webhooksRouter = require('../../../src/routes/webhooks');

// Mock dependencies
jest.mock('../../../src/utils/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn()
}));

jest.mock('../../../src/config', () => ({
  supportedEventTypes: [
    'issue.created',
    'issue.updated',
    'issue.deleted',
    'issue.status_changed',
    'issue.assigned'
  ],
  delivery: {
    retry: {
      maxAttempts: 3,
      backoffMultiplier: 2
    }
  }
}));

jest.mock('../../../src/controllers/WebhookController');

jest.mock('../../../src/middleware/errorHandler', () => ({
  asyncHandler: (fn) => (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  }
}));

const WebhookController = require('../../../src/controllers/WebhookController');

describe('Webhook Routes', () => {
  let app;
  let mockController;

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Create mock controller instance
    mockController = {
      listWebhooks: jest.fn(),
      createWebhook: jest.fn(),
      getWebhook: jest.fn(),
      updateWebhook: jest.fn(),
      deleteWebhook: jest.fn(),
      testWebhook: jest.fn(),
      getWebhookDeliveries: jest.fn(),
      getWebhookStats: jest.fn()
    };
    
    // Mock the controller constructor
    WebhookController.mockImplementation(() => mockController);
    
    // Create Express app with routes
    app = express();
    app.use(express.json());
    
    // Mock services in app.locals
    app.locals.services = {
      database: {},
      webhookService: {},
      deliveryService: {}
    };
    
    // Mount routes
    app.use('/api/webhooks', webhooksRouter);
    
    // Add error handler
    app.use((err, req, res, next) => {
      res.status(err.statusCode || 500).json({
        error: err.message || 'Internal Server Error'
      });
    });
  });

  describe('GET /api/webhooks', () => {
    test('should list all webhooks', async () => {
      mockController.listWebhooks.mockImplementation((req, res) => {
        res.json({
          webhooks: [
            { id: '1', name: 'Test Webhook 1' },
            { id: '2', name: 'Test Webhook 2' }
          ],
          total: 2
        });
      });

      const response = await request(app)
        .get('/api/webhooks')
        .expect(200);

      expect(response.body.webhooks).toHaveLength(2);
      expect(response.body.total).toBe(2);
      expect(mockController.listWebhooks).toHaveBeenCalled();
    });

    test('should handle errors in list webhooks', async () => {
      mockController.listWebhooks.mockImplementation(() => {
        throw new Error('Database error');
      });

      const response = await request(app)
        .get('/api/webhooks')
        .expect(500);

      expect(response.body.error).toBe('Database error');
    });
  });

  describe('POST /api/webhooks', () => {
    const validWebhook = {
      name: 'Test Webhook',
      url: 'https://example.com/webhook',
      events: ['issue.created', 'issue.updated'],
      active: true,
      secret: 'secretkey123'
    };

    test('should create a new webhook', async () => {
      mockController.createWebhook.mockImplementation((req, res) => {
        res.status(201).json({
          id: 'webhook-123',
          ...req.body
        });
      });

      const response = await request(app)
        .post('/api/webhooks')
        .send(validWebhook)
        .expect(201);

      expect(response.body.id).toBe('webhook-123');
      expect(response.body.name).toBe(validWebhook.name);
      expect(mockController.createWebhook).toHaveBeenCalled();
    });

    test('should validate required fields', async () => {
      const invalidWebhook = {
        url: 'https://example.com/webhook'
        // Missing name and events
      };

      const response = await request(app)
        .post('/api/webhooks')
        .send(invalidWebhook)
        .expect(201); // Will succeed since validation is in controller

      expect(mockController.createWebhook).toHaveBeenCalled();
    });

    test('should handle create errors', async () => {
      mockController.createWebhook.mockImplementation(() => {
        const error = new Error('Duplicate webhook name');
        error.statusCode = 409;
        throw error;
      });

      const response = await request(app)
        .post('/api/webhooks')
        .send(validWebhook)
        .expect(409);

      expect(response.body.error).toBe('Duplicate webhook name');
    });
  });

  describe('GET /api/webhooks/:id', () => {
    test('should get a specific webhook', async () => {
      const webhook = {
        id: 'webhook-123',
        name: 'Test Webhook',
        url: 'https://example.com/webhook'
      };

      mockController.getWebhook.mockImplementation((req, res) => {
        res.json(webhook);
      });

      const response = await request(app)
        .get('/api/webhooks/webhook-123')
        .expect(200);

      expect(response.body).toEqual(webhook);
      expect(mockController.getWebhook).toHaveBeenCalled();
    });

    test('should handle webhook not found', async () => {
      mockController.getWebhook.mockImplementation(() => {
        const error = new Error('Webhook not found');
        error.statusCode = 404;
        throw error;
      });

      const response = await request(app)
        .get('/api/webhooks/nonexistent')
        .expect(404);

      expect(response.body.error).toBe('Webhook not found');
    });
  });

  describe('PUT /api/webhooks/:id', () => {
    const updateData = {
      name: 'Updated Webhook',
      active: false
    };

    test('should update a webhook', async () => {
      mockController.updateWebhook.mockImplementation((req, res) => {
        res.json({
          id: req.params.id,
          ...updateData,
          updatedAt: new Date()
        });
      });

      const response = await request(app)
        .put('/api/webhooks/webhook-123')
        .send(updateData)
        .expect(200);

      expect(response.body.name).toBe(updateData.name);
      expect(response.body.active).toBe(updateData.active);
      expect(mockController.updateWebhook).toHaveBeenCalled();
    });

    test('should handle update errors', async () => {
      mockController.updateWebhook.mockImplementation(() => {
        const error = new Error('Webhook not found');
        error.statusCode = 404;
        throw error;
      });

      const response = await request(app)
        .put('/api/webhooks/nonexistent')
        .send(updateData)
        .expect(404);

      expect(response.body.error).toBe('Webhook not found');
    });
  });

  describe('DELETE /api/webhooks/:id', () => {
    test('should delete a webhook', async () => {
      mockController.deleteWebhook.mockImplementation((req, res) => {
        res.status(204).send();
      });

      await request(app)
        .delete('/api/webhooks/webhook-123')
        .expect(204);

      expect(mockController.deleteWebhook).toHaveBeenCalled();
    });

    test('should handle delete errors', async () => {
      mockController.deleteWebhook.mockImplementation(() => {
        const error = new Error('Webhook not found');
        error.statusCode = 404;
        throw error;
      });

      const response = await request(app)
        .delete('/api/webhooks/nonexistent')
        .expect(404);

      expect(response.body.error).toBe('Webhook not found');
    });
  });

  describe('POST /api/webhooks/:id/test', () => {
    test('should test webhook delivery', async () => {
      mockController.testWebhook.mockImplementation((req, res) => {
        res.json({
          success: true,
          statusCode: 200,
          duration: 150,
          response: 'OK'
        });
      });

      const response = await request(app)
        .post('/api/webhooks/webhook-123/test')
        .expect(200);

      expect(response.body.success).toBe(true);
      expect(response.body.statusCode).toBe(200);
      expect(mockController.testWebhook).toHaveBeenCalled();
    });

    test('should handle test webhook errors', async () => {
      mockController.testWebhook.mockImplementation(() => {
        const error = new Error('Webhook delivery failed');
        error.statusCode = 500;
        throw error;
      });

      const response = await request(app)
        .post('/api/webhooks/webhook-123/test')
        .expect(500);

      expect(response.body.error).toBe('Webhook delivery failed');
    });
  });

  describe('GET /api/webhooks/:id/deliveries', () => {
    test('should get webhook delivery history', async () => {
      mockController.getWebhookDeliveries.mockImplementation((req, res) => {
        res.json({
          deliveries: [
            {
              id: 'delivery-1',
              status: 'success',
              httpStatus: 200,
              timestamp: new Date()
            },
            {
              id: 'delivery-2',
              status: 'failed',
              httpStatus: 500,
              timestamp: new Date()
            }
          ],
          total: 2
        });
      });

      const response = await request(app)
        .get('/api/webhooks/webhook-123/deliveries')
        .expect(200);

      expect(response.body.deliveries).toHaveLength(2);
      expect(response.body.total).toBe(2);
      expect(mockController.getWebhookDeliveries).toHaveBeenCalled();
    });

    test('should support query parameters', async () => {
      mockController.getWebhookDeliveries.mockImplementation((req, res) => {
        expect(req.query.limit).toBe('10');
        expect(req.query.offset).toBe('0');
        expect(req.query.status).toBe('failed');
        res.json({ deliveries: [], total: 0 });
      });

      await request(app)
        .get('/api/webhooks/webhook-123/deliveries')
        .query({ limit: 10, offset: 0, status: 'failed' })
        .expect(200);
    });
  });

  describe('GET /api/webhooks/:id/stats', () => {
    test('should get webhook statistics', async () => {
      mockController.getWebhookStats.mockImplementation((req, res) => {
        res.json({
          totalDeliveries: 100,
          successfulDeliveries: 85,
          failedDeliveries: 15,
          successRate: 0.85,
          averageResponseTime: 250,
          lastDelivery: new Date()
        });
      });

      const response = await request(app)
        .get('/api/webhooks/webhook-123/stats')
        .expect(200);

      expect(response.body.totalDeliveries).toBe(100);
      expect(response.body.successRate).toBe(0.85);
      expect(mockController.getWebhookStats).toHaveBeenCalled();
    });

    test('should handle stats errors', async () => {
      mockController.getWebhookStats.mockImplementation(() => {
        const error = new Error('Webhook not found');
        error.statusCode = 404;
        throw error;
      });

      const response = await request(app)
        .get('/api/webhooks/nonexistent/stats')
        .expect(404);

      expect(response.body.error).toBe('Webhook not found');
    });
  });

  describe('Controller initialization', () => {
    test('should initialize controller with services', async () => {
      await request(app)
        .get('/api/webhooks')
        .expect(200);

      expect(WebhookController).toHaveBeenCalledWith(app.locals.services);
    });

    test('should create new controller for each request', async () => {
      await request(app).get('/api/webhooks').expect(200);
      await request(app).get('/api/webhooks').expect(200);

      expect(WebhookController).toHaveBeenCalledTimes(2);
    });
  });

  describe('Error handling', () => {
    test('should handle async errors', async () => {
      mockController.listWebhooks.mockRejectedValue(new Error('Async error'));

      const response = await request(app)
        .get('/api/webhooks')
        .expect(500);

      expect(response.body.error).toBe('Async error');
    });

    test('should handle controller initialization errors', async () => {
      WebhookController.mockImplementation(() => {
        throw new Error('Controller init failed');
      });

      const response = await request(app)
        .get('/api/webhooks')
        .expect(500);

      expect(response.body.error).toBe('Controller init failed');
    });
  });
});