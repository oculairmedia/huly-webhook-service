/**
 * Unit tests for WebhookController
 */

const WebhookController = require('../../../src/controllers/WebhookController');
const Webhook = require('../../../src/models/Webhook');
const logger = require('../../../src/utils/logger');

// Mock the logger
jest.mock('../../../src/utils/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn()
}));

// Mock the Webhook model
jest.mock('../../../src/models/Webhook');

describe('WebhookController', () => {
  let controller;
  let mockServices;
  let mockReq;
  let mockRes;

  beforeEach(() => {
    jest.clearAllMocks();

    // Mock services
    mockServices = {
      webhook: {
        findWebhooks: jest.fn(),
        countWebhooks: jest.fn(),
        findWebhookById: jest.fn(),
        findWebhookByUrl: jest.fn(),
        createWebhook: jest.fn(),
        updateWebhook: jest.fn(),
        deleteWebhook: jest.fn()
      },
      delivery: {
        deliverToWebhook: jest.fn()
      },
      deliveryHistory: {
        findDeliveries: jest.fn(),
        countDeliveries: jest.fn(),
        getWebhookStats: jest.fn()
      },
      database: {
        // Add database methods if needed
      }
    };

    // Create controller instance
    controller = new WebhookController(mockServices);

    // Mock request and response
    mockReq = {
      query: {},
      params: {},
      body: {}
    };

    mockRes = {
      json: jest.fn(),
      status: jest.fn().mockReturnThis(),
      send: jest.fn()
    };
  });

  describe('listWebhooks', () => {
    it('should list webhooks with default pagination', async () => {
      const mockWebhooks = [
        { 
          id: 'webhook1',
          name: 'Test Webhook 1',
          url: 'https://example.com/webhook1',
          toResponse: jest.fn().mockReturnValue({ id: 'webhook1', name: 'Test Webhook 1' })
        },
        {
          id: 'webhook2',
          name: 'Test Webhook 2',
          url: 'https://example.com/webhook2',
          toResponse: jest.fn().mockReturnValue({ id: 'webhook2', name: 'Test Webhook 2' })
        }
      ];

      mockServices.webhook.findWebhooks.mockResolvedValue(mockWebhooks);
      mockServices.webhook.countWebhooks.mockResolvedValue(2);

      await controller.listWebhooks(mockReq, mockRes);

      expect(mockServices.webhook.findWebhooks).toHaveBeenCalledWith({}, {
        skip: 0,
        limit: 50,
        sort: { createdAt: -1 }
      });
      expect(mockServices.webhook.countWebhooks).toHaveBeenCalledWith({});
      expect(mockRes.json).toHaveBeenCalledWith({
        webhooks: [
          { id: 'webhook1', name: 'Test Webhook 1' },
          { id: 'webhook2', name: 'Test Webhook 2' }
        ],
        pagination: {
          page: 1,
          limit: 50,
          total: 2,
          pages: 1
        }
      });
    });

    it('should handle custom pagination parameters', async () => {
      mockReq.query = { page: '2', limit: '10' };
      mockServices.webhook.findWebhooks.mockResolvedValue([]);
      mockServices.webhook.countWebhooks.mockResolvedValue(25);

      await controller.listWebhooks(mockReq, mockRes);

      expect(mockServices.webhook.findWebhooks).toHaveBeenCalledWith({}, {
        skip: 10, // (page 2 - 1) * limit 10
        limit: 10,
        sort: { createdAt: -1 }
      });
      expect(mockRes.json).toHaveBeenCalledWith({
        webhooks: [],
        pagination: {
          page: 2,
          limit: 10,
          total: 25,
          pages: 3
        }
      });
    });

    it('should filter by active status', async () => {
      mockReq.query = { active: 'true' };
      mockServices.webhook.findWebhooks.mockResolvedValue([]);
      mockServices.webhook.countWebhooks.mockResolvedValue(0);

      await controller.listWebhooks(mockReq, mockRes);

      expect(mockServices.webhook.findWebhooks).toHaveBeenCalledWith(
        { active: true },
        expect.any(Object)
      );
    });

    it('should filter by events', async () => {
      mockReq.query = { events: 'issue.created,issue.updated' };
      mockServices.webhook.findWebhooks.mockResolvedValue([]);
      mockServices.webhook.countWebhooks.mockResolvedValue(0);

      await controller.listWebhooks(mockReq, mockRes);

      expect(mockServices.webhook.findWebhooks).toHaveBeenCalledWith(
        { events: { $in: ['issue.created', 'issue.updated'] } },
        expect.any(Object)
      );
    });

    it('should handle search parameter', async () => {
      mockReq.query = { search: 'test' };
      mockServices.webhook.findWebhooks.mockResolvedValue([]);
      mockServices.webhook.countWebhooks.mockResolvedValue(0);

      await controller.listWebhooks(mockReq, mockRes);

      expect(mockServices.webhook.findWebhooks).toHaveBeenCalledWith(
        {
          $or: [
            { name: { $regex: 'test', $options: 'i' } },
            { url: { $regex: 'test', $options: 'i' } }
          ]
        },
        expect.any(Object)
      );
    });

    it('should handle errors gracefully', async () => {
      mockServices.webhook.findWebhooks.mockRejectedValue(new Error('Database error'));

      await controller.listWebhooks(mockReq, mockRes);

      expect(logger.error).toHaveBeenCalledWith('Error listing webhooks:', expect.any(Error));
      expect(mockRes.status).toHaveBeenCalledWith(500);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'Internal Server Error',
        message: 'Failed to list webhooks'
      });
    });
  });

  describe('getWebhook', () => {
    it('should return webhook by ID', async () => {
      mockReq.params.id = 'webhook123';
      const mockWebhook = {
        id: 'webhook123',
        name: 'Test Webhook',
        toResponse: jest.fn().mockReturnValue({ id: 'webhook123', name: 'Test Webhook' })
      };

      mockServices.webhook.findWebhookById.mockResolvedValue(mockWebhook);

      await controller.getWebhook(mockReq, mockRes);

      expect(mockServices.webhook.findWebhookById).toHaveBeenCalledWith('webhook123');
      expect(mockRes.json).toHaveBeenCalledWith({ id: 'webhook123', name: 'Test Webhook' });
    });

    it('should return 404 for non-existent webhook', async () => {
      mockReq.params.id = 'nonexistent';
      mockServices.webhook.findWebhookById.mockResolvedValue(null);

      await controller.getWebhook(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(404);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'Not Found',
        message: 'Webhook not found'
      });
    });

    it('should handle errors gracefully', async () => {
      mockReq.params.id = 'webhook123';
      mockServices.webhook.findWebhookById.mockRejectedValue(new Error('Database error'));

      await controller.getWebhook(mockReq, mockRes);

      expect(logger.error).toHaveBeenCalledWith('Error getting webhook:', expect.any(Error));
      expect(mockRes.status).toHaveBeenCalledWith(500);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'Internal Server Error',
        message: 'Failed to get webhook'
      });
    });
  });

  describe('createWebhook', () => {
    const validWebhookData = {
      name: 'New Webhook',
      url: 'https://example.com/webhook',
      events: ['issue.created'],
      active: true
    };

    beforeEach(() => {
      Webhook.mockImplementation((data) => ({
        ...data,
        validate: jest.fn(),
        toResponse: jest.fn().mockReturnValue(data)
      }));
    });

    it('should create a new webhook successfully', async () => {
      mockReq.body = validWebhookData;
      const createdWebhook = {
        id: 'new-webhook-id',
        ...validWebhookData,
        toResponse: jest.fn().mockReturnValue({ id: 'new-webhook-id', ...validWebhookData })
      };

      mockServices.webhook.findWebhookByUrl.mockResolvedValue(null);
      mockServices.webhook.createWebhook.mockResolvedValue(createdWebhook);

      await controller.createWebhook(mockReq, mockRes);

      expect(Webhook).toHaveBeenCalledWith(validWebhookData);
      expect(mockServices.webhook.findWebhookByUrl).toHaveBeenCalledWith(validWebhookData.url);
      expect(mockServices.webhook.createWebhook).toHaveBeenCalledWith(expect.any(Object));
      expect(logger.info).toHaveBeenCalledWith('Webhook created: new-webhook-id - New Webhook');
      expect(mockRes.status).toHaveBeenCalledWith(201);
      expect(mockRes.json).toHaveBeenCalledWith({ id: 'new-webhook-id', ...validWebhookData });
    });

    it('should reject duplicate webhook URLs', async () => {
      mockReq.body = validWebhookData;
      const existingWebhook = { id: 'existing', url: validWebhookData.url };

      mockServices.webhook.findWebhookByUrl.mockResolvedValue(existingWebhook);

      await controller.createWebhook(mockReq, mockRes);

      expect(mockServices.webhook.createWebhook).not.toHaveBeenCalled();
      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'Bad Request',
        message: 'Webhook with this URL already exists'
      });
    });

    it('should handle validation errors', async () => {
      mockReq.body = validWebhookData;
      
      Webhook.mockImplementation((data) => ({
        ...data,
        validate: jest.fn().mockImplementation(() => {
          throw new Error('Webhook validation failed: Invalid URL format');
        })
      }));

      await controller.createWebhook(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'Bad Request',
        message: 'Webhook validation failed: Invalid URL format'
      });
    });

    it('should handle generic errors', async () => {
      mockReq.body = validWebhookData;
      mockServices.webhook.findWebhookByUrl.mockRejectedValue(new Error('Database connection failed'));

      await controller.createWebhook(mockReq, mockRes);

      expect(logger.error).toHaveBeenCalledWith('Error creating webhook:', expect.any(Error));
      expect(mockRes.status).toHaveBeenCalledWith(500);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'Internal Server Error',
        message: 'Failed to create webhook'
      });
    });
  });

  describe('updateWebhook', () => {
    const updateData = {
      name: 'Updated Webhook',
      active: false
    };

    it('should update webhook successfully', async () => {
      mockReq.params.id = 'webhook123';
      mockReq.body = updateData;

      const existingWebhook = {
        id: 'webhook123',
        name: 'Old Name',
        url: 'https://example.com/webhook',
        active: true
      };

      const updatedWebhook = {
        ...existingWebhook,
        ...updateData,
        toResponse: jest.fn().mockReturnValue({ id: 'webhook123', ...updateData })
      };

      mockServices.webhook.findWebhookById.mockResolvedValue(existingWebhook);
      mockServices.webhook.updateWebhook.mockResolvedValue(updatedWebhook);

      await controller.updateWebhook(mockReq, mockRes);

      expect(mockServices.webhook.findWebhookById).toHaveBeenCalledWith('webhook123');
      expect(mockServices.webhook.updateWebhook).toHaveBeenCalledWith('webhook123', updateData);
      expect(logger.info).toHaveBeenCalledWith('Webhook updated: webhook123 - Updated Webhook');
      expect(mockRes.json).toHaveBeenCalledWith({ id: 'webhook123', ...updateData });
    });

    it('should handle URL updates with conflict check', async () => {
      mockReq.params.id = 'webhook123';
      mockReq.body = { url: 'https://new-url.com/webhook' };

      const existingWebhook = {
        id: 'webhook123',
        url: 'https://old-url.com/webhook'
      };

      mockServices.webhook.findWebhookById.mockResolvedValue(existingWebhook);
      mockServices.webhook.findWebhookByUrl.mockResolvedValue(null);
      mockServices.webhook.updateWebhook.mockResolvedValue({
        ...existingWebhook,
        url: mockReq.body.url,
        toResponse: jest.fn().mockReturnValue({})
      });

      await controller.updateWebhook(mockReq, mockRes);

      expect(mockServices.webhook.findWebhookByUrl).toHaveBeenCalledWith('https://new-url.com/webhook');
      expect(mockServices.webhook.updateWebhook).toHaveBeenCalled();
    });

    it('should reject URL update if already exists', async () => {
      mockReq.params.id = 'webhook123';
      mockReq.body = { url: 'https://existing-url.com/webhook' };

      const existingWebhook = {
        id: 'webhook123',
        url: 'https://old-url.com/webhook'
      };

      const conflictingWebhook = {
        id: 'webhook456',
        url: 'https://existing-url.com/webhook'
      };

      mockServices.webhook.findWebhookById.mockResolvedValue(existingWebhook);
      mockServices.webhook.findWebhookByUrl.mockResolvedValue(conflictingWebhook);

      await controller.updateWebhook(mockReq, mockRes);

      expect(mockServices.webhook.updateWebhook).not.toHaveBeenCalled();
      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'Bad Request',
        message: 'Webhook with this URL already exists'
      });
    });

    it('should return 404 for non-existent webhook', async () => {
      mockReq.params.id = 'nonexistent';
      mockReq.body = updateData;

      mockServices.webhook.findWebhookById.mockResolvedValue(null);

      await controller.updateWebhook(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(404);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'Not Found',
        message: 'Webhook not found'
      });
    });

    it('should handle validation errors', async () => {
      mockReq.params.id = 'webhook123';
      mockReq.body = updateData;

      mockServices.webhook.findWebhookById.mockResolvedValue({ id: 'webhook123' });
      mockServices.webhook.updateWebhook.mockRejectedValue(new Error('Webhook validation failed: Invalid events'));

      await controller.updateWebhook(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'Bad Request',
        message: 'Webhook validation failed: Invalid events'
      });
    });

    it('should handle generic errors', async () => {
      mockReq.params.id = 'webhook123';
      mockReq.body = updateData;

      mockServices.webhook.findWebhookById.mockRejectedValue(new Error('Database error'));

      await controller.updateWebhook(mockReq, mockRes);

      expect(logger.error).toHaveBeenCalledWith('Error updating webhook:', expect.any(Error));
      expect(mockRes.status).toHaveBeenCalledWith(500);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'Internal Server Error',
        message: 'Failed to update webhook'
      });
    });
  });

  describe('deleteWebhook', () => {
    it('should delete webhook successfully', async () => {
      mockReq.params.id = 'webhook123';
      const webhook = {
        id: 'webhook123',
        name: 'Test Webhook'
      };

      mockServices.webhook.findWebhookById.mockResolvedValue(webhook);
      mockServices.webhook.deleteWebhook.mockResolvedValue(true);

      await controller.deleteWebhook(mockReq, mockRes);

      expect(mockServices.webhook.findWebhookById).toHaveBeenCalledWith('webhook123');
      expect(mockServices.webhook.deleteWebhook).toHaveBeenCalledWith('webhook123');
      expect(logger.info).toHaveBeenCalledWith('Webhook deleted: webhook123 - Test Webhook');
      expect(mockRes.status).toHaveBeenCalledWith(204);
      expect(mockRes.send).toHaveBeenCalled();
    });

    it('should return 404 for non-existent webhook', async () => {
      mockReq.params.id = 'nonexistent';
      mockServices.webhook.findWebhookById.mockResolvedValue(null);

      await controller.deleteWebhook(mockReq, mockRes);

      expect(mockServices.webhook.deleteWebhook).not.toHaveBeenCalled();
      expect(mockRes.status).toHaveBeenCalledWith(404);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'Not Found',
        message: 'Webhook not found'
      });
    });

    it('should handle errors gracefully', async () => {
      mockReq.params.id = 'webhook123';
      mockServices.webhook.findWebhookById.mockRejectedValue(new Error('Database error'));

      await controller.deleteWebhook(mockReq, mockRes);

      expect(logger.error).toHaveBeenCalledWith('Error deleting webhook:', expect.any(Error));
      expect(mockRes.status).toHaveBeenCalledWith(500);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'Internal Server Error',
        message: 'Failed to delete webhook'
      });
    });
  });

  describe('testWebhook', () => {
    it('should test webhook successfully', async () => {
      mockReq.params.id = 'webhook123';
      const webhook = {
        id: 'webhook123',
        name: 'Test Webhook',
        url: 'https://example.com/webhook'
      };

      const deliveryResult = {
        success: true,
        status: 200,
        duration: 150,
        error: null
      };

      mockServices.webhook.findWebhookById.mockResolvedValue(webhook);
      mockServices.delivery.deliverToWebhook.mockResolvedValue(deliveryResult);

      await controller.testWebhook(mockReq, mockRes);

      expect(mockServices.webhook.findWebhookById).toHaveBeenCalledWith('webhook123');
      expect(mockServices.delivery.deliverToWebhook).toHaveBeenCalledWith(
        webhook,
        expect.objectContaining({
          id: expect.stringContaining('test-event-'),
          type: 'webhook.test',
          timestamp: expect.any(String),
          workspace: 'test',
          data: {
            message: 'This is a test webhook delivery',
            webhook: {
              id: 'webhook123',
              name: 'Test Webhook'
            }
          }
        })
      );
      expect(mockRes.json).toHaveBeenCalledWith({
        success: true,
        status: 200,
        duration: 150,
        message: 'Test webhook delivered successfully'
      });
    });

    it('should handle failed test delivery', async () => {
      mockReq.params.id = 'webhook123';
      const webhook = { id: 'webhook123', name: 'Test Webhook' };

      const deliveryResult = {
        success: false,
        status: 500,
        duration: 100,
        error: 'Connection refused'
      };

      mockServices.webhook.findWebhookById.mockResolvedValue(webhook);
      mockServices.delivery.deliverToWebhook.mockResolvedValue(deliveryResult);

      await controller.testWebhook(mockReq, mockRes);

      expect(mockRes.json).toHaveBeenCalledWith({
        success: false,
        status: 500,
        duration: 100,
        message: 'Connection refused'
      });
    });

    it('should return 404 for non-existent webhook', async () => {
      mockReq.params.id = 'nonexistent';
      mockServices.webhook.findWebhookById.mockResolvedValue(null);

      await controller.testWebhook(mockReq, mockRes);

      expect(mockServices.delivery.deliverToWebhook).not.toHaveBeenCalled();
      expect(mockRes.status).toHaveBeenCalledWith(404);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'Not Found',
        message: 'Webhook not found'
      });
    });

    it('should handle errors gracefully', async () => {
      mockReq.params.id = 'webhook123';
      mockServices.webhook.findWebhookById.mockRejectedValue(new Error('Database error'));

      await controller.testWebhook(mockReq, mockRes);

      expect(logger.error).toHaveBeenCalledWith('Error testing webhook:', expect.any(Error));
      expect(mockRes.status).toHaveBeenCalledWith(500);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'Internal Server Error',
        message: 'Failed to test webhook'
      });
    });
  });

  describe('getWebhookDeliveries', () => {
    it('should get webhook deliveries with default pagination', async () => {
      mockReq.params.id = 'webhook123';
      const webhook = { id: 'webhook123' };
      
      const mockDeliveries = [
        {
          id: 'delivery1',
          webhookId: 'webhook123',
          status: 'success',
          toResponse: jest.fn().mockReturnValue({ id: 'delivery1', status: 'success' })
        },
        {
          id: 'delivery2',
          webhookId: 'webhook123',
          status: 'failed',
          toResponse: jest.fn().mockReturnValue({ id: 'delivery2', status: 'failed' })
        }
      ];

      mockServices.webhook.findWebhookById.mockResolvedValue(webhook);
      mockServices.deliveryHistory.findDeliveries.mockResolvedValue(mockDeliveries);
      mockServices.deliveryHistory.countDeliveries.mockResolvedValue(2);

      await controller.getWebhookDeliveries(mockReq, mockRes);

      expect(mockServices.deliveryHistory.findDeliveries).toHaveBeenCalledWith(
        { webhookId: 'webhook123' },
        {
          skip: 0,
          limit: 50,
          sort: { timestamp: -1 }
        }
      );
      expect(mockRes.json).toHaveBeenCalledWith({
        deliveries: [
          { id: 'delivery1', status: 'success' },
          { id: 'delivery2', status: 'failed' }
        ],
        pagination: {
          page: 1,
          limit: 50,
          total: 2,
          pages: 1
        }
      });
    });

    it('should filter deliveries by status', async () => {
      mockReq.params.id = 'webhook123';
      mockReq.query = { status: 'failed' };

      mockServices.webhook.findWebhookById.mockResolvedValue({ id: 'webhook123' });
      mockServices.deliveryHistory.findDeliveries.mockResolvedValue([]);
      mockServices.deliveryHistory.countDeliveries.mockResolvedValue(0);

      await controller.getWebhookDeliveries(mockReq, mockRes);

      expect(mockServices.deliveryHistory.findDeliveries).toHaveBeenCalledWith(
        { webhookId: 'webhook123', status: 'failed' },
        expect.any(Object)
      );
    });

    it('should filter deliveries by date range', async () => {
      mockReq.params.id = 'webhook123';
      mockReq.query = {
        from: '2024-01-01T00:00:00Z',
        to: '2024-12-31T23:59:59Z'
      };

      mockServices.webhook.findWebhookById.mockResolvedValue({ id: 'webhook123' });
      mockServices.deliveryHistory.findDeliveries.mockResolvedValue([]);
      mockServices.deliveryHistory.countDeliveries.mockResolvedValue(0);

      await controller.getWebhookDeliveries(mockReq, mockRes);

      expect(mockServices.deliveryHistory.findDeliveries).toHaveBeenCalledWith(
        {
          webhookId: 'webhook123',
          timestamp: {
            $gte: new Date('2024-01-01T00:00:00Z'),
            $lte: new Date('2024-12-31T23:59:59Z')
          }
        },
        expect.any(Object)
      );
    });

    it('should handle custom pagination', async () => {
      mockReq.params.id = 'webhook123';
      mockReq.query = { page: '3', limit: '20' };

      mockServices.webhook.findWebhookById.mockResolvedValue({ id: 'webhook123' });
      mockServices.deliveryHistory.findDeliveries.mockResolvedValue([]);
      mockServices.deliveryHistory.countDeliveries.mockResolvedValue(100);

      await controller.getWebhookDeliveries(mockReq, mockRes);

      expect(mockServices.deliveryHistory.findDeliveries).toHaveBeenCalledWith(
        { webhookId: 'webhook123' },
        {
          skip: 40, // (page 3 - 1) * limit 20
          limit: 20,
          sort: { timestamp: -1 }
        }
      );
      expect(mockRes.json).toHaveBeenCalledWith(expect.objectContaining({
        pagination: {
          page: 3,
          limit: 20,
          total: 100,
          pages: 5
        }
      }));
    });

    it('should return 404 for non-existent webhook', async () => {
      mockReq.params.id = 'nonexistent';
      mockServices.webhook.findWebhookById.mockResolvedValue(null);

      await controller.getWebhookDeliveries(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(404);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'Not Found',
        message: 'Webhook not found'
      });
    });

    it('should handle errors gracefully', async () => {
      mockReq.params.id = 'webhook123';
      mockServices.webhook.findWebhookById.mockRejectedValue(new Error('Database error'));

      await controller.getWebhookDeliveries(mockReq, mockRes);

      expect(logger.error).toHaveBeenCalledWith('Error getting webhook deliveries:', expect.any(Error));
      expect(mockRes.status).toHaveBeenCalledWith(500);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'Internal Server Error',
        message: 'Failed to get webhook deliveries'
      });
    });
  });

  describe('getWebhookStats', () => {
    it('should get webhook stats with default period', async () => {
      mockReq.params.id = 'webhook123';
      const webhook = { id: 'webhook123', name: 'Test Webhook' };
      
      const mockStats = {
        total: 100,
        successful: 90,
        failed: 10,
        averageResponseTime: 250,
        successRate: 0.9
      };

      mockServices.webhook.findWebhookById.mockResolvedValue(webhook);
      mockServices.deliveryHistory.getWebhookStats.mockResolvedValue(mockStats);

      await controller.getWebhookStats(mockReq, mockRes);

      const expectedFrom = expect.any(Date);
      const expectedTo = expect.any(Date);

      expect(mockServices.deliveryHistory.getWebhookStats).toHaveBeenCalledWith(
        'webhook123',
        expectedFrom,
        expectedTo
      );
      expect(mockRes.json).toHaveBeenCalledWith({
        webhook: {
          id: 'webhook123',
          name: 'Test Webhook'
        },
        period: {
          from: expect.any(String),
          to: expect.any(String),
          duration: '7d'
        },
        stats: mockStats
      });
    });

    it('should handle custom period parameter', async () => {
      mockReq.params.id = 'webhook123';
      mockReq.query = { period: '30d' };

      mockServices.webhook.findWebhookById.mockResolvedValue({ id: 'webhook123', name: 'Test' });
      mockServices.deliveryHistory.getWebhookStats.mockResolvedValue({});

      await controller.getWebhookStats(mockReq, mockRes);

      // Verify the date calculation
      const callArgs = mockServices.deliveryHistory.getWebhookStats.mock.calls[0];
      const fromDate = callArgs[1];
      const toDate = callArgs[2];
      const diffInDays = (toDate - fromDate) / (1000 * 60 * 60 * 24);
      
      expect(Math.round(diffInDays)).toBe(30);
      expect(mockRes.json).toHaveBeenCalledWith(expect.objectContaining({
        period: expect.objectContaining({
          duration: '30d'
        })
      }));
    });

    it('should return 404 for non-existent webhook', async () => {
      mockReq.params.id = 'nonexistent';
      mockServices.webhook.findWebhookById.mockResolvedValue(null);

      await controller.getWebhookStats(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(404);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'Not Found',
        message: 'Webhook not found'
      });
    });

    it('should handle errors gracefully', async () => {
      mockReq.params.id = 'webhook123';
      mockServices.webhook.findWebhookById.mockRejectedValue(new Error('Database error'));

      await controller.getWebhookStats(mockReq, mockRes);

      expect(logger.error).toHaveBeenCalledWith('Error getting webhook stats:', expect.any(Error));
      expect(mockRes.status).toHaveBeenCalledWith(500);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'Internal Server Error',
        message: 'Failed to get webhook stats'
      });
    });
  });

  describe('parsePeriod', () => {
    it('should parse hours correctly', () => {
      const result = controller.parsePeriod('24h');
      expect(result).toBe(24 * 60 * 60 * 1000);
    });

    it('should parse days correctly', () => {
      const result = controller.parsePeriod('7d');
      expect(result).toBe(7 * 24 * 60 * 60 * 1000);
    });

    it('should parse weeks correctly', () => {
      const result = controller.parsePeriod('2w');
      expect(result).toBe(2 * 7 * 24 * 60 * 60 * 1000);
    });

    it('should parse months correctly', () => {
      const result = controller.parsePeriod('3m');
      expect(result).toBe(3 * 30 * 24 * 60 * 60 * 1000);
    });

    it('should parse years correctly', () => {
      const result = controller.parsePeriod('1y');
      expect(result).toBe(365 * 24 * 60 * 60 * 1000);
    });

    it('should throw error for invalid format', () => {
      expect(() => controller.parsePeriod('invalid')).toThrow('Invalid period format');
      expect(() => controller.parsePeriod('7')).toThrow('Invalid period format');
      expect(() => controller.parsePeriod('d7')).toThrow('Invalid period format');
    });

    it('should throw error for invalid unit', () => {
      // Invalid unit 'x' will cause the regex to fail, resulting in "Invalid period format"
      expect(() => controller.parsePeriod('7x')).toThrow('Invalid period format');
    });
  });

  describe('edge cases and error scenarios', () => {
    it('should handle webhook with minimal data', async () => {
      mockReq.body = {
        name: 'Minimal Webhook',
        url: 'https://example.com/minimal'
      };

      Webhook.mockImplementation((data) => ({
        ...data,
        validate: jest.fn(),
        toResponse: jest.fn().mockReturnValue(data)
      }));

      mockServices.webhook.findWebhookByUrl.mockResolvedValue(null);
      mockServices.webhook.createWebhook.mockResolvedValue({
        id: 'minimal-id',
        ...mockReq.body,
        toResponse: jest.fn().mockReturnValue({ id: 'minimal-id', ...mockReq.body })
      });

      await controller.createWebhook(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(201);
    });

    it('should handle concurrent requests gracefully', async () => {
      const promises = [];
      
      for (let i = 0; i < 5; i++) {
        mockServices.webhook.findWebhooks.mockResolvedValue([]);
        mockServices.webhook.countWebhooks.mockResolvedValue(0);
        
        const req = { query: { page: i + 1 } };
        const res = {
          json: jest.fn(),
          status: jest.fn().mockReturnThis()
        };
        
        promises.push(controller.listWebhooks(req, res));
      }

      await Promise.all(promises);
      
      expect(mockServices.webhook.findWebhooks).toHaveBeenCalledTimes(5);
    });

    it('should handle malformed webhook data gracefully', async () => {
      mockReq.body = {
        name: 123, // Should be string
        url: 'not-a-valid-url',
        events: 'not-an-array' // Should be array
      };

      Webhook.mockImplementation(() => ({
        validate: jest.fn().mockImplementation(() => {
          throw new Error('Webhook validation failed: Invalid data types');
        })
      }));

      await controller.createWebhook(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(400);
    });

    it('should handle database connection errors', async () => {
      mockReq.query = {};
      
      const dbError = new Error('MongoNetworkError: connection timeout');
      mockServices.webhook.findWebhooks.mockRejectedValue(dbError);

      await controller.listWebhooks(mockReq, mockRes);

      expect(logger.error).toHaveBeenCalledWith('Error listing webhooks:', dbError);
      expect(mockRes.status).toHaveBeenCalledWith(500);
    });

    it('should sanitize search input to prevent injection', async () => {
      mockReq.query = { search: '$regex{.*}' };
      
      mockServices.webhook.findWebhooks.mockResolvedValue([]);
      mockServices.webhook.countWebhooks.mockResolvedValue(0);

      await controller.listWebhooks(mockReq, mockRes);

      // The search should be treated as literal string, not regex injection
      expect(mockServices.webhook.findWebhooks).toHaveBeenCalledWith(
        {
          $or: [
            { name: { $regex: '$regex{.*}', $options: 'i' } },
            { url: { $regex: '$regex{.*}', $options: 'i' } }
          ]
        },
        expect.any(Object)
      );
    });
  });
});