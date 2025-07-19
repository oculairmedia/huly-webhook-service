/**
 * Delivery test fixtures
 */

const { ObjectId } = require('mongodb');

const successfulDelivery = {
  _id: new ObjectId('707f1f77bcf86cd799439001'),
  webhookId: new ObjectId('507f1f77bcf86cd799439011'), // GitHub webhook
  eventType: 'issue.created',
  eventId: 'evt_issue_created_001',
  url: 'https://api.github.com/webhook',
  payload: {
    id: 'evt_issue_created_001',
    type: 'issue.created',
    timestamp: '2025-01-19T10:00:00Z',
    data: {
      issue: {
        identifier: 'WEBHOOK-100',
        title: 'Test issue'
      }
    }
  },
  result: {
    success: true,
    statusCode: 200,
    responseTime: 145,
    headers: {
      'x-github-request-id': '1234:5678:90AB:CDEF',
      'x-ratelimit-remaining': '4999'
    },
    body: '{"status":"ok"}',
    size: 15
  },
  attempt: 1,
  timestamp: new Date('2025-01-19T10:00:01Z'),
  statusCode: 200,
  success: true,
  responseTime: 145
};

const failedDelivery = {
  _id: new ObjectId('707f1f77bcf86cd799439002'),
  webhookId: new ObjectId('507f1f77bcf86cd799439012'), // Slack webhook
  eventType: 'issue.created',
  eventId: 'evt_issue_created_002',
  url: 'https://hooks.slack.com/services/T00000000/B00000000/XXXXXXXXXXXXXXXXXXXXXXXX',
  payload: {
    id: 'evt_issue_created_002',
    type: 'issue.created',
    timestamp: '2025-01-19T11:00:00Z',
    data: {
      issue: {
        identifier: 'WEBHOOK-101',
        title: 'Another test issue'
      }
    }
  },
  result: {
    success: false,
    statusCode: 500,
    responseTime: 3000,
    error: 'HTTP 500: Internal Server Error',
    retryable: true,
    headers: {
      'x-slack-error': 'internal_error'
    },
    body: '{"ok":false,"error":"internal_error"}',
    size: 38
  },
  attempt: 1,
  timestamp: new Date('2025-01-19T11:00:03Z'),
  statusCode: 500,
  success: false,
  responseTime: 3000
};

const retriedDelivery = {
  _id: new ObjectId('707f1f77bcf86cd799439003'),
  webhookId: new ObjectId('507f1f77bcf86cd799439012'), // Slack webhook
  eventType: 'issue.created',
  eventId: 'evt_issue_created_002',
  url: 'https://hooks.slack.com/services/T00000000/B00000000/XXXXXXXXXXXXXXXXXXXXXXXX',
  payload: {
    id: 'evt_issue_created_002',
    type: 'issue.created',
    timestamp: '2025-01-19T11:00:00Z',
    data: {
      issue: {
        identifier: 'WEBHOOK-101',
        title: 'Another test issue'
      }
    }
  },
  result: {
    success: true,
    statusCode: 200,
    responseTime: 250,
    headers: {
      'x-slack-ok': 'true'
    },
    body: '{"ok":true}',
    size: 11
  },
  attempt: 2,
  timestamp: new Date('2025-01-19T11:00:10Z'),
  statusCode: 200,
  success: true,
  responseTime: 250
};

const timeoutDelivery = {
  _id: new ObjectId('707f1f77bcf86cd799439004'),
  webhookId: new ObjectId('507f1f77bcf86cd799439014'), // Broken endpoint
  eventType: 'issue.updated',
  eventId: 'evt_issue_updated_001',
  url: 'https://broken.example.com/webhook',
  payload: {
    id: 'evt_issue_updated_001',
    type: 'issue.updated',
    timestamp: '2025-01-19T12:00:00Z'
  },
  result: {
    success: false,
    error: 'Request timeout',
    retryable: true,
    responseTime: 30000
  },
  attempt: 1,
  timestamp: new Date('2025-01-19T12:00:30Z'),
  statusCode: null,
  success: false,
  responseTime: 30000
};

