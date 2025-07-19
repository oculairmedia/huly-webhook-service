/**
 * Database service for Huly Webhook Service
 *
 * This service now uses the adapter pattern for better testability.
 * It delegates all database operations to the injected adapter,
 * allowing for easy mocking in tests.
 */

const MongoDBAdapter = require('../adapters/MongoDBAdapter');
const config = require('../config');
const logger = require('../utils/logger');

class DatabaseService {
  constructor (adapter = null) {
    // Use injected adapter or create default MongoDB adapter
    this.adapter = adapter || new MongoDBAdapter(config.mongodb);
  }

  /**
   * Connect to database
   */
  async connect () {
    await this.adapter.connect();

    // Initialize webhook collections
    const collectionNames = [
      'webhooks',
      'webhook_deliveries',
      'webhook_events'
    ];

    const indexes = {
      webhooks: [
        { key: { active: 1 } },
        { key: { events: 1 } },
        { key: { createdAt: 1 } },
        { key: { name: 1 }, options: { unique: true } }
      ],
      webhook_deliveries: [
        { key: { webhookId: 1 } },
        { key: { status: 1 } },
        { key: { eventType: 1 } },
        { key: { createdAt: 1 } },
        { key: { nextRetry: 1 } },
        { key: { webhookId: 1, createdAt: -1 } }
      ],
      webhook_events: [
        {
          key: { sourceId: 1, eventType: 1, eventHash: 1 },
          options: { unique: true }
        },
        { key: { processedAt: 1 } }
      ]
    };

    await this.adapter.initializeCollections(collectionNames, indexes);
  }

  /**
   * Disconnect from database
   */
  async disconnect () {
    await this.adapter.disconnect();
  }

  /**
   * Ping database to check connectivity
   */
  async ping () {
    return await this.adapter.ping();
  }

  /**
   * Get database information
   */
  async getInfo () {
    return await this.adapter.getInfo();
  }

  /**
   * Check if connected
   */
  isConnectedToDatabase () {
    return this.adapter.isConnected();
  }

  // Delegate all CRUD operations to the adapter

  async insertOne (collectionName, document) {
    return await this.adapter.insertOne(collectionName, document);
  }

  async find (collectionName, filter = {}, options = {}) {
    return await this.adapter.find(collectionName, filter, options);
  }

  async findOne (collectionName, filter, options = {}) {
    return await this.adapter.findOne(collectionName, filter, options);
  }

  async updateOne (collectionName, filter, update, options = {}) {
    return await this.adapter.updateOne(collectionName, filter, update, options);
  }

  async deleteOne (collectionName, filter) {
    return await this.adapter.deleteOne(collectionName, filter);
  }

  async aggregate (collectionName, pipeline) {
    return await this.adapter.aggregate(collectionName, pipeline);
  }

  async countDocuments (collectionName, filter = {}) {
    return await this.adapter.countDocuments(collectionName, filter);
  }

  async insertMany (collectionName, documents) {
    return await this.adapter.insertMany(collectionName, documents);
  }

  async updateMany (collectionName, filter, update, options = {}) {
    return await this.adapter.updateMany(collectionName, filter, update, options);
  }

  async deleteMany (collectionName, filter) {
    return await this.adapter.deleteMany(collectionName, filter);
  }

  async findOneAndUpdate (collectionName, filter, update, options = {}) {
    return await this.adapter.findOneAndUpdate(collectionName, filter, update, options);
  }

  async findOneAndDelete (collectionName, filter, options = {}) {
    return await this.adapter.findOneAndDelete(collectionName, filter, options);
  }

  async bulkWrite (collectionName, operations, options = {}) {
    return await this.adapter.bulkWrite(collectionName, operations, options);
  }

  async withTransaction (callback) {
    return await this.adapter.withTransaction(callback);
  }

  async watchCollection (collectionName, pipeline = [], options = {}) {
    return await this.adapter.watchCollection(collectionName, pipeline, options);
  }

  async createIndexes (collectionName, indexes) {
    return await this.adapter.createIndexes(collectionName, indexes);
  }

  // ID handling methods

  createObjectId (id) {
    return this.adapter.createId(id);
  }

  isValidObjectId (id) {
    return this.adapter.isValidId(id);
  }

  // Backward compatibility methods

  /**
   * Get collection handle (for backward compatibility)
   * Note: This may not work with all adapters
   */
  getCollection (name) {
    logger.warn('getCollection() is deprecated. Use the adapter methods directly.');
    if (this.adapter.getNativeDb) {
      return this.adapter.getNativeDb().collection(name);
    }
    throw new Error('Current adapter does not support getCollection()');
  }

  /**
   * Get MongoDB client (for backward compatibility)
   * Note: This only works with MongoDB adapter
   */
  getClient () {
    logger.warn('getClient() is deprecated and may not work with all adapters.');
    if (this.adapter.getNativeClient) {
      return this.adapter.getNativeClient();
    }
    throw new Error('Current adapter does not support getClient()');
  }

  /**
   * Get database handle (for backward compatibility)
   * Note: This only works with MongoDB adapter
   */
  getDatabase () {
    logger.warn('getDatabase() is deprecated and may not work with all adapters.');
    if (this.adapter.getNativeDb) {
      return this.adapter.getNativeDb();
    }
    throw new Error('Current adapter does not support getDatabase()');
  }

  // Add helper method to set adapter (useful for testing)
  setAdapter (adapter) {
    this.adapter = adapter;
  }

  // Add helper method to get adapter (useful for testing)
  getAdapter () {
    return this.adapter;
  }
}

module.exports = DatabaseService;
