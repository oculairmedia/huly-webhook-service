/**
 * Unit tests for DeliveryHistoryService
 */

const DeliveryHistoryService = require('../../../src/services/DeliveryHistoryService');

// Mock dependencies
jest.mock('../../../src/utils/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn()
}));

const logger = require('../../../src/utils/logger');

describe('DeliveryHistoryService', () => {
  let service;
  let mockDatabaseService;
  let config;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();

    // Mock database service
    mockDatabaseService = {
      findMany: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockResolvedValue({}),
      aggregate: jest.fn().mockResolvedValue([]),
      deleteMany: jest.fn().mockResolvedValue({ deletedCount: 0 })
    };

    // Default config
    config = {
      deliveryHistory: {
        retentionPeriod: 90,
        batchSize: 1000,
        compression: true,
        analytics: true,
        maxCacheSize: 100
      }
    };

    service = new DeliveryHistoryService(config, mockDatabaseService);
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  describe('constructor', () => {
    it('should initialize with default values', () => {
      const minimalConfig = {};
      const service = new DeliveryHistoryService(minimalConfig, mockDatabaseService);
      
      expect(service.retentionPeriod).toBe(90);
      expect(service.batchSize).toBe(1000);
      expect(service.compressionEnabled).toBe(true);
      expect(service.analyticsEnabled).toBe(true);
      expect(service.maxCacheSize).toBe(10000);
    });

    it('should initialize with custom config', () => {
      expect(service.retentionPeriod).toBe(90);
      expect(service.batchSize).toBe(1000);
      expect(service.compressionEnabled).toBe(true);
      expect(service.analyticsEnabled).toBe(true);
      expect(service.maxCacheSize).toBe(100);
    });

    it('should initialize analytics data structure', () => {
      expect(service.analytics).toEqual({
        totalDeliveries: 0,
        successfulDeliveries: 0,
        failedDeliveries: 0,
        averageResponseTime: 0,
        deliveriesByStatus: {},
        deliveriesByWebhook: {},
        deliveriesByEventType: {},
        deliveriesByHour: {},
        deliveriesByDay: {},
        errorsByType: {},
        responseTimes: []
      });
    });

    it('should initialize recent deliveries cache', () => {
      expect(service.recentDeliveries).toBeInstanceOf(Map);
      expect(service.recentDeliveries.size).toBe(0);
    });
  });

  describe('initialize', () => {
    it('should load analytics when enabled', async () => {
      jest.spyOn(service, 'loadAnalytics').mockResolvedValue();
      
      await service.initialize();

      expect(service.loadAnalytics).toHaveBeenCalled();
    });

    it('should not load analytics when disabled', async () => {
      service.analyticsEnabled = false;
      jest.spyOn(service, 'loadAnalytics');
      
      await service.initialize();

      expect(service.loadAnalytics).not.toHaveBeenCalled();
    });

    it('should start cleanup interval', async () => {
      const setIntervalSpy = jest.spyOn(global, 'setInterval');
      
      await service.initialize();

      expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 24 * 60 * 60 * 1000);
    });

    it('should start analytics update interval when enabled', async () => {
      const setIntervalSpy = jest.spyOn(global, 'setInterval');
      
      await service.initialize();

      expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 10 * 60 * 1000);
    });

    it('should handle initialization errors', async () => {
      jest.spyOn(service, 'loadAnalytics').mockRejectedValue(new Error('Load error'));

      await expect(service.initialize()).rejects.toThrow('Load error');
      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe('recordDelivery', () => {
    const mockDelivery = {
      id: 'delivery_1',
      webhook: {
        _id: 'webhook_1',
        name: 'Test Webhook',
        url: 'https://example.com/webhook'
      },
      payload: {
        event: 'test.event',
        id: 'event_1',
        data: {
          id: 'doc_1',
          type: 'document',
          operation: 'create'
        }
      },
      attempt: 1,
      maxAttempts: 3,
      headers: {
        'User-Agent': 'Webhook/1.0'
      },
      metadata: {
        ipAddress: '192.168.1.1'
      }
    };

    const mockResult = {
      success: true,
      statusCode: 200,
      responseTime: 150,
      error: null,
      headers: { 'Content-Type': 'application/json' },
      body: '{"ok":true}'
    };

    it('should record successful delivery', async () => {
      const historyId = await service.recordDelivery(mockDelivery, mockResult);

      expect(historyId).toMatch(/^hist_\d+_[a-z0-9]+$/);
      expect(mockDatabaseService.create).toHaveBeenCalledWith(
        'delivery_history',
        expect.objectContaining({
          id: historyId,
          webhookId: 'webhook_1',
          webhookName: 'Test Webhook',
          webhookUrl: 'https://example.com/webhook',
          eventType: 'test.event',
          eventId: 'event_1',
          result: expect.objectContaining({
            success: true,
            statusCode: 200,
            responseTime: 150,
            bodySize: 11
          }),
          attempt: 1,
          maxAttempts: 3,
          timestamp: expect.any(Date)
        })
      );
    });

    it('should record failed delivery', async () => {
      const failedResult = {
        success: false,
        statusCode: 500,
        responseTime: 1000,
        error: 'Internal Server Error',
        headers: {},
        body: null
      };

      const historyId = await service.recordDelivery(mockDelivery, failedResult);

      expect(mockDatabaseService.create).toHaveBeenCalledWith(
        'delivery_history',
        expect.objectContaining({
          result: expect.objectContaining({
            success: false,
            statusCode: 500,
            error: 'Internal Server Error',
            bodySize: 0
          })
        })
      );
    });

    it('should compress payload when enabled', async () => {
      jest.spyOn(service, 'compressPayload');
      
      await service.recordDelivery(mockDelivery, mockResult);

      expect(service.compressPayload).toHaveBeenCalledWith(mockDelivery.payload);
    });

    it('should not compress payload when disabled', async () => {
      service.compressionEnabled = false;
      jest.spyOn(service, 'compressPayload');
      
      await service.recordDelivery(mockDelivery, mockResult);

      expect(service.compressPayload).not.toHaveBeenCalled();
    });

    it('should add to cache', async () => {
      jest.spyOn(service, 'addToCache');
      
      await service.recordDelivery(mockDelivery, mockResult);

      expect(service.addToCache).toHaveBeenCalledWith(
        expect.objectContaining({
          webhookId: 'webhook_1',
          eventType: 'test.event'
        })
      );
    });

    it('should update analytics when enabled', async () => {
      jest.spyOn(service, 'updateAnalytics');
      
      await service.recordDelivery(mockDelivery, mockResult);

      expect(service.updateAnalytics).toHaveBeenCalledWith(
        expect.objectContaining({
          result: expect.objectContaining({ success: true })
        })
      );
    });

    it('should handle errors', async () => {
      mockDatabaseService.create.mockRejectedValue(new Error('DB error'));

      await expect(service.recordDelivery(mockDelivery, mockResult))
        .rejects.toThrow('DB error');
      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe('getDeliveryHistory', () => {
    const mockRecords = [
      {
        id: 'hist_1',
        webhookId: 'webhook_1',
        eventType: 'test.event',
        payload: { compressed: true, data: '{"event":"test.event"}' },
        result: { success: true },
        timestamp: new Date()
      },
      {
        id: 'hist_2',
        webhookId: 'webhook_2',
        eventType: 'other.event',
        payload: { event: 'other.event' },
        result: { success: false },
        timestamp: new Date()
      }
    ];

    it('should retrieve delivery history', async () => {
      mockDatabaseService.findMany.mockResolvedValue(mockRecords);

      const records = await service.getDeliveryHistory();

      expect(mockDatabaseService.findMany).toHaveBeenCalledWith(
        'delivery_history',
        {},
        expect.any(Object)
      );
      expect(records).toHaveLength(2);
    });

    it('should decompress payloads when compression is enabled', async () => {
      mockDatabaseService.findMany.mockResolvedValue([mockRecords[0]]);
      jest.spyOn(service, 'decompressPayload').mockReturnValue({ event: 'test.event' });

      const records = await service.getDeliveryHistory();

      expect(service.decompressPayload).toHaveBeenCalledWith(mockRecords[0].payload);
      expect(records[0].payload).toEqual({ event: 'test.event' });
    });

    it('should not decompress uncompressed payloads', async () => {
      mockDatabaseService.findMany.mockResolvedValue([mockRecords[1]]);
      jest.spyOn(service, 'decompressPayload');

      const records = await service.getDeliveryHistory();

      expect(service.decompressPayload).not.toHaveBeenCalled();
      expect(records[0].payload).toEqual({ event: 'other.event' });
    });

    it('should apply query filters', async () => {
      mockDatabaseService.findMany.mockResolvedValue([]);
      
      await service.getDeliveryHistory({
        webhookId: 'webhook_1',
        eventType: 'test.event',
        success: true,
        fromDate: '2024-01-01',
        toDate: '2024-01-31',
        limit: 50,
        skip: 10
      });

      expect(mockDatabaseService.findMany).toHaveBeenCalledWith(
        'delivery_history',
        expect.objectContaining({
          webhookId: 'webhook_1',
          eventType: 'test.event',
          'result.success': true,
          timestamp: {
            $gte: expect.any(Date),
            $lte: expect.any(Date)
          }
        }),
        expect.objectContaining({
          limit: 50,
          skip: 10,
          sort: { timestamp: -1 }
        })
      );
    });

    it('should handle errors', async () => {
      mockDatabaseService.findMany.mockRejectedValue(new Error('DB error'));

      await expect(service.getDeliveryHistory()).rejects.toThrow('DB error');
      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe('getDeliveryStats', () => {
    const mockAggregateResult = [{
      _id: null,
      totalDeliveries: 100,
      successfulDeliveries: 85,
      failedDeliveries: 15,
      averageResponseTime: 250,
      minResponseTime: 50,
      maxResponseTime: 5000,
      totalAttempts: 120,
      uniqueWebhooks: ['webhook_1', 'webhook_2'],
      uniqueEventTypes: ['event.type1', 'event.type2', 'event.type3']
    }];

    it('should return aggregated statistics', async () => {
      mockDatabaseService.aggregate.mockResolvedValue(mockAggregateResult);

      const stats = await service.getDeliveryStats();

      expect(stats).toMatchObject({
        totalDeliveries: 100,
        successfulDeliveries: 85,
        failedDeliveries: 15,
        averageResponseTime: 250,
        minResponseTime: 50,
        maxResponseTime: 5000,
        totalAttempts: 120,
        successRate: 0.85,
        failureRate: 0.15,
        averageAttempts: 1.2,
        uniqueWebhookCount: 2,
        uniqueEventTypeCount: 3
      });
    });

    it('should handle empty results', async () => {
      mockDatabaseService.aggregate.mockResolvedValue([]);

      const stats = await service.getDeliveryStats();

      expect(stats).toEqual({
        totalDeliveries: 0,
        successfulDeliveries: 0,
        failedDeliveries: 0,
        averageResponseTime: 0,
        minResponseTime: 0,
        maxResponseTime: 0,
        totalAttempts: 0,
        uniqueWebhooks: [],
        uniqueEventTypes: [],
        successRate: 0,
        failureRate: 0,
        averageAttempts: 0,
        uniqueWebhookCount: 0,
        uniqueEventTypeCount: 0
      });
    });

    it('should apply query filters', async () => {
      mockDatabaseService.aggregate.mockResolvedValue(mockAggregateResult);

      await service.getDeliveryStats({ webhookId: 'webhook_1' });

      expect(mockDatabaseService.aggregate).toHaveBeenCalledWith(
        'delivery_history',
        expect.arrayContaining([
          { $match: { webhookId: 'webhook_1' } },
          expect.any(Object)
        ])
      );
    });

    it('should handle errors', async () => {
      mockDatabaseService.aggregate.mockRejectedValue(new Error('Aggregate error'));

      await expect(service.getDeliveryStats()).rejects.toThrow('Aggregate error');
      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe('getDeliveryTrends', () => {
    const mockTrendsData = [
      {
        _id: { year: 2024, month: 1, day: 15, hour: 10 },
        totalDeliveries: 25,
        successfulDeliveries: 23,
        failedDeliveries: 2,
        averageResponseTime: 200,
        timestamp: new Date('2024-01-15T10:00:00Z')
      }
    ];

    it('should get hourly trends by default', async () => {
      mockDatabaseService.aggregate.mockResolvedValue(mockTrendsData);

      const trends = await service.getDeliveryTrends();

      expect(mockDatabaseService.aggregate).toHaveBeenCalledWith(
        'delivery_history',
        expect.arrayContaining([
          { $match: {} },
          expect.objectContaining({
            $group: expect.objectContaining({
              _id: expect.objectContaining({
                year: { $year: '$timestamp' },
                month: { $month: '$timestamp' },
                day: { $dayOfMonth: '$timestamp' },
                hour: { $hour: '$timestamp' }
              })
            })
          })
        ])
      );
      expect(trends).toHaveLength(1);
    });

    it('should get daily trends', async () => {
      mockDatabaseService.aggregate.mockResolvedValue(mockTrendsData);

      await service.getDeliveryTrends({ groupBy: 'day' });

      expect(mockDatabaseService.aggregate).toHaveBeenCalledWith(
        'delivery_history',
        expect.arrayContaining([
          expect.any(Object),
          expect.objectContaining({
            $group: expect.objectContaining({
              _id: expect.objectContaining({
                year: { $year: '$timestamp' },
                month: { $month: '$timestamp' },
                day: { $dayOfMonth: '$timestamp' }
              })
            })
          })
        ])
      );
    });

    it('should get weekly trends', async () => {
      mockDatabaseService.aggregate.mockResolvedValue(mockTrendsData);

      await service.getDeliveryTrends({ groupBy: 'week' });

      expect(mockDatabaseService.aggregate).toHaveBeenCalledWith(
        'delivery_history',
        expect.arrayContaining([
          expect.any(Object),
          expect.objectContaining({
            $group: expect.objectContaining({
              _id: expect.objectContaining({
                year: { $year: '$timestamp' },
                week: { $week: '$timestamp' }
              })
            })
          })
        ])
      );
    });

    it('should get monthly trends', async () => {
      mockDatabaseService.aggregate.mockResolvedValue(mockTrendsData);

      await service.getDeliveryTrends({ groupBy: 'month' });

      expect(mockDatabaseService.aggregate).toHaveBeenCalledWith(
        'delivery_history',
        expect.arrayContaining([
          expect.any(Object),
          expect.objectContaining({
            $group: expect.objectContaining({
              _id: expect.objectContaining({
                year: { $year: '$timestamp' },
                month: { $month: '$timestamp' }
              })
            })
          })
        ])
      );
    });

    it('should apply filters', async () => {
      mockDatabaseService.aggregate.mockResolvedValue(mockTrendsData);

      await service.getDeliveryTrends({ webhookId: 'webhook_1' });

      expect(mockDatabaseService.aggregate).toHaveBeenCalledWith(
        'delivery_history',
        expect.arrayContaining([
          { $match: { webhookId: 'webhook_1' } },
          expect.any(Object)
        ])
      );
    });

    it('should handle errors', async () => {
      mockDatabaseService.aggregate.mockRejectedValue(new Error('Trends error'));

      await expect(service.getDeliveryTrends()).rejects.toThrow('Trends error');
      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe('getWebhookDeliveryHistory', () => {
    it('should get history for specific webhook', async () => {
      jest.spyOn(service, 'getDeliveryHistory').mockResolvedValue([]);

      await service.getWebhookDeliveryHistory('webhook_1', { limit: 10 });

      expect(service.getDeliveryHistory).toHaveBeenCalledWith({
        webhookId: 'webhook_1',
        limit: 10
      });
    });
  });

  describe('getEventDeliveryHistory', () => {
    it('should get history for specific event', async () => {
      jest.spyOn(service, 'getDeliveryHistory').mockResolvedValue([]);

      await service.getEventDeliveryHistory('event_1', { limit: 10 });

      expect(service.getDeliveryHistory).toHaveBeenCalledWith({
        eventId: 'event_1',
        limit: 10
      });
    });
  });

  describe('getFailedDeliveries', () => {
    it('should get failed deliveries', async () => {
      jest.spyOn(service, 'getDeliveryHistory').mockResolvedValue([]);

      await service.getFailedDeliveries({ limit: 10 });

      expect(service.getDeliveryHistory).toHaveBeenCalledWith({
        success: false,
        limit: 10
      });
    });
  });

  describe('getSlowDeliveries', () => {
    it('should get slow deliveries with default threshold', async () => {
      mockDatabaseService.findMany.mockResolvedValue([]);

      await service.getSlowDeliveries();

      expect(mockDatabaseService.findMany).toHaveBeenCalledWith(
        'delivery_history',
        expect.objectContaining({
          'result.responseTime': { $gte: 5000 }
        }),
        expect.any(Object)
      );
    });

    it('should get slow deliveries with custom threshold', async () => {
      mockDatabaseService.findMany.mockResolvedValue([]);

      await service.getSlowDeliveries(1000, { webhookId: 'webhook_1' });

      expect(mockDatabaseService.findMany).toHaveBeenCalledWith(
        'delivery_history',
        expect.objectContaining({
          webhookId: 'webhook_1',
          'result.responseTime': { $gte: 1000 }
        }),
        expect.any(Object)
      );
    });
  });

  describe('getErrorAnalysis', () => {
    const mockErrorAnalysis = [
      {
        _id: 500,
        count: 15,
        webhooks: ['webhook_1', 'webhook_2'],
        eventTypes: ['event.type1'],
        errors: ['Internal Server Error'],
        averageResponseTime: 1500,
        lastOccurrence: new Date()
      },
      {
        _id: 404,
        count: 5,
        webhooks: ['webhook_3'],
        eventTypes: ['event.type2'],
        errors: ['Not Found'],
        averageResponseTime: 100,
        lastOccurrence: new Date()
      }
    ];

    it('should analyze errors', async () => {
      // Mock the aggregate to return the expected format with $addFields
      const transformedMockErrorAnalysis = mockErrorAnalysis.map(item => ({
        ...item,
        statusCode: item._id,
        webhookCount: item.webhooks.length,
        eventTypeCount: item.eventTypes.length
      }));
      mockDatabaseService.aggregate.mockResolvedValue(transformedMockErrorAnalysis);

      const analysis = await service.getErrorAnalysis();

      expect(mockDatabaseService.aggregate).toHaveBeenCalledWith(
        'delivery_history',
        expect.arrayContaining([
          { $match: { 'result.success': false } },
          expect.objectContaining({
            $group: expect.objectContaining({
              _id: '$result.statusCode'
            })
          })
        ])
      );
      expect(analysis).toHaveLength(2);
      expect(analysis[0]).toHaveProperty('statusCode', 500);
      expect(analysis[0]).toHaveProperty('webhookCount', 2);
    });

    it('should apply filters', async () => {
      mockDatabaseService.aggregate.mockResolvedValue(mockErrorAnalysis);

      await service.getErrorAnalysis({ webhookId: 'webhook_1' });

      expect(mockDatabaseService.aggregate).toHaveBeenCalledWith(
        'delivery_history',
        expect.arrayContaining([
          { $match: expect.objectContaining({ 
            webhookId: 'webhook_1',
            'result.success': false 
          })}
        ])
      );
    });

    it('should handle errors', async () => {
      mockDatabaseService.aggregate.mockRejectedValue(new Error('Analysis error'));

      await expect(service.getErrorAnalysis()).rejects.toThrow('Analysis error');
      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe('exportDeliveryHistory', () => {
    const mockRecords = [
      {
        id: 'hist_1',
        webhookId: 'webhook_1',
        webhookName: 'Test Webhook',
        eventType: 'test.event',
        result: {
          success: true,
          statusCode: 200,
          responseTime: 150,
          error: null
        },
        timestamp: new Date('2024-01-01T10:00:00Z'),
        attempt: 1
      }
    ];

    it('should export as JSON by default', async () => {
      jest.spyOn(service, 'getDeliveryHistory').mockResolvedValue(mockRecords);

      const result = await service.exportDeliveryHistory();

      expect(result).toEqual({
        format: 'json',
        data: mockRecords,
        count: 1,
        exportedAt: expect.any(Date)
      });
    });

    it('should export as CSV', async () => {
      jest.spyOn(service, 'getDeliveryHistory').mockResolvedValue(mockRecords);

      const result = await service.exportDeliveryHistory({}, 'csv');

      expect(result.format).toBe('csv');
      expect(result.data).toContain('ID","Webhook ID","Webhook Name"');
      expect(result.data).toContain('hist_1","webhook_1","Test Webhook"');
      expect(result.count).toBe(1);
    });

    it('should apply query filters', async () => {
      jest.spyOn(service, 'getDeliveryHistory').mockResolvedValue([]);

      await service.exportDeliveryHistory({ webhookId: 'webhook_1' });

      expect(service.getDeliveryHistory).toHaveBeenCalledWith({ webhookId: 'webhook_1' });
    });

    it('should handle errors', async () => {
      jest.spyOn(service, 'getDeliveryHistory').mockRejectedValue(new Error('Export error'));

      await expect(service.exportDeliveryHistory()).rejects.toThrow('Export error');
      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe('cleanupOldHistory', () => {
    it('should delete old records', async () => {
      mockDatabaseService.deleteMany.mockResolvedValue({ deletedCount: 50 });

      const deletedCount = await service.cleanupOldHistory();

      expect(deletedCount).toBe(50);
      expect(mockDatabaseService.deleteMany).toHaveBeenCalledWith(
        'delivery_history',
        {
          timestamp: { $lt: expect.any(Date) }
        }
      );
    });

    it('should use retention period', async () => {
      service.retentionPeriod = 30;
      mockDatabaseService.deleteMany.mockResolvedValue({ deletedCount: 10 });

      await service.cleanupOldHistory();

      const expectedCutoff = new Date();
      expectedCutoff.setDate(expectedCutoff.getDate() - 30);

      const actualCall = mockDatabaseService.deleteMany.mock.calls[0];
      const actualCutoff = actualCall[1].timestamp.$lt;
      
      // Check dates are close (within 1 second)
      expect(Math.abs(actualCutoff - expectedCutoff)).toBeLessThan(1000);
    });

    it('should handle no deletions', async () => {
      mockDatabaseService.deleteMany.mockResolvedValue({ deletedCount: 0 });

      const deletedCount = await service.cleanupOldHistory();

      expect(deletedCount).toBe(0);
    });

    it('should handle errors gracefully', async () => {
      mockDatabaseService.deleteMany.mockRejectedValue(new Error('Delete error'));

      const deletedCount = await service.cleanupOldHistory();

      expect(deletedCount).toBe(0);
      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe('buildFilter', () => {
    it('should build empty filter for empty query', () => {
      const filter = service.buildFilter({});

      expect(filter).toEqual({});
    });

    it('should build filter with all options', () => {
      const filter = service.buildFilter({
        webhookId: 'webhook_1',
        eventType: 'test.event',
        eventId: 'event_1',
        success: true,
        statusCode: 200,
        fromDate: '2024-01-01',
        toDate: '2024-01-31',
        minResponseTime: 100,
        maxResponseTime: 1000
      });

      expect(filter).toEqual({
        webhookId: 'webhook_1',
        eventType: 'test.event',
        eventId: 'event_1',
        'result.success': true,
        'result.statusCode': 200,
        timestamp: {
          $gte: new Date('2024-01-01'),
          $lte: new Date('2024-01-31')
        },
        'result.responseTime': {
          $gte: 100,
          $lte: 1000
        }
      });
    });

    it('should handle response time ranges correctly', () => {
      const filter1 = service.buildFilter({ minResponseTime: 100 });
      expect(filter1['result.responseTime']).toEqual({ $gte: 100 });

      const filter2 = service.buildFilter({ maxResponseTime: 1000 });
      expect(filter2['result.responseTime']).toEqual({ $lte: 1000 });

      const filter3 = service.buildFilter({ minResponseTime: 100, maxResponseTime: 1000 });
      expect(filter3['result.responseTime']).toEqual({ $gte: 100, $lte: 1000 });
    });
  });

  describe('buildQueryOptions', () => {
    it('should build default options', () => {
      const options = service.buildQueryOptions({});

      expect(options).toEqual({
        sort: { timestamp: -1 }
      });
    });

    it('should apply limit with cap', () => {
      const options1 = service.buildQueryOptions({ limit: 50 });
      expect(options1.limit).toBe(50);

      const options2 = service.buildQueryOptions({ limit: 20000 });
      expect(options2.limit).toBe(10000);
    });

    it('should apply skip', () => {
      const options = service.buildQueryOptions({ skip: 100 });
      expect(options.skip).toBe(100);
    });

    it('should apply custom sort', () => {
      const options = service.buildQueryOptions({ 
        sortBy: 'responseTime',
        sortOrder: 'asc'
      });
      expect(options.sort).toEqual({ responseTime: 1 });
    });
  });

  describe('addToCache', () => {
    it('should add record to cache', () => {
      const record = { id: 'hist_1', webhookId: 'webhook_1' };
      
      service.addToCache(record);

      expect(service.recentDeliveries.has('hist_1')).toBe(true);
      expect(service.recentDeliveries.get('hist_1')).toMatchObject({
        ...record,
        cachedAt: expect.any(Number)
      });
    });

    it('should trim cache when exceeding max size', () => {
      service.maxCacheSize = 2;
      
      // Add three records
      service.addToCache({ id: 'hist_1' });
      jest.advanceTimersByTime(100);
      service.addToCache({ id: 'hist_2' });
      jest.advanceTimersByTime(100);
      service.addToCache({ id: 'hist_3' });

      expect(service.recentDeliveries.size).toBe(2);
      expect(service.recentDeliveries.has('hist_1')).toBe(false);
      expect(service.recentDeliveries.has('hist_2')).toBe(true);
      expect(service.recentDeliveries.has('hist_3')).toBe(true);
    });
  });

  describe('updateAnalytics', () => {
    const successRecord = {
      result: { success: true, statusCode: 200, responseTime: 150, error: null },
      webhookId: 'webhook_1',
      eventType: 'test.event',
      timestamp: new Date('2024-01-01T10:00:00Z')
    };

    const failureRecord = {
      result: { success: false, statusCode: 500, responseTime: 1000, error: 'Server Error' },
      webhookId: 'webhook_2',
      eventType: 'error.event',
      timestamp: new Date('2024-01-01T15:00:00Z')
    };

    it('should update delivery counts', () => {
      service.updateAnalytics(successRecord);
      service.updateAnalytics(failureRecord);

      expect(service.analytics.totalDeliveries).toBe(2);
      expect(service.analytics.successfulDeliveries).toBe(1);
      expect(service.analytics.failedDeliveries).toBe(1);
    });

    it('should update response time analytics', () => {
      service.updateAnalytics(successRecord);
      service.updateAnalytics(failureRecord);

      expect(service.analytics.responseTimes).toEqual([150, 1000]);
      expect(service.analytics.averageResponseTime).toBe(575);
    });

    it('should trim response times array', () => {
      service.analytics.responseTimes = new Array(10000).fill(100);
      
      service.updateAnalytics(successRecord);

      expect(service.analytics.responseTimes).toHaveLength(10000);
      expect(service.analytics.responseTimes[service.analytics.responseTimes.length - 1]).toBe(150);
    });

    it('should update status counters', () => {
      service.updateAnalytics(successRecord);
      service.updateAnalytics(failureRecord);

      expect(service.analytics.deliveriesByStatus).toEqual({
        200: 1,
        500: 1
      });
    });

    it('should update webhook counters', () => {
      service.updateAnalytics(successRecord);
      service.updateAnalytics(successRecord);

      expect(service.analytics.deliveriesByWebhook).toEqual({
        webhook_1: 2
      });
    });

    it('should update event type counters', () => {
      service.updateAnalytics(successRecord);
      service.updateAnalytics(failureRecord);

      expect(service.analytics.deliveriesByEventType).toEqual({
        'test.event': 1,
        'error.event': 1
      });
    });

    it('should update time-based counters', () => {
      service.updateAnalytics(successRecord);
      service.updateAnalytics(failureRecord);

      expect(service.analytics.deliveriesByHour).toEqual({
        10: 1,
        15: 1
      });
      // The day string depends on system locale, so just check if keys exist
      expect(Object.keys(service.analytics.deliveriesByDay)).toHaveLength(1);
      expect(Object.values(service.analytics.deliveriesByDay)[0]).toBe(2);
    });

    it('should update error counters', () => {
      service.updateAnalytics(failureRecord);

      expect(service.analytics.errorsByType).toEqual({
        'Server Error': 1
      });
    });
  });

  describe('loadAnalytics', () => {
    it('should load recent analytics from database', async () => {
      jest.spyOn(service, 'getDeliveryStats').mockResolvedValue({
        totalDeliveries: 100,
        successfulDeliveries: 85,
        failedDeliveries: 15,
        averageResponseTime: 250
      });

      await service.loadAnalytics();

      expect(service.getDeliveryStats).toHaveBeenCalledWith({
        fromDate: expect.any(Date)
      });
      expect(service.analytics.totalDeliveries).toBe(100);
      expect(service.analytics.successfulDeliveries).toBe(85);
      expect(service.analytics.failedDeliveries).toBe(15);
      expect(service.analytics.averageResponseTime).toBe(250);
    });

    it('should handle errors gracefully', async () => {
      jest.spyOn(service, 'getDeliveryStats').mockRejectedValue(new Error('Stats error'));

      await service.loadAnalytics();

      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe('compressPayload', () => {
    it('should compress large payloads', () => {
      const largePayload = { data: 'x'.repeat(1500) };
      
      const compressed = service.compressPayload(largePayload);

      expect(compressed).toEqual({
        compressed: true,
        data: JSON.stringify(largePayload),
        originalSize: expect.any(Number),
        compressedSize: expect.any(Number)
      });
    });

    it('should not compress small payloads', () => {
      const smallPayload = { data: 'small' };
      
      const result = service.compressPayload(smallPayload);

      expect(result).toEqual(smallPayload);
    });
  });

  describe('decompressPayload', () => {
    it('should decompress compressed payloads', () => {
      const compressed = {
        compressed: true,
        data: '{"data":"test"}',
        originalSize: 15,
        compressedSize: 15
      };

      const decompressed = service.decompressPayload(compressed);

      expect(decompressed).toEqual({ data: 'test' });
    });

    it('should return uncompressed payloads as is', () => {
      const payload = { data: 'test' };

      const result = service.decompressPayload(payload);

      expect(result).toEqual(payload);
    });
  });

  describe('convertToCSV', () => {
    it('should convert records to CSV format', () => {
      const records = [
        {
          id: 'hist_1',
          webhookId: 'webhook_1',
          webhookName: 'Test Webhook',
          eventType: 'test.event',
          result: {
            success: true,
            statusCode: 200,
            responseTime: 150,
            error: null
          },
          timestamp: new Date('2024-01-01T10:00:00Z'),
          attempt: 1
        }
      ];

      const result = service.convertToCSV(records);

      expect(result.format).toBe('csv');
      expect(result.count).toBe(1);
      expect(result.data).toContain('"ID","Webhook ID","Webhook Name"');
      expect(result.data).toContain('"hist_1","webhook_1","Test Webhook"');
      expect(result.data).toContain('"2024-01-01T10:00:00.000Z"');
    });

    it('should handle empty error field', () => {
      const records = [{
        id: 'hist_1',
        webhookId: 'webhook_1',
        webhookName: 'Test',
        eventType: 'test',
        result: { success: true, statusCode: 200, responseTime: 100, error: null },
        timestamp: new Date(),
        attempt: 1
      }];

      const result = service.convertToCSV(records);

      expect(result.data).toContain('""'); // Empty error field
    });
  });

  describe('generateHistoryId', () => {
    it('should generate unique IDs', () => {
      const id1 = service.generateHistoryId();
      const id2 = service.generateHistoryId();

      expect(id1).toMatch(/^hist_\d+_[a-z0-9]+$/);
      expect(id2).toMatch(/^hist_\d+_[a-z0-9]+$/);
      expect(id1).not.toBe(id2);
    });
  });

  describe('getCurrentAnalytics', () => {
    it('should return copy of current analytics', () => {
      service.analytics.totalDeliveries = 100;
      
      const analytics = service.getCurrentAnalytics();

      expect(analytics).toEqual(service.analytics);
      expect(analytics).not.toBe(service.analytics); // Should be a copy
    });
  });

  describe('shutdown', () => {
    it('should clear cache and shutdown gracefully', async () => {
      service.recentDeliveries.set('test', {});
      
      await service.shutdown();

      expect(service.recentDeliveries.size).toBe(0);
      expect(logger.info).toHaveBeenCalledWith('Shutting down Delivery History Service...');
      expect(logger.info).toHaveBeenCalledWith('Delivery History Service shut down successfully');
    });

    it('should handle shutdown errors', async () => {
      // Mock clear to throw
      jest.spyOn(service.recentDeliveries, 'clear').mockImplementation(() => {
        throw new Error('Clear error');
      });

      // The shutdown method doesn't throw, just logs errors
      await service.shutdown();

      expect(logger.error).toHaveBeenCalledWith(
        'Error shutting down Delivery History Service:',
        expect.any(Error)
      );
    });
  });

  describe('interval tasks', () => {
    it('should run cleanup periodically', async () => {
      jest.spyOn(service, 'cleanupOldHistory').mockResolvedValue(10);
      
      await service.initialize();
      
      // Fast-forward 24 hours
      jest.advanceTimersByTime(24 * 60 * 60 * 1000);
      
      expect(service.cleanupOldHistory).toHaveBeenCalled();
    });

    it('should run analytics update periodically', async () => {
      jest.spyOn(service, 'loadAnalytics').mockResolvedValue();
      
      await service.initialize();
      
      // Fast-forward 10 minutes
      jest.advanceTimersByTime(10 * 60 * 1000);
      
      expect(service.loadAnalytics).toHaveBeenCalled();
    });

    it('should handle interval errors gracefully', async () => {
      jest.spyOn(service, 'cleanupOldHistory').mockRejectedValue(new Error('Cleanup error'));
      jest.spyOn(service, 'loadAnalytics').mockRejectedValue(new Error('Analytics error'));
      
      await service.initialize();
      
      // Fast-forward to trigger cleanup interval (24 hours)
      await jest.advanceTimersByTimeAsync(24 * 60 * 60 * 1000);
      
      // Fast-forward to trigger analytics interval (10 minutes) 
      await jest.advanceTimersByTimeAsync(10 * 60 * 1000);
      
      // Should not throw, just log errors
      expect(logger.error).toHaveBeenCalledWith('Error in cleanup interval:', expect.any(Error));
      expect(logger.error).toHaveBeenCalledWith('Error in analytics update interval:', expect.any(Error));
    });
  });
});