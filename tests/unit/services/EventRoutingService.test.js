/**
 * Unit tests for EventRoutingService
 */

// Mock dependencies before requiring the service
jest.mock('../../../src/utils/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn()
}));

const EventRoutingService = require('../../../src/services/EventRoutingService');

describe('EventRoutingService', () => {
  let service;
  let mockConfig;
  let consoleErrorSpy;
  let consoleInfoSpy;
  let consoleWarnSpy;

  beforeEach(() => {
    mockConfig = {
      routing: {
        maxWebhooksPerEvent: 10,
        enableParallelRouting: true
      }
    };
    service = new EventRoutingService(mockConfig);
    consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
    consoleInfoSpy = jest.spyOn(console, 'info').mockImplementation();
    consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();
  });

  afterEach(() => {
    jest.clearAllMocks();
    consoleErrorSpy.mockRestore();
    consoleInfoSpy.mockRestore();
    consoleWarnSpy.mockRestore();
  });

  describe('Constructor and Initialization', () => {
    test('should initialize with default settings', () => {
      expect(service.config).toBe(mockConfig);
      expect(service.routingRules.size).toBe(0);
      expect(service.collectionMappings.size).toBeGreaterThan(0);
      expect(service.webhookTargets.size).toBe(0);
      expect(service.routingStats).toMatchObject({
        totalEvents: 0,
        routedEvents: 0,
        droppedEvents: 0,
        routingErrors: 0,
        routesByCollection: {},
        routesByWebhook: {},
        routesByEventType: {}
      });
    });

    test('should initialize default collection mappings', () => {
      expect(service.collectionMappings.get('issues')).toMatchObject({
        collections: ['issues'],
        eventTypes: ['issue.*'],
        priority: 'high',
        description: 'Issue management events'
      });

      expect(service.collectionMappings.get('projects')).toMatchObject({
        collections: ['projects'],
        eventTypes: ['project.*'],
        priority: 'high',
        description: 'Project management events'
      });

      expect(service.collectionMappings.get('users')).toMatchObject({
        collections: ['users'],
        eventTypes: ['user.*'],
        priority: 'medium',
        description: 'User management events'
      });
    });

    test('should initialize all expected collection mappings', () => {
      const expectedMappings = [
        'tx', 'issues', 'projects', 'users', 'documents', 'comments',
        'attachments', 'teams', 'workspaces', 'channels', 'messages',
        'tasks', 'calendar', 'boards', 'cards', 'contacts', 'organizations',
        'leads', 'candidates', 'applications', 'vacancies', 'reviews',
        'inventory', 'requests', 'notifications', 'tags', 'templates',
        'workflows', 'audit', 'activity', 'chunks', 'blobs', 'accounts',
        'space', 'preference', 'setting'
      ];

      expectedMappings.forEach(mapping => {
        expect(service.collectionMappings.has(mapping)).toBe(true);
      });
    });
  });

  describe('findMatchingWebhooks', () => {
    let mockWebhooks;

    beforeEach(() => {
      mockWebhooks = [
        {
          _id: 'webhook1',
          url: 'https://example.com/webhook1',
          events: ['issue.*'],
          active: true,
          collections: ['issues']
        },
        {
          _id: 'webhook2',
          url: 'https://example.com/webhook2',
          events: ['project.*', 'issue.created'],
          active: true,
          collections: ['projects', 'issues']
        },
        {
          _id: 'webhook3',
          url: 'https://example.com/webhook3',
          events: ['*'],
          active: true,
          collections: []
        },
        {
          _id: 'webhook4',
          url: 'https://example.com/webhook4',
          events: ['user.*'],
          active: false, // Inactive
          collections: ['users']
        }
      ];
    });

    test('should find webhooks matching event type', async () => {
      const changeEvent = {
        ns: { coll: 'issues' },
        operationType: 'insert'
      };

      const eventDetails = {
        eventType: 'issue.created',
        collection: 'issues'
      };

      const result = await service.findMatchingWebhooks(changeEvent, eventDetails, mockWebhooks);

      expect(result).toHaveLength(3);
      expect(result.map(w => w._id)).toEqual(['webhook1', 'webhook2', 'webhook3']);
    });

    test('should filter out inactive webhooks', async () => {
      const changeEvent = {
        ns: { coll: 'users' },
        operationType: 'update'
      };

      const eventDetails = {
        eventType: 'user.updated',
        collection: 'users'
      };

      const result = await service.findMatchingWebhooks(changeEvent, eventDetails, mockWebhooks);

      expect(result).toHaveLength(1);
      expect(result[0]._id).toBe('webhook3'); // Only the wildcard webhook
    });

    test('should match wildcard event patterns', async () => {
      const changeEvent = {
        ns: { coll: 'custom' },
        operationType: 'delete'
      };

      const eventDetails = {
        eventType: 'custom.deleted',
        collection: 'custom'
      };

      const result = await service.findMatchingWebhooks(changeEvent, eventDetails, mockWebhooks);

      expect(result).toHaveLength(1);
      expect(result[0]._id).toBe('webhook3');
    });

    test('should respect collection filters', async () => {
      const webhook = {
        _id: 'webhook5',
        url: 'https://example.com/webhook5',
        events: ['*'],
        active: true,
        collections: ['issues', 'projects'] // Only these collections
      };

      const changeEvent1 = {
        ns: { coll: 'issues' },
        operationType: 'insert'
      };

      const eventDetails1 = {
        eventType: 'issue.created',
        collection: 'issues'
      };

      const result1 = await service.findMatchingWebhooks(changeEvent1, eventDetails1, [webhook]);
      expect(result1).toHaveLength(1);

      const changeEvent2 = {
        ns: { coll: 'users' },
        operationType: 'insert'
      };

      const eventDetails2 = {
        eventType: 'user.created',
        collection: 'users'
      };

      const result2 = await service.findMatchingWebhooks(changeEvent2, eventDetails2, [webhook]);
      expect(result2).toHaveLength(0);
    });

    test('should handle complex event patterns', async () => {
      const webhook = {
        _id: 'webhook6',
        url: 'https://example.com/webhook6',
        events: ['issue.status_changed', 'issue.assigned', 'project.created'],
        active: true,
        collections: []
      };

      const eventDetails1 = {
        eventType: 'issue.status_changed',
        collection: 'issues'
      };

      const result1 = await service.findMatchingWebhooks({}, eventDetails1, [webhook]);
      expect(result1).toHaveLength(1);

      const eventDetails2 = {
        eventType: 'issue.priority_changed',
        collection: 'issues'
      };

      const result2 = await service.findMatchingWebhooks({}, eventDetails2, [webhook]);
      expect(result2).toHaveLength(0);
    });

    test('should update routing statistics', async () => {
      const changeEvent = {
        ns: { coll: 'issues' },
        operationType: 'insert'
      };

      const eventDetails = {
        eventType: 'issue.created',
        collection: 'issues'
      };

      await service.findMatchingWebhooks(changeEvent, eventDetails, mockWebhooks);

      expect(service.routingStats.totalEvents).toBe(1);
      expect(service.routingStats.routedEvents).toBe(1);
      expect(service.routingStats.routesByCollection.issues).toBe(1);
      expect(service.routingStats.routesByEventType['issue.created']).toBe(1);
    });

    test('should handle routing errors gracefully', async () => {
      const changeEvent = null; // Will cause error
      const eventDetails = {
        eventType: 'issue.created',
        collection: 'issues'
      };

      const result = await service.findMatchingWebhooks(changeEvent, eventDetails, mockWebhooks);

      expect(result).toEqual([]);
      expect(service.routingStats.routingErrors).toBe(1);
      expect(consoleErrorSpy).toHaveBeenCalled();
    });
  });

  describe('shouldRouteToWebhook', () => {
    test('should route when webhook has no filters', () => {
      const webhook = {
        events: [],
        collections: []
      };

      const eventDetails = {
        eventType: 'issue.created',
        collection: 'issues'
      };

      const result = service.shouldRouteToWebhook(webhook, eventDetails);
      expect(result).toBe(true);
    });

    test('should route when event type matches', () => {
      const webhook = {
        events: ['issue.created', 'issue.updated'],
        collections: []
      };

      const eventDetails = {
        eventType: 'issue.created',
        collection: 'issues'
      };

      const result = service.shouldRouteToWebhook(webhook, eventDetails);
      expect(result).toBe(true);
    });

    test('should route when event pattern matches', () => {
      const webhook = {
        events: ['issue.*'],
        collections: []
      };

      const eventDetails = {
        eventType: 'issue.status_changed',
        collection: 'issues'
      };

      const result = service.shouldRouteToWebhook(webhook, eventDetails);
      expect(result).toBe(true);
    });

    test('should not route when event type does not match', () => {
      const webhook = {
        events: ['project.*'],
        collections: []
      };

      const eventDetails = {
        eventType: 'issue.created',
        collection: 'issues'
      };

      const result = service.shouldRouteToWebhook(webhook, eventDetails);
      expect(result).toBe(false);
    });

    test('should respect collection filters', () => {
      const webhook = {
        events: ['*'],
        collections: ['issues', 'projects']
      };

      const eventDetails1 = {
        eventType: 'issue.created',
        collection: 'issues'
      };

      const result1 = service.shouldRouteToWebhook(webhook, eventDetails1);
      expect(result1).toBe(true);

      const eventDetails2 = {
        eventType: 'user.created',
        collection: 'users'
      };

      const result2 = service.shouldRouteToWebhook(webhook, eventDetails2);
      expect(result2).toBe(false);
    });
  });

  describe('addRoutingRule', () => {
    test('should add routing rule successfully', () => {
      const rule = {
        name: 'custom-rule',
        priority: 100,
        condition: jest.fn().mockReturnValue(true),
        action: jest.fn()
      };

      service.addRoutingRule('custom-rule', rule);

      expect(service.routingRules.has('custom-rule')).toBe(true);
      expect(service.routingRules.get('custom-rule')).toBe(rule);
      expect(consoleInfoSpy).toHaveBeenCalledWith('Added routing rule: custom-rule');
    });

    test('should override existing rule', () => {
      const rule1 = { priority: 100 };
      const rule2 = { priority: 200 };

      service.addRoutingRule('test-rule', rule1);
      service.addRoutingRule('test-rule', rule2);

      expect(service.routingRules.get('test-rule')).toBe(rule2);
    });
  });

  describe('addWebhookTarget', () => {
    test('should add webhook target successfully', () => {
      const target = {
        url: 'https://example.com/webhook',
        headers: { 'X-Custom': 'value' }
      };

      service.addWebhookTarget('target1', target);

      expect(service.webhookTargets.has('target1')).toBe(true);
      expect(service.webhookTargets.get('target1')).toBe(target);
      expect(consoleInfoSpy).toHaveBeenCalledWith('Added webhook target: target1');
    });
  });

  describe('getRoutingInfo', () => {
    test('should return routing information', () => {
      const changeEvent = {
        ns: { coll: 'issues' },
        operationType: 'insert'
      };

      const eventDetails = {
        eventType: 'issue.created',
        collection: 'issues',
        entityType: 'issue'
      };

      const result = service.getRoutingInfo(changeEvent, eventDetails);

      expect(result).toMatchObject({
        collection: 'issues',
        eventType: 'issue.created',
        entityType: 'issue',
        priority: 'high',
        metadata: {
          hasCollectionMapping: true,
          collectionPriority: 'high',
          eventPatterns: ['issue.*'],
          description: 'Issue management events'
        }
      });
    });

    test('should handle unknown collections', () => {
      const changeEvent = {
        ns: { coll: 'unknown_collection' },
        operationType: 'insert'
      };

      const eventDetails = {
        eventType: 'unknown.created',
        collection: 'unknown_collection',
        entityType: 'unknown'
      };

      const result = service.getRoutingInfo(changeEvent, eventDetails);

      expect(result).toMatchObject({
        collection: 'unknown_collection',
        eventType: 'unknown.created',
        entityType: 'unknown',
        priority: 'low',
        metadata: {
          hasCollectionMapping: false,
          collectionPriority: 'low',
          eventPatterns: [],
          description: 'Unknown collection'
        }
      });
    });
  });

  describe('applyRoutingRules', () => {
    test('should apply matching routing rules', async () => {
      const rule1 = {
        priority: 100,
        condition: jest.fn().mockReturnValue(true),
        action: jest.fn().mockResolvedValue({ modified: true })
      };

      const rule2 = {
        priority: 50,
        condition: jest.fn().mockReturnValue(false),
        action: jest.fn()
      };

      service.addRoutingRule('rule1', rule1);
      service.addRoutingRule('rule2', rule2);

      const changeEvent = { ns: { coll: 'issues' } };
      const eventDetails = { eventType: 'issue.created' };
      const webhooks = [{ _id: 'webhook1' }];

      const result = await service.applyRoutingRules(changeEvent, eventDetails, webhooks);

      expect(rule1.condition).toHaveBeenCalledWith(changeEvent, eventDetails, webhooks);
      expect(rule1.action).toHaveBeenCalledWith(changeEvent, eventDetails, webhooks);
      expect(rule2.condition).toHaveBeenCalledWith(changeEvent, eventDetails, webhooks);
      expect(rule2.action).not.toHaveBeenCalled();
      expect(result).toEqual({ modified: true });
    });

    test('should apply rules in priority order', async () => {
      const callOrder = [];

      const rule1 = {
        priority: 50,
        condition: () => true,
        action: async () => callOrder.push('rule1')
      };

      const rule2 = {
        priority: 100,
        condition: () => true,
        action: async () => callOrder.push('rule2')
      };

      const rule3 = {
        priority: 75,
        condition: () => true,
        action: async () => callOrder.push('rule3')
      };

      service.addRoutingRule('rule1', rule1);
      service.addRoutingRule('rule2', rule2);
      service.addRoutingRule('rule3', rule3);

      await service.applyRoutingRules({}, {}, []);

      expect(callOrder).toEqual(['rule2', 'rule3', 'rule1']);
    });

    test('should handle rule errors gracefully', async () => {
      const rule = {
        priority: 100,
        condition: () => true,
        action: async () => {
          throw new Error('Rule error');
        }
      };

      service.addRoutingRule('error-rule', rule);

      const result = await service.applyRoutingRules({}, {}, []);

      expect(result).toEqual([]);
      expect(consoleErrorSpy).toHaveBeenCalledWith(
        'Error applying routing rule error-rule:',
        expect.any(Error)
      );
    });
  });

  describe('getRoutingStats', () => {
    test('should return routing statistics', () => {
      // Simulate some routing activity
      service.routingStats.totalEvents = 100;
      service.routingStats.routedEvents = 85;
      service.routingStats.droppedEvents = 10;
      service.routingStats.routingErrors = 5;
      service.routingStats.routesByCollection = {
        issues: 50,
        projects: 30,
        users: 20
      };
      service.routingStats.routesByEventType = {
        'issue.created': 25,
        'issue.updated': 25,
        'project.created': 30
      };

      const stats = service.getRoutingStats();

      expect(stats).toMatchObject({
        summary: {
          totalEvents: 100,
          routedEvents: 85,
          droppedEvents: 10,
          routingErrors: 5,
          routingRate: 0.85,
          errorRate: 0.05
        },
        collections: expect.any(Array),
        eventTypes: expect.any(Array),
        routingRules: expect.any(Array),
        webhookTargets: expect.any(Array)
      });

      expect(stats.collections).toContainEqual({ name: 'issues', events: 50 });
      expect(stats.eventTypes).toContainEqual({ type: 'issue.created', events: 25 });
    });

    test('should handle empty statistics', () => {
      const stats = service.getRoutingStats();

      expect(stats.summary).toMatchObject({
        totalEvents: 0,
        routedEvents: 0,
        droppedEvents: 0,
        routingErrors: 0,
        routingRate: 0,
        errorRate: 0
      });

      expect(stats.collections).toEqual([]);
      expect(stats.eventTypes).toEqual([]);
    });
  });

  describe('resetRoutingStats', () => {
    test('should reset all routing statistics', () => {
      // Set some stats
      service.routingStats.totalEvents = 100;
      service.routingStats.routedEvents = 85;
      service.routingStats.routesByCollection.issues = 50;
      service.routingStats.routesByEventType['issue.created'] = 25;

      service.resetRoutingStats();

      expect(service.routingStats).toEqual({
        totalEvents: 0,
        routedEvents: 0,
        droppedEvents: 0,
        routingErrors: 0,
        routesByCollection: {},
        routesByWebhook: {},
        routesByEventType: {}
      });

      expect(consoleInfoSpy).toHaveBeenCalledWith('Routing statistics reset');
    });
  });

  describe('validateWebhookRouting', () => {
    test('should validate webhook routing configuration', () => {
      const validWebhook = {
        _id: 'webhook1',
        url: 'https://example.com/webhook',
        events: ['issue.*', 'project.created'],
        collections: ['issues', 'projects'],
        active: true
      };

      const result = service.validateWebhookRouting(validWebhook);

      expect(result).toMatchObject({
        valid: true,
        errors: [],
        warnings: [],
        suggestions: []
      });
    });

    test('should detect invalid event patterns', () => {
      const webhook = {
        _id: 'webhook1',
        url: 'https://example.com/webhook',
        events: ['issue.*', 'invalid..pattern', '*.*.toomany'],
        collections: [],
        active: true
      };

      const result = service.validateWebhookRouting(webhook);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Invalid event pattern: invalid..pattern');
      expect(result.errors).toContain('Invalid event pattern: *.*.toomany');
    });

    test('should warn about broad event patterns', () => {
      const webhook = {
        _id: 'webhook1',
        url: 'https://example.com/webhook',
        events: ['*'],
        collections: [],
        active: true
      };

      const result = service.validateWebhookRouting(webhook);

      expect(result.valid).toBe(true);
      expect(result.warnings).toContain('Webhook subscribes to all events (*)');
    });

    test('should suggest optimizations', () => {
      const webhook = {
        _id: 'webhook1',
        url: 'https://example.com/webhook',
        events: ['issue.created', 'issue.updated', 'issue.deleted', 'issue.assigned'],
        collections: [],
        active: true
      };

      const result = service.validateWebhookRouting(webhook);

      expect(result.suggestions).toContain('Consider using issue.* instead of multiple issue events');
    });

    test('should detect collection mismatches', () => {
      const webhook = {
        _id: 'webhook1',
        url: 'https://example.com/webhook',
        events: ['issue.*'],
        collections: ['projects'], // Mismatch
        active: true
      };

      const result = service.validateWebhookRouting(webhook);

      expect(result.warnings).toContain('Event pattern issue.* may not match collection filter');
    });
  });

  describe('getPriorityForEvent', () => {
    test('should return priority from collection mapping', () => {
      const eventDetails = {
        collection: 'issues',
        eventType: 'issue.created'
      };

      const priority = service.getPriorityForEvent(eventDetails);
      expect(priority).toBe('high');
    });

    test('should return low priority for unknown collections', () => {
      const eventDetails = {
        collection: 'unknown',
        eventType: 'unknown.event'
      };

      const priority = service.getPriorityForEvent(eventDetails);
      expect(priority).toBe('low');
    });
  });

  describe('Error Handling', () => {
    test('should handle null/undefined inputs gracefully', () => {
      expect(() => service.shouldRouteToWebhook(null, {})).not.toThrow();
      expect(() => service.getRoutingInfo(null, null)).not.toThrow();
      expect(() => service.validateWebhookRouting(null)).not.toThrow();
    });
  });
});