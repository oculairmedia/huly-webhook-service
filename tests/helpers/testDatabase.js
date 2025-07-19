/**
 * Test database helper for MongoDB memory server
 * Provides isolated database for testing
 */

const { MongoMemoryServer } = require('mongodb-memory-server');
const { MongoClient } = require('mongodb');
const logger = require('../../src/utils/logger');

class TestDatabase {
  constructor() {
    this.mongod = null;
    this.client = null;
    this.db = null;
  }

  /**
   * Start MongoDB memory server
   * @returns {Promise<string>} MongoDB connection URI
   */
  async start() {
    try {
      // Create and start MongoDB memory server
      this.mongod = await MongoMemoryServer.create({
        instance: {
          dbName: 'huly-webhook-test',
          port: 27017 + Math.floor(Math.random() * 1000) // Random port to avoid conflicts
        }
      });

      const uri = this.mongod.getUri();
      
      // Create client connection
      this.client = new MongoClient(uri, {
        useUnifiedTopology: true
      });

      await this.client.connect();
      this.db = this.client.db('huly-webhook-test');

      logger.info(`Test database started on ${uri}`);
      return uri;
    } catch (error) {
      logger.error('Failed to start test database:', error);
      throw error;
    }
  }

  /**
   * Stop MongoDB memory server
   */
  async stop() {
    try {
      if (this.client) {
        await this.client.close();
        this.client = null;
      }

      if (this.mongod) {
        await this.mongod.stop();
        this.mongod = null;
      }

      logger.info('Test database stopped');
    } catch (error) {
      logger.error('Error stopping test database:', error);
      throw error;
    }
  }

  /**
   * Get database instance
   * @returns {Db} MongoDB database instance
   */
  getDb() {
    if (!this.db) {
      throw new Error('Database not initialized. Call start() first.');
    }
    return this.db;
  }

  /**
   * Clear all collections
   */
  async clean() {
    if (!this.db) return;

    const collections = await this.db.listCollections().toArray();
    await Promise.all(
      collections.map(collection => 
        this.db.collection(collection.name).deleteMany({})
      )
    );
  }

  /**
   * Create collections with indexes
   */
  async createCollections() {
    const db = this.getDb();

    // Create webhooks collection
    await db.createCollection('webhooks');
    await db.collection('webhooks').createIndex({ active: 1 });
    await db.collection('webhooks').createIndex({ events: 1 });
    await db.collection('webhooks').createIndex({ 'filters.projects': 1 });

    // Create webhook_deliveries collection
    await db.createCollection('webhook_deliveries');
    await db.collection('webhook_deliveries').createIndex({ webhookId: 1, timestamp: -1 });
    await db.collection('webhook_deliveries').createIndex({ status: 1 });
    await db.collection('webhook_deliveries').createIndex({ timestamp: -1 });

    // Create webhook_events collection
    await db.createCollection('webhook_events');
    await db.collection('webhook_events').createIndex({ sourceId: 1, eventHash: 1 }, { unique: true });
    await db.collection('webhook_events').createIndex({ eventType: 1, processedAt: -1 });

    // Create resume_tokens collection
    await db.createCollection('resume_tokens');
    await db.collection('resume_tokens').createIndex({ service: 1 }, { unique: true });

    // Create dead_letter_queue collection
    await db.createCollection('dead_letter_queue');
    await db.collection('dead_letter_queue').createIndex({ createdAt: 1 });
    await db.collection('dead_letter_queue').createIndex({ webhookId: 1 });
  }

  /**
   * Seed database with fixtures
   * @param {Object} fixtures - Fixture data organized by collection
   */
  async seed(fixtures) {
    const db = this.getDb();

    for (const [collectionName, documents] of Object.entries(fixtures)) {
      if (documents && documents.length > 0) {
        await db.collection(collectionName).insertMany(documents);
      }
    }
  }

  /**
   * Get collection
   * @param {string} name - Collection name
   * @returns {Collection} MongoDB collection
   */
  collection(name) {
    return this.getDb().collection(name);
  }

  /**
   * Helper to wait for change stream events in tests
   * @param {Function} action - Action that triggers change
   * @param {number} timeout - Max wait time in ms
   * @returns {Promise<Object>} Change event
   */
  async waitForChangeEvent(action, timeout = 5000) {
    const db = this.getDb();
    const changeStream = db.watch();
    
    return new Promise(async (resolve, reject) => {
      const timer = setTimeout(() => {
        changeStream.close();
        reject(new Error('Timeout waiting for change event'));
      }, timeout);

      changeStream.on('change', (event) => {
        clearTimeout(timer);
        changeStream.close();
        resolve(event);
      });

      // Execute the action that should trigger a change
      await action();
    });
  }
}

// Singleton instance for test suite
let instance = null;

/**
 * Get singleton test database instance
 */
function getTestDatabase() {
  if (!instance) {
    instance = new TestDatabase();
  }
  return instance;
}

module.exports = {
  TestDatabase,
  getTestDatabase,

  /**
   * Global test setup
   */
  async setupTestDatabase() {
    const testDb = getTestDatabase();
    const uri = await testDb.start();
    await testDb.createCollections();
    return uri;
  },

  /**
   * Global test teardown
   */
  async teardownTestDatabase() {
    const testDb = getTestDatabase();
    await testDb.stop();
    instance = null;
  }
};