/**
 * Unit tests for EventController
 */

const EventController = require('../../../src/controllers/EventController');
const logger = require('../../../src/utils/logger');

// Mock the logger
jest.mock('../../../src/utils/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn()
}));

// Mock config
jest.mock('../../../src/config', () => ({
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
  ]
}));

describe('EventController', () => {
  let controller;
  let mockServices;
  let mockReq;
  let mockRes;

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();

    // Mock database services
    mockServices = {
      event: {
        // Add event service methods if needed
      },
      database: {
        db: {
          collection: jest.fn()
        }
      },
      webhook: {
        findWebhookById: jest.fn(),
        findWebhooks: jest.fn()
      },
      delivery: {
        queueDelivery: jest.fn()
      }
    };

    // Create controller instance
    controller = new EventController(mockServices);

    // Mock request and response
    mockReq = {
      query: {},
      params: {},
      body: {}
    };

    mockRes = {
      json: jest.fn(),
      status: jest.fn().mockReturnThis()
    };
  });

  describe('listEvents', () => {
    it('should list events with default pagination', async () => {
      const mockEvents = [
        {
          id: 'event1',
          type: 'issue.created',
          timestamp: new Date(),
          workspace: 'workspace1',
          processed: true,
          processedAt: new Date(),
          data: { test: 'data' }
        }
      ];

      const mockCollection = {
        find: jest.fn().mockReturnThis(),
        sort: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        toArray: jest.fn().mockResolvedValue(mockEvents),
        countDocuments: jest.fn().mockResolvedValue(1)
      };

      mockServices.database.db.collection.mockReturnValue(mockCollection);

      await controller.listEvents(mockReq, mockRes);

      expect(mockServices.database.db.collection).toHaveBeenCalledWith('webhook_events');
      expect(mockCollection.find).toHaveBeenCalledWith({});
      expect(mockCollection.sort).toHaveBeenCalledWith({ timestamp: -1 });
      expect(mockCollection.skip).toHaveBeenCalledWith(0);
      expect(mockCollection.limit).toHaveBeenCalledWith(50);
      expect(mockRes.json).toHaveBeenCalledWith({
        events: expect.any(Array),
        pagination: {
          page: 1,
          limit: 50,
          total: 1,
          pages: 1
        }
      });
    });

    it('should apply filters when provided', async () => {
      mockReq.query = {
        page: 2,
        limit: 20,
        type: 'issue.created',
        workspace: 'workspace1',
        processed: 'true',
        from: '2024-01-01',
        to: '2024-01-31'
      };

      const mockCollection = {
        find: jest.fn().mockReturnThis(),
        sort: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        toArray: jest.fn().mockResolvedValue([]),
        countDocuments: jest.fn().mockResolvedValue(0)
      };

      mockServices.database.db.collection.mockReturnValue(mockCollection);

      await controller.listEvents(mockReq, mockRes);

      expect(mockCollection.find).toHaveBeenCalledWith({
        type: 'issue.created',
        workspace: 'workspace1',
        processed: true,
        timestamp: {
          $gte: new Date('2024-01-01'),
          $lte: new Date('2024-01-31')
        }
      });
      expect(mockCollection.skip).toHaveBeenCalledWith(20); // (page-1) * limit
      expect(mockCollection.limit).toHaveBeenCalledWith(20);
    });

    it('should handle errors', async () => {
      const error = new Error('Database error');
      mockServices.database.db.collection.mockImplementation(() => {
        throw error;
      });

      await controller.listEvents(mockReq, mockRes);

      expect(logger.error).toHaveBeenCalledWith('Error listing events:', error);
      expect(mockRes.status).toHaveBeenCalledWith(500);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'Internal Server Error',
        message: 'Failed to list events'
      });
    });
  });

  describe('getEvent', () => {
    it('should return event when found', async () => {
      mockReq.params.id = 'event1';
      const mockEvent = {
        id: 'event1',
        type: 'issue.created',
        timestamp: new Date()
      };

      const mockCollection = {
        findOne: jest.fn().mockResolvedValue(mockEvent)
      };

      mockServices.database.db.collection.mockReturnValue(mockCollection);

      await controller.getEvent(mockReq, mockRes);

      expect(mockCollection.findOne).toHaveBeenCalledWith({ id: 'event1' });
      expect(mockRes.json).toHaveBeenCalledWith(mockEvent);
    });

    it('should return 404 when event not found', async () => {
      mockReq.params.id = 'nonexistent';

      const mockCollection = {
        findOne: jest.fn().mockResolvedValue(null)
      };

      mockServices.database.db.collection.mockReturnValue(mockCollection);

      await controller.getEvent(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(404);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'Not Found',
        message: 'Event not found'
      });
    });

    it('should handle errors', async () => {
      mockReq.params.id = 'event1';
      const error = new Error('Database error');

      const mockCollection = {
        findOne: jest.fn().mockRejectedValue(error)
      };

      mockServices.database.db.collection.mockReturnValue(mockCollection);

      await controller.getEvent(mockReq, mockRes);

      expect(logger.error).toHaveBeenCalledWith('Error getting event:', error);
      expect(mockRes.status).toHaveBeenCalledWith(500);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'Internal Server Error',
        message: 'Failed to get event'
      });
    });
  });

  describe('getEventDeliveries', () => {
    it('should return deliveries for existing event', async () => {
      mockReq.params.id = 'event1';
      mockReq.query = { page: 1, limit: 50 };

      const mockEvent = {
        id: 'event1',
        type: 'issue.created',
        timestamp: new Date(),
        workspace: 'workspace1'
      };

      const mockDeliveries = [
        {
          id: 'delivery1',
          eventId: 'event1',
          webhookId: 'webhook1',
          attemptNumber: 1,
          status: 'delivered',
          httpStatus: 200,
          duration: 150,
          timestamp: new Date()
        }
      ];

      const mockEventCollection = {
        findOne: jest.fn().mockResolvedValue(mockEvent)
      };

      const mockDeliveryCollection = {
        find: jest.fn().mockReturnThis(),
        sort: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        toArray: jest.fn().mockResolvedValue(mockDeliveries),
        countDocuments: jest.fn().mockResolvedValue(1)
      };

      mockServices.database.db.collection.mockImplementation((collectionName) => {
        if (collectionName === 'webhook_events') return mockEventCollection;
        if (collectionName === 'delivery_attempts') return mockDeliveryCollection;
      });

      await controller.getEventDeliveries(mockReq, mockRes);

      expect(mockEventCollection.findOne).toHaveBeenCalledWith({ id: 'event1' });
      expect(mockDeliveryCollection.find).toHaveBeenCalledWith({ eventId: 'event1' });
      expect(mockRes.json).toHaveBeenCalledWith({
        event: expect.objectContaining({
          id: 'event1',
          type: 'issue.created'
        }),
        deliveries: expect.any(Array),
        pagination: expect.any(Object)
      });
    });

    it('should handle deliveries with all optional fields', async () => {
      mockReq.params.id = 'event1';
      mockReq.query = { page: 2, limit: 10 };

      const mockEvent = {
        id: 'event1',
        type: 'issue.created',
        timestamp: new Date(),
        workspace: 'workspace1'
      };

      const mockDeliveries = [
        {
          id: 'delivery1',
          eventId: 'event1',
          webhookId: 'webhook1',
          attemptNumber: 3,
          status: 'failed',
          httpStatus: 500,
          errorMessage: 'Server error',
          duration: 2500,
          timestamp: new Date(),
          nextRetryAt: new Date(Date.now() + 3600000),
          finalAttempt: true
        }
      ];

      const mockEventCollection = {
        findOne: jest.fn().mockResolvedValue(mockEvent)
      };

      const mockDeliveryCollection = {
        find: jest.fn().mockReturnThis(),
        sort: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        toArray: jest.fn().mockResolvedValue(mockDeliveries),
        countDocuments: jest.fn().mockResolvedValue(15)
      };

      mockServices.database.db.collection.mockImplementation((collectionName) => {
        if (collectionName === 'webhook_events') return mockEventCollection;
        if (collectionName === 'delivery_attempts') return mockDeliveryCollection;
      });

      await controller.getEventDeliveries(mockReq, mockRes);

      expect(mockDeliveryCollection.skip).toHaveBeenCalledWith(10); // (2-1) * 10
      expect(mockDeliveryCollection.limit).toHaveBeenCalledWith(10);
      
      const response = mockRes.json.mock.calls[0][0];
      expect(response.deliveries[0]).toHaveProperty('errorMessage', 'Server error');
      expect(response.deliveries[0]).toHaveProperty('nextRetryAt');
      expect(response.deliveries[0]).toHaveProperty('finalAttempt', true);
      expect(response.pagination.pages).toBe(2); // 15 total / 10 per page
    });

    it('should apply status filter when provided', async () => {
      mockReq.params.id = 'event1';
      mockReq.query = { status: 'failed' };

      const mockEvent = { id: 'event1' };
      const mockEventCollection = {
        findOne: jest.fn().mockResolvedValue(mockEvent)
      };

      const mockDeliveryCollection = {
        find: jest.fn().mockReturnThis(),
        sort: jest.fn().mockReturnThis(),
        skip: jest.fn().mockReturnThis(),
        limit: jest.fn().mockReturnThis(),
        toArray: jest.fn().mockResolvedValue([]),
        countDocuments: jest.fn().mockResolvedValue(0)
      };

      mockServices.database.db.collection.mockImplementation((collectionName) => {
        if (collectionName === 'webhook_events') return mockEventCollection;
        if (collectionName === 'delivery_attempts') return mockDeliveryCollection;
      });

      await controller.getEventDeliveries(mockReq, mockRes);

      expect(mockDeliveryCollection.find).toHaveBeenCalledWith({
        eventId: 'event1',
        status: 'failed'
      });
    });

    it('should return 404 when event not found', async () => {
      mockReq.params.id = 'nonexistent';

      const mockEventCollection = {
        findOne: jest.fn().mockResolvedValue(null)
      };

      mockServices.database.db.collection.mockReturnValue(mockEventCollection);

      await controller.getEventDeliveries(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(404);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'Not Found',
        message: 'Event not found'
      });
    });

    it('should handle errors when getting deliveries', async () => {
      mockReq.params.id = 'event1';
      const error = new Error('Database error');

      const mockEventCollection = {
        findOne: jest.fn().mockRejectedValue(error)
      };

      mockServices.database.db.collection.mockReturnValue(mockEventCollection);

      await controller.getEventDeliveries(mockReq, mockRes);

      expect(logger.error).toHaveBeenCalledWith('Error getting event deliveries:', error);
      expect(mockRes.status).toHaveBeenCalledWith(500);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'Internal Server Error',
        message: 'Failed to get event deliveries'
      });
    });
  });

  describe('retryEvent', () => {
    it('should retry event for specific webhooks', async () => {
      mockReq.params.id = 'event1';
      mockReq.body = { webhookIds: ['webhook1', 'webhook2'] };

      const mockEvent = {
        id: 'event1',
        type: 'issue.created',
        data: { issueId: '123' }
      };

      const mockWebhook1 = {
        id: 'webhook1',
        name: 'Webhook 1',
        active: true,
        shouldProcessEvent: jest.fn().mockReturnValue(true),
        matchesFilters: jest.fn().mockReturnValue(true)
      };

      const mockWebhook2 = {
        id: 'webhook2',
        name: 'Webhook 2',
        active: true,
        shouldProcessEvent: jest.fn().mockReturnValue(true),
        matchesFilters: jest.fn().mockReturnValue(true)
      };

      const mockEventCollection = {
        findOne: jest.fn().mockResolvedValue(mockEvent)
      };

      mockServices.database.db.collection.mockReturnValue(mockEventCollection);
      mockServices.webhook.findWebhookById.mockImplementation((id) => {
        if (id === 'webhook1') return Promise.resolve(mockWebhook1);
        if (id === 'webhook2') return Promise.resolve(mockWebhook2);
        return Promise.resolve(null);
      });

      mockServices.delivery.queueDelivery.mockResolvedValue({ id: 'delivery1' });

      await controller.retryEvent(mockReq, mockRes);

      expect(mockServices.webhook.findWebhookById).toHaveBeenCalledTimes(2);
      expect(mockServices.delivery.queueDelivery).toHaveBeenCalledTimes(2);
      expect(mockRes.json).toHaveBeenCalledWith({
        eventId: 'event1',
        retryResults: expect.arrayContaining([
          expect.objectContaining({
            webhookId: 'webhook1',
            success: true
          }),
          expect.objectContaining({
            webhookId: 'webhook2',
            success: true
          })
        ]),
        summary: {
          totalWebhooks: 2,
          successfulQueues: 2,
          failedQueues: 0
        }
      });
    });

    it('should retry event for all matching webhooks when no specific IDs provided', async () => {
      mockReq.params.id = 'event1';
      mockReq.body = {};

      const mockEvent = {
        id: 'event1',
        type: 'issue.created',
        data: { issueId: '123' }
      };

      const mockWebhooks = [
        {
          id: 'webhook1',
          name: 'Webhook 1',
          active: true,
          shouldProcessEvent: jest.fn().mockReturnValue(true),
          matchesFilters: jest.fn().mockReturnValue(true)
        },
        {
          id: 'webhook2',
          name: 'Webhook 2',
          active: true,
          shouldProcessEvent: jest.fn().mockReturnValue(false),
          matchesFilters: jest.fn().mockReturnValue(true)
        }
      ];

      const mockEventCollection = {
        findOne: jest.fn().mockResolvedValue(mockEvent)
      };

      mockServices.database.db.collection.mockReturnValue(mockEventCollection);
      mockServices.webhook.findWebhooks.mockResolvedValue(mockWebhooks);
      mockServices.delivery.queueDelivery.mockResolvedValue({ id: 'delivery1' });

      await controller.retryEvent(mockReq, mockRes);

      expect(mockServices.webhook.findWebhooks).toHaveBeenCalledWith({ active: true });
      expect(mockServices.delivery.queueDelivery).toHaveBeenCalledTimes(1);
      expect(mockServices.delivery.queueDelivery).toHaveBeenCalledWith(mockWebhooks[0], mockEvent);
    });

    it('should handle delivery queue errors', async () => {
      mockReq.params.id = 'event1';
      mockReq.body = { webhookIds: ['webhook1'] };

      const mockEvent = { id: 'event1' };
      const mockWebhook = {
        id: 'webhook1',
        name: 'Webhook 1',
        active: true
      };

      const mockEventCollection = {
        findOne: jest.fn().mockResolvedValue(mockEvent)
      };

      mockServices.database.db.collection.mockReturnValue(mockEventCollection);
      mockServices.webhook.findWebhookById.mockResolvedValue(mockWebhook);
      mockServices.delivery.queueDelivery.mockRejectedValue(new Error('Queue error'));

      await controller.retryEvent(mockReq, mockRes);

      expect(mockRes.json).toHaveBeenCalledWith({
        eventId: 'event1',
        retryResults: expect.arrayContaining([
          expect.objectContaining({
            webhookId: 'webhook1',
            success: false,
            error: 'Queue error'
          })
        ]),
        summary: {
          totalWebhooks: 1,
          successfulQueues: 0,
          failedQueues: 1
        }
      });
    });

    it('should return 404 when event not found', async () => {
      mockReq.params.id = 'nonexistent';

      const mockEventCollection = {
        findOne: jest.fn().mockResolvedValue(null)
      };

      mockServices.database.db.collection.mockReturnValue(mockEventCollection);

      await controller.retryEvent(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(404);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'Not Found',
        message: 'Event not found'
      });
    });

    it('should return 400 when no eligible webhooks found', async () => {
      mockReq.params.id = 'event1';
      mockReq.body = { webhookIds: ['inactive'] };

      const mockEvent = { id: 'event1' };
      const mockEventCollection = {
        findOne: jest.fn().mockResolvedValue(mockEvent)
      };

      mockServices.database.db.collection.mockReturnValue(mockEventCollection);
      mockServices.webhook.findWebhookById.mockResolvedValue(null);

      await controller.retryEvent(mockReq, mockRes);

      expect(mockRes.status).toHaveBeenCalledWith(400);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'Bad Request',
        message: 'No eligible webhooks found for retry'
      });
    });

    it('should handle general errors during retry', async () => {
      mockReq.params.id = 'event1';
      const error = new Error('Unexpected error');

      mockServices.database.db.collection.mockImplementation(() => {
        throw error;
      });

      await controller.retryEvent(mockReq, mockRes);

      expect(logger.error).toHaveBeenCalledWith('Error retrying event:', error);
      expect(mockRes.status).toHaveBeenCalledWith(500);
      expect(mockRes.json).toHaveBeenCalledWith({
        error: 'Internal Server Error',
        message: 'Failed to retry event'
      });
    });
  });

  describe('getEventTypes', () => {
    it('should return supported event types', async () => {
      await controller.getEventTypes(mockReq, mockRes);

      expect(mockRes.json).toHaveBeenCalledWith({
        supportedTypes: expect.arrayContaining([
          'issue.created',
          'issue.updated',
          'issue.deleted'
        ]),
        description: expect.objectContaining({
          'issue.created': 'New issue created',
          'issue.updated': 'Issue modified'
        })
      });
    });

  });

  describe('getEventStats', () => {
    it('should return event statistics for default period', async () => {
      const mockAggregateResult = {
        toArray: jest.fn()
      };

      const mockCollection = {
        aggregate: jest.fn().mockReturnValue(mockAggregateResult),
        countDocuments: jest.fn().mockResolvedValue(100)
      };

      mockAggregateResult.toArray.mockResolvedValueOnce([
        { _id: 'issue.created', count: 50 },
        { _id: 'issue.updated', count: 30 }
      ]);

      mockAggregateResult.toArray.mockResolvedValueOnce([
        { _id: true, count: 70 },
        { _id: false, count: 30 }
      ]);

      mockAggregateResult.toArray.mockResolvedValueOnce([
        { _id: 'workspace1', count: 60 },
        { _id: 'workspace2', count: 40 }
      ]);

      mockServices.database.db.collection.mockReturnValue(mockCollection);

      await controller.getEventStats(mockReq, mockRes);

      expect(mockCollection.aggregate).toHaveBeenCalledTimes(3);
      expect(mockRes.json).toHaveBeenCalledWith(expect.objectContaining({
        period: expect.objectContaining({
          duration: '7d'
        }),
        totalEvents: 100,
        eventsByType: expect.arrayContaining([
          { type: 'issue.created', count: 50 }
        ]),
        processingStats: {
          processed: 70,
          unprocessed: 30
        },
        eventsByWorkspace: expect.arrayContaining([
          { workspace: 'workspace1', count: 60 }
        ])
      }));
    });

    it('should handle custom period parameter', async () => {
      mockReq.query.period = '30d';

      const mockCollection = {
        aggregate: jest.fn().mockReturnValue({
          toArray: jest.fn().mockResolvedValue([])
        }),
        countDocuments: jest.fn().mockResolvedValue(0)
      };

      mockServices.database.db.collection.mockReturnValue(mockCollection);

      await controller.getEventStats(mockReq, mockRes);

      expect(mockRes.json).toHaveBeenCalledWith(expect.objectContaining({
        period: expect.objectContaining({
          duration: '30d'
        })
      }));
    });

    it('should handle errors', async () => {
      const error = new Error('Aggregation error');
      mockServices.database.db.collection.mockImplementation(() => {
        throw error;
      });

      await controller.getEventStats(mockReq, mockRes);

      expect(logger.error).toHaveBeenCalledWith('Error getting event stats:', error);
      expect(mockRes.status).toHaveBeenCalledWith(500);
    });
  });

  describe('parsePeriod', () => {
    it('should parse valid period strings', () => {
      expect(controller.parsePeriod('1h')).toBe(60 * 60 * 1000);
      expect(controller.parsePeriod('7d')).toBe(7 * 24 * 60 * 60 * 1000);
      expect(controller.parsePeriod('2w')).toBe(2 * 7 * 24 * 60 * 60 * 1000);
      expect(controller.parsePeriod('1m')).toBe(30 * 24 * 60 * 60 * 1000);
      expect(controller.parsePeriod('1y')).toBe(365 * 24 * 60 * 60 * 1000);
    });

    it('should handle large numbers correctly', () => {
      expect(controller.parsePeriod('100h')).toBe(100 * 60 * 60 * 1000);
      expect(controller.parsePeriod('365d')).toBe(365 * 24 * 60 * 60 * 1000);
    });

    it('should throw error for invalid period format', () => {
      expect(() => controller.parsePeriod('invalid')).toThrow('Invalid period format');
      expect(() => controller.parsePeriod('7')).toThrow('Invalid period format');
      expect(() => controller.parsePeriod('d7')).toThrow('Invalid period format');
      expect(() => controller.parsePeriod('')).toThrow('Invalid period format');
      // '0d' actually matches the regex and returns 0 * 24 * 60 * 60 * 1000 = 0
      expect(controller.parsePeriod('0d')).toBe(0);
      expect(() => controller.parsePeriod('-1d')).toThrow('Invalid period format');
    });

    it('should throw error for invalid period unit', () => {
      // Any character not in [hdwmy] won't match the regex
      expect(() => controller.parsePeriod('7x')).toThrow('Invalid period format');
      expect(() => controller.parsePeriod('7z')).toThrow('Invalid period format');
      expect(() => controller.parsePeriod('7D')).toThrow('Invalid period format'); // case sensitive
      
      // Note: The default case in the switch is unreachable because the regex
      // only allows [hdwmy] characters, making it defensive programming
    });
  });
});