/**
 * Mock services for testing
 */

const { EventEmitter } = require('events');

/**
 * Create mock database service
 */
function createMockDatabaseService() {
  return {
    connect: jest.fn().mockResolvedValue(true),
    disconnect: jest.fn().mockResolvedValue(true),
    ping: jest.fn().mockResolvedValue(true),
    isConnected: jest.fn().mockReturnValue(true),
    isConnectedToDatabase: jest.fn().mockReturnValue(true),
    getInfo: jest.fn().mockResolvedValue({
      version: '5.0.0',
      connections: 1,
      databases: ['huly-webhook-test']
    }),
    
    // CRUD operations
    create: jest.fn().mockResolvedValue({ _id: '123', acknowledged: true }),
    findOne: jest.fn().mockResolvedValue(null),
    findMany: jest.fn().mockResolvedValue([]),
    update: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
    delete: jest.fn().mockResolvedValue({ deletedCount: 1 }),
    count: jest.fn().mockResolvedValue(0),
    
    // Collection operations
    createCollection: jest.fn().mockResolvedValue(true),
    createIndex: jest.fn().mockResolvedValue(true),
    
    // Transaction support
    startTransaction: jest.fn().mockResolvedValue({
      commit: jest.fn().mockResolvedValue(true),
      abort: jest.fn().mockResolvedValue(true)
    })
  };
}

/**
 * Create mock webhook service
 */
function createMockWebhookService() {
  return {
    createWebhook: jest.fn().mockResolvedValue({
      _id: '123',
      name: 'Test Webhook',
      url: 'https://example.com/webhook'
    }),
    getWebhook: jest.fn().mockResolvedValue(null),
    updateWebhook: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
    deleteWebhook: jest.fn().mockResolvedValue({ deletedCount: 1 }),
    listWebhooks: jest.fn().mockResolvedValue({
      documents: [],
      total: 0,
      page: 1,
      totalPages: 1
    }),
    getActiveWebhookCount: jest.fn().mockResolvedValue(0),
    getWebhooksForEvent: jest.fn().mockResolvedValue([]),
    testWebhook: jest.fn().mockResolvedValue({
      success: true,
      statusCode: 200,
      message: 'Test successful'
    }),
    getWebhookStats: jest.fn().mockResolvedValue({
      total: 0,
      active: 0,
      inactive: 0,
      byEventType: {}
    })
  };
}

/**
 * Create mock delivery service
 */
function createMockDeliveryService() {
  return {
    deliverWebhook: jest.fn().mockResolvedValue({
      success: true,
      statusCode: 200,
      responseTime: 100,
      deliveryId: 'delivery_123'
    }),
    testWebhook: jest.fn().mockResolvedValue({
      success: true,
      statusCode: 200,
      message: 'Test successful'
    }),
    calculateRetryDelay: jest.fn().mockReturnValue(1000),
    isRetryableError: jest.fn().mockReturnValue(true),
    getStats: jest.fn().mockResolvedValue({
      pending: 0,
      processing: 0,
      failed: 0,
      succeeded: 0
    }),
    getDetailedStats: jest.fn().mockResolvedValue({
      totalDeliveries: 0,
      successRate: 0,
      failureRate: 0,
      averageResponseTime: 0
    }),
    getPerformanceStats: jest.fn().mockResolvedValue({
      deliveriesPerSecond: 0,
      averageLatency: 0,
      errorRate: 0
    }),
    getHealthStats: jest.fn().mockResolvedValue({
      healthy: true,
      queueDepth: 0,
      failureRate: 0,
      lastDelivery: null
    }),
    getErrorStats: jest.fn().mockResolvedValue({
      recentErrors: [],
      errorsByType: {},
      errorRate: 0
    }),
    getWebhookDeliveries: jest.fn().mockResolvedValue([]),
    replayDelivery: jest.fn().mockResolvedValue({
      success: true,
      message: 'Delivery replayed successfully'
    })
  };
}

/**
 * Create mock change stream service
 */