const rateLimitedDelivery = {
  _id: new ObjectId('707f1f77bcf86cd799439005'),
  webhookId: new ObjectId('507f1f77bcf86cd799439011'), // GitHub webhook
  eventType: 'issue.created',
  eventId: 'evt_issue_created_003',
  url: 'https://api.github.com/webhook',
  payload: {
    id: 'evt_issue_created_003',
    type: 'issue.created',
    timestamp: '2025-01-19T13:00:00Z'
  },
  result: {
    success: false,
    statusCode: 429,
    responseTime: 50,
    error: 'HTTP 429: Too Many Requests',
    retryable: true,
    headers: {
      'x-ratelimit-limit': '5000',
      'x-ratelimit-remaining': '0',
      'x-ratelimit-reset': '1705665600'
    },
    body: '{"message":"API rate limit exceeded"}',
    size: 37
  },
  attempt: 1,
  timestamp: new Date('2025-01-19T13:00:00Z'),
  statusCode: 429,
  success: false,
  responseTime: 50
};

// Dead letter queue entry
const deadLetterEntry = {
  _id: new ObjectId('807f1f77bcf86cd799439001'),
  webhookId: new ObjectId('507f1f77bcf86cd799439014'), // Broken endpoint
  eventType: 'issue.deleted',
  eventId: 'evt_issue_deleted_001',
  originalPayload: {
    id: 'evt_issue_deleted_001',
    type: 'issue.deleted',
    timestamp: '2025-01-19T14:00:00Z'
  },
  failureReason: 'Max retry attempts exceeded',
  attempts: 3,
  lastAttempt: new Date('2025-01-19T14:15:00Z'),
  errors: [
    { attempt: 1, error: 'HTTP 500: Internal Server Error', timestamp: new Date('2025-01-19T14:00:01Z') },
    { attempt: 2, error: 'HTTP 503: Service Unavailable', timestamp: new Date('2025-01-19T14:05:00Z') },
    { attempt: 3, error: 'Request timeout', timestamp: new Date('2025-01-19T14:15:00Z') }
  ],
  createdAt: new Date('2025-01-19T14:15:00Z')
};

module.exports = {
  successfulDelivery,
  failedDelivery,
  retriedDelivery,
  timeoutDelivery,
  rateLimitedDelivery,
  deadLetterEntry,

  // Collections
  deliveryHistory: [
    successfulDelivery,
    failedDelivery,
    retriedDelivery,
    timeoutDelivery,
    rateLimitedDelivery
  ],

  // Factory function
  createDelivery(overrides = {}) {
    return {
      _id: new ObjectId(),
      webhookId: new ObjectId(),
      eventType: 'issue.created',
      eventId: `evt_${Date.now()}`,
      url: 'https://example.com/webhook',
      payload: {
        id: `evt_${Date.now()}`,
        type: 'issue.created',
        timestamp: new Date().toISOString()
      },
      result: {
        success: true,
        statusCode: 200,
        responseTime: 100
      },
      attempt: 1,
      timestamp: new Date(),
      statusCode: 200,
      success: true,
      responseTime: 100,
      ...overrides
    };
  },

  // Statistics
  getDeliveryStats(deliveries) {
    const total = deliveries.length;
    const successful = deliveries.filter(d => d.success).length;
    const failed = deliveries.filter(d => !d.success).length;
    
    const avgResponseTime = deliveries.reduce((sum, d) => sum + (d.responseTime || 0), 0) / total || 0;
    
    const statusCodes = {};
    deliveries.forEach(d => {
      if (d.statusCode) {
        statusCodes[d.statusCode] = (statusCodes[d.statusCode] || 0) + 1;
      }
    });

    return {
      total,
      successful,
      failed,
      successRate: total > 0 ? successful / total : 0,
      failureRate: total > 0 ? failed / total : 0,
      avgResponseTime,
      statusCodes
    };
  }
};