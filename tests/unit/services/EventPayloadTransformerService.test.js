/**
 * Unit tests for EventPayloadTransformerService
 */

// Mock dependencies before requiring the service
jest.mock('../../../src/utils/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn()
}));

jest.mock('crypto');

const EventPayloadTransformerService = require('../../../src/services/EventPayloadTransformerService');
const crypto = require('crypto');

describe('EventPayloadTransformerService', () => {
  let service;
  let mockConfig;
  let consoleErrorSpy;
  let consoleInfoSpy;

  beforeEach(() => {
    mockConfig = {
      webhook: {
        payloadVersion: '1.0',
        includeFullDocument: true,
        maxPayloadSize: 1000000
      }
    };
    service = new EventPayloadTransformerService(mockConfig);
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
    consoleInfoSpy = jest.spyOn(console, 'info').mockImplementation();
    
    // Mock crypto.createHash
    const mockHash = {
      update: jest.fn().mockReturnThis(),
      digest: jest.fn().mockReturnValue('mockedHash123')
    };
    crypto.createHash = jest.fn().mockReturnValue(mockHash);
  });

  afterEach(() => {
    jest.clearAllMocks();
    consoleErrorSpy.mockRestore();
    consoleInfoSpy.mockRestore();
  });

  describe('Constructor and Initialization', () => {
    test('should initialize with default settings', () => {
      expect(service.config).toBe(mockConfig);
      expect(service.transformers.size).toBeGreaterThan(0);
      expect(service.fieldTransformers.size).toBeGreaterThan(0);
      expect(service.payloadFilters.size).toBeGreaterThan(0);
      expect(service.defaultPayloadVersion).toBe('1.0');
    });

    test('should initialize field transformers', () => {
      const idTransformer = service.fieldTransformers.get('_id');
      expect(idTransformer({ toString: () => '123' })).toBe('123');
      expect(idTransformer(null)).toBeNull();

      const dateTransformer = service.fieldTransformers.get('modifiedOn');
      const testDate = new Date('2024-01-01');
      expect(dateTransformer(testDate)).toBe('2024-01-01T00:00:00.000Z');
      expect(dateTransformer(null)).toBeNull();
    });

    test('should initialize entity transformers', () => {
      expect(service.transformers.has('issue')).toBe(true);
      expect(service.transformers.has('project')).toBe(true);
      expect(service.transformers.has('user')).toBe(true);
      expect(service.transformers.has('task')).toBe(true);
      expect(service.transformers.has('comment')).toBe(true);
    });

    test('should initialize payload filters', () => {
      expect(service.payloadFilters.has('sensitive')).toBe(true);
      expect(service.payloadFilters.has('minimal')).toBe(true);
      expect(service.payloadFilters.has('detailed')).toBe(true);
    });
  });

  describe('transformEvent', () => {
    let mockChangeEvent;
    let mockEventDetails;
    let mockWebhook;

    beforeEach(() => {
      mockChangeEvent = {
        operationType: 'insert',
        fullDocument: {
          _id: '123',
          title: 'Test Issue',
          status: 'open'
        },
        ns: { db: 'huly', coll: 'issues' },
        documentKey: { _id: '123' },
        clusterTime: new Date('2024-01-01')
      };

      mockEventDetails = {
        eventType: 'issue.created',
        entityType: 'issue',
        collection: 'issues',
        operationType: 'insert'
      };

      mockWebhook = {
        _id: 'webhook123',
        url: 'https://example.com/webhook',
        events: ['issue.*'],
        headers: { 'X-Custom': 'value' },
        payloadTransform: null,
        payloadFilter: null
      };
    });

    test('should transform event with entity-specific transformer', () => {
      const result = service.transformEvent(mockChangeEvent, mockEventDetails, mockWebhook);

      expect(result).toMatchObject({
        eventId: expect.any(String),
        eventType: 'issue.created',
        timestamp: expect.any(String),
        version: '1.0',
        webhook: {
          id: 'webhook123',
          url: 'https://example.com/webhook'
        },
        metadata: {
          database: 'huly',
          collection: 'issues',
          operationType: 'insert',
          documentKey: { _id: '123' }
        },
        data: {
          entity: 'issue',
          action: 'created',
          issue: expect.objectContaining({
            id: '123',
            title: 'Test Issue',
            status: 'open'
          })
        }
      });
    });

    test('should use generic transformer for unknown entity types', () => {
      mockEventDetails.entityType = 'unknown';
      const result = service.transformEvent(mockChangeEvent, mockEventDetails, mockWebhook);

      expect(result.data).toMatchObject({
        entity: 'unknown',
        action: 'created',
        document: expect.any(Object),
        changes: {}
      });
    });

    test('should apply payload filter when specified', () => {
      mockWebhook.payloadFilter = 'minimal';
      const result = service.transformEvent(mockChangeEvent, mockEventDetails, mockWebhook);

      expect(result).toBeDefined();
      expect(result.eventType).toBe('issue.created');
    });

    test('should apply custom payload transform', () => {
      mockWebhook.payloadTransform = {
        jmesPath: 'data.issue',
        template: null
      };
      const result = service.transformEvent(mockChangeEvent, mockEventDetails, mockWebhook);

      expect(result).toBeDefined();
    });

    test('should handle transform errors gracefully', () => {
      // Force an error by making the base payload creation fail
      service.createBasePayload = jest.fn().mockImplementation(() => {
        throw new Error('Transform error');
      });

      const result = service.transformEvent(mockChangeEvent, mockEventDetails, mockWebhook);

      expect(result).toMatchObject({
        error: 'Failed to transform event',
        eventType: 'issue.created',
        timestamp: expect.any(String)
      });
      expect(consoleErrorSpy).toHaveBeenCalled();
    });
  });

  describe('createBasePayload', () => {
    test('should create base payload structure', () => {
      const changeEvent = {
        _id: 'resumeToken123',
        clusterTime: new Date('2024-01-01'),
        ns: { db: 'huly', coll: 'issues' },
        documentKey: { _id: '123' },
        operationType: 'insert'
      };

      const eventDetails = {
        eventType: 'issue.created',
        entityType: 'issue',
        collection: 'issues',
        operationType: 'insert'
      };

      const webhook = {
        _id: 'webhook123',
        url: 'https://example.com/webhook'
      };

      const result = service.createBasePayload(changeEvent, eventDetails, webhook);

      expect(result).toMatchObject({
        eventId: expect.any(String),
        eventType: 'issue.created',
        timestamp: '2024-01-01T00:00:00.000Z',
        version: '1.0',
        webhook: {
          id: 'webhook123',
          url: 'https://example.com/webhook'
        },
        metadata: {
          database: 'huly',
          collection: 'issues',
          operationType: 'insert',
          documentKey: { _id: '123' },
          resumeToken: 'resumeToken123'
        },
        data: {}
      });
    });

    test('should generate unique event ID', () => {
      const changeEvent = { _id: 'token123', clusterTime: new Date() };
      const eventDetails = { eventType: 'test.event' };
      const webhook = { _id: 'webhook123' };

      const result1 = service.createBasePayload(changeEvent, eventDetails, webhook);
      const result2 = service.createBasePayload(changeEvent, eventDetails, webhook);

      expect(result1.eventId).toBeDefined();
      expect(result2.eventId).toBeDefined();
      expect(result1.eventId).not.toBe(result2.eventId);
    });
  });

  describe('transformIssueEvent', () => {
    test('should transform issue insert event', () => {
      const changeEvent = {
        operationType: 'insert',
        fullDocument: {
          _id: '123',
          title: 'Test Issue',
          description: 'Test Description',
          status: 'open',
          priority: 'high',
          assignee: 'user123',
          createdOn: new Date('2024-01-01'),
          modifiedOn: new Date('2024-01-01')
        }
      };

      const eventDetails = {
        eventType: 'issue.created',
        operationType: 'insert'
      };

      const result = service.transformIssueEvent(changeEvent, eventDetails, {});

      expect(result).toMatchObject({
        entity: 'issue',
        action: 'created',
        issue: {
          id: '123',
          title: 'Test Issue',
          description: 'Test Description',
          status: 'open',
          priority: 'high',
          assignee: 'user123',
          createdAt: '2024-01-01T00:00:00.000Z',
          updatedAt: '2024-01-01T00:00:00.000Z'
        }
      });
    });

    test('should transform issue update event with changes', () => {
      const changeEvent = {
        operationType: 'update',
        fullDocument: {
          _id: '123',
          title: 'Updated Issue',
          status: 'closed'
        },
        fullDocumentBeforeChange: {
          _id: '123',
          title: 'Original Issue',
          status: 'open'
        },
        updateDescription: {
          updatedFields: {
            title: 'Updated Issue',
            status: 'closed'
          }
        }
      };

      const eventDetails = {
        eventType: 'issue.updated',
        operationType: 'update'
      };

      const result = service.transformIssueEvent(changeEvent, eventDetails, {});

      expect(result).toMatchObject({
        entity: 'issue',
        action: 'updated',
        issue: expect.any(Object),
        changes: {
          title: { old: 'Original Issue', new: 'Updated Issue' },
          status: { old: 'open', new: 'closed' }
        },
        changedFields: ['title', 'status']
      });
    });

    test('should handle missing fields gracefully', () => {
      const changeEvent = {
        operationType: 'insert',
        fullDocument: {
          _id: '123'
        }
      };

      const eventDetails = {
        eventType: 'issue.created',
        operationType: 'insert'
      };

      const result = service.transformIssueEvent(changeEvent, eventDetails, {});

      expect(result.issue).toMatchObject({
        id: '123',
        title: '',
        description: '',
        status: 'unknown'
      });
    });
  });

  describe('Field Transformers', () => {
    test('should transform ObjectId fields', () => {
      const transformer = service.fieldTransformers.get('_id');
      const mockObjectId = { toString: () => 'objectid123' };
      expect(transformer(mockObjectId)).toBe('objectid123');
      expect(transformer(null)).toBeNull();
      expect(transformer(undefined)).toBeNull();
    });

    test('should transform date fields', () => {
      const transformer = service.fieldTransformers.get('createdOn');
      const date = new Date('2024-01-01T12:30:45.123Z');
      expect(transformer(date)).toBe('2024-01-01T12:30:45.123Z');
      expect(transformer('2024-01-01')).toBe('2024-01-01T00:00:00.000Z');
      expect(transformer(null)).toBeNull();
    });

    test('should transform reference fields', () => {
      const transformer = service.fieldTransformers.get('attachedTo');
      const ref = { toString: () => 'ref123' };
      expect(transformer(ref)).toBe('ref123');
      expect(transformer('string123')).toBe('string123');
    });
  });

  describe('Payload Filters', () => {
    test('should filter sensitive fields', () => {
      const payload = {
        data: {
          user: {
            id: '123',
            email: 'test@example.com',
            password: 'secret123',
            token: 'auth-token',
            apiKey: 'api-key-123',
            secret: 'secret-value',
            credentials: { oauth: 'token' }
          }
        }
      };

      const result = service.filterSensitiveFields(payload);

      expect(result.data.user).toBeDefined();
      expect(result.data.user.id).toBe('123');
      expect(result.data.user.email).toBe('test@example.com');
      expect(result.data.user.password).toBeUndefined();
      expect(result.data.user.token).toBeUndefined();
      expect(result.data.user.apiKey).toBeUndefined();
      expect(result.data.user.secret).toBeUndefined();
      expect(result.data.user.credentials).toBeUndefined();
    });

    test('should create minimal payload', () => {
      const payload = {
        eventId: 'evt123',
        eventType: 'issue.created',
        timestamp: '2024-01-01T00:00:00.000Z',
        version: '1.0',
        webhook: { id: 'wh123', url: 'https://example.com' },
        metadata: { lots: 'of', meta: 'data' },
        data: {
          entity: 'issue',
          action: 'created',
          issue: { id: '123', title: 'Test', lotsOfOtherFields: 'values' }
        }
      };

      const result = service.filterMinimalFields(payload);

      expect(result).toMatchObject({
        eventId: 'evt123',
        eventType: 'issue.created',
        timestamp: '2024-01-01T00:00:00.000Z',
        data: {
          entity: 'issue',
          action: 'created',
          entityId: '123'
        }
      });
      expect(result.metadata).toBeUndefined();
      expect(result.webhook).toBeUndefined();
    });

    test('should create detailed payload', () => {
      const payload = {
        eventId: 'evt123',
        data: { entity: 'issue' }
      };

      const changeEvent = { _id: 'token123', wallTime: new Date() };
      const result = service.filterDetailedFields(payload, changeEvent);

      expect(result.debug).toBeDefined();
      expect(result.debug.resumeToken).toBe('token123');
      expect(result.debug.processingTime).toBeDefined();
    });
  });

  describe('applyCustomTransform', () => {
    test('should apply JMESPath transform', () => {
      const payload = {
        data: {
          issue: {
            id: '123',
            title: 'Test Issue'
          }
        }
      };

      const transform = {
        jmesPath: 'data.issue',
        template: null
      };

      const result = service.applyCustomTransform(payload, transform);
      
      expect(result).toEqual({
        id: '123',
        title: 'Test Issue'
      });
    });

    test('should apply template transform', () => {
      const payload = {
        eventType: 'issue.created',
        data: {
          issue: {
            id: '123',
            title: 'Test Issue'
          }
        }
      };

      const transform = {
        template: {
          event: '{{eventType}}',
          issueId: '{{data.issue.id}}',
          issueTitle: '{{data.issue.title}}'
        }
      };

      const result = service.applyCustomTransform(payload, transform);

      expect(result).toEqual({
        event: 'issue.created',
        issueId: '123',
        issueTitle: 'Test Issue'
      });
    });

    test('should handle transform errors gracefully', () => {
      const payload = { data: {} };
      const transform = { jmesPath: 'invalid..path' };

      const result = service.applyCustomTransform(payload, transform);
      
      expect(result).toBe(payload);
      expect(consoleErrorSpy).toHaveBeenCalled();
    });
  });

  describe('addTransformer', () => {
    test('should add custom entity transformer', () => {
      const customTransformer = jest.fn().mockReturnValue({ custom: 'data' });
      
      service.addTransformer('custom_entity', customTransformer);

      expect(service.transformers.get('custom_entity')).toBe(customTransformer);
      expect(consoleInfoSpy).toHaveBeenCalledWith('Added transformer for entity: custom_entity');
    });
  });

  describe('addFieldTransformer', () => {
    test('should add custom field transformer', () => {
      const customTransformer = jest.fn().mockReturnValue('transformed');
      
      service.addFieldTransformer('customField', customTransformer);

      expect(service.fieldTransformers.get('customField')).toBe(customTransformer);
      expect(consoleInfoSpy).toHaveBeenCalledWith('Added field transformer: customField');
    });
  });

  describe('addPayloadFilter', () => {
    test('should add custom payload filter', () => {
      const customFilter = jest.fn().mockReturnValue({ filtered: true });
      
      service.addPayloadFilter('custom', customFilter);

      expect(service.payloadFilters.get('custom')).toBe(customFilter);
      expect(consoleInfoSpy).toHaveBeenCalledWith('Added payload filter: custom');
    });
  });

  describe('getTransformerStats', () => {
    test('should return transformer statistics', () => {
      const stats = service.getTransformerStats();

      expect(stats).toMatchObject({
        totalTransformers: expect.any(Number),
        totalFieldTransformers: expect.any(Number),
        totalPayloadFilters: expect.any(Number),
        transformers: expect.any(Array),
        fieldTransformers: expect.any(Array),
        payloadFilters: expect.any(Array)
      });

      expect(stats.totalTransformers).toBeGreaterThan(0);
      expect(stats.transformers).toContain('issue');
      expect(stats.fieldTransformers).toContain('_id');
      expect(stats.payloadFilters).toContain('sensitive');
    });
  });

  describe('Error Handling', () => {
    test('should handle transformation errors for all entity types', () => {
      const errorEvent = {
        operationType: 'insert',
        fullDocument: null // This will cause errors
      };

      const entities = ['project', 'user', 'comment', 'task', 'document'];

      entities.forEach(entity => {
        const transformer = service.transformers.get(entity);
        expect(() => transformer(errorEvent, {}, {})).not.toThrow();
      });
    });
  });
});