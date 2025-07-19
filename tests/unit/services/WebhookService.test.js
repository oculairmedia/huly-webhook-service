/**
 * Unit tests for WebhookService
 */

const crypto = require('crypto');
const { ObjectId } = require('mongodb');
const WebhookService = require('../../../src/services/WebhookService');
const { createMockDatabaseService } = require('../../helpers/mockServices');
const { 
  activeWebhook, 
  inactiveWebhook, 
  createWebhook,
  allWebhooks 
} = require('../../fixtures/webhooks');
const { NotFoundError, ConflictError, ValidationError } = require('../../../src/middleware/errorHandler');

// Mock dependencies
jest.mock('../../../src/utils/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
  timeStart: jest.fn(() => ({ end: jest.fn() }))
}));

jest.mock('../../../src/config', () => ({
  defaultWebhookConfig: {
    retryConfig: {
      maxAttempts: 3,
      backoffMultiplier: 2
    }
  },
  validate: {
    isProduction: jest.fn().mockReturnValue(false)
  }
}));

describe('WebhookService', () => {
  let service;
  let mockDatabaseService;
  let mockObjectId;

  beforeEach(() => {
    jest.clearAllMocks();
    
    // Create mock database service
    mockDatabaseService = {
      insertOne: jest.fn(),
      find: jest.fn(),
      findOne: jest.fn(),
      updateOne: jest.fn(),
      deleteOne: jest.fn(),
      aggregate: jest.fn(),
      countDocuments: jest.fn(),
      createObjectId: jest.fn(),
      isValidObjectId: jest.fn(),
      getCollection: jest.fn()
    };
    
    // Mock ObjectId creation
    mockObjectId = new ObjectId();
    mockDatabaseService.createObjectId.mockReturnValue(mockObjectId);
    
    // Initialize service
    service = new WebhookService(mockDatabaseService);
  });

  describe('createWebhook', () => {
    const webhookData = {
      name: 'Test Webhook',
      url: 'https://test.example.com/webhook',
      events: ['issue.created', 'issue.updated'],
      active: true,
      filters: { projects: ['PROJECT-1'] },
      headers: { 'X-Custom': 'value' },
      retryConfig: { maxAttempts: 5 }
    };

    it('should create a new webhook successfully', async () => {
      const insertedWebhook = { ...webhookData, _id: mockObjectId, createdAt: new Date(), updatedAt: new Date() };
      mockDatabaseService.findOne.mockResolvedValue(null);
      mockDatabaseService.insertOne.mockResolvedValue(insertedWebhook);

      const result = await service.createWebhook(webhookData);

      expect(mockDatabaseService.findOne).toHaveBeenCalledWith('webhooks', { name: webhookData.name });
      expect(mockDatabaseService.insertOne).toHaveBeenCalledWith('webhooks', expect.objectContaining({
        ...webhookData,
        active: true,
        retryConfig: { maxAttempts: 5, backoffMultiplier: 2 },
        createdAt: expect.any(Date),
        updatedAt: expect.any(Date),
        lastDelivery: null,
        failureCount: 0,
        successCount: 0,
        totalDeliveries: 0
      }));
      expect(result).toBeDefined();
      expect(result.secret).toMatch(/^.{8}\.\.\./); // Sanitized secret
    });

    it('should generate a secret if not provided', async () => {
      const dataWithoutSecret = { ...webhookData };
      delete dataWithoutSecret.secret;
      
      mockDatabaseService.findOne.mockResolvedValue(null);
      mockDatabaseService.insertOne.mockResolvedValue({ ...dataWithoutSecret, _id: mockObjectId });

      await service.createWebhook(dataWithoutSecret);

      expect(mockDatabaseService.insertOne).toHaveBeenCalledWith('webhooks', expect.objectContaining({
        secret: expect.stringMatching(/^[a-f0-9]{64}$/) // 32 bytes = 64 hex chars
      }));
    });

    it('should throw ConflictError if webhook name already exists', async () => {
      mockDatabaseService.findOne.mockResolvedValue(activeWebhook);

      await expect(service.createWebhook(webhookData))
        .rejects.toThrow(ConflictError);
      await expect(service.createWebhook(webhookData))
        .rejects.toThrow("Webhook with name 'Test Webhook' already exists");
    });

    it('should validate webhook URL', async () => {
      const invalidUrlData = { ...webhookData, url: 'invalid-url' };
      mockDatabaseService.findOne.mockResolvedValue(null);

      await expect(service.createWebhook(invalidUrlData))
        .rejects.toThrow(ValidationError);
      await expect(service.createWebhook(invalidUrlData))
        .rejects.toThrow('Invalid webhook URL format');
    });

    it('should reject non-HTTP/HTTPS protocols', async () => {
      const ftpUrlData = { ...webhookData, url: 'ftp://example.com/webhook' };
      mockDatabaseService.findOne.mockResolvedValue(null);

      await expect(service.createWebhook(ftpUrlData))
        .rejects.toThrow(ValidationError);
      await expect(service.createWebhook(ftpUrlData))
        .rejects.toThrow('Webhook URL must use HTTP or HTTPS protocol');
    });

    it('should set default values correctly', async () => {
      const minimalData = {
        name: 'Minimal Webhook',
        url: 'https://minimal.example.com/webhook',
        events: ['issue.created']
      };
      
      mockDatabaseService.findOne.mockResolvedValue(null);
      mockDatabaseService.insertOne.mockResolvedValue({ ...minimalData, _id: mockObjectId });

      await service.createWebhook(minimalData);

      expect(mockDatabaseService.insertOne).toHaveBeenCalledWith('webhooks', expect.objectContaining({
        active: true,
        filters: {},
        headers: {},
        retryConfig: { maxAttempts: 3, backoffMultiplier: 2 },
        failureCount: 0,
        successCount: 0,
        totalDeliveries: 0,
        lastDelivery: null
      }));
    });

    it('should handle database errors gracefully', async () => {
      mockDatabaseService.findOne.mockRejectedValue(new Error('Database connection failed'));

      await expect(service.createWebhook(webhookData))
        .rejects.toThrow('Database connection failed');
    });
  });

  describe('getWebhook', () => {
    it('should retrieve webhook by ID', async () => {
      mockDatabaseService.findOne.mockResolvedValue(activeWebhook);

      const result = await service.getWebhook('507f1f77bcf86cd799439011');

      expect(mockDatabaseService.createObjectId).toHaveBeenCalledWith('507f1f77bcf86cd799439011');
      expect(mockDatabaseService.findOne).toHaveBeenCalledWith('webhooks', { _id: mockObjectId });
      expect(result).toBeDefined();
      expect(result.name).toBe(activeWebhook.name);
      expect(result.secret).toMatch(/^.{8}\.\.\./);
    });

    it('should throw NotFoundError if webhook does not exist', async () => {
      mockDatabaseService.findOne.mockResolvedValue(null);

      await expect(service.getWebhook('507f1f77bcf86cd799439011'))
        .rejects.toThrow(NotFoundError);
      await expect(service.getWebhook('507f1f77bcf86cd799439011'))
        .rejects.toThrow('Webhook');
    });

    it('should handle invalid ObjectId', async () => {
      mockDatabaseService.createObjectId.mockImplementation(() => {
        throw new Error('Invalid ObjectId');
      });

      await expect(service.getWebhook('invalid-id'))
        .rejects.toThrow('Invalid ObjectId');
    });
  });

  describe('listWebhooks', () => {
    it('should list all webhooks with default options', async () => {
      const mockResult = {
        documents: [activeWebhook, inactiveWebhook],
        total: 2,
        hasMore: false
      };
      mockDatabaseService.find.mockResolvedValue(mockResult);

      const result = await service.listWebhooks();

      expect(mockDatabaseService.find).toHaveBeenCalledWith('webhooks', {}, {
        limit: 50,
        offset: 0,
        sort: { createdAt: -1 }
      });
      expect(result.documents).toHaveLength(2);
      expect(result.documents[0].secret).toMatch(/^.{8}\.\.\./);
      expect(result.total).toBe(2);
    });

    it('should filter by active status', async () => {
      const mockResult = {
        documents: [activeWebhook],
        total: 1,
        hasMore: false
      };
      mockDatabaseService.find.mockResolvedValue(mockResult);

      const result = await service.listWebhooks({ active: true });

      expect(mockDatabaseService.find).toHaveBeenCalledWith('webhooks', { active: true }, expect.any(Object));
      expect(result.documents).toHaveLength(1);
      expect(result.documents[0].active).toBe(true);
    });

    it('should support custom pagination options', async () => {
      const mockResult = {
        documents: [],
        total: 0,
        hasMore: false
      };
      mockDatabaseService.find.mockResolvedValue(mockResult);

      await service.listWebhooks({ limit: 25, offset: 50 });

      expect(mockDatabaseService.find).toHaveBeenCalledWith('webhooks', {}, {
        limit: 25,
        offset: 50,
        sort: { createdAt: -1 }
      });
    });

    it('should support different sort options', async () => {
      const mockResult = {
        documents: [],
        total: 0,
        hasMore: false
      };
      mockDatabaseService.find.mockResolvedValue(mockResult);

      // Test name sort
      await service.listWebhooks({ sort: 'name' });
      expect(mockDatabaseService.find).toHaveBeenCalledWith('webhooks', {}, 
        expect.objectContaining({ sort: { name: 1 } })
      );

      // Test updated sort
      await service.listWebhooks({ sort: 'updated' });
      expect(mockDatabaseService.find).toHaveBeenCalledWith('webhooks', {}, 
        expect.objectContaining({ sort: { updatedAt: -1 } })
      );
    });

    it('should handle database errors gracefully', async () => {
      mockDatabaseService.find.mockRejectedValue(new Error('Database error'));

      await expect(service.listWebhooks())
        .rejects.toThrow('Database error');
    });
  });

  describe('updateWebhook', () => {
    const updateData = {
      name: 'Updated Webhook',
      url: 'https://updated.example.com/webhook',
      active: false,
      retryConfig: { maxAttempts: 7 }
    };

    it('should update webhook successfully', async () => {
      mockDatabaseService.findOne
        .mockResolvedValueOnce(activeWebhook)
        .mockResolvedValueOnce(null) // Name conflict check
        .mockResolvedValueOnce({ ...activeWebhook, ...updateData });
      mockDatabaseService.updateOne.mockResolvedValue({ modifiedCount: 1 });

      const result = await service.updateWebhook('507f1f77bcf86cd799439011', updateData);

      expect(mockDatabaseService.updateOne).toHaveBeenCalledWith('webhooks', 
        { _id: mockObjectId },
        {
          $set: expect.objectContaining({
            ...updateData,
            retryConfig: { 
              maxAttempts: 7, 
              backoffMultiplier: activeWebhook.retryConfig.backoffMultiplier 
            },
            updatedAt: expect.any(Date)
          })
        }
      );
      expect(result).toBeDefined();
    });

    it('should throw NotFoundError if webhook does not exist', async () => {
      mockDatabaseService.findOne.mockResolvedValue(null);

      await expect(service.updateWebhook('507f1f77bcf86cd799439011', updateData))
        .rejects.toThrow(NotFoundError);
    });

    it('should validate URL if being updated', async () => {
      mockDatabaseService.findOne.mockResolvedValue(activeWebhook);
      const invalidUpdate = { url: 'invalid-url' };

      await expect(service.updateWebhook('507f1f77bcf86cd799439011', invalidUpdate))
        .rejects.toThrow(ValidationError);
    });

    it('should check for name conflicts', async () => {
      mockDatabaseService.findOne
        .mockResolvedValueOnce(activeWebhook)
        .mockResolvedValueOnce(inactiveWebhook); // Name conflict

      await expect(service.updateWebhook('507f1f77bcf86cd799439011', { name: inactiveWebhook.name }))
        .rejects.toThrow(ConflictError);
      await expect(service.updateWebhook('507f1f77bcf86cd799439011', { name: inactiveWebhook.name }))
        .rejects.toThrow(`Webhook with name '${inactiveWebhook.name}' already exists`);
    });

    it('should merge nested objects correctly', async () => {
      const partialUpdate = {
        retryConfig: { maxAttempts: 10 },
        filters: { issueTypes: ['bug'] },
        headers: { 'X-New-Header': 'value' }
      };

      mockDatabaseService.findOne
        .mockResolvedValueOnce(activeWebhook)
        .mockResolvedValueOnce({ ...activeWebhook, ...partialUpdate });
      mockDatabaseService.updateOne.mockResolvedValue({ modifiedCount: 1 });

      await service.updateWebhook('507f1f77bcf86cd799439011', partialUpdate);

      expect(mockDatabaseService.updateOne).toHaveBeenCalledWith('webhooks',
        { _id: mockObjectId },
        {
          $set: expect.objectContaining({
            retryConfig: {
              ...activeWebhook.retryConfig,
              maxAttempts: 10
            },
            filters: {
              ...activeWebhook.filters,
              issueTypes: ['bug']
            },
            headers: {
              ...activeWebhook.headers,
              'X-New-Header': 'value'
            }
          })
        }
      );
    });
  });

  describe('deleteWebhook', () => {
    it('should delete webhook successfully', async () => {
      mockDatabaseService.findOne.mockResolvedValue(activeWebhook);
      mockDatabaseService.deleteOne.mockResolvedValue({ deletedCount: 1 });

      const result = await service.deleteWebhook('507f1f77bcf86cd799439011');

      expect(mockDatabaseService.findOne).toHaveBeenCalledWith('webhooks', { _id: mockObjectId });
      expect(mockDatabaseService.deleteOne).toHaveBeenCalledWith('webhooks', { _id: mockObjectId });
      expect(result).toBe(true);
    });

    it('should throw NotFoundError if webhook does not exist', async () => {
      mockDatabaseService.findOne.mockResolvedValue(null);

      await expect(service.deleteWebhook('507f1f77bcf86cd799439011'))
        .rejects.toThrow(NotFoundError);
    });

    it('should handle database errors gracefully', async () => {
      mockDatabaseService.findOne.mockResolvedValue(activeWebhook);
      mockDatabaseService.deleteOne.mockRejectedValue(new Error('Delete failed'));

      await expect(service.deleteWebhook('507f1f77bcf86cd799439011'))
        .rejects.toThrow('Delete failed');
    });
  });

  describe('getWebhooksByEvent', () => {
    it('should retrieve webhooks by event type', async () => {
      const mockResult = {
        documents: [activeWebhook],
        total: 1,
        hasMore: false
      };
      mockDatabaseService.find.mockResolvedValue(mockResult);

      const result = await service.getWebhooksByEvent('issue.created');

      expect(mockDatabaseService.find).toHaveBeenCalledWith('webhooks', {
        active: true,
        events: 'issue.created'
      }, {
        limit: 1000,
        sort: { createdAt: 1 }
      });
      expect(result).toHaveLength(1);
      expect(result[0].events).toContain('issue.created');
    });

    it('should apply additional filters', async () => {
      const mockResult = {
        documents: [],
        total: 0,
        hasMore: false
      };
      mockDatabaseService.find.mockResolvedValue(mockResult);

      await service.getWebhooksByEvent('issue.updated', { 'filters.projects': ['PROJECT-1'] });

      expect(mockDatabaseService.find).toHaveBeenCalledWith('webhooks', {
        active: true,
        events: 'issue.updated',
        'filters.projects': ['PROJECT-1']
      }, expect.any(Object));
    });

    it('should handle database errors gracefully', async () => {
      mockDatabaseService.find.mockRejectedValue(new Error('Database error'));

      await expect(service.getWebhooksByEvent('issue.created'))
        .rejects.toThrow('Database error');
    });
  });

  describe('getActiveWebhookCount', () => {
    it('should return count of active webhooks', async () => {
      mockDatabaseService.countDocuments.mockResolvedValue(5);

      const count = await service.getActiveWebhookCount();

      expect(mockDatabaseService.countDocuments).toHaveBeenCalledWith('webhooks', { active: true });
      expect(count).toBe(5);
    });

    it('should return 0 on database error', async () => {
      mockDatabaseService.countDocuments.mockRejectedValue(new Error('Database error'));

      const count = await service.getActiveWebhookCount();

      expect(count).toBe(0);
    });
  });

  describe('getStats', () => {
    it('should retrieve webhook statistics', async () => {
      const mockStats = {
        _id: null,
        total: 10,
        active: 7,
        inactive: 3,
        totalSuccessCount: 100,
        totalFailureCount: 5,
        totalDeliveries: 105
      };
      mockDatabaseService.aggregate.mockResolvedValue([mockStats]);

      const stats = await service.getStats();

      expect(mockDatabaseService.aggregate).toHaveBeenCalledWith('webhooks', expect.any(Array));
      expect(stats).toEqual(mockStats);
    });

    it('should return default stats if aggregation returns empty', async () => {
      mockDatabaseService.aggregate.mockResolvedValue([]);

      const stats = await service.getStats();

      expect(stats).toEqual({
        total: 0,
        active: 0,
        inactive: 0,
        totalSuccessCount: 0,
        totalFailureCount: 0,
        totalDeliveries: 0
      });
    });

    it('should return default stats on database error', async () => {
      mockDatabaseService.aggregate.mockRejectedValue(new Error('Aggregation failed'));

      const stats = await service.getStats();

      expect(stats).toEqual({
        total: 0,
        active: 0,
        inactive: 0,
        totalSuccessCount: 0,
        totalFailureCount: 0,
        totalDeliveries: 0
      });
    });
  });

  describe('getDetailedStats', () => {
    it('should retrieve detailed stats grouped by event', async () => {
      const mockStats = [
        { _id: 'issue.created', count: 5, successCount: 50, failureCount: 2 },
        { _id: 'issue.updated', count: 3, successCount: 30, failureCount: 1 }
      ];
      mockDatabaseService.aggregate.mockResolvedValue(mockStats);

      const stats = await service.getDetailedStats({ groupBy: 'event' });

      expect(mockDatabaseService.aggregate).toHaveBeenCalled();
      const pipeline = mockDatabaseService.aggregate.mock.calls[0][1];
      expect(pipeline).toContainEqual(expect.objectContaining({ $unwind: '$events' }));
      expect(stats).toEqual(mockStats);
    });

    it('should filter inactive webhooks by default', async () => {
      mockDatabaseService.aggregate.mockResolvedValue([]);

      await service.getDetailedStats();

      const pipeline = mockDatabaseService.aggregate.mock.calls[0][1];
      expect(pipeline[0].$match).toEqual({ active: true });
    });

    it('should include inactive webhooks when specified', async () => {
      mockDatabaseService.aggregate.mockResolvedValue([]);

      await service.getDetailedStats({ includeInactive: true });

      const pipeline = mockDatabaseService.aggregate.mock.calls[0][1];
      expect(pipeline[0].$match).toEqual({});
    });

    it('should return empty array on error', async () => {
      mockDatabaseService.aggregate.mockRejectedValue(new Error('Aggregation failed'));

      const stats = await service.getDetailedStats();

      expect(stats).toEqual([]);
    });
  });

  describe('updateWebhookStats', () => {
    it('should increment success stats', async () => {
      mockDatabaseService.updateOne.mockResolvedValue({ modifiedCount: 1 });

      await service.updateWebhookStats('507f1f77bcf86cd799439011', true);

      expect(mockDatabaseService.updateOne).toHaveBeenCalledWith('webhooks',
        { _id: mockObjectId },
        {
          $inc: {
            totalDeliveries: 1,
            successCount: 1,
            failureCount: 0
          },
          $set: {
            lastDelivery: expect.any(Date),
            updatedAt: expect.any(Date)
          }
        }
      );
    });

    it('should increment failure stats', async () => {
      mockDatabaseService.updateOne.mockResolvedValue({ modifiedCount: 1 });

      await service.updateWebhookStats('507f1f77bcf86cd799439011', false);

      expect(mockDatabaseService.updateOne).toHaveBeenCalledWith('webhooks',
        { _id: mockObjectId },
        {
          $inc: {
            totalDeliveries: 1,
            successCount: 0,
            failureCount: 1
          },
          $set: {
            lastDelivery: expect.any(Date),
            updatedAt: expect.any(Date)
          }
        }
      );
    });

    it('should not throw on database error', async () => {
      mockDatabaseService.updateOne.mockRejectedValue(new Error('Update failed'));

      await expect(service.updateWebhookStats('507f1f77bcf86cd799439011', true))
        .resolves.not.toThrow();
    });
  });

  describe('validateWebhookUrl', () => {
    it('should accept valid HTTP URL', () => {
      expect(() => service.validateWebhookUrl('http://example.com/webhook')).not.toThrow();
    });

    it('should accept valid HTTPS URL', () => {
      expect(() => service.validateWebhookUrl('https://example.com/webhook')).not.toThrow();
    });

    it('should reject non-HTTP/HTTPS protocols', () => {
      expect(() => service.validateWebhookUrl('ftp://example.com/webhook'))
        .toThrow(ValidationError);
      expect(() => service.validateWebhookUrl('ws://example.com/webhook'))
        .toThrow(ValidationError);
    });

    it('should reject invalid URL format', () => {
      expect(() => service.validateWebhookUrl('not-a-url'))
        .toThrow(ValidationError);
      expect(() => service.validateWebhookUrl('http://'))
        .toThrow(ValidationError);
    });

    it('should allow localhost in non-production', () => {
      require('../../../src/config').validate.isProduction.mockReturnValue(false);
      
      expect(() => service.validateWebhookUrl('http://localhost:3000/webhook')).not.toThrow();
      expect(() => service.validateWebhookUrl('http://127.0.0.1:3000/webhook')).not.toThrow();
    });

    it('should reject private networks in production', () => {
      require('../../../src/config').validate.isProduction.mockReturnValue(true);
      
      expect(() => service.validateWebhookUrl('http://localhost/webhook'))
        .toThrow('Webhook URL cannot target private networks in production');
      expect(() => service.validateWebhookUrl('http://127.0.0.1/webhook'))
        .toThrow('Webhook URL cannot target private networks in production');
      expect(() => service.validateWebhookUrl('http://192.168.1.1/webhook'))
        .toThrow('Webhook URL cannot target private networks in production');
      expect(() => service.validateWebhookUrl('http://10.0.0.1/webhook'))
        .toThrow('Webhook URL cannot target private networks in production');
      expect(() => service.validateWebhookUrl('http://172.16.0.1/webhook'))
        .toThrow('Webhook URL cannot target private networks in production');
    });
  });

  describe('generateSecret', () => {
    it('should generate a 64-character hex string by default', () => {
      const secret = service.generateSecret();
      
      expect(secret).toMatch(/^[a-f0-9]{64}$/);
      expect(secret).toHaveLength(64);
    });

    it('should generate custom length secrets', () => {
      const secret16 = service.generateSecret(16);
      const secret48 = service.generateSecret(48);
      
      expect(secret16).toMatch(/^[a-f0-9]{32}$/); // 16 bytes = 32 hex chars
      expect(secret48).toMatch(/^[a-f0-9]{96}$/); // 48 bytes = 96 hex chars
    });
  });

  describe('generateSignature', () => {
    it('should generate valid HMAC signature', () => {
      const payload = JSON.stringify({ test: 'data' });
      const secret = 'test-secret';
      
      const signature = service.generateSignature(payload, secret);
      
      expect(signature).toMatch(/^sha256=[a-f0-9]{64}$/);
      expect(signature).toContain('sha256=');
    });

    it('should generate consistent signatures', () => {
      const payload = JSON.stringify({ test: 'data' });
      const secret = 'test-secret';
      
      const sig1 = service.generateSignature(payload, secret);
      const sig2 = service.generateSignature(payload, secret);
      
      expect(sig1).toBe(sig2);
    });

    it('should generate different signatures for different payloads', () => {
      const secret = 'test-secret';
      
      const sig1 = service.generateSignature('payload1', secret);
      const sig2 = service.generateSignature('payload2', secret);
      
      expect(sig1).not.toBe(sig2);
    });
  });

  describe('verifySignature', () => {
    it('should verify valid signature', () => {
      const payload = JSON.stringify({ test: 'data' });
      const secret = 'test-secret';
      const signature = service.generateSignature(payload, secret);
      
      const isValid = service.verifySignature(payload, signature, secret);
      
      expect(isValid).toBe(true);
    });

    it('should reject invalid signature', () => {
      const payload = JSON.stringify({ test: 'data' });
      const secret = 'test-secret';
      // Create an invalid signature with the same format/length as a real one
      const invalidSignature = 'sha256=' + '0'.repeat(64);
      
      const isValid = service.verifySignature(payload, invalidSignature, secret);
      
      expect(isValid).toBe(false);
    });

    it('should reject signature with wrong secret', () => {
      const payload = JSON.stringify({ test: 'data' });
      const signature = service.generateSignature(payload, 'secret1');
      
      const isValid = service.verifySignature(payload, signature, 'secret2');
      
      expect(isValid).toBe(false);
    });
  });

  describe('shouldReceiveEvent', () => {
    const event = {
      type: 'issue.created',
      data: {
        project: { id: 'PROJECT-1' },
        issue: { type: 'bug' }
      }
    };

    it('should return true if webhook subscribes to event type', () => {
      const webhook = createWebhook({
        events: ['issue.created'],
        filters: {}
      });

      const shouldReceive = service.shouldReceiveEvent(webhook, event);
      
      expect(shouldReceive).toBe(true);
    });

    it('should return false if webhook does not subscribe to event type', () => {
      const webhook = createWebhook({
        events: ['issue.updated'],
        filters: {}
      });

      const shouldReceive = service.shouldReceiveEvent(webhook, event);
      
      expect(shouldReceive).toBe(false);
    });

    it('should apply project filter', () => {
      const webhook = createWebhook({
        events: ['issue.created'],
        filters: { projects: ['PROJECT-2', 'PROJECT-3'] }
      });

      const shouldReceive = service.shouldReceiveEvent(webhook, event);
      
      expect(shouldReceive).toBe(false);
    });

    it('should pass if project matches filter', () => {
      const webhook = createWebhook({
        events: ['issue.created'],
        filters: { projects: ['PROJECT-1', 'PROJECT-2'] }
      });

      const shouldReceive = service.shouldReceiveEvent(webhook, event);
      
      expect(shouldReceive).toBe(true);
    });

    it('should apply issue type filter', () => {
      const webhook = createWebhook({
        events: ['issue.created'],
        filters: { issueTypes: ['feature', 'enhancement'] }
      });

      const shouldReceive = service.shouldReceiveEvent(webhook, event);
      
      expect(shouldReceive).toBe(false);
    });

    it('should pass if issue type matches filter', () => {
      const webhook = createWebhook({
        events: ['issue.created'],
        filters: { issueTypes: ['bug', 'feature'] }
      });

      const shouldReceive = service.shouldReceiveEvent(webhook, event);
      
      expect(shouldReceive).toBe(true);
    });

    it('should handle missing filter data gracefully', () => {
      const webhook = createWebhook({
        events: ['issue.created'],
        filters: { projects: ['PROJECT-1'] }
      });

      const eventWithoutProject = {
        type: 'issue.created',
        data: { issue: { type: 'bug' } }
      };

      const shouldReceive = service.shouldReceiveEvent(webhook, eventWithoutProject);
      
      expect(shouldReceive).toBe(false);
    });

    it('should handle empty filters', () => {
      const webhook = createWebhook({
        events: ['issue.created'],
        filters: { projects: [], issueTypes: [] }
      });

      const shouldReceive = service.shouldReceiveEvent(webhook, event);
      
      expect(shouldReceive).toBe(true);
    });
  });

  describe('sanitizeWebhook', () => {
    it('should mask webhook secret', () => {
      const webhook = createWebhook({
        secret: 'super-secret-key-that-should-be-hidden'
      });

      const sanitized = service.sanitizeWebhook(webhook);

      expect(sanitized.secret).toBe('super-se...');
      expect(sanitized.secret).not.toContain('hidden');
    });

    it('should preserve other webhook properties', () => {
      const webhook = createWebhook({
        name: 'Test Webhook',
        url: 'https://example.com',
        events: ['issue.created']
      });

      const sanitized = service.sanitizeWebhook(webhook);

      expect(sanitized.name).toBe(webhook.name);
      expect(sanitized.url).toBe(webhook.url);
      expect(sanitized.events).toEqual(webhook.events);
    });

    it('should handle null webhook', () => {
      const sanitized = service.sanitizeWebhook(null);
      
      expect(sanitized).toBeNull();
    });

    it('should handle webhook without secret', () => {
      const webhook = createWebhook();
      delete webhook.secret;

      const sanitized = service.sanitizeWebhook(webhook);

      expect(sanitized.secret).toBeUndefined();
    });
  });

  describe('integration scenarios', () => {
    it('should handle full webhook lifecycle', async () => {
      // Create webhook
      const webhookData = {
        name: 'Lifecycle Test',
        url: 'https://lifecycle.example.com/webhook',
        events: ['issue.created']
      };
      
      const createdWebhook = { ...webhookData, _id: mockObjectId };
      mockDatabaseService.findOne.mockResolvedValue(null);
      mockDatabaseService.insertOne.mockResolvedValue(createdWebhook);
      
      const created = await service.createWebhook(webhookData);
      expect(created).toBeDefined();

      // Update webhook
      mockDatabaseService.findOne
        .mockResolvedValueOnce(createdWebhook)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ ...createdWebhook, active: false });
      mockDatabaseService.updateOne.mockResolvedValue({ modifiedCount: 1 });
      
      const updated = await service.updateWebhook(mockObjectId.toString(), { active: false });
      expect(updated).toBeDefined();

      // Delete webhook
      mockDatabaseService.findOne.mockResolvedValue(createdWebhook);
      mockDatabaseService.deleteOne.mockResolvedValue({ deletedCount: 1 });
      
      const deleted = await service.deleteWebhook(mockObjectId.toString());
      expect(deleted).toBe(true);
    });
  });
});