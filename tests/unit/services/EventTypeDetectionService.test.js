/**
 * Unit tests for EventTypeDetectionService
 */

// Mock dependencies before requiring the service
jest.mock('../../../src/utils/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn()
}));

const logger = require('../../../src/utils/logger');

const EventTypeDetectionService = require('../../../src/services/EventTypeDetectionService');

describe('EventTypeDetectionService', () => {
  let service;
  let mockConfig;
  let consoleErrorSpy;

  beforeEach(() => {
    mockConfig = {
      webhook: {
        maxRetries: 3,
        timeout: 5000
      }
    };
    service = new EventTypeDetectionService(mockConfig);
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
  });

  afterEach(() => {
    jest.clearAllMocks();
    consoleErrorSpy.mockRestore();
  });

  describe('Constructor and Initialization', () => {
    test('should initialize with default rules', () => {
      expect(service.config).toBe(mockConfig);
      expect(service.eventTypeRules.size).toBeGreaterThan(0);
      expect(service.collectionMappings.size).toBeGreaterThan(0);
      expect(service.fieldMappings.size).toBeGreaterThan(0);
      expect(service.customRules.size).toBe(0);
    });

    test('should initialize collection mappings correctly', () => {
      expect(service.collectionMappings.get('issues')).toBe('issue');
      expect(service.collectionMappings.get('projects')).toBe('project');
      expect(service.collectionMappings.get('users')).toBe('user');
      expect(service.collectionMappings.get('tx')).toBe('transaction');
    });

    test('should initialize field mappings correctly', () => {
      expect(service.fieldMappings.get('status')).toBe('status_changed');
      expect(service.fieldMappings.get('assignee')).toBe('assigned');
      expect(service.fieldMappings.get('priority')).toBe('priority_changed');
    });

    test('should initialize event type rules', () => {
      expect(service.eventTypeRules.has('insert')).toBe(true);
      expect(service.eventTypeRules.has('update')).toBe(true);
      expect(service.eventTypeRules.has('delete')).toBe(true);
      expect(service.eventTypeRules.has('replace')).toBe(true);
      expect(service.eventTypeRules.has('invalidate')).toBe(true);
    });
  });

  describe('detectEventType', () => {
    test('should detect insert event type correctly', () => {
      const changeEvent = {
        operationType: 'insert',
        ns: { coll: 'issues' }
      };
      const result = service.detectEventType(changeEvent);
      expect(result).toBe('issue.created');
    });

    test('should detect update event type correctly', () => {
      const changeEvent = {
        operationType: 'update',
        ns: { coll: 'projects' },
        updateDescription: {
          updatedFields: { title: 'New Title' }
        }
      };
      const result = service.detectEventType(changeEvent);
      expect(result).toBe('project.title_changed');
    });

    test('should detect delete event type correctly', () => {
      const changeEvent = {
        operationType: 'delete',
        ns: { coll: 'users' }
      };
      const result = service.detectEventType(changeEvent);
      expect(result).toBe('user.deleted');
    });

    test('should detect replace event type correctly', () => {
      const changeEvent = {
        operationType: 'replace',
        ns: { coll: 'documents' }
      };
      const result = service.detectEventType(changeEvent);
      expect(result).toBe('document.replaced');
    });

    test('should detect invalidate event type correctly', () => {
      const changeEvent = {
        operationType: 'invalidate'
      };
      const result = service.detectEventType(changeEvent);
      expect(result).toBe('collection.invalidated');
    });

    test('should handle unknown operation type', () => {
      const changeEvent = {
        operationType: 'unknown',
        ns: { coll: 'tasks' }
      };
      const result = service.detectEventType(changeEvent);
      expect(result).toBe('task.unknown');
    });

    test('should apply custom rules when available', () => {
      const customRule = jest.fn().mockReturnValue('custom.event');
      service.addCustomRule('issues', 'insert', customRule);
      
      const changeEvent = {
        operationType: 'insert',
        ns: { coll: 'issues' }
      };
      const result = service.detectEventType(changeEvent);
      
      expect(customRule).toHaveBeenCalledWith(changeEvent);
      expect(result).toBe('custom.event');
    });

    test('should handle errors gracefully', () => {
      // Force an error by making getEntityType throw
      const changeEvent = {
        operationType: 'insert',
        ns: null // This will cause an error in getEntityType
      };
      
      // Spy on getEntityType to make it throw
      jest.spyOn(service, 'getEntityType').mockImplementation(() => {
        throw new Error('Test error');
      });
      
      const result = service.detectEventType(changeEvent);
      expect(result).toBe('unknown.event');
      expect(logger.error).toHaveBeenCalledWith('Error detecting event type:', expect.any(Error));
    });
  });

  describe('getEntityType', () => {
    test('should get entity type from collection mapping', () => {
      const changeEvent = { ns: { coll: 'issues' } };
      const result = service.getEntityType(changeEvent);
      expect(result).toBe('issue');
    });

    test('should return collection name if no mapping exists', () => {
      const changeEvent = { ns: { coll: 'custom_collection' } };
      const result = service.getEntityType(changeEvent);
      expect(result).toBe('custom_collection');
    });

    test('should handle missing namespace', () => {
      const changeEvent = {};
      const result = service.getEntityType(changeEvent);
      expect(result).toBe('unknown');
    });
  });

  describe('getUpdateType', () => {
    test('should detect field-specific update type', () => {
      const changeEvent = {
        updateDescription: {
          updatedFields: { status: 'completed' }
        }
      };
      const result = service.getUpdateType(changeEvent);
      expect(result).toBe('status_changed');
    });

    test('should detect multiple field updates', () => {
      const changeEvent = {
        updateDescription: {
          updatedFields: { 
            status: 'completed',
            assignee: 'user123'
          }
        }
      };
      const result = service.getUpdateType(changeEvent);
      expect(result).toBe('status_changed'); // First matching field
    });

    test('should detect field prefix match', () => {
      const changeEvent = {
        updateDescription: {
          updatedFields: { 'labels.0': 'bug' }
        }
      };
      const result = service.getUpdateType(changeEvent);
      expect(result).toBe('labels_changed');
    });

    test('should detect array operations', () => {
      const changeEvent = {
        updateDescription: {
          updatedFields: { 'items.$[]': true }
        }
      };
      const result = service.getUpdateType(changeEvent);
      expect(result).toBe('array_updated');
    });

    test('should detect nested object updates', () => {
      const changeEvent = {
        updateDescription: {
          updatedFields: { 'metadata.key': 'value' }
        }
      };
      const result = service.getUpdateType(changeEvent);
      expect(result).toBe('metadata_changed');
    });

    test('should handle removed fields', () => {
      const changeEvent = {
        updateDescription: {
          updatedFields: {},
          removedFields: ['priority']
        }
      };
      const result = service.getUpdateType(changeEvent);
      expect(result).toBe('priority_changed');
    });

    test('should return generic update for unknown fields', () => {
      const changeEvent = {
        updateDescription: {
          updatedFields: { unknownField: 'value' }
        }
      };
      const result = service.getUpdateType(changeEvent);
      expect(result).toBe('updated');
    });

    test('should handle missing update description', () => {
      const changeEvent = {};
      const result = service.getUpdateType(changeEvent);
      expect(result).toBe('updated');
    });

    test('should handle errors gracefully', () => {
      const changeEvent = {
        updateDescription: null
      };
      const result = service.getUpdateType(changeEvent);
      expect(result).toBe('updated');
    });
  });

  describe('applyCustomRules', () => {
    test('should apply collection-specific custom rule', () => {
      const customRule = jest.fn().mockReturnValue('custom.collection.event');
      service.addCustomRule('issues', 'update', customRule);
      
      const changeEvent = {
        operationType: 'update',
        ns: { coll: 'issues' }
      };
      const result = service.applyCustomRules(changeEvent);
      
      expect(customRule).toHaveBeenCalledWith(changeEvent);
      expect(result).toBe('custom.collection.event');
    });

    test('should apply global custom rule', () => {
      const globalRule = jest.fn().mockReturnValue('custom.global.event');
      service.addCustomRule('*', 'insert', globalRule);
      
      const changeEvent = {
        operationType: 'insert',
        ns: { coll: 'any_collection' }
      };
      const result = service.applyCustomRules(changeEvent);
      
      expect(globalRule).toHaveBeenCalledWith(changeEvent);
      expect(result).toBe('custom.global.event');
    });

    test('should prioritize collection-specific over global rules', () => {
      const collectionRule = jest.fn().mockReturnValue('collection.rule');
      const globalRule = jest.fn().mockReturnValue('global.rule');
      
      service.addCustomRule('issues', 'update', collectionRule);
      service.addCustomRule('*', 'update', globalRule);
      
      const changeEvent = {
        operationType: 'update',
        ns: { coll: 'issues' }
      };
      const result = service.applyCustomRules(changeEvent);
      
      expect(collectionRule).toHaveBeenCalled();
      expect(globalRule).not.toHaveBeenCalled();
      expect(result).toBe('collection.rule');
    });

    test('should return null if no custom rules match', () => {
      const changeEvent = {
        operationType: 'update',
        ns: { coll: 'no_rules' }
      };
      const result = service.applyCustomRules(changeEvent);
      expect(result).toBeNull();
    });

    test('should handle errors in custom rules', () => {
      const errorRule = jest.fn().mockImplementation(() => {
        throw new Error('Custom rule error');
      });
      service.addCustomRule('issues', 'update', errorRule);
      
      const changeEvent = {
        operationType: 'update',
        ns: { coll: 'issues' }
      };
      const result = service.applyCustomRules(changeEvent);
      
      expect(result).toBeNull();
      expect(logger.error).toHaveBeenCalled();
    });
  });

  describe('addCustomRule', () => {
    test('should add custom rule successfully', () => {
      const ruleFunction = jest.fn();
      service.addCustomRule('issues', 'insert', ruleFunction);
      
      expect(service.customRules.has('issues')).toBe(true);
      expect(service.customRules.get('issues').get('insert')).toBe(ruleFunction);
      expect(logger.info).toHaveBeenCalledWith('Added custom rule for issues.insert');
    });

    test('should add multiple rules for same collection', () => {
      const insertRule = jest.fn();
      const updateRule = jest.fn();
      
      service.addCustomRule('issues', 'insert', insertRule);
      service.addCustomRule('issues', 'update', updateRule);
      
      expect(service.customRules.get('issues').size).toBe(2);
    });
  });

  describe('addCollectionMapping', () => {
    test('should add collection mapping successfully', () => {
      service.addCollectionMapping('custom_collection', 'custom');
      
      expect(service.collectionMappings.get('custom_collection')).toBe('custom');
      expect(logger.info).toHaveBeenCalledWith('Added collection mapping: custom_collection -> custom');
    });

    test('should override existing mapping', () => {
      service.addCollectionMapping('issues', 'new_issue_type');
      expect(service.collectionMappings.get('issues')).toBe('new_issue_type');
    });
  });

  describe('addFieldMapping', () => {
    test('should add field mapping successfully', () => {
      service.addFieldMapping('customField', 'custom_changed');
      
      expect(service.fieldMappings.get('customField')).toBe('custom_changed');
      expect(logger.info).toHaveBeenCalledWith('Added field mapping: customField -> custom_changed');
    });
  });

  describe('getEventDetails', () => {
    test('should get detailed event information', () => {
      const changeEvent = {
        operationType: 'update',
        ns: { coll: 'issues', db: 'huly' },
        documentKey: { _id: '123' },
        clusterTime: new Date('2024-01-01'),
        _id: 'resume_token_123',
        wallTime: new Date('2024-01-01T00:00:01'),
        fullDocument: { id: '123', title: 'Test' },
        fullDocumentBeforeChange: { id: '123', title: 'Old' },
        updateDescription: {
          updatedFields: { status: 'done' }
        }
      };

      const result = service.getEventDetails(changeEvent);

      expect(result).toEqual({
        eventType: 'issue.status_changed',
        entityType: 'issue',
        collection: 'issues',
        operationType: 'update',
        documentKey: { _id: '123' },
        timestamp: new Date('2024-01-01'),
        namespace: { coll: 'issues', db: 'huly' },
        hasFullDocument: true,
        hasFullDocumentBeforeChange: true,
        updateDescription: {
          updatedFields: { status: 'done' }
        },
        metadata: {
          resumeToken: 'resume_token_123',
          wallTime: new Date('2024-01-01T00:00:01')
        }
      });
    });

    test('should handle minimal change event', () => {
      const changeEvent = {
        operationType: 'insert',
        ns: { coll: 'users' }
      };

      const result = service.getEventDetails(changeEvent);

      expect(result.eventType).toBe('user.created');
      expect(result.entityType).toBe('user');
      expect(result.hasFullDocument).toBe(false);
      expect(result.hasFullDocumentBeforeChange).toBe(false);
    });
  });

  describe('shouldProcessEvent', () => {
    test('should process event when no allowed types specified', () => {
      const result = service.shouldProcessEvent('issue.created');
      expect(result).toBe(true);
    });

    test('should process event with exact match', () => {
      const result = service.shouldProcessEvent('issue.created', ['issue.created', 'issue.updated']);
      expect(result).toBe(true);
    });

    test('should process event with wildcard match', () => {
      const result = service.shouldProcessEvent('issue.created', ['issue.*', 'project.*']);
      expect(result).toBe(true);
    });

    test('should not process event when not in allowed types', () => {
      const result = service.shouldProcessEvent('user.created', ['issue.*', 'project.*']);
      expect(result).toBe(false);
    });

    test('should handle complex wildcard patterns', () => {
      expect(service.shouldProcessEvent('issue.status.changed', ['issue.*.changed'])).toBe(true);
      expect(service.shouldProcessEvent('issue.created', ['*.created'])).toBe(true);
      expect(service.shouldProcessEvent('anything.here', ['*'])).toBe(true);
    });
  });

  describe('getEventTypeStats', () => {
    test('should return event type statistics', () => {
      // Add some custom rules
      service.addCustomRule('issues', 'insert', jest.fn());
      service.addCustomRule('issues', 'update', jest.fn());
      service.addCustomRule('*', 'delete', jest.fn());

      const stats = service.getEventTypeStats();

      expect(stats.totalCollectionMappings).toBeGreaterThan(0);
      expect(stats.totalFieldMappings).toBeGreaterThan(0);
      expect(stats.totalCustomRules).toBe(3);
      expect(stats.collectionMappings).toBeInstanceOf(Array);
      expect(stats.fieldMappings).toBeInstanceOf(Array);
      expect(stats.customRules).toEqual([
        { collection: 'issues', rules: ['insert', 'update'] },
        { collection: '*', rules: ['delete'] }
      ]);
    });
  });
});