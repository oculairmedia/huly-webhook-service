/**
 * Integration tests for webhook workflows
 * Tests end-to-end scenarios across multiple services
 */

const request = require('supertest');
const nock = require('nock');
const { ObjectId } = require('mongodb');
const WebhookApp = require('../../src/index');
const { 
  getTestDatabase, 
  setupTestDatabase, 
  teardownTestDatabase 
} = require('../helpers/testDatabase');
const { 
  activeWebhook, 
  createWebhook,
  failingWebhook 
} = require('../fixtures/webhooks');
const { 
  issueCreatedEvent,
  issueUpdatedEvent,
  mongoChangeEventInsert,
  createIssueEvent,
  createMongoChangeEvent
} = require('../fixtures/events');
const { createDelivery } = require('../fixtures/deliveries');

// Environment setup
process.env.NODE_ENV = 'test';
process.env.MONGODB_URL = 'mongodb://localhost:27017/test';
process.env.WEBHOOK_SECRET_KEY = 'test-webhook-secret-key-that-is-at-least-32-chars';
process.env.API_KEY = 'test-api-key-16chars';

describe('Webhook Workflows Integration Tests', () => {
  let app;
  let server;
  let testDb;
  let mongoUri;
  const apiKey = process.env.API_KEY;

  beforeAll(async () => {
    // Setup test database
    mongoUri = await setupTestDatabase();
    testDb = getTestDatabase();
    
    // Override MongoDB URL with test database URI
    process.env.MONGODB_URL = mongoUri;
    
    // Initialize application
    app = new WebhookApp();
    server = await app.start();
  }, 30000);

  afterAll(async () => {
    // Cleanup
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
    await teardownTestDatabase();
  });

  beforeEach(async () => {
    // Clean database before each test
    await testDb.clean();
    
    // Clear all HTTP mocks
    nock.cleanAll();
  });

  describe('Complete Webhook Lifecycle', () => {
    it('should handle complete webhook lifecycle: create → trigger → deliver → verify', async () => {
      // 1. Create a webhook
      const webhookData = {
        name: 'Test Webhook',
        url: 'https://test.example.com/webhook',
        events: ['issue.created', 'issue.updated'],
        secret: 'test-secret-123'
      };

      const createResponse = await request(server)
        .post('/api/webhooks')
        .set('X-API-Key', apiKey)
        .send(webhookData)
        .expect(201);

      const webhook = createResponse.body;
      expect(webhook).toMatchObject({
        name: webhookData.name,
        url: webhookData.url,
        events: webhookData.events,
        active: true
      });

      // 2. Mock the webhook endpoint
      const webhookScope = nock('https://test.example.com')
        .post('/webhook')
        .reply(200, { status: 'received' });

      // 3. Simulate a change event in MongoDB
      const issuesCollection = testDb.collection('issues');
      const changePromise = testDb.waitForChangeEvent(async () => {
        await issuesCollection.insertOne({
          _id: new ObjectId(),
          _class: 'tracker:class:Issue',
          space: new ObjectId(),
          title: 'New test issue',
          status: 'tracker:status:Backlog',
          modifiedOn: Date.now()
        });
      });

      // Wait for change event
      const changeEvent = await changePromise;
      expect(changeEvent.operationType).toBe('insert');

      // 4. Wait for webhook delivery
      await new Promise(resolve => setTimeout(resolve, 2000));

      // 5. Verify delivery was attempted
      expect(webhookScope.isDone()).toBe(true);

      // 6. Check delivery record in database
      const deliveries = await testDb.collection('webhook_deliveries')
        .find({ webhookId: new ObjectId(webhook._id) })
        .toArray();

      expect(deliveries).toHaveLength(1);
      expect(deliveries[0]).toMatchObject({
        webhookId: new ObjectId(webhook._id),
        eventType: 'issue.created',
        success: true,
        statusCode: 200
      });

      // 7. Verify webhook stats were updated
      const statsResponse = await request(server)
        .get(`/api/webhooks/${webhook._id}/stats`)
        .set('X-API-Key', apiKey)
        .expect(200);

      expect(statsResponse.body).toMatchObject({
        totalDeliveries: 1,
        successfulDeliveries: 1,
        failedDeliveries: 0
      });
    });

    it('should handle webhook deletion and stop deliveries', async () => {
      // Create and save a webhook
      const webhook = createWebhook({
        url: 'https://delete-test.example.com/webhook'
      });
      await testDb.collection('webhooks').insertOne(webhook);

      // Delete the webhook
      await request(server)
        .delete(`/api/webhooks/${webhook._id}`)
        .set('X-API-Key', apiKey)
        .expect(204);

      // Simulate an event
      const issuesCollection = testDb.collection('issues');
      await issuesCollection.insertOne({
        _id: new ObjectId(),
        _class: 'tracker:class:Issue',
        title: 'Should not trigger webhook'
      });

      // Wait to ensure no delivery is attempted
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Verify no deliveries were made
      const deliveries = await testDb.collection('webhook_deliveries')
        .find({ webhookId: webhook._id })
        .toArray();

      expect(deliveries).toHaveLength(0);
    });
  });

  describe('Event Processing Pipeline', () => {
    it('should process change stream events and route to appropriate webhooks', async () => {
      // Create multiple webhooks with different event subscriptions
      const webhooks = [
        createWebhook({
          name: 'Issues Only',
          url: 'https://issues.example.com/webhook',
          events: ['issue.created', 'issue.updated']
        }),
        createWebhook({
          name: 'Projects Only',
          url: 'https://projects.example.com/webhook',
          events: ['project.created']
        }),
        createWebhook({
          name: 'All Events',
          url: 'https://all.example.com/webhook',
          events: ['*']
        })
      ];

      await testDb.collection('webhooks').insertMany(webhooks);

      // Mock webhook endpoints
      const issuesScope = nock('https://issues.example.com')
        .post('/webhook')
        .reply(200);

      const projectsScope = nock('https://projects.example.com')
        .post('/webhook')
        .reply(200);

      const allScope = nock('https://all.example.com')
        .post('/webhook')
        .times(2) // Should receive both events
        .reply(200);

      // Trigger issue event
      await testDb.collection('issues').insertOne({
        _id: new ObjectId(),
        _class: 'tracker:class:Issue',
        title: 'Test issue event routing'
      });

      // Trigger project event
      await testDb.collection('projects').insertOne({
        _id: new ObjectId(),
        _class: 'core:class:Project',
        name: 'Test project event routing'
      });

      // Wait for deliveries
      await new Promise(resolve => setTimeout(resolve, 3000));

      // Verify correct webhooks were called
      expect(issuesScope.isDone()).toBe(true);
      expect(projectsScope.isDone()).toBe(true);
      expect(allScope.isDone()).toBe(true);

      // Verify delivery records
      const deliveries = await testDb.collection('webhook_deliveries')
        .find({})
        .toArray();

      // Issues webhook: 1 delivery
      const issueDeliveries = deliveries.filter(d => 
        d.webhookId.toString() === webhooks[0]._id.toString()
      );
      expect(issueDeliveries).toHaveLength(1);

      // Projects webhook: 1 delivery
      const projectDeliveries = deliveries.filter(d => 
        d.webhookId.toString() === webhooks[1]._id.toString()
      );
      expect(projectDeliveries).toHaveLength(1);

      // All events webhook: 2 deliveries
      const allDeliveries = deliveries.filter(d => 
        d.webhookId.toString() === webhooks[2]._id.toString()
      );
      expect(allDeliveries).toHaveLength(2);
    });

    it('should handle duplicate events and deduplication', async () => {
      const webhook = createWebhook({
        url: 'https://dedup.example.com/webhook'
      });
      await testDb.collection('webhooks').insertOne(webhook);

      // Mock webhook to track calls
      let callCount = 0;
      const scope = nock('https://dedup.example.com')
        .post('/webhook')
        .reply(() => {
          callCount++;
          return [200, { received: true }];
        })
        .persist();

      // Create an event
      const event = createIssueEvent('created', {
        id: 'evt_duplicate_test',
        data: {
          issue: {
            _id: new ObjectId(),
            identifier: 'TEST-123'
          }
        }
      });

      // Store the same event multiple times
      const eventsCollection = testDb.collection('webhook_events');
      
      // First insert should succeed
      await eventsCollection.insertOne({
        sourceId: event.id,
        eventHash: require('crypto').createHash('sha256')
          .update(JSON.stringify(event))
          .digest('hex'),
        eventType: event.type,
        eventData: event,
        processedAt: new Date()
      });

      // Duplicate insert should fail due to unique index
      try {
        await eventsCollection.insertOne({
          sourceId: event.id,
          eventHash: require('crypto').createHash('sha256')
            .update(JSON.stringify(event))
            .digest('hex'),
          eventType: event.type,
          eventData: event,
          processedAt: new Date()
        });
      } catch (error) {
        expect(error.code).toBe(11000); // Duplicate key error
      }

      // Process the event
      await app.services.delivery.processEvent(event);

      // Wait for processing
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Verify webhook was called only once
      expect(callCount).toBe(1);

      scope.persist(false);
    });
  });

  describe('Retry and Failure Handling', () => {
    it('should retry failed deliveries with exponential backoff', async () => {
      const webhook = createWebhook({
        url: 'https://retry.example.com/webhook',
        retryConfig: {
          maxAttempts: 3,
          backoffMultiplier: 2
        }
      });
      await testDb.collection('webhooks').insertOne(webhook);

      // Mock webhook to fail twice then succeed
      let attemptCount = 0;
      const scope = nock('https://retry.example.com')
        .post('/webhook')
        .times(3)
        .reply(() => {
          attemptCount++;
          if (attemptCount < 3) {
            return [500, { error: 'Server error' }];
          }
          return [200, { status: 'success' }];
        });

      // Trigger an event
      const event = createIssueEvent('created');
      await app.services.delivery.processEvent(event);

      // Wait for retries (with backoff)
      await new Promise(resolve => setTimeout(resolve, 5000));

      // Verify all attempts were made
      expect(scope.isDone()).toBe(true);
      expect(attemptCount).toBe(3);

      // Check delivery records
      const deliveries = await testDb.collection('webhook_deliveries')
        .find({ webhookId: webhook._id })
        .sort({ timestamp: 1 })
        .toArray();

      expect(deliveries).toHaveLength(3);
      expect(deliveries[0].success).toBe(false);
      expect(deliveries[0].attempt).toBe(1);
      expect(deliveries[1].success).toBe(false);
      expect(deliveries[1].attempt).toBe(2);
      expect(deliveries[2].success).toBe(true);
      expect(deliveries[2].attempt).toBe(3);

      // Verify backoff timing
      const delay1 = deliveries[1].timestamp - deliveries[0].timestamp;
      const delay2 = deliveries[2].timestamp - deliveries[1].timestamp;
      expect(delay2).toBeGreaterThan(delay1); // Exponential backoff
    });

    it('should move permanently failed deliveries to dead letter queue', async () => {
      const webhook = createWebhook({
        url: 'https://permanent-fail.example.com/webhook',
        retryConfig: {
          maxAttempts: 3,
          backoffMultiplier: 2
        }
      });
      await testDb.collection('webhooks').insertOne(webhook);

      // Mock webhook to always fail
      const scope = nock('https://permanent-fail.example.com')
        .post('/webhook')
        .times(3)
        .reply(500, { error: 'Permanent failure' });

      // Trigger an event
      const event = createIssueEvent('created', {
        id: 'evt_permanent_fail'
      });
      await app.services.delivery.processEvent(event);

      // Wait for all retry attempts
      await new Promise(resolve => setTimeout(resolve, 6000));

      // Verify all attempts were made
      expect(scope.isDone()).toBe(true);

      // Check dead letter queue
      const dlqEntries = await testDb.collection('dead_letter_queue')
        .find({ webhookId: webhook._id })
        .toArray();

      expect(dlqEntries).toHaveLength(1);
      expect(dlqEntries[0]).toMatchObject({
        webhookId: webhook._id,
        eventType: 'issue.created',
        eventId: 'evt_permanent_fail',
        failureReason: expect.stringContaining('Max retry attempts exceeded'),
        attempts: 3
      });

      // Verify error history is recorded
      expect(dlqEntries[0].errors).toHaveLength(3);
      dlqEntries[0].errors.forEach((error, index) => {
        expect(error).toMatchObject({
          attempt: index + 1,
          error: expect.stringContaining('500')
        });
      });
    });

    it('should handle timeout failures correctly', async () => {
      const webhook = createWebhook({
        url: 'https://timeout.example.com/webhook'
      });
      await testDb.collection('webhooks').insertOne(webhook);

      // Mock webhook to delay response beyond timeout
      const scope = nock('https://timeout.example.com')
        .post('/webhook')
        .delayConnection(35000) // Delay longer than default timeout
        .reply(200);

      // Trigger an event
      const event = createIssueEvent('created');
      await app.services.delivery.processEvent(event);

      // Wait for timeout
      await new Promise(resolve => setTimeout(resolve, 32000));

      // Check delivery record
      const deliveries = await testDb.collection('webhook_deliveries')
        .find({ webhookId: webhook._id })
        .toArray();

      expect(deliveries).toHaveLength(1);
      expect(deliveries[0]).toMatchObject({
        success: false,
        result: {
          error: expect.stringContaining('timeout')
        }
      });

      nock.cleanAll();
    }, 40000);
  });

  describe('Webhook Filtering and Routing', () => {
    it('should filter webhooks by project', async () => {
      // Create webhooks with project filters
      const webhooks = [
        createWebhook({
          name: 'Project A Only',
          url: 'https://project-a.example.com/webhook',
          filters: { projects: ['PROJECT-A'] }
        }),
        createWebhook({
          name: 'Project B Only',
          url: 'https://project-b.example.com/webhook',
          filters: { projects: ['PROJECT-B'] }
        }),
        createWebhook({
          name: 'All Projects',
          url: 'https://all-projects.example.com/webhook',
          filters: { projects: [] } // Empty means all
        })
      ];

      await testDb.collection('webhooks').insertMany(webhooks);

      // Mock endpoints
      const projectAScope = nock('https://project-a.example.com')
        .post('/webhook')
        .reply(200);

      const projectBScope = nock('https://project-b.example.com')
        .post('/webhook')
        .reply(200);

      const allProjectsScope = nock('https://all-projects.example.com')
        .post('/webhook')
        .times(2) // Should receive both events
        .reply(200);

      // Create events for different projects
      const eventA = createIssueEvent('created', {
        data: {
          issue: {
            project: { identifier: 'PROJECT-A' }
          }
        }
      });

      const eventB = createIssueEvent('created', {
        data: {
          issue: {
            project: { identifier: 'PROJECT-B' }
          }
        }
      });

      // Process events
      await app.services.delivery.processEvent(eventA);
      await app.services.delivery.processEvent(eventB);

      // Wait for deliveries
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Verify correct filtering
      expect(projectAScope.isDone()).toBe(true);
      expect(projectBScope.isDone()).toBe(true);
      expect(allProjectsScope.isDone()).toBe(true);
    });

    it('should filter webhooks by custom criteria', async () => {
      // Create webhook with custom filters
      const webhook = createWebhook({
        name: 'High Priority Only',
        url: 'https://priority.example.com/webhook',
        events: ['issue.created', 'issue.updated'],
        filters: {
          custom: {
            priority: ['high', 'urgent']
          }
        }
      });

      await testDb.collection('webhooks').insertOne(webhook);

      // Mock endpoint
      let receivedEvents = [];
      const scope = nock('https://priority.example.com')
        .post('/webhook')
        .times(2)
        .reply(200, function(uri, requestBody) {
          receivedEvents.push(requestBody);
          return { received: true };
        });

      // Create events with different priorities
      const events = [
        createIssueEvent('created', {
          data: { issue: { priority: 'low' } }
        }),
        createIssueEvent('created', {
          data: { issue: { priority: 'medium' } }
        }),
        createIssueEvent('created', {
          data: { issue: { priority: 'high' } }
        }),
        createIssueEvent('created', {
          data: { issue: { priority: 'urgent' } }
        })
      ];

      // Process all events
      for (const event of events) {
        await app.services.delivery.processEvent(event);
      }

      // Wait for processing
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Verify only high/urgent events were delivered
      expect(receivedEvents).toHaveLength(2);
      expect(receivedEvents[0].data.issue.priority).toMatch(/high|urgent/);
      expect(receivedEvents[1].data.issue.priority).toMatch(/high|urgent/);
    });
  });

  describe('Authentication and Authorization', () => {
    it('should reject requests without API key', async () => {
      await request(server)
        .get('/api/webhooks')
        .expect(401)
        .expect(res => {
          expect(res.body.error).toBe('Unauthorized');
        });
    });

    it('should reject requests with invalid API key', async () => {
      await request(server)
        .get('/api/webhooks')
        .set('X-API-Key', 'invalid-key')
        .expect(401);
    });

    it('should validate webhook signatures', async () => {
      const webhook = createWebhook({
        url: 'https://signed.example.com/webhook',
        secret: 'webhook-secret-key'
      });
      await testDb.collection('webhooks').insertOne(webhook);

      // Mock endpoint to verify signature
      let receivedHeaders = {};
      const scope = nock('https://signed.example.com')
        .post('/webhook')
        .reply(function(uri, requestBody, cb) {
          receivedHeaders = this.req.headers;
          cb(null, [200, { verified: true }]);
        });

      // Process an event
      const event = createIssueEvent('created');
      await app.services.delivery.processEvent(event);

      // Wait for delivery
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Verify signature header was sent
      expect(receivedHeaders).toHaveProperty('x-hub-signature-256');
      
      // Verify signature format
      const signature = receivedHeaders['x-hub-signature-256'];
      expect(signature).toMatch(/^sha256=[a-f0-9]{64}$/);
    });

    it('should respect IP allowlist when configured', async () => {
      // This would require modifying the app configuration
      // and testing with different source IPs
      // Skipping for now as it requires more complex setup
    });
  });

  describe('Rate Limiting', () => {
    it('should enforce rate limits per API key', async () => {
      // Make multiple rapid requests
      const requests = [];
      for (let i = 0; i < 15; i++) {
        requests.push(
          request(server)
            .get('/api/webhooks')
            .set('X-API-Key', apiKey)
        );
      }

      const responses = await Promise.all(requests);
      
      // Check that some requests were rate limited
      const rateLimited = responses.filter(r => r.status === 429);
      expect(rateLimited.length).toBeGreaterThan(0);

      // Verify rate limit headers
      const limitedResponse = rateLimited[0];
      expect(limitedResponse.headers).toHaveProperty('x-ratelimit-limit');
      expect(limitedResponse.headers).toHaveProperty('x-ratelimit-remaining');
      expect(limitedResponse.headers).toHaveProperty('x-ratelimit-reset');
    });

    it('should handle webhook delivery rate limiting', async () => {
      const webhook = createWebhook({
        url: 'https://github.com/webhook' // GitHub has rate limits
      });
      await testDb.collection('webhooks').insertOne(webhook);

      // Mock GitHub to return rate limit error
      const scope = nock('https://github.com')
        .post('/webhook')
        .reply(429, {
          message: 'API rate limit exceeded'
        }, {
          'X-RateLimit-Limit': '5000',
          'X-RateLimit-Remaining': '0',
          'X-RateLimit-Reset': Math.floor(Date.now() / 1000) + 3600
        });

      // Process event
      const event = createIssueEvent('created');
      await app.services.delivery.processEvent(event);

      // Wait for delivery attempt
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Check delivery record
      const deliveries = await testDb.collection('webhook_deliveries')
        .find({ webhookId: webhook._id })
        .toArray();

      expect(deliveries).toHaveLength(1);
      expect(deliveries[0]).toMatchObject({
        success: false,
        statusCode: 429,
        result: {
          error: expect.stringContaining('429'),
          retryable: true
        }
      });
    });
  });

  describe('Dead Letter Queue Processing', () => {
    it('should allow manual retry of dead letter queue entries', async () => {
      const webhook = createWebhook({
        url: 'https://dlq-retry.example.com/webhook'
      });
      await testDb.collection('webhooks').insertOne(webhook);

      // Create a DLQ entry
      const dlqEntry = {
        _id: new ObjectId(),
        webhookId: webhook._id,
        eventType: 'issue.created',
        eventId: 'evt_dlq_test',
        originalPayload: createIssueEvent('created'),
        failureReason: 'Max retry attempts exceeded',
        attempts: 3,
        createdAt: new Date()
      };
      await testDb.collection('dead_letter_queue').insertOne(dlqEntry);

      // Mock successful endpoint now
      const scope = nock('https://dlq-retry.example.com')
        .post('/webhook')
        .reply(200, { success: true });

      // Manually retry DLQ entry (this would be an admin endpoint)
      // For now, directly call the service method
      await app.services.delivery.retryDeadLetterEntry(dlqEntry._id);

      // Wait for delivery
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Verify delivery was successful
      expect(scope.isDone()).toBe(true);

      // Check DLQ entry was removed
      const remainingDlq = await testDb.collection('dead_letter_queue')
        .findOne({ _id: dlqEntry._id });
      expect(remainingDlq).toBeNull();

      // Verify successful delivery was recorded
      const deliveries = await testDb.collection('webhook_deliveries')
        .find({ webhookId: webhook._id })
        .toArray();

      expect(deliveries).toHaveLength(1);
      expect(deliveries[0].success).toBe(true);
    });

    it('should purge old DLQ entries based on retention policy', async () => {
      // Create old and new DLQ entries
      const oldDate = new Date();
      oldDate.setDate(oldDate.getDate() - 31); // 31 days old

      const entries = [
        {
          _id: new ObjectId(),
          webhookId: new ObjectId(),
          createdAt: oldDate,
          eventType: 'issue.created'
        },
        {
          _id: new ObjectId(),
          webhookId: new ObjectId(),
          createdAt: new Date(), // Recent
          eventType: 'issue.created'
        }
      ];

      await testDb.collection('dead_letter_queue').insertMany(entries);

      // Run purge operation (this would typically be a scheduled job)
      await app.services.delivery.purgeOldDeadLetterEntries(30); // 30 day retention

      // Check remaining entries
      const remaining = await testDb.collection('dead_letter_queue')
        .find({})
        .toArray();

      expect(remaining).toHaveLength(1);
      expect(remaining[0]._id).toEqual(entries[1]._id); // Only recent entry remains
    });
  });

  describe('Concurrent Webhook Deliveries', () => {
    it('should handle concurrent deliveries to multiple webhooks', async () => {
      // Create multiple webhooks
      const webhooks = [];
      const scopes = [];
      
      for (let i = 0; i < 5; i++) {
        const webhook = createWebhook({
          name: `Webhook ${i}`,
          url: `https://concurrent-${i}.example.com/webhook`
        });
        webhooks.push(webhook);

        // Mock each endpoint with different delays
        const scope = nock(`https://concurrent-${i}.example.com`)
          .post('/webhook')
          .delay(Math.random() * 1000) // Random delay up to 1 second
          .reply(200, { webhookId: i });
        scopes.push(scope);
      }

      await testDb.collection('webhooks').insertMany(webhooks);

      // Process a single event that should trigger all webhooks
      const startTime = Date.now();
      const event = createIssueEvent('created');
      await app.services.delivery.processEvent(event);

      // Wait for all deliveries
      await new Promise(resolve => setTimeout(resolve, 3000));

      // Verify all webhooks were called
      scopes.forEach(scope => {
        expect(scope.isDone()).toBe(true);
      });

      // Check delivery times to ensure concurrency
      const deliveries = await testDb.collection('webhook_deliveries')
        .find({})
        .toArray();

      expect(deliveries).toHaveLength(5);

      // Calculate delivery windows
      const deliveryTimes = deliveries.map(d => d.timestamp.getTime());
      const minTime = Math.min(...deliveryTimes);
      const maxTime = Math.max(...deliveryTimes);
      const timeSpan = maxTime - minTime;

      // Deliveries should be concurrent (within ~1 second window)
      expect(timeSpan).toBeLessThan(1500);
    });

    it('should handle high load with multiple events and webhooks', async () => {
      // Create webhooks
      const webhookCount = 3;
      const eventCount = 10;
      const webhooks = [];
      
      for (let i = 0; i < webhookCount; i++) {
        const webhook = createWebhook({
          name: `Load Test Webhook ${i}`,
          url: `https://load-test-${i}.example.com/webhook`
        });
        webhooks.push(webhook);

        // Mock endpoint to accept multiple calls
        nock(`https://load-test-${i}.example.com`)
          .post('/webhook')
          .times(eventCount)
          .reply(200);
      }

      await testDb.collection('webhooks').insertMany(webhooks);

      // Generate multiple events rapidly
      const events = [];
      for (let i = 0; i < eventCount; i++) {
        events.push(createIssueEvent('created', {
          id: `evt_load_test_${i}`,
          data: {
            issue: {
              identifier: `LOAD-${i}`
            }
          }
        }));
      }

      // Process all events concurrently
      const startTime = Date.now();
      await Promise.all(
        events.map(event => app.services.delivery.processEvent(event))
      );

      // Wait for all deliveries
      await new Promise(resolve => setTimeout(resolve, 5000));

      const endTime = Date.now();
      const totalTime = endTime - startTime;

      // Verify all deliveries completed
      const deliveries = await testDb.collection('webhook_deliveries')
        .find({})
        .toArray();

      expect(deliveries).toHaveLength(webhookCount * eventCount);

      // Check success rate
      const successful = deliveries.filter(d => d.success).length;
      expect(successful).toBe(webhookCount * eventCount);

      // Performance check - should handle load efficiently
      expect(totalTime).toBeLessThan(10000); // Should complete within 10 seconds

      // Verify no events were lost
      const uniqueEvents = new Set(deliveries.map(d => d.eventId));
      expect(uniqueEvents.size).toBe(eventCount);
    });
  });

  describe('Resume Token Persistence', () => {
    it('should persist and resume from change stream tokens', async () => {
      // Get current resume token
      const tokensBefore = await testDb.collection('resume_tokens')
        .find({})
        .toArray();

      // Create an event
      await testDb.collection('issues').insertOne({
        _id: new ObjectId(),
        _class: 'tracker:class:Issue',
        title: 'Test resume token'
      });

      // Wait for processing
      await new Promise(resolve => setTimeout(resolve, 1000));

      // Check resume token was updated
      const tokensAfter = await testDb.collection('resume_tokens')
        .find({})
        .toArray();

      expect(tokensAfter.length).toBeGreaterThan(0);
      
      if (tokensBefore.length > 0) {
        // Token should be different after processing
        expect(tokensAfter[0].token).not.toEqual(tokensBefore[0].token);
      }

      // Simulate service restart by stopping and starting change stream
      await app.services.changeStream.stop();
      await app.services.changeStream.start();

      // Service should resume from saved token
      // (In a real test, we'd verify it doesn't reprocess old events)
    });
  });

  describe('Health Checks and Monitoring', () => {
    it('should report healthy status when all services are running', async () => {
      const response = await request(server)
        .get('/api/health')
        .expect(200);

      expect(response.body).toMatchObject({
        status: 'healthy',
        timestamp: expect.any(String),
        services: {
          database: { status: 'connected' },
          changeStream: { status: 'running' }
        }
      });
    });

    it('should provide detailed health metrics', async () => {
      const response = await request(server)
        .get('/api/health/detailed')
        .expect(200);

      expect(response.body).toMatchObject({
        status: 'healthy',
        uptime: expect.any(Number),
        memory: {
          used: expect.any(Number),
          total: expect.any(Number)
        },
        services: expect.any(Object),
        stats: {
          totalWebhooks: expect.any(Number),
          activeWebhooks: expect.any(Number)
        }
      });
    });
  });

  describe('Error Scenarios', () => {
    it('should handle malformed webhook payloads gracefully', async () => {
      const response = await request(server)
        .post('/api/webhooks')
        .set('X-API-Key', apiKey)
        .send({
          name: 'Invalid Webhook',
          url: 'not-a-valid-url', // Invalid URL
          events: 'not-an-array' // Should be array
        })
        .expect(400);

      expect(response.body).toMatchObject({
        error: 'Validation Error',
        details: expect.any(Array)
      });
    });

    it('should handle database connection failures gracefully', async () => {
      // This would require simulating database disconnection
      // which is complex in an integration test
      // Could be done by stopping MongoDB container if using Docker
    });

    it('should handle webhook endpoint DNS failures', async () => {
      const webhook = createWebhook({
        url: 'https://non-existent-domain-12345.example.com/webhook'
      });
      await testDb.collection('webhooks').insertOne(webhook);

      // Process event
      const event = createIssueEvent('created');
      await app.services.delivery.processEvent(event);

      // Wait for delivery attempt
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Check delivery record
      const deliveries = await testDb.collection('webhook_deliveries')
        .find({ webhookId: webhook._id })
        .toArray();

      expect(deliveries).toHaveLength(1);
      expect(deliveries[0]).toMatchObject({
        success: false,
        result: {
          error: expect.stringContaining('ENOTFOUND')
        }
      });
    });
  });

  describe('Performance and Timing', () => {
    it('should deliver webhooks within acceptable time limits', async () => {
      const webhook = createWebhook({
        url: 'https://performance.example.com/webhook'
      });
      await testDb.collection('webhooks').insertOne(webhook);

      // Mock fast endpoint
      const scope = nock('https://performance.example.com')
        .post('/webhook')
        .reply(200);

      // Measure time from event to delivery
      const startTime = Date.now();
      
      const event = createIssueEvent('created');
      await app.services.delivery.processEvent(event);

      // Wait for delivery
      await new Promise(resolve => setTimeout(resolve, 500));

      const delivery = await testDb.collection('webhook_deliveries')
        .findOne({ webhookId: webhook._id });

      const endTime = delivery.timestamp.getTime();
      const totalTime = endTime - startTime;

      // Delivery should be fast (under 1 second for local delivery)
      expect(totalTime).toBeLessThan(1000);
      expect(delivery.responseTime).toBeLessThan(500);
    });

    it('should batch process events efficiently', async () => {
      const webhook = createWebhook({
        url: 'https://batch.example.com/webhook'
      });
      await testDb.collection('webhooks').insertOne(webhook);

      let receivedPayloads = [];
      const scope = nock('https://batch.example.com')
        .post('/webhook')
        .times(5)
        .reply(200, function(uri, requestBody) {
          receivedPayloads.push(requestBody);
          return { received: true };
        });

      // Create multiple events in quick succession
      const events = [];
      for (let i = 0; i < 5; i++) {
        events.push(createIssueEvent('created', {
          id: `evt_batch_${i}`
        }));
      }

      // Process all events
      const startTime = Date.now();
      await Promise.all(
        events.map(e => app.services.delivery.processEvent(e))
      );

      // Wait for batch processing
      await new Promise(resolve => setTimeout(resolve, 2000));

      const endTime = Date.now();
      const totalTime = endTime - startTime;

      // All events should be delivered
      expect(scope.isDone()).toBe(true);
      expect(receivedPayloads).toHaveLength(5);

      // Batch processing should be efficient
      expect(totalTime).toBeLessThan(3000);
    });
  });
});