function createMockChangeStreamService() {
  const emitter = new EventEmitter();
  
  const service = {
    ...emitter,
    initialize: jest.fn().mockResolvedValue(true),
    start: jest.fn().mockResolvedValue(true),
    stop: jest.fn().mockResolvedValue(true),
    shutdown: jest.fn().mockResolvedValue(true),
    isActive: jest.fn().mockReturnValue(true),
    getStatus: jest.fn().mockReturnValue({
      active: true,
      connected: true,
      eventsProcessed: 0,
      lastEvent: null,
      resumeToken: true,
      reconnectAttempts: 0
    }),
    getPerformanceStats: jest.fn().mockResolvedValue({
      eventsProcessed: 0,
      averageProcessingTime: 0,
      errorRate: 0
    }),
    getEventStats: jest.fn().mockResolvedValue({
      totalEvents: 0,
      eventsByType: {},
      eventsByCollection: {}
    }),
    getResumeToken: jest.fn().mockReturnValue(null),
    setResumeToken: jest.fn()
  };
  
  // Ensure EventEmitter methods are available
  Object.setPrototypeOf(service, EventEmitter.prototype);
  
  return service;
}

/**
 * Create mock event type detection service
 */
function createMockEventTypeDetectionService() {
  return {
    detectEventType: jest.fn().mockReturnValue('issue.created'),
    getEntityType: jest.fn().mockReturnValue('issue'),
    getOperationType: jest.fn().mockReturnValue('created'),
    isSupported: jest.fn().mockReturnValue(true),
    getSupportedEventTypes: jest.fn().mockReturnValue([
      'issue.created',
      'issue.updated',
      'issue.deleted',
      'project.created',
      'project.updated'
    ])
  };
}

/**
 * Create mock event payload transformer service
 */
function createMockEventPayloadTransformerService() {
  return {
    transform: jest.fn().mockReturnValue({
      id: 'evt_123',
      type: 'issue.created',
      timestamp: new Date().toISOString(),
      data: {}
    }),
    transformIssue: jest.fn(),
    transformProject: jest.fn(),
    transformComment: jest.fn()
  };
}

/**
 * Create mock event filter service
 */
function createMockEventFilterService() {
  return {
    filterEvent: jest.fn().mockReturnValue(true),
    matchesProjectFilter: jest.fn().mockReturnValue(true),
    matchesEventTypeFilter: jest.fn().mockReturnValue(true),
    matchesCustomFilter: jest.fn().mockReturnValue(true),
    evaluateFilter: jest.fn().mockReturnValue(true)
  };
}

/**
 * Create mock event routing service
 */
function createMockEventRoutingService() {
  return {
    routeEvent: jest.fn().mockResolvedValue([]),
    getMatchingWebhooks: jest.fn().mockResolvedValue([]),
    processEvent: jest.fn().mockResolvedValue({
      processed: 0,
      delivered: 0,
      failed: 0
    })
  };
}

/**
 * Create all mock services
 */
function createMockServices() {
  return {
    database: createMockDatabaseService(),
    webhook: createMockWebhookService(),
    delivery: createMockDeliveryService(),
    changeStream: createMockChangeStreamService(),
    eventTypeDetection: createMockEventTypeDetectionService(),
    eventPayloadTransformer: createMockEventPayloadTransformerService(),
    eventFilter: createMockEventFilterService(),
    eventRouting: createMockEventRoutingService(),
    
    // Additional services
    deadLetterQueue: {
      addToQueue: jest.fn().mockResolvedValue(true),
      getQueueSize: jest.fn().mockResolvedValue(0),
      processQueue: jest.fn().mockResolvedValue(0)
    },
    deliveryQueue: {
      enqueue: jest.fn().mockResolvedValue(true),
      dequeue: jest.fn().mockResolvedValue(null),
      getQueueLength: jest.fn().mockResolvedValue(0)
    },
    circuitBreaker: {
      isOpen: jest.fn().mockReturnValue(false),
      recordSuccess: jest.fn(),
      recordFailure: jest.fn()
    },
    rateLimit: {
      checkLimit: jest.fn().mockResolvedValue(true),
      incrementCounter: jest.fn().mockResolvedValue(true)
    },
    resumeToken: {
      initialize: jest.fn().mockResolvedValue(true),
      saveResumeToken: jest.fn().mockResolvedValue(true),
      loadResumeToken: jest.fn().mockResolvedValue(null),
      shutdown: jest.fn().mockResolvedValue(true)
    },
    deliveryHistory: {
      recordDelivery: jest.fn().mockResolvedValue(true),
      getDeliveryHistory: jest.fn().mockResolvedValue([])
    }
  };
}

module.exports = {
  createMockDatabaseService,
  createMockWebhookService,
  createMockDeliveryService,
  createMockChangeStreamService,
  createMockEventTypeDetectionService,
  createMockEventPayloadTransformerService,
  createMockEventFilterService,
  createMockEventRoutingService,
  createMockServices
};