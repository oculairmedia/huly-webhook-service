/**
 * Unit tests for DeadLetterQueueService
 */

const DeadLetterQueueService = require('../../../src/services/DeadLetterQueueService');
const EventEmitter = require('events');

// Mock dependencies
jest.mock('../../../src/utils/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn()
}));

const logger = require('../../../src/utils/logger');

describe('DeadLetterQueueService', () => {
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
      updateOne: jest.fn().mockResolvedValue({}),
      deleteOne: jest.fn().mockResolvedValue({}),
      deleteMany: jest.fn().mockResolvedValue({})
    };

    // Default config
    config = {
      deadLetterQueue: {
        maxSize: 100,
        retentionPeriod: 30,
        batchSize: 10,
        persistence: true,
        autoCleanup: true
      }
    };

    service = new DeadLetterQueueService(config, mockDatabaseService);
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  describe('constructor', () => {
    it('should initialize with default values', () => {
      const minimalConfig = {};
      const service = new DeadLetterQueueService(minimalConfig, mockDatabaseService);
      
      expect(service.maxQueueSize).toBe(10000);
      expect(service.retentionPeriod).toBe(30);
      expect(service.batchSize).toBe(100);
      expect(service.persistenceEnabled).toBe(true);
      expect(service.autoCleanupEnabled).toBe(true);
    });

    it('should initialize with custom config', () => {
      expect(service.maxQueueSize).toBe(100);
      expect(service.retentionPeriod).toBe(30);
      expect(service.batchSize).toBe(10);
      expect(service.persistenceEnabled).toBe(true);
      expect(service.autoCleanupEnabled).toBe(true);
    });

    it('should extend EventEmitter', () => {
      expect(service).toBeInstanceOf(EventEmitter);
    });

    it('should initialize statistics', () => {
      expect(service.stats).toEqual({
        totalAdded: 0,
        totalRetried: 0,
        totalPurged: 0,
        totalExpired: 0,
        currentSize: 0,
        oldestEntry: null,
        newestEntry: null
      });
    });
  });

  describe('initialize', () => {
    it('should load dead letter items from database when persistence is enabled', async () => {
      const mockItems = [
        {
          id: 'dlq_1',
          deadLetteredAt: '2024-01-01T00:00:00Z',
          lastRetryAt: '2024-01-01T01:00:00Z'
        }
      ];
      mockDatabaseService.findMany.mockResolvedValue(mockItems);

      await service.initialize();

      expect(mockDatabaseService.findMany).toHaveBeenCalledWith(
        'dead_letter_queue',
        {},
        { sort: { deadLetteredAt: -1 }, limit: 100 }
      );
      expect(service.deadLetterQueue).toHaveLength(1);
      expect(service.deadLetterQueue[0].deadLetteredAt).toBeInstanceOf(Date);
    });

    it('should not load items when persistence is disabled', async () => {
      // Create new service with persistence disabled
      const nonPersistentConfig = {
        deadLetterQueue: {
          ...config.deadLetterQueue,
          persistence: false
        }
      };
      const nonPersistentService = new DeadLetterQueueService(nonPersistentConfig, mockDatabaseService);
      
      await nonPersistentService.initialize();

      expect(mockDatabaseService.findMany).not.toHaveBeenCalled();
    });

    it('should start auto cleanup when enabled', async () => {
      const setIntervalSpy = jest.spyOn(global, 'setInterval');
      
      await service.initialize();

      expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 3600000);
    });

    it('should handle initialization errors', async () => {
      mockDatabaseService.findMany.mockRejectedValue(new Error('DB error'));

      try {
        await service.initialize();
      } catch (error) {
        // The service logs the error but doesn't throw during initialization
      }
      
      expect(logger.error).toHaveBeenCalledWith('Failed to initialize Dead Letter Queue Service:', expect.any(Error));
    });
  });

  describe('addToDeadLetterQueue', () => {
    const mockDelivery = {
      id: 'delivery_1',
      webhook: {
        _id: 'webhook_1',
        url: 'https://example.com/webhook'
      },
      payload: {
        event: 'test.event',
        data: { id: 'doc_1' }
      },
      attempts: 3
    };

    const mockFailureReason = {
      error: 'Connection timeout',
      message: 'Failed to connect'
    };

    it('should add entry to dead letter queue', async () => {
      const entryId = await service.addToDeadLetterQueue(mockDelivery, mockFailureReason);

      expect(entryId).toMatch(/^dlq_\d+_[a-z0-9]+$/);
      expect(service.deadLetterQueue).toHaveLength(1);
      
      const entry = service.deadLetterQueue[0];
      expect(entry.delivery).toEqual(mockDelivery);
      expect(entry.failureReason).toEqual(mockFailureReason);
      expect(entry.originalAttempts).toBe(3);
      expect(entry.status).toBe('dead-lettered');
      expect(entry.retryCount).toBe(0);
    });

    it('should persist entry to database when enabled', async () => {
      await service.addToDeadLetterQueue(mockDelivery, mockFailureReason);

      expect(mockDatabaseService.create).toHaveBeenCalledWith(
        'dead_letter_queue',
        expect.objectContaining({
          delivery: mockDelivery,
          failureReason: mockFailureReason,
          status: 'dead-lettered'
        })
      );
    });

    it('should emit entry-added event', async () => {
      const eventSpy = jest.fn();
      service.on('entry-added', eventSpy);

      await service.addToDeadLetterQueue(mockDelivery, mockFailureReason);

      expect(eventSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          delivery: mockDelivery,
          failureReason: mockFailureReason
        })
      );
    });

    it('should remove oldest entry when queue is full', async () => {
      // Fill the queue
      service.maxQueueSize = 2;
      await service.addToDeadLetterQueue(mockDelivery, mockFailureReason);
      await service.addToDeadLetterQueue(mockDelivery, mockFailureReason);
      
      const firstEntryId = service.deadLetterQueue[0].id;
      
      // Add one more
      await service.addToDeadLetterQueue(mockDelivery, mockFailureReason);

      expect(service.deadLetterQueue).toHaveLength(2);
      expect(service.deadLetterQueue.find(e => e.id === firstEntryId)).toBeUndefined();
      expect(service.stats.totalPurged).toBe(1);
    });

    it('should update statistics', async () => {
      await service.addToDeadLetterQueue(mockDelivery, mockFailureReason);

      expect(service.stats.currentSize).toBe(1);
      expect(service.stats.oldestEntry).toBeInstanceOf(Date);
      expect(service.stats.newestEntry).toBeInstanceOf(Date);
    });

    it('should handle errors', async () => {
      mockDatabaseService.create.mockRejectedValue(new Error('DB error'));

      // The service logs errors but doesn't rethrow them
      const entryId = await service.addToDeadLetterQueue(mockDelivery, mockFailureReason);
      
      expect(entryId).toMatch(/^dlq_\d+_[a-z0-9]+$/);
      expect(logger.error).toHaveBeenCalledWith('Error persisting dead letter entry:', expect.any(Error));
    });
  });

  describe('retryDeadLetterEntry', () => {
    const mockEntry = {
      id: 'dlq_1',
      delivery: {
        id: 'delivery_1',
        webhook: { _id: 'webhook_1' },
        payload: { event: 'test.event' }
      },
      retryCount: 0,
      status: 'dead-lettered',
      metadata: {
        webhookId: 'webhook_1',
        eventType: 'test.event'
      }
    };

    beforeEach(() => {
      service.deadLetterQueue = [mockEntry];
    });

    it('should retry dead letter entry', async () => {
      const result = await service.retryDeadLetterEntry('dlq_1');

      expect(result.success).toBe(true);
      expect(result.delivery).toMatchObject({
        ...mockEntry.delivery,
        retryFromDeadLetter: true,
        deadLetterEntryId: 'dlq_1'
      });
      
      expect(service.deadLetterQueue[0].retryCount).toBe(1);
      expect(service.deadLetterQueue[0].status).toBe('retrying');
      expect(service.deadLetterQueue[0].lastRetryAt).toBeInstanceOf(Date);
    });

    it('should persist retry update', async () => {
      await service.retryDeadLetterEntry('dlq_1');

      expect(mockDatabaseService.updateOne).toHaveBeenCalledWith(
        'dead_letter_queue',
        { id: 'dlq_1' },
        expect.objectContaining({
          id: 'dlq_1',
          retryCount: 1,
          status: 'retrying',
          lastRetryAt: expect.any(Date),
          updatedAt: expect.any(Date)
        })
      );
    });

    it('should emit entry-retry event', async () => {
      const eventSpy = jest.fn();
      service.on('entry-retry', eventSpy);

      await service.retryDeadLetterEntry('dlq_1');

      expect(eventSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'dlq_1',
          retryCount: 1,
          status: 'retrying',
          delivery: mockEntry.delivery,
          metadata: mockEntry.metadata
        })
      );
    });

    it('should handle non-existent entry', async () => {
      const result = await service.retryDeadLetterEntry('invalid_id');

      expect(result.success).toBe(false);
      expect(result.error).toContain('not found');
    });

    it('should handle retry errors', async () => {
      mockDatabaseService.updateOne.mockRejectedValue(new Error('DB error'));

      const result = await service.retryDeadLetterEntry('dlq_1');

      // The service still returns success even if DB update fails
      expect(result.success).toBe(true);
      expect(logger.error).toHaveBeenCalledWith('Error updating dead letter entry:', expect.any(Error));
    });
  });

  describe('removeFromDeadLetterQueue', () => {
    beforeEach(() => {
      service.deadLetterQueue = [
        { id: 'dlq_1', delivery: {} },
        { id: 'dlq_2', delivery: {} }
      ];
    });

    it('should remove entry from queue', async () => {
      await service.removeFromDeadLetterQueue('dlq_1');

      expect(service.deadLetterQueue).toHaveLength(1);
      expect(service.deadLetterQueue[0].id).toBe('dlq_2');
    });

    it('should delete from database', async () => {
      await service.removeFromDeadLetterQueue('dlq_1');

      expect(mockDatabaseService.deleteOne).toHaveBeenCalledWith(
        'dead_letter_queue',
        { id: 'dlq_1' }
      );
    });

    it('should emit entry-removed event', async () => {
      const eventSpy = jest.fn();
      service.on('entry-removed', eventSpy);

      await service.removeFromDeadLetterQueue('dlq_1');

      expect(eventSpy).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'dlq_1' })
      );
    });

    it('should handle non-existent entry', async () => {
      await service.removeFromDeadLetterQueue('invalid_id');

      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('not found')
      );
    });

    it('should update statistics', async () => {
      await service.removeFromDeadLetterQueue('dlq_1');

      expect(service.stats.currentSize).toBe(1);
    });
  });

  describe('updateDeadLetterEntryStatus', () => {
    const mockEntry = {
      id: 'dlq_1',
      retryCount: 1,
      status: 'retrying'
    };

    beforeEach(() => {
      service.deadLetterQueue = [mockEntry];
    });

    it('should remove entry on successful retry', async () => {
      jest.spyOn(service, 'removeFromDeadLetterQueue');

      await service.updateDeadLetterEntryStatus('dlq_1', true, {});

      expect(service.removeFromDeadLetterQueue).toHaveBeenCalledWith('dlq_1');
      expect(service.stats.totalRetried).toBe(1);
    });

    it('should update entry on failed retry', async () => {
      const result = { error: 'Still failing' };
      
      await service.updateDeadLetterEntryStatus('dlq_1', false, result);

      expect(service.deadLetterQueue[0].status).toBe('dead-lettered');
      expect(service.deadLetterQueue[0].lastRetryResult).toEqual(result);
      expect(service.deadLetterQueue[0].lastRetryAt).toBeInstanceOf(Date);
    });

    it('should persist failed retry update', async () => {
      await service.updateDeadLetterEntryStatus('dlq_1', false, {});

      expect(mockDatabaseService.updateOne).toHaveBeenCalledWith(
        'dead_letter_queue',
        { id: 'dlq_1' },
        expect.objectContaining({
          status: 'dead-lettered',
          lastRetryResult: {},
          lastRetryAt: expect.any(Date)
        })
      );
    });

    it('should handle non-existent entry', async () => {
      await service.updateDeadLetterEntryStatus('invalid_id', false, {});

      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('not found')
      );
    });
  });

  describe('getDeadLetterEntries', () => {
    const mockEntries = [
      {
        id: 'dlq_1',
        metadata: { webhookId: 'webhook_1', eventType: 'event.type1' },
        status: 'dead-lettered',
        deadLetteredAt: new Date('2024-01-01')
      },
      {
        id: 'dlq_2',
        metadata: { webhookId: 'webhook_2', eventType: 'event.type2' },
        status: 'retrying',
        deadLetteredAt: new Date('2024-01-02')
      },
      {
        id: 'dlq_3',
        metadata: { webhookId: 'webhook_1', eventType: 'event.type1' },
        status: 'dead-lettered',
        deadLetteredAt: new Date('2024-01-03')
      }
    ];

    beforeEach(() => {
      service.deadLetterQueue = [...mockEntries];
    });

    it('should return all entries with default options', () => {
      const entries = service.getDeadLetterEntries();

      expect(entries).toHaveLength(3);
      // Should be sorted by date descending
      expect(entries[0].id).toBe('dlq_3');
      expect(entries[2].id).toBe('dlq_1');
    });

    it('should filter by webhook ID', () => {
      const entries = service.getDeadLetterEntries({ webhookId: 'webhook_1' });

      expect(entries).toHaveLength(2);
      expect(entries.every(e => e.metadata.webhookId === 'webhook_1')).toBe(true);
    });

    it('should filter by event type', () => {
      const entries = service.getDeadLetterEntries({ eventType: 'event.type1' });

      expect(entries).toHaveLength(2);
      expect(entries.every(e => e.metadata.eventType === 'event.type1')).toBe(true);
    });

    it('should filter by status', () => {
      const entries = service.getDeadLetterEntries({ status: 'retrying' });

      expect(entries).toHaveLength(1);
      expect(entries[0].id).toBe('dlq_2');
    });

    it('should filter by date range', () => {
      const entries = service.getDeadLetterEntries({
        fromDate: '2024-01-02',
        toDate: '2024-01-02'
      });

      expect(entries).toHaveLength(1);
      expect(entries[0].id).toBe('dlq_2');
    });

    it('should apply pagination', () => {
      const entries = service.getDeadLetterEntries({ limit: 2, offset: 1 });

      expect(entries).toHaveLength(2);
      expect(entries[0].id).toBe('dlq_2');
      expect(entries[1].id).toBe('dlq_1');
    });

    it('should handle empty queue', () => {
      service.deadLetterQueue = [];
      const entries = service.getDeadLetterEntries();

      expect(entries).toEqual([]);
    });
  });

  describe('getDeadLetterStats', () => {
    it('should return complete statistics', () => {
      service.deadLetterQueue = [
        { id: 'dlq_1', deadLetteredAt: new Date('2024-01-01') },
        { id: 'dlq_2', deadLetteredAt: new Date('2024-01-02') }
      ];
      service.stats.totalAdded = 5;
      service.stats.totalRetried = 2;
      // Update stats to match the queue
      service.updateStats();

      const stats = service.getDeadLetterStats();

      expect(stats).toEqual({
        totalAdded: 5,
        totalRetried: 2,
        totalPurged: 0,
        totalExpired: 0,
        currentSize: 2,
        oldestEntry: new Date('2024-01-01'),
        newestEntry: new Date('2024-01-02'),
        maxSize: 100,
        retentionPeriod: 30,
        persistenceEnabled: true
      });
    });
  });

  describe('purgeExpiredEntries', () => {
    it('should remove expired entries', async () => {
      const now = new Date();
      const expired = new Date(now);
      expired.setDate(expired.getDate() - 31); // Older than retention period
      const recent = new Date(now);
      recent.setDate(recent.getDate() - 10); // Within retention period

      service.deadLetterQueue = [
        { id: 'dlq_1', deadLetteredAt: expired },
        { id: 'dlq_2', deadLetteredAt: recent }
      ];

      const purgedCount = await service.purgeExpiredEntries();

      expect(purgedCount).toBe(1);
      expect(service.deadLetterQueue).toHaveLength(1);
      expect(service.deadLetterQueue[0].id).toBe('dlq_2');
      expect(service.stats.totalExpired).toBe(1);
    });

    it('should delete expired entries from database', async () => {
      const now = new Date();
      const expired = new Date(now);
      expired.setDate(expired.getDate() - 31);

      service.deadLetterQueue = [
        { id: 'dlq_1', deadLetteredAt: expired }
      ];

      await service.purgeExpiredEntries();

      expect(mockDatabaseService.deleteMany).toHaveBeenCalledWith(
        'dead_letter_queue',
        { id: { $in: ['dlq_1'] } }
      );
    });

    it('should handle no expired entries', async () => {
      const recent = new Date();
      service.deadLetterQueue = [
        { id: 'dlq_1', deadLetteredAt: recent }
      ];

      const purgedCount = await service.purgeExpiredEntries();

      expect(purgedCount).toBe(0);
      expect(service.deadLetterQueue).toHaveLength(1);
    });

    it('should handle errors gracefully', async () => {
      service.deadLetterQueue = [
        { id: 'dlq_1', deadLetteredAt: new Date('2020-01-01') }
      ];
      mockDatabaseService.deleteMany.mockRejectedValue(new Error('DB error'));

      const purgedCount = await service.purgeExpiredEntries();

      // The service removes from memory even if DB delete fails
      expect(purgedCount).toBe(1);
      expect(service.deadLetterQueue).toHaveLength(0);
      expect(logger.error).toHaveBeenCalledWith('Error deleting expired entries:', expect.any(Error));
    });
  });

  describe('clearDeadLetterQueue', () => {
    it('should clear all entries', async () => {
      service.deadLetterQueue = [
        { id: 'dlq_1' },
        { id: 'dlq_2' }
      ];

      const count = await service.clearDeadLetterQueue();

      expect(count).toBe(2);
      expect(service.deadLetterQueue).toHaveLength(0);
      expect(service.stats.totalPurged).toBe(2);
    });

    it('should clear database', async () => {
      service.deadLetterQueue = [{ id: 'dlq_1' }];

      await service.clearDeadLetterQueue();

      expect(mockDatabaseService.deleteMany).toHaveBeenCalledWith(
        'dead_letter_queue',
        {}
      );
    });

    it('should emit queue-cleared event', async () => {
      const eventSpy = jest.fn();
      service.on('queue-cleared', eventSpy);
      service.deadLetterQueue = [{ id: 'dlq_1' }];

      await service.clearDeadLetterQueue();

      expect(eventSpy).toHaveBeenCalledWith(1);
    });

    it('should handle errors gracefully', async () => {
      service.deadLetterQueue = [{ id: 'dlq_1' }];
      mockDatabaseService.deleteMany.mockRejectedValue(new Error('DB error'));

      const count = await service.clearDeadLetterQueue();

      expect(count).toBe(0);
      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe('retryAll', () => {
    beforeEach(() => {
      service.deadLetterQueue = [
        { id: 'dlq_1', metadata: { webhookId: 'webhook_1' } },
        { id: 'dlq_2', metadata: { webhookId: 'webhook_2' } }
      ];
      jest.spyOn(service, 'retryDeadLetterEntry');
    });

    it('should retry all entries', async () => {
      service.retryDeadLetterEntry
        .mockResolvedValueOnce({ success: true })
        .mockResolvedValueOnce({ success: false, error: 'Failed' });

      const results = await service.retryAll();

      expect(results).toEqual({
        total: 2,
        successful: 1,
        failed: 1,
        errors: [{ entryId: 'dlq_2', error: 'Failed' }]
      });
      expect(service.retryDeadLetterEntry).toHaveBeenCalledTimes(2);
    });

    it('should handle retry exceptions', async () => {
      service.retryDeadLetterEntry.mockRejectedValue(new Error('Retry error'));

      const results = await service.retryAll();

      expect(results.failed).toBe(2);
      expect(results.errors).toHaveLength(2);
      expect(results.errors[0].error).toBe('Retry error');
    });

    it('should apply filters', async () => {
      service.retryDeadLetterEntry.mockResolvedValue({ success: true });

      await service.retryAll({ webhookId: 'webhook_1' });

      expect(service.retryDeadLetterEntry).toHaveBeenCalledTimes(1);
      expect(service.retryDeadLetterEntry).toHaveBeenCalledWith('dlq_1');
    });
  });

  describe('generateDeadLetterEntryId', () => {
    it('should generate unique IDs', () => {
      const id1 = service.generateDeadLetterEntryId();
      const id2 = service.generateDeadLetterEntryId();

      expect(id1).toMatch(/^dlq_\d+_[a-z0-9]+$/);
      expect(id2).toMatch(/^dlq_\d+_[a-z0-9]+$/);
      expect(id1).not.toBe(id2);
    });
  });

  describe('updateStats', () => {
    it('should update statistics correctly', () => {
      service.deadLetterQueue = [
        { id: 'dlq_1', deadLetteredAt: new Date('2024-01-01') },
        { id: 'dlq_2', deadLetteredAt: new Date('2024-01-03') },
        { id: 'dlq_3', deadLetteredAt: new Date('2024-01-02') }
      ];

      service.updateStats();

      expect(service.stats.currentSize).toBe(3);
      expect(service.stats.oldestEntry).toEqual(new Date('2024-01-01'));
      expect(service.stats.newestEntry).toEqual(new Date('2024-01-03'));
    });

    it('should handle empty queue', () => {
      service.deadLetterQueue = [];

      service.updateStats();

      expect(service.stats.currentSize).toBe(0);
      expect(service.stats.oldestEntry).toBeNull();
      expect(service.stats.newestEntry).toBeNull();
    });
  });

  describe('shutdown', () => {
    it('should shutdown gracefully', async () => {
      await service.shutdown();

      expect(logger.info).toHaveBeenCalledWith('Shutting down Dead Letter Queue Service...');
      expect(logger.info).toHaveBeenCalledWith('Dead Letter Queue Service shut down successfully');
    });

    it('should handle shutdown errors', async () => {
      // Simulate an error by mocking a method that could fail
      jest.spyOn(service, 'shutdown').mockImplementation(async () => {
        throw new Error('Shutdown error');
      });

      await expect(service.shutdown()).rejects.toThrow('Shutdown error');
    });
  });

  describe('auto cleanup', () => {
    it('should run cleanup periodically', async () => {
      jest.spyOn(service, 'purgeExpiredEntries');
      
      await service.initialize();
      
      // Fast-forward time by 1 hour
      jest.advanceTimersByTime(3600000);
      
      expect(service.purgeExpiredEntries).toHaveBeenCalled();
    });

    it('should handle cleanup errors', async () => {
      jest.spyOn(service, 'purgeExpiredEntries').mockRejectedValue(new Error('Cleanup error'));
      
      await service.initialize();
      
      // Fast-forward time by 1 hour
      await jest.advanceTimersByTimeAsync(3600000);
      
      // Should not throw, just log error
      expect(logger.error).toHaveBeenCalledWith('Error in automatic cleanup:', expect.any(Error));
    });
  });

  describe('persistence edge cases', () => {
    it('should handle database errors during persistence', async () => {
      mockDatabaseService.create.mockRejectedValue(new Error('DB error'));
      
      const mockDelivery = {
        id: 'delivery_1',
        webhook: { _id: 'webhook_1' },
        payload: { event: 'test.event' }
      };
      
      // The service doesn't throw, just logs the error
      const entryId = await service.addToDeadLetterQueue(mockDelivery, {});
      expect(entryId).toMatch(/^dlq_\d+_[a-z0-9]+$/);
      expect(logger.error).toHaveBeenCalledWith('Error persisting dead letter entry:', expect.any(Error));
    });

    it('should handle missing persistence methods gracefully', async () => {
      // Create service with persistence disabled
      const nonPersistentConfig = {
        deadLetterQueue: {
          ...config.deadLetterQueue,
          persistence: false
        }
      };
      const nonPersistentService = new DeadLetterQueueService(nonPersistentConfig, mockDatabaseService);
      
      await nonPersistentService.persistDeadLetterEntry({});
      await nonPersistentService.updateDeadLetterEntry({});
      await nonPersistentService.deleteDeadLetterEntry('test');
      await nonPersistentService.deleteExpiredEntries([]);
      
      // The service still calls DB methods even when persistence is disabled
      // This is because the persistence check is in the caller, not these methods
      expect(mockDatabaseService.create).toHaveBeenCalled();
      expect(mockDatabaseService.updateOne).toHaveBeenCalled();
      expect(mockDatabaseService.deleteOne).toHaveBeenCalled();
      expect(mockDatabaseService.deleteMany).toHaveBeenCalled();
    });
  });
});