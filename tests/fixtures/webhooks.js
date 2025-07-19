/**
 * Webhook test fixtures
 */

const { ObjectId } = require('mongodb');

const activeWebhook = {
  _id: new ObjectId('507f1f77bcf86cd799439011'),
  name: 'GitHub Integration',
  url: 'https://api.github.com/webhook',
  events: ['issue.created', 'issue.updated', 'issue.deleted'],
  active: true,
  secret: 'github-webhook-secret-123',
  filters: {
    projects: ['PROJECT-1', 'PROJECT-2'],
    issueTypes: []
  },
  headers: {
    'X-GitHub-Event': 'issues',
    'Accept': 'application/vnd.github.v3+json'
  },
  retryConfig: {
    maxAttempts: 3,
    backoffMultiplier: 2
  },
  createdAt: new Date('2025-01-01T00:00:00Z'),
  updatedAt: new Date('2025-01-01T00:00:00Z'),
  lastDelivery: null,
  failureCount: 0
};

const inactiveWebhook = {
  _id: new ObjectId('507f1f77bcf86cd799439012'),
  name: 'Slack Notifications',
  url: 'https://hooks.slack.com/services/T00000000/B00000000/XXXXXXXXXXXXXXXXXXXXXXXX',
  events: ['issue.created', 'project.created'],
  active: false,
  secret: 'slack-webhook-secret-456',
  filters: {
    projects: [],
    issueTypes: ['bug', 'feature']
  },
  headers: {
    'Content-Type': 'application/json'
  },
  retryConfig: {
    maxAttempts: 5,
    backoffMultiplier: 3
  },
  createdAt: new Date('2025-01-02T00:00:00Z'),
  updatedAt: new Date('2025-01-02T00:00:00Z'),
  lastDelivery: new Date('2025-01-15T10:30:00Z'),
  failureCount: 2
};

const allEventsWebhook = {
  _id: new ObjectId('507f1f77bcf86cd799439013'),
  name: 'Audit Logger',
  url: 'https://audit.example.com/webhook',
  events: ['*'], // All events
  active: true,
  secret: 'audit-webhook-secret-789',
  filters: {
    projects: [],
    issueTypes: []
  },
  headers: {
    'X-Audit-System': 'huly-webhook'
  },
  retryConfig: {
    maxAttempts: 10,
    backoffMultiplier: 2
  },
  createdAt: new Date('2025-01-03T00:00:00Z'),
  updatedAt: new Date('2025-01-03T00:00:00Z'),
  lastDelivery: null,
  failureCount: 0
};

const failingWebhook = {
  _id: new ObjectId('507f1f77bcf86cd799439014'),
  name: 'Broken Endpoint',
  url: 'https://broken.example.com/webhook',
  events: ['issue.created'],
  active: true,
  secret: 'broken-webhook-secret',
  filters: {
    projects: ['PROJECT-3'],
    issueTypes: []
  },
  headers: {},
  retryConfig: {
    maxAttempts: 3,
    backoffMultiplier: 2
  },
  createdAt: new Date('2025-01-04T00:00:00Z'),
  updatedAt: new Date('2025-01-04T00:00:00Z'),
  lastDelivery: new Date('2025-01-18T15:45:00Z'),
  failureCount: 25
};

const customFilterWebhook = {
  _id: new ObjectId('507f1f77bcf86cd799439015'),
  name: 'Priority Filter',
  url: 'https://priority.example.com/webhook',
  events: ['issue.created', 'issue.updated'],
  active: true,
  secret: 'priority-webhook-secret',
  filters: {
    projects: [],
    issueTypes: [],
    custom: {
      priority: ['high', 'urgent'],
      status: ['in-progress', 'blocked']
    }
  },
  headers: {
    'X-Priority-Filter': 'true'
  },
  retryConfig: {
    maxAttempts: 3,
    backoffMultiplier: 2
  },
  createdAt: new Date('2025-01-05T00:00:00Z'),
  updatedAt: new Date('2025-01-05T00:00:00Z'),
  lastDelivery: null,
  failureCount: 0
};

module.exports = {
  activeWebhook,
  inactiveWebhook,
  allEventsWebhook,
  failingWebhook,
  customFilterWebhook,
  
  // Collections
  defaultWebhooks: [
    activeWebhook,
    inactiveWebhook,
    allEventsWebhook
  ],
  
  allWebhooks: [
    activeWebhook,
    inactiveWebhook,
    allEventsWebhook,
    failingWebhook,
    customFilterWebhook
  ],
  
  // Factory function for creating custom webhooks
  createWebhook(overrides = {}) {
    return {
      _id: new ObjectId(),
      name: 'Test Webhook',
      url: 'https://test.example.com/webhook',
      events: ['issue.created'],
      active: true,
      secret: 'test-secret',
      filters: {
        projects: [],
        issueTypes: []
      },
      headers: {},
      retryConfig: {
        maxAttempts: 3,
        backoffMultiplier: 2
      },
      createdAt: new Date(),
      updatedAt: new Date(),
      lastDelivery: null,
      failureCount: 0,
      ...overrides
    };
  }
};