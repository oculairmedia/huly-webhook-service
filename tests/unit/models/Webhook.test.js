/**
 * Unit tests for Webhook model
 */

const Webhook = require('../../../src/models/Webhook');
const {
  createWebhook,
  createMinimalWebhook,
  createInactiveWebhook,
  createFilteredWebhook,
  createWebhookWithHeaders,
  createWebhookWithFailures
} = require('../../../src/models/factories/webhookFactory');

describe('Webhook Model', () => {
  describe('Constructor', () => {
    test('should create webhook with default values', () => {
      const webhook = new Webhook();
      
      expect(webhook.id).toBeDefined();
      expect(webhook.name).toBe('');
      expect(webhook.url).toBe('');
      expect(webhook.secret).toBe('');
      expect(webhook.events).toEqual([]);
      expect(webhook.filters).toEqual({});
      expect(webhook.active).toBe(true);
      expect(webhook.retryConfig).toEqual({
        maxAttempts: 3,
        backoffMultiplier: 2,
        initialDelay: 1000
      });
      expect(webhook.timeout).toBe(30000);
      expect(webhook.headers).toEqual({});
      expect(webhook.metadata).toEqual({});
      expect(webhook.createdAt).toBeInstanceOf(Date);
      expect(webhook.updatedAt).toBeInstanceOf(Date);
      expect(webhook.createdBy).toBeNull();
      expect(webhook.lastDelivery).toBeNull();
      expect(webhook.deliveryStats).toEqual({
        totalDeliveries: 0,
        successfulDeliveries: 0,
        failedDeliveries: 0,
        lastSuccessAt: null,
        lastFailureAt: null
      });
    });

    test('should create webhook with provided data', () => {
      const data = {
        id: 'webhook-123',
        name: 'Test Webhook',
        url: 'https://example.com/webhook',
        secret: 'secret-key',
        events: ['issue.created'],
        active: false,
        timeout: 60000,
        createdBy: 'user-123'
      };
      
      const webhook = new Webhook(data);
      
      expect(webhook.id).toBe(data.id);
      expect(webhook.name).toBe(data.name);
      expect(webhook.url).toBe(data.url);
      expect(webhook.secret).toBe(data.secret);
      expect(webhook.events).toEqual(data.events);
      expect(webhook.active).toBe(data.active);
      expect(webhook.timeout).toBe(data.timeout);
      expect(webhook.createdBy).toBe(data.createdBy);
    });
  });

  describe('Validation', () => {
    test('should validate valid webhook', () => {
      const webhook = createWebhook();
      
      expect(() => webhook.validate()).not.toThrow();
    });

    test('should fail validation without required fields', () => {
      const webhook = new Webhook();
      
      expect(() => webhook.validate()).toThrow('Webhook validation failed');
    });

    test('should fail validation with invalid URL', () => {
      const webhook = createWebhook({ url: 'not-a-url' });
      
      expect(() => webhook.validate()).toThrow('must be a valid uri');
    });

    test('should fail validation with invalid event type', () => {
      const webhook = createWebhook({ events: ['invalid.event'] });
      
      expect(() => webhook.validate()).toThrow();
    });

    test('should fail validation with short secret', () => {
      const webhook = createWebhook({ secret: 'short' });
      
      expect(() => webhook.validate()).toThrow('length must be at least 8 characters');
    });

    test('should fail validation with invalid timeout', () => {
      const webhook = createWebhook({ timeout: 500 });
      
      expect(() => webhook.validate()).toThrow('must be greater than or equal to 1000');
    });

    test('should validate webhook with all valid event types', () => {
      const allEvents = [
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
      ];
      
      const webhook = createWebhook({ events: allEvents });
      
      expect(() => webhook.validate()).not.toThrow();
    });
  });

  describe('toObject', () => {
    test('should convert webhook to plain object', () => {
      const webhook = createWebhook();
      const obj = webhook.toObject();
      
      expect(obj).toEqual({
        id: webhook.id,
        name: webhook.name,
        url: webhook.url,
        secret: webhook.secret,
        events: webhook.events,
        filters: webhook.filters,
        active: webhook.active,
        retryConfig: webhook.retryConfig,
        timeout: webhook.timeout,
        headers: webhook.headers,
        metadata: webhook.metadata,
        createdAt: webhook.createdAt,
        updatedAt: webhook.updatedAt,
        createdBy: webhook.createdBy,
        lastDelivery: webhook.lastDelivery,
        deliveryStats: webhook.deliveryStats
      });
    });
  });

  describe('toResponse', () => {
    test('should convert webhook to API response format', () => {
      const webhook = createWebhook();
      const response = webhook.toResponse();
      
      // Response should not include secret
      expect(response.secret).toBeUndefined();
      
      // Should include other fields
      expect(response.id).toBe(webhook.id);
      expect(response.name).toBe(webhook.name);
      expect(response.url).toBe(webhook.url);
      expect(response.events).toEqual(webhook.events);
      expect(response.active).toBe(webhook.active);
    });
  });

  describe('fromDocument', () => {
    test('should create webhook from database document', () => {
      const doc = {
        id: 'webhook-123',
        name: 'DB Webhook',
        url: 'https://db.example.com',
        secret: 'db-secret',
        events: ['issue.created'],
        active: true
      };
      
      const webhook = Webhook.fromDocument(doc);
      
      expect(webhook).toBeInstanceOf(Webhook);
      expect(webhook.id).toBe(doc.id);
      expect(webhook.name).toBe(doc.name);
      expect(webhook.url).toBe(doc.url);
    });
  });

  describe('updateDeliveryStats', () => {
    test('should update stats for successful delivery', () => {
      const webhook = createWebhook();
      const timestamp = new Date();
      
      webhook.updateDeliveryStats(true, timestamp);
      
      expect(webhook.deliveryStats.totalDeliveries).toBe(1);
      expect(webhook.deliveryStats.successfulDeliveries).toBe(1);
      expect(webhook.deliveryStats.failedDeliveries).toBe(0);
      expect(webhook.deliveryStats.lastSuccessAt).toBe(timestamp);
      expect(webhook.lastDelivery).toBe(timestamp);
      expect(webhook.updatedAt).toBe(timestamp);
    });

    test('should update stats for failed delivery', () => {
      const webhook = createWebhook();
      const timestamp = new Date();
      
      webhook.updateDeliveryStats(false, timestamp);
      
      expect(webhook.deliveryStats.totalDeliveries).toBe(1);
      expect(webhook.deliveryStats.successfulDeliveries).toBe(0);
      expect(webhook.deliveryStats.failedDeliveries).toBe(1);
      expect(webhook.deliveryStats.lastFailureAt).toBe(timestamp);
      expect(webhook.lastDelivery).toBe(timestamp);
      expect(webhook.updatedAt).toBe(timestamp);
    });

    test('should accumulate delivery stats', () => {
      const webhook = createWebhook();
      
      webhook.updateDeliveryStats(true);
      webhook.updateDeliveryStats(false);
      webhook.updateDeliveryStats(true);
      
      expect(webhook.deliveryStats.totalDeliveries).toBe(3);
      expect(webhook.deliveryStats.successfulDeliveries).toBe(2);
      expect(webhook.deliveryStats.failedDeliveries).toBe(1);
    });
  });

  describe('matchesFilters', () => {
    test('should match when no filters are set', () => {
      const webhook = createWebhook();
      const eventData = { project: { id: 'project-1' } };
      
      expect(webhook.matchesFilters(eventData)).toBe(true);
    });

    test('should match project filter', () => {
      const webhook = createFilteredWebhook({ projects: ['project-1', 'project-2'] });
      
      expect(webhook.matchesFilters({ project: { id: 'project-1' } })).toBe(true);
      expect(webhook.matchesFilters({ projectId: 'project-2' })).toBe(true);
      expect(webhook.matchesFilters({ project: { id: 'project-3' } })).toBe(false);
    });

    test('should match status filter', () => {
      const webhook = createFilteredWebhook({ statuses: ['Open', 'In Progress'] });
      
      expect(webhook.matchesFilters({ status: 'Open' })).toBe(true);
      expect(webhook.matchesFilters({ data: { status: 'In Progress' } })).toBe(true);
      expect(webhook.matchesFilters({ status: 'Closed' })).toBe(false);
    });

    test('should match priority filter', () => {
      const webhook = createFilteredWebhook({ priorities: ['High', 'Critical'] });
      
      expect(webhook.matchesFilters({ priority: 'High' })).toBe(true);
      expect(webhook.matchesFilters({ data: { priority: 'Critical' } })).toBe(true);
      expect(webhook.matchesFilters({ priority: 'Low' })).toBe(false);
    });

    test('should match assignee filter', () => {
      const webhook = createFilteredWebhook({ assignees: ['user-1', 'user-2'] });
      
      expect(webhook.matchesFilters({ assignee: 'user-1' })).toBe(true);
      expect(webhook.matchesFilters({ data: { assignee: 'user-2' } })).toBe(true);
      expect(webhook.matchesFilters({ assignee: 'user-3' })).toBe(false);
    });

    test('should match tags filter', () => {
      const webhook = createFilteredWebhook({ tags: ['bug', 'urgent'] });
      
      expect(webhook.matchesFilters({ tags: ['bug', 'feature'] })).toBe(true);
      expect(webhook.matchesFilters({ data: { tags: ['urgent'] } })).toBe(true);
      expect(webhook.matchesFilters({ tags: ['feature'] })).toBe(false);
      expect(webhook.matchesFilters({ tags: [] })).toBe(false);
    });

    test('should match multiple filters (AND logic)', () => {
      const webhook = createFilteredWebhook({
        projects: ['project-1'],
        statuses: ['Open'],
        priorities: ['High']
      });
      
      const matchingEvent = {
        project: { id: 'project-1' },
        status: 'Open',
        priority: 'High'
      };
      
      const nonMatchingEvent = {
        project: { id: 'project-1' },
        status: 'Open',
        priority: 'Low' // Doesn't match priority filter
      };
      
      expect(webhook.matchesFilters(matchingEvent)).toBe(true);
      expect(webhook.matchesFilters(nonMatchingEvent)).toBe(false);
    });
  });

  describe('shouldProcessEvent', () => {
    test('should process event when active and event type matches', () => {
      const webhook = createWebhook({
        active: true,
        events: ['issue.created', 'issue.updated']
      });
      
      expect(webhook.shouldProcessEvent('issue.created')).toBe(true);
      expect(webhook.shouldProcessEvent('issue.updated')).toBe(true);
    });

    test('should not process event when inactive', () => {
      const webhook = createInactiveWebhook({
        events: ['issue.created']
      });
      
      expect(webhook.shouldProcessEvent('issue.created')).toBe(false);
    });

    test('should not process event when event type not in list', () => {
      const webhook = createWebhook({
        active: true,
        events: ['issue.created']
      });
      
      expect(webhook.shouldProcessEvent('issue.updated')).toBe(false);
    });
  });

  describe('Factory Functions', () => {
    test('should create minimal webhook', () => {
      const webhook = createMinimalWebhook();
      
      expect(webhook.name).toBe('Minimal Webhook');
      expect(webhook.url).toBe('https://example.com/minimal');
      expect(webhook.events).toEqual(['issue.created']);
    });

    test('should create inactive webhook', () => {
      const webhook = createInactiveWebhook();
      
      expect(webhook.active).toBe(false);
      expect(webhook.name).toBe('Inactive Webhook');
    });

    test('should create webhook with headers', () => {
      const headers = {
        'X-API-Key': 'test-key',
        'X-Custom-Header': 'custom-value'
      };
      
      const webhook = createWebhookWithHeaders(headers);
      
      expect(webhook.headers).toEqual(headers);
    });

    test('should create webhook with failures', () => {
      const webhook = createWebhookWithFailures(10);
      
      expect(webhook.deliveryStats.totalDeliveries).toBe(12);
      expect(webhook.deliveryStats.successfulDeliveries).toBe(2);
      expect(webhook.deliveryStats.failedDeliveries).toBe(10);
      expect(webhook.deliveryStats.lastSuccessAt).toBeInstanceOf(Date);
      expect(webhook.deliveryStats.lastFailureAt).toBeInstanceOf(Date);
    });
  });
});