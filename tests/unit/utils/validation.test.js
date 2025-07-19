/**
 * Unit tests for ValidationUtils
 */

const ValidationUtils = require('../../../src/utils/validation');

describe('ValidationUtils', () => {
  describe('isValidUrl', () => {
    test('should validate HTTP URLs', () => {
      expect(ValidationUtils.isValidUrl('http://example.com')).toBe(true);
      expect(ValidationUtils.isValidUrl('http://example.com/webhook')).toBe(true);
      expect(ValidationUtils.isValidUrl('http://example.com:8080/webhook')).toBe(true);
    });

    test('should validate HTTPS URLs', () => {
      expect(ValidationUtils.isValidUrl('https://example.com')).toBe(true);
      expect(ValidationUtils.isValidUrl('https://api.example.com/webhook')).toBe(true);
      expect(ValidationUtils.isValidUrl('https://example.com:443/webhook')).toBe(true);
    });

    test('should reject invalid URLs', () => {
      expect(ValidationUtils.isValidUrl('not-a-url')).toBe(false);
      expect(ValidationUtils.isValidUrl('ftp://example.com')).toBe(false);
      expect(ValidationUtils.isValidUrl('ws://example.com')).toBe(false);
      expect(ValidationUtils.isValidUrl('')).toBe(false);
      expect(ValidationUtils.isValidUrl(null)).toBe(false);
      expect(ValidationUtils.isValidUrl(undefined)).toBe(false);
    });
  });

  describe('isValidSecret', () => {
    test('should validate valid secrets', () => {
      expect(ValidationUtils.isValidSecret('secretkey123')).toBe(true);
      expect(ValidationUtils.isValidSecret('a'.repeat(255))).toBe(true);
      expect(ValidationUtils.isValidSecret('12345678')).toBe(true);
    });

    test('should reject invalid secrets', () => {
      expect(ValidationUtils.isValidSecret('short')).toBe(false); // Too short
      expect(ValidationUtils.isValidSecret('a'.repeat(256))).toBe(false); // Too long
      expect(ValidationUtils.isValidSecret('')).toBe(false);
      expect(ValidationUtils.isValidSecret(123)).toBe(false);
      expect(ValidationUtils.isValidSecret(null)).toBe(false);
    });
  });

  describe('isValidEventType', () => {
    test('should validate supported event types', () => {
      expect(ValidationUtils.isValidEventType('issue.created')).toBe(true);
      expect(ValidationUtils.isValidEventType('issue.updated')).toBe(true);
      expect(ValidationUtils.isValidEventType('issue.deleted')).toBe(true);
      expect(ValidationUtils.isValidEventType('issue.status_changed')).toBe(true);
      expect(ValidationUtils.isValidEventType('issue.assigned')).toBe(true);
      expect(ValidationUtils.isValidEventType('project.created')).toBe(true);
      expect(ValidationUtils.isValidEventType('project.updated')).toBe(true);
      expect(ValidationUtils.isValidEventType('project.archived')).toBe(true);
      expect(ValidationUtils.isValidEventType('comment.created')).toBe(true);
      expect(ValidationUtils.isValidEventType('attachment.added')).toBe(true);
    });

    test('should reject unsupported event types', () => {
      expect(ValidationUtils.isValidEventType('unknown.event')).toBe(false);
      expect(ValidationUtils.isValidEventType('issue')).toBe(false);
      expect(ValidationUtils.isValidEventType('')).toBe(false);
      expect(ValidationUtils.isValidEventType(null)).toBe(false);
    });
  });

  describe('isValidUUID', () => {
    test('should validate valid UUIDs', () => {
      expect(ValidationUtils.isValidUUID('550e8400-e29b-41d4-a716-446655440000')).toBe(true);
      expect(ValidationUtils.isValidUUID('6ba7b810-9dad-11d1-80b4-00c04fd430c8')).toBe(true);
      expect(ValidationUtils.isValidUUID('6ba7b811-9dad-11d1-80b4-00c04fd430c8')).toBe(true);
    });

    test('should reject invalid UUIDs', () => {
      expect(ValidationUtils.isValidUUID('550e8400-e29b-41d4-a716')).toBe(false);
      expect(ValidationUtils.isValidUUID('not-a-uuid')).toBe(false);
      expect(ValidationUtils.isValidUUID('550e8400-e29b-61d4-a716-446655440000')).toBe(false); // Invalid version
      expect(ValidationUtils.isValidUUID('')).toBe(false);
    });
  });

  describe('isValidEmail', () => {
    test('should validate valid emails', () => {
      expect(ValidationUtils.isValidEmail('test@example.com')).toBe(true);
      expect(ValidationUtils.isValidEmail('user.name@example.com')).toBe(true);
      expect(ValidationUtils.isValidEmail('user+tag@example.co.uk')).toBe(true);
    });

    test('should reject invalid emails', () => {
      expect(ValidationUtils.isValidEmail('notanemail')).toBe(false);
      expect(ValidationUtils.isValidEmail('@example.com')).toBe(false);
      expect(ValidationUtils.isValidEmail('user@')).toBe(false);
      expect(ValidationUtils.isValidEmail('user @example.com')).toBe(false);
      expect(ValidationUtils.isValidEmail('')).toBe(false);
    });
  });

  describe('isValidIP', () => {
    test('should validate valid IPv4 addresses', () => {
      expect(ValidationUtils.isValidIP('192.168.1.1')).toBe(true);
      expect(ValidationUtils.isValidIP('10.0.0.0')).toBe(true);
      expect(ValidationUtils.isValidIP('255.255.255.255')).toBe(true);
    });

    test('should validate valid IPv6 addresses', () => {
      expect(ValidationUtils.isValidIP('2001:0db8:85a3:0000:0000:8a2e:0370:7334')).toBe(true);
    });

    test('should reject invalid IP addresses', () => {
      expect(ValidationUtils.isValidIP('256.256.256.256')).toBe(false);
      expect(ValidationUtils.isValidIP('192.168.1')).toBe(false);
      expect(ValidationUtils.isValidIP('not-an-ip')).toBe(false);
      expect(ValidationUtils.isValidIP('')).toBe(false);
    });
  });

  describe('isValidHeaders', () => {
    test('should validate valid headers', () => {
      expect(ValidationUtils.isValidHeaders({
        'X-Custom-Header': 'value',
        'Authorization': 'Bearer token'
      })).toBe(true);
      expect(ValidationUtils.isValidHeaders({})).toBe(true);
    });

    test('should reject invalid headers', () => {
      expect(ValidationUtils.isValidHeaders(null)).toBe(false);
      expect(ValidationUtils.isValidHeaders('not-an-object')).toBe(false);
      expect(ValidationUtils.isValidHeaders({
        'Host': 'example.com' // Forbidden header
      })).toBe(false);
      expect(ValidationUtils.isValidHeaders({
        'Content-Length': '100' // Forbidden header
      })).toBe(false);
      expect(ValidationUtils.isValidHeaders({
        'Valid-Header': 123 // Non-string value
      })).toBe(false);
    });
  });

  describe('isValidTimeout', () => {
    test('should validate valid timeouts', () => {
      expect(ValidationUtils.isValidTimeout(1000)).toBe(true);
      expect(ValidationUtils.isValidTimeout(30000)).toBe(true);
      expect(ValidationUtils.isValidTimeout(120000)).toBe(true);
    });

    test('should reject invalid timeouts', () => {
      expect(ValidationUtils.isValidTimeout(999)).toBe(false); // Too short
      expect(ValidationUtils.isValidTimeout(120001)).toBe(false); // Too long
      expect(ValidationUtils.isValidTimeout('30000')).toBe(false); // Not a number
      expect(ValidationUtils.isValidTimeout(null)).toBe(false);
    });
  });

  describe('isValidRetryConfig', () => {
    test('should validate valid retry configurations', () => {
      expect(ValidationUtils.isValidRetryConfig({
        maxAttempts: 3,
        backoffMultiplier: 2,
        initialDelay: 1000
      })).toBe(true);
      
      expect(ValidationUtils.isValidRetryConfig({
        maxAttempts: 10,
        backoffMultiplier: 10,
        initialDelay: 100
      })).toBe(true);
    });

    test('should reject invalid retry configurations', () => {
      expect(ValidationUtils.isValidRetryConfig(null)).toBe(false);
      expect(ValidationUtils.isValidRetryConfig({})).toBe(false);
      
      expect(ValidationUtils.isValidRetryConfig({
        maxAttempts: 0, // Too low
        backoffMultiplier: 2,
        initialDelay: 1000
      })).toBe(false);
      
      expect(ValidationUtils.isValidRetryConfig({
        maxAttempts: 11, // Too high
        backoffMultiplier: 2,
        initialDelay: 1000
      })).toBe(false);
      
      expect(ValidationUtils.isValidRetryConfig({
        maxAttempts: 3,
        backoffMultiplier: 11, // Too high
        initialDelay: 1000
      })).toBe(false);
      
      expect(ValidationUtils.isValidRetryConfig({
        maxAttempts: 3,
        backoffMultiplier: 2,
        initialDelay: 50 // Too low
      })).toBe(false);
    });
  });

  describe('isValidFilters', () => {
    test('should validate valid filters', () => {
      expect(ValidationUtils.isValidFilters(null)).toBe(true); // Filters are optional
      expect(ValidationUtils.isValidFilters({})).toBe(true);
      
      expect(ValidationUtils.isValidFilters({
        projects: ['project1', 'project2'],
        statuses: ['open', 'closed'],
        priorities: ['high', 'low'],
        assignees: ['user1', 'user2'],
        tags: ['bug', 'feature']
      })).toBe(true);
    });

    test('should reject invalid filters', () => {
      expect(ValidationUtils.isValidFilters({
        projects: 'not-an-array'
      })).toBe(false);
      
      expect(ValidationUtils.isValidFilters({
        statuses: 'not-an-array'
      })).toBe(false);
    });
  });

  describe('isValidWebhookName', () => {
    test('should validate valid webhook names', () => {
      expect(ValidationUtils.isValidWebhookName('My Webhook')).toBe(true);
      expect(ValidationUtils.isValidWebhookName('webhook-123')).toBe(true);
      expect(ValidationUtils.isValidWebhookName('test_webhook')).toBe(true);
      expect(ValidationUtils.isValidWebhookName('Webhook 2023')).toBe(true);
    });

    test('should reject invalid webhook names', () => {
      expect(ValidationUtils.isValidWebhookName('')).toBe(false);
      expect(ValidationUtils.isValidWebhookName('a'.repeat(101))).toBe(false); // Too long
      expect(ValidationUtils.isValidWebhookName('webhook!@#')).toBe(false); // Invalid characters
      expect(ValidationUtils.isValidWebhookName(123)).toBe(false);
    });
  });

  describe('isValidApiKey', () => {
    test('should validate valid API keys', () => {
      expect(ValidationUtils.isValidApiKey('abcdef123456789012345678')).toBe(true);
      expect(ValidationUtils.isValidApiKey('ABCdef-123_456+789/012=')).toBe(true);
      expect(ValidationUtils.isValidApiKey('a'.repeat(255))).toBe(true);
    });

    test('should reject invalid API keys', () => {
      expect(ValidationUtils.isValidApiKey('short')).toBe(false); // Too short
      expect(ValidationUtils.isValidApiKey('a'.repeat(256))).toBe(false); // Too long
      expect(ValidationUtils.isValidApiKey('key with spaces')).toBe(false);
      expect(ValidationUtils.isValidApiKey('key@#$%')).toBe(false);
      expect(ValidationUtils.isValidApiKey(null)).toBe(false);
    });
  });

  describe('validatePagination', () => {
    test('should validate and sanitize pagination parameters', () => {
      expect(ValidationUtils.validatePagination({ page: 2, limit: 20 })).toEqual({
        page: 2,
        limit: 20,
        offset: 20
      });
      
      expect(ValidationUtils.validatePagination({})).toEqual({
        page: 1,
        limit: 50,
        offset: 0
      });
    });

    test('should handle invalid pagination parameters', () => {
      expect(ValidationUtils.validatePagination({ page: 0, limit: 200 })).toEqual({
        page: 1,
        limit: 100,
        offset: 0
      });
      
      expect(ValidationUtils.validatePagination({ page: 'abc', limit: 'xyz' })).toEqual({
        page: 1,
        limit: 50,
        offset: 0
      });
    });
  });

  describe('validateDateRange', () => {
    test('should validate valid date ranges', () => {
      const result = ValidationUtils.validateDateRange('2023-01-01', '2023-12-31');
      expect(result).toBeTruthy();
      expect(result.from).toBeInstanceOf(Date);
      expect(result.to).toBeInstanceOf(Date);
    });

    test('should handle partial date ranges', () => {
      const fromOnly = ValidationUtils.validateDateRange('2023-01-01', null);
      expect(fromOnly).toBeTruthy();
      expect(fromOnly.from).toBeInstanceOf(Date);
      expect(fromOnly.to).toBeUndefined();
      
      const toOnly = ValidationUtils.validateDateRange(null, '2023-12-31');
      expect(toOnly).toBeTruthy();
      expect(toOnly.from).toBeUndefined();
      expect(toOnly.to).toBeInstanceOf(Date);
    });

    test('should reject invalid date ranges', () => {
      expect(ValidationUtils.validateDateRange('invalid', '2023-12-31')).toBeNull();
      expect(ValidationUtils.validateDateRange('2023-12-31', '2023-01-01')).toBeNull(); // From > To
    });
  });

  describe('isValidEventData', () => {
    test('should validate valid event data', () => {
      expect(ValidationUtils.isValidEventData({
        id: '550e8400-e29b-41d4-a716-446655440000',
        type: 'issue.created',
        timestamp: new Date().toISOString(),
        workspace: 'workspace-123',
        data: { title: 'Test Issue' }
      })).toBe(true);
    });

    test('should reject invalid event data', () => {
      expect(ValidationUtils.isValidEventData(null)).toBe(false);
      expect(ValidationUtils.isValidEventData({})).toBe(false);
      
      expect(ValidationUtils.isValidEventData({
        // Missing required fields
        type: 'issue.created',
        timestamp: new Date().toISOString()
      })).toBe(false);
      
      expect(ValidationUtils.isValidEventData({
        id: 'not-a-uuid',
        type: 'issue.created',
        timestamp: new Date().toISOString(),
        workspace: 'workspace-123',
        data: {}
      })).toBe(false);
      
      expect(ValidationUtils.isValidEventData({
        id: '550e8400-e29b-41d4-a716-446655440000',
        type: 'invalid.type',
        timestamp: new Date().toISOString(),
        workspace: 'workspace-123',
        data: {}
      })).toBe(false);
    });
  });

  describe('sanitizeString', () => {
    test('should sanitize strings', () => {
      expect(ValidationUtils.sanitizeString('  test  ')).toBe('test');
      expect(ValidationUtils.sanitizeString('test\x00null')).toBe('testnull');
      expect(ValidationUtils.sanitizeString('test\x1Fcontrol')).toBe('testcontrol');
    });

    test('should truncate long strings', () => {
      const longString = 'a'.repeat(300);
      expect(ValidationUtils.sanitizeString(longString)).toHaveLength(255);
      expect(ValidationUtils.sanitizeString(longString, 10)).toHaveLength(10);
    });

    test('should handle non-string inputs', () => {
      expect(ValidationUtils.sanitizeString(null)).toBe('');
      expect(ValidationUtils.sanitizeString(undefined)).toBe('');
      expect(ValidationUtils.sanitizeString(123)).toBe('');
    });
  });

  describe('validateJSON', () => {
    test('should validate and parse valid JSON', () => {
      expect(ValidationUtils.validateJSON('{"key": "value"}')).toEqual({ key: 'value' });
      expect(ValidationUtils.validateJSON('[]')).toEqual([]);
      expect(ValidationUtils.validateJSON('null')).toBeNull();
    });

    test('should return null for invalid JSON', () => {
      expect(ValidationUtils.validateJSON('invalid')).toBeNull();
      expect(ValidationUtils.validateJSON('{key: value}')).toBeNull();
      expect(ValidationUtils.validateJSON('')).toBeNull();
    });
  });

  describe('isValidSignatureFormat', () => {
    test('should validate valid signature formats', () => {
      expect(ValidationUtils.isValidSignatureFormat('sha256=' + 'a'.repeat(64))).toBe(true);
      expect(ValidationUtils.isValidSignatureFormat('sha256=' + '0123456789abcdef'.repeat(4))).toBe(true);
    });

    test('should reject invalid signature formats', () => {
      expect(ValidationUtils.isValidSignatureFormat('sha256=' + 'a'.repeat(63))).toBe(false); // Too short
      expect(ValidationUtils.isValidSignatureFormat('sha256=' + 'g'.repeat(64))).toBe(false); // Invalid hex
      expect(ValidationUtils.isValidSignatureFormat('sha1=' + 'a'.repeat(64))).toBe(false); // Wrong prefix
      expect(ValidationUtils.isValidSignatureFormat('a'.repeat(64))).toBe(false); // No prefix
      expect(ValidationUtils.isValidSignatureFormat(null)).toBe(false);
    });
  });

  describe('isValidMongoConnectionString', () => {
    test('should validate valid MongoDB connection strings', () => {
      expect(ValidationUtils.isValidMongoConnectionString('mongodb://localhost/test')).toBe(true);
      expect(ValidationUtils.isValidMongoConnectionString('mongodb://user:pass@localhost/test')).toBe(true);
      expect(ValidationUtils.isValidMongoConnectionString('mongodb://host1,host2,host3/test')).toBe(true);
    });

    test('should reject invalid MongoDB connection strings', () => {
      expect(ValidationUtils.isValidMongoConnectionString('mysql://localhost/test')).toBe(false);
      expect(ValidationUtils.isValidMongoConnectionString('localhost/test')).toBe(false);
      expect(ValidationUtils.isValidMongoConnectionString('')).toBe(false);
      expect(ValidationUtils.isValidMongoConnectionString(null)).toBe(false);
    });
  });

  describe('createWebhookSchema', () => {
    test('should create valid webhook schema', () => {
      const schema = ValidationUtils.createWebhookSchema();
      
      const validWebhook = {
        name: 'Test Webhook',
        url: 'https://example.com/webhook',
        events: ['issue.created'],
        secret: 'secretkey123',
        active: true
      };
      
      const { error } = schema.validate(validWebhook);
      expect(error).toBeUndefined();
    });

    test('should validate webhook schema with all fields', () => {
      const schema = ValidationUtils.createWebhookSchema();
      
      const webhook = {
        name: 'Complete Webhook',
        url: 'https://example.com/webhook',
        events: ['issue.created', 'issue.updated'],
        secret: 'secretkey123',
        filters: {
          projects: ['project1'],
          statuses: ['open'],
          priorities: ['high'],
          assignees: ['user1'],
          tags: ['bug']
        },
        active: false,
        retryConfig: {
          maxAttempts: 5,
          backoffMultiplier: 3,
          initialDelay: 2000
        },
        timeout: 60000,
        headers: {
          'X-Custom': 'value'
        },
        metadata: {
          custom: 'data'
        }
      };
      
      const { error, value } = schema.validate(webhook);
      expect(error).toBeUndefined();
      expect(value).toMatchObject(webhook);
    });

    test('should reject invalid webhook data', () => {
      const schema = ValidationUtils.createWebhookSchema();
      
      const invalidWebhook = {
        name: '', // Too short
        url: 'not-a-url',
        events: [] // Empty array
      };
      
      const { error } = schema.validate(invalidWebhook);
      expect(error).toBeDefined();
    });
  });

  describe('createWebhookUpdateSchema', () => {
    test('should create valid webhook update schema', () => {
      const schema = ValidationUtils.createWebhookUpdateSchema();
      
      const partialUpdate = {
        name: 'Updated Name'
      };
      
      const { error } = schema.validate(partialUpdate);
      expect(error).toBeUndefined();
    });

    test('should allow all fields to be optional', () => {
      const schema = ValidationUtils.createWebhookUpdateSchema();
      
      const { error } = schema.validate({});
      expect(error).toBeUndefined();
    });
  });
});