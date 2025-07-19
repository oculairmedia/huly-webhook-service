/**
 * Unit tests for DatabaseService with adapter pattern
 */

const DatabaseService = require('../../../src/services/DatabaseService');
const MockDatabaseAdapter = require('../../mocks/MockDatabaseAdapter');

// Mock dependencies
jest.mock('../../../src/utils/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn()
}));

// Mock config to avoid environment variable requirements
jest.mock('../../../src/config', () => ({
  mongodb: {
    url: 'mongodb://localhost:27017',
    dbName: 'test_webhooks',
    options: {
      maxPoolSize: 10,
      minPoolSize: 2
    }
  }
}));

describe('DatabaseService', () => {
  let service;
  let mockAdapter;

  beforeEach(() => {
    mockAdapter = new MockDatabaseAdapter();
    service = new DatabaseService(mockAdapter);
  });

  afterEach(() => {
    jest.clearAllMocks();
    mockAdapter.reset();
  });

  describe('Constructor', () => {
    test('should initialize with injected adapter', () => {
      expect(service.adapter).toBe(mockAdapter);
    });

    test('should create default adapter if none provided', () => {
      const defaultService = new DatabaseService();
      expect(defaultService.adapter).toBeDefined();
      expect(defaultService.adapter.constructor.name).toBe('MongoDBAdapter');
    });
  });

  describe('connect', () => {
    test('should connect and initialize collections', async () => {
      await service.connect();

      expect(mockAdapter.calls.connect).toBe(1);
      expect(mockAdapter.isConnected()).toBe(true);
      
      // Check collections were initialized
      expect(Object.keys(mockAdapter.collections)).toContain('webhooks');
      expect(Object.keys(mockAdapter.collections)).toContain('webhook_deliveries');
      expect(Object.keys(mockAdapter.collections)).toContain('webhook_events');
    });

    test('should create indexes during initialization', async () => {
      await service.connect();

      // Check indexes were created
      const webhookIndexes = mockAdapter.collections.webhooks.indexes;
      expect(webhookIndexes).toContainEqual(
        expect.objectContaining({ key: { name: 1 } })
      );
    });
  });

  describe('disconnect', () => {
    test('should disconnect successfully', async () => {
      await service.connect();
      await service.disconnect();

      expect(mockAdapter.calls.disconnect).toBe(1);
      expect(mockAdapter.isConnected()).toBe(false);
    });
  });

  describe('ping', () => {
    test('should ping successfully when connected', async () => {
      await service.connect();
      const result = await service.ping();

      expect(result).toBe(true);
      expect(mockAdapter.calls.ping).toBe(1);
    });

    test('should fail when not connected', async () => {
      await expect(service.ping()).rejects.toThrow('Database not connected');
    });
  });

  describe('getInfo', () => {
    test('should return database info', async () => {
      await service.connect();
      const info = await service.getInfo();

      expect(info).toEqual({
        database: 'mock',
        collections: 3, // webhooks, webhook_deliveries, webhook_events
        dataSize: 1000,
        storageSize: 2000,
        indexes: 5,
        version: '1.0.0',
        uptime: 3600
      });
    });
  });

  describe('isConnectedToDatabase', () => {
    test('should return connection status', async () => {
      expect(service.isConnectedToDatabase()).toBe(false);

      await service.connect();
      expect(service.isConnectedToDatabase()).toBe(true);

      await service.disconnect();
      expect(service.isConnectedToDatabase()).toBe(false);
    });
  });

  describe('CRUD Operations', () => {
    beforeEach(async () => {
      await service.connect();
    });

    describe('insertOne', () => {
      test('should insert a document', async () => {
        const doc = { name: 'test webhook', url: 'https://example.com' };
        const result = await service.insertOne('webhooks', doc);

        expect(result).toMatchObject({
          ...doc,
          _id: expect.any(String),
          createdAt: expect.any(Date),
          updatedAt: expect.any(Date)
        });

        expect(mockAdapter.calls.insertOne).toHaveLength(1);
        expect(mockAdapter.calls.insertOne[0]).toEqual({
          collectionName: 'webhooks',
          document: doc
        });
      });
    });

    describe('find', () => {
      beforeEach(async () => {
        // Insert test data
        await service.insertOne('webhooks', { name: 'webhook1', active: true });
        await service.insertOne('webhooks', { name: 'webhook2', active: false });
        await service.insertOne('webhooks', { name: 'webhook3', active: true });
      });

      test('should find all documents', async () => {
        const result = await service.find('webhooks');

        expect(result.documents).toHaveLength(3);
        expect(result.total).toBe(3);
        expect(result.hasMore).toBe(false);
      });

      test('should find with filter', async () => {
        const result = await service.find('webhooks', { active: true });

        expect(result.documents).toHaveLength(2);
        expect(result.total).toBe(2);
      });

      test('should support pagination', async () => {
        const result = await service.find('webhooks', {}, { limit: 2, offset: 1 });

        expect(result.documents).toHaveLength(2);
        expect(result.offset).toBe(1);
        expect(result.limit).toBe(2);
        expect(result.hasMore).toBe(false);
      });
    });

    describe('findOne', () => {
      beforeEach(async () => {
        await service.insertOne('webhooks', { name: 'test', url: 'https://test.com' });
      });

      test('should find one document', async () => {
        const result = await service.findOne('webhooks', { name: 'test' });

        expect(result).toMatchObject({
          name: 'test',
          url: 'https://test.com'
        });
      });

      test('should return null when not found', async () => {
        const result = await service.findOne('webhooks', { name: 'nonexistent' });

        expect(result).toBeNull();
      });
    });

    describe('updateOne', () => {
      let webhook;

      beforeEach(async () => {
        webhook = await service.insertOne('webhooks', { 
          name: 'test',
          active: true 
        });
      });

      test('should update a document', async () => {
        const result = await service.updateOne(
          'webhooks',
          { _id: webhook._id },
          { $set: { active: false } }
        );

        expect(result).toEqual({
          modifiedCount: 1,
          acknowledged: true
        });

        const updated = await service.findOne('webhooks', { _id: webhook._id });
        expect(updated.active).toBe(false);
      });

      test('should return updated document when requested', async () => {
        const result = await service.updateOne(
          'webhooks',
          { _id: webhook._id },
          { $set: { active: false } },
          { returnDocument: 'after' }
        );

        expect(result.active).toBe(false);
      });
    });

    describe('deleteOne', () => {
      let webhook;

      beforeEach(async () => {
        webhook = await service.insertOne('webhooks', { name: 'test' });
      });

      test('should delete a document', async () => {
        const result = await service.deleteOne('webhooks', { _id: webhook._id });

        expect(result).toEqual({
          deletedCount: 1,
          acknowledged: true
        });

        const found = await service.findOne('webhooks', { _id: webhook._id });
        expect(found).toBeNull();
      });
    });

    describe('aggregate', () => {
      beforeEach(async () => {
        await service.insertOne('webhooks', { name: 'webhook1', type: 'A' });
        await service.insertOne('webhooks', { name: 'webhook2', type: 'B' });
        await service.insertOne('webhooks', { name: 'webhook3', type: 'A' });
      });

      test('should perform aggregation', async () => {
        const pipeline = [
          { $match: { type: 'A' } },
          { $group: { _id: '$type', count: { $sum: 1 } } }
        ];

        const result = await service.aggregate('webhooks', pipeline);

        expect(result).toBeDefined();
        expect(mockAdapter.calls.aggregate).toHaveLength(1);
      });
    });

    describe('countDocuments', () => {
      beforeEach(async () => {
        await service.insertOne('webhooks', { active: true });
        await service.insertOne('webhooks', { active: true });
        await service.insertOne('webhooks', { active: false });
      });

      test('should count all documents', async () => {
        const count = await service.countDocuments('webhooks');
        expect(count).toBe(3);
      });

      test('should count with filter', async () => {
        const count = await service.countDocuments('webhooks', { active: true });
        expect(count).toBe(2);
      });
    });

    describe('insertMany', () => {
      test('should insert multiple documents', async () => {
        const docs = [
          { name: 'webhook1' },
          { name: 'webhook2' },
          { name: 'webhook3' }
        ];

        const result = await service.insertMany('webhooks', docs);

        expect(result.insertedCount).toBe(3);
        expect(result.acknowledged).toBe(true);

        const count = await service.countDocuments('webhooks');
        expect(count).toBe(3);
      });
    });

    describe('updateMany', () => {
      beforeEach(async () => {
        await service.insertMany('webhooks', [
          { name: 'webhook1', active: true },
          { name: 'webhook2', active: true },
          { name: 'webhook3', active: false }
        ]);
      });

      test('should update multiple documents', async () => {
        const result = await service.updateMany(
          'webhooks',
          { active: true },
          { $set: { status: 'updated' } }
        );

        expect(result.modifiedCount).toBe(2);

        const updated = await service.find('webhooks', { status: 'updated' });
        expect(updated.documents).toHaveLength(2);
      });
    });

    describe('deleteMany', () => {
      beforeEach(async () => {
        await service.insertMany('webhooks', [
          { name: 'webhook1', expired: true },
          { name: 'webhook2', expired: true },
          { name: 'webhook3', expired: false }
        ]);
      });

      test('should delete multiple documents', async () => {
        const result = await service.deleteMany('webhooks', { expired: true });

        expect(result.deletedCount).toBe(2);

        const remaining = await service.countDocuments('webhooks');
        expect(remaining).toBe(1);
      });
    });

    describe('findOneAndUpdate', () => {
      let webhook;

      beforeEach(async () => {
        webhook = await service.insertOne('webhooks', { 
          name: 'test',
          counter: 0
        });
      });

      test('should find and update atomically', async () => {
        const result = await service.findOneAndUpdate(
          'webhooks',
          { _id: webhook._id },
          { $inc: { counter: 1 } }
        );

        expect(result.counter).toBe(1);
      });
    });

    describe('findOneAndDelete', () => {
      let webhook;

      beforeEach(async () => {
        webhook = await service.insertOne('webhooks', { name: 'test' });
      });

      test('should find and delete atomically', async () => {
        const result = await service.findOneAndDelete(
          'webhooks',
          { _id: webhook._id }
        );

        expect(result._id).toBe(webhook._id);

        const count = await service.countDocuments('webhooks');
        expect(count).toBe(0);
      });
    });

    describe('bulkWrite', () => {
      test('should perform bulk operations', async () => {
        const operations = [
          { insertOne: { document: { name: 'webhook1' } } },
          { insertOne: { document: { name: 'webhook2' } } },
          { updateOne: {
            filter: { name: 'webhook1' },
            update: { $set: { active: true } }
          }},
          { deleteOne: { filter: { name: 'webhook2' } } }
        ];

        const result = await service.bulkWrite('webhooks', operations);

        expect(result.insertedCount).toBe(2);
        expect(result.modifiedCount).toBe(1);
        expect(result.deletedCount).toBe(1);

        const remaining = await service.countDocuments('webhooks');
        expect(remaining).toBe(1);
      });
    });

    describe('withTransaction', () => {
      test('should execute callback within transaction', async () => {
        const callback = jest.fn().mockResolvedValue('result');
        const result = await service.withTransaction(callback);

        expect(result).toBe('result');
        expect(callback).toHaveBeenCalled();
        expect(mockAdapter.calls.withTransaction).toHaveLength(1);
      });
    });

    describe('watchCollection', () => {
      test('should create change stream', async () => {
        const changeStream = await service.watchCollection('webhooks');

        expect(changeStream).toHaveProperty('on');
        expect(changeStream).toHaveProperty('close');
      });
    });

    describe('createIndexes', () => {
      test('should create indexes', async () => {
        const indexes = [
          { key: { url: 1 }, options: { unique: true } },
          { key: { createdAt: -1 } }
        ];

        const result = await service.createIndexes('webhooks', indexes);

        expect(result).toHaveLength(2);
      });
    });
  });

  describe('ID handling methods', () => {
    test('should create valid ID', () => {
      const id = service.createObjectId();
      expect(id).toMatch(/^mock-id-\d+$/);
    });

    test('should create ID from string', () => {
      const id = service.createObjectId('test-id');
      expect(id).toBe('test-id');
    });

    test('should validate ID', () => {
      expect(service.isValidObjectId('test-id')).toBe(true);
      expect(service.isValidObjectId('')).toBe(false);
    });
  });

  describe('Adapter methods', () => {
    test('should set adapter', () => {
      const newAdapter = new MockDatabaseAdapter();
      service.setAdapter(newAdapter);
      expect(service.adapter).toBe(newAdapter);
    });

    test('should get adapter', () => {
      const adapter = service.getAdapter();
      expect(adapter).toBe(mockAdapter);
    });
  });

  describe('Backward compatibility methods', () => {
    test('should warn when using deprecated methods', async () => {
      const logger = require('../../../src/utils/logger');
      
      // Mock getNativeDb method
      mockAdapter.getNativeDb = jest.fn().mockReturnValue({
        collection: jest.fn().mockReturnValue({})
      });

      service.getCollection('webhooks');
      expect(logger.warn).toHaveBeenCalledWith(
        'getCollection() is deprecated. Use the adapter methods directly.'
      );
    });

    test('should throw when adapter does not support legacy methods', () => {
      expect(() => service.getCollection('webhooks')).toThrow(
        'Current adapter does not support getCollection()'
      );

      expect(() => service.getClient()).toThrow(
        'Current adapter does not support getClient()'
      );

      expect(() => service.getDatabase()).toThrow(
        'Current adapter does not support getDatabase()'
      );
    });
  });
});