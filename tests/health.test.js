/**
 * Basic health check tests for Huly Webhook Service
 */

const request = require('supertest');
const WebhookApp = require('../src/index');

describe('Health Check Endpoints', () => {
  let app;
  let server;

  beforeAll(async () => {
    // Set test environment
    process.env.NODE_ENV = 'test';
    process.env.MONGODB_URL = 'mongodb://nonexistent:27017/test';
    process.env.WEBHOOK_SECRET_KEY = 'test-secret-key-for-testing-must-be-32-chars-long';
    process.env.API_KEY = 'test-api-key-16-chars';
    process.env.ALLOWED_IPS = ''; // Disable IP whitelist for tests

    app = new WebhookApp();
    
    // Mock database service to avoid connection issues
    app.services = {
      database: {
        ping: jest.fn().mockRejectedValue(new Error('Database not available')),
        getInfo: jest.fn().mockResolvedValue({ error: 'Not connected' }),
        isConnectedToDatabase: jest.fn().mockReturnValue(false)
      },
      webhook: {
        getActiveWebhookCount: jest.fn().mockResolvedValue(0)
      },
      delivery: {
        getStats: jest.fn().mockResolvedValue({ pending: 0, processing: 0, failed: 0 })
      },
      changeStream: {
        isActive: jest.fn().mockReturnValue(false),
        getStatus: jest.fn().mockReturnValue({ active: false })
      }
    };

    // Override service initialization for testing
    const originalInitialize = app.initialize.bind(app);
    app.initialize = async function() {
      // Setup middleware and routes without database connection
      this.setupMiddleware();
      this.setupRoutes();
      this.setupErrorHandling();
      
      // Make mock services available
      this.app.locals.services = this.services;
    };

    await app.initialize();
    server = app.app;
  });

  afterAll(async () => {
    if (server && server.close) {
      server.close();
    }
  });

  describe('GET /api/health', () => {
    it('should return health status', async () => {
      const response = await request(server)
        .get('/api/health')
        .expect(200);

      expect(response.body).toHaveProperty('status');
      expect(response.body).toHaveProperty('timestamp');
      expect(response.body).toHaveProperty('version');
      expect(response.body).toHaveProperty('services');
    });

    it('should show degraded status when services are not healthy', async () => {
      const response = await request(server)
        .get('/api/health')
        .expect(200);

      expect(response.body.status).toBe('degraded');
      expect(response.body.services.mongodb).toBe('disconnected');
    });
  });

  describe('GET /api/health/live', () => {
    it('should return liveness status', async () => {
      const response = await request(server)
        .get('/api/health/live')
        .expect(200);

      expect(response.body).toHaveProperty('alive', true);
      expect(response.body).toHaveProperty('timestamp');
      expect(response.body).toHaveProperty('uptime');
    });
  });

  describe('GET /api/health/ready', () => {
    it('should return readiness status', async () => {
      const response = await request(server)
        .get('/api/health/ready')
        .expect(503); // Should be 503 because services are not ready

      expect(response.body).toHaveProperty('ready', false);
      expect(response.body).toHaveProperty('checks');
    });
  });
});

describe('Basic API Structure', () => {
  let app;
  let server;

  beforeAll(async () => {
    process.env.NODE_ENV = 'test';
    process.env.WEBHOOK_SECRET_KEY = 'test-secret-key-for-testing-must-be-32-chars-long';
    process.env.API_KEY = 'test-api-key-16-chars';
    process.env.ALLOWED_IPS = ''; // Disable IP whitelist for tests

    app = new WebhookApp();
    
    // Mock services for testing
    app.services = {
      database: { ping: jest.fn().mockResolvedValue(true) },
      webhook: { getActiveWebhookCount: jest.fn().mockResolvedValue(0) },
      delivery: { getStats: jest.fn().mockResolvedValue({}) },
      changeStream: { isActive: jest.fn().mockReturnValue(true) }
    };

    app.initialize = async function() {
      this.setupMiddleware();
      this.setupRoutes();
      this.setupErrorHandling();
      this.app.locals.services = this.services;
    };

    await app.initialize();
    server = app.app;
  });

  describe('GET /', () => {
    it('should return service information', async () => {
      const response = await request(server)
        .get('/')
        .expect(200);

      expect(response.body).toHaveProperty('name', 'Huly Webhook Service');
      expect(response.body).toHaveProperty('version');
      expect(response.body).toHaveProperty('status', 'running');
    });
  });

  describe('Authentication', () => {
    it('should reject requests without API key', async () => {
      await request(server)
        .get('/api/webhooks')
        .expect(401);
    });

    it('should reject requests with invalid API key', async () => {
      await request(server)
        .get('/api/webhooks')
        .set('X-API-Key', 'invalid-key')
        .expect(401);
    });

    it('should accept requests with valid API key', async () => {
      // Mock the webhook service for this test
      server.locals.services.webhook = {
        listWebhooks: jest.fn().mockResolvedValue({ documents: [], total: 0 })
      };

      await request(server)
        .get('/api/webhooks')
        .set('X-API-Key', 'test-api-key-16-chars')
        .expect(200);
    });
  });

  describe('404 Handler', () => {
    it('should return 404 for unknown routes', async () => {
      const response = await request(server)
        .get('/unknown-route')
        .expect(404);

      expect(response.body).toHaveProperty('error', 'Not Found');
    });
  });
});