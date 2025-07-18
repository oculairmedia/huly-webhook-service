/**
 * Database service for Huly Webhook Service
 * Handles MongoDB connections and basic database operations
 */

const { MongoClient, ObjectId } = require('mongodb');
const config = require('../config');
const logger = require('../utils/logger');
const { ServiceUnavailableError, handleDatabaseError } = require('../middleware/errorHandler');

class DatabaseService {
  constructor () {
    this.client = null;
    this.db = null;
    this.isConnected = false;
    this.collections = {};
  }

  /**
   * Connect to MongoDB
   */
  async connect () {
    try {
      logger.info('Connecting to MongoDB...', { url: config.mongodb.url });

      this.client = new MongoClient(config.mongodb.url, config.mongodb.options);
      await this.client.connect();

      this.db = this.client.db(config.mongodb.dbName);
      this.isConnected = true;

      // Initialize collections
      await this.initializeCollections();

      // Set up monitoring
      this.setupMonitoring();

      logger.info('MongoDB connected successfully', {
        database: config.mongodb.dbName,
        collections: Object.keys(this.collections)
      });
    } catch (error) {
      logger.error('Failed to connect to MongoDB:', error);
      this.isConnected = false;
      throw new ServiceUnavailableError(`Database connection failed: ${error.message}`);
    }
  }

  /**
   * Disconnect from MongoDB
   */
  async disconnect () {
    try {
      if (this.client) {
        await this.client.close();
        this.isConnected = false;
        logger.info('MongoDB disconnected');
      }
    } catch (error) {
      logger.error('Error disconnecting from MongoDB:', error);
    }
  }

  /**
   * Initialize webhook collections
   */
  async initializeCollections () {
    try {
      // Create collections if they don't exist
      const collections = [
        'webhooks',
        'webhook_deliveries',
        'webhook_events'
      ];

      for (const collectionName of collections) {
        try {
          await this.db.createCollection(collectionName);
          logger.debug(`Collection ${collectionName} created`);
        } catch (error) {
          if (error.code !== 48) { // Collection already exists
            throw error;
          }
        }

        this.collections[collectionName] = this.db.collection(collectionName);
      }

      // Create indexes
      await this.createIndexes();

      logger.info('Database collections initialized');
    } catch (error) {
      handleDatabaseError(error);
    }
  }

  /**
   * Create database indexes for performance
   */
  async createIndexes () {
    try {
      // Webhooks collection indexes
      await this.collections.webhooks.createIndex({ active: 1 });
      await this.collections.webhooks.createIndex({ events: 1 });
      await this.collections.webhooks.createIndex({ createdAt: 1 });
      await this.collections.webhooks.createIndex({ name: 1 }, { unique: true });

      // Webhook deliveries collection indexes
      await this.collections.webhook_deliveries.createIndex({ webhookId: 1 });
      await this.collections.webhook_deliveries.createIndex({ status: 1 });
      await this.collections.webhook_deliveries.createIndex({ eventType: 1 });
      await this.collections.webhook_deliveries.createIndex({ createdAt: 1 });
      await this.collections.webhook_deliveries.createIndex({ nextRetry: 1 });
      await this.collections.webhook_deliveries.createIndex({
        webhookId: 1,
        createdAt: -1
      });

      // Webhook events collection indexes
      await this.collections.webhook_events.createIndex({
        sourceId: 1,
        eventType: 1,
        eventHash: 1
      }, { unique: true });
      await this.collections.webhook_events.createIndex({ processedAt: 1 });

      logger.debug('Database indexes created');
    } catch (error) {
      logger.warn('Error creating indexes:', error.message);
      // Don't throw - indexes are optimization, not critical
    }
  }

  /**
   * Setup database monitoring
   */
  setupMonitoring () {
    if (!this.client) return;

    // Monitor connection events
    this.client.on('serverOpening', () => {
      logger.debug('MongoDB server connection opening');
    });

    this.client.on('serverClosed', () => {
      logger.warn('MongoDB server connection closed');
      this.isConnected = false;
    });

    this.client.on('error', (error) => {
      logger.error('MongoDB connection error:', error);
      this.isConnected = false;
    });

    this.client.on('timeout', () => {
      logger.warn('MongoDB connection timeout');
    });
  }

  /**
   * Ping database to check connectivity
   */
  async ping () {
    try {
      if (!this.isConnected || !this.db) {
        throw new Error('Database not connected');
      }

      await this.db.admin().ping();
      return true;
    } catch (error) {
      this.isConnected = false;
      throw new ServiceUnavailableError(`Database ping failed: ${error.message}`);
    }
  }

  /**
   * Get database information
   */
  async getInfo () {
    try {
      if (!this.isConnected || !this.db) {
        throw new Error('Database not connected');
      }

      const [stats, serverStatus] = await Promise.all([
        this.db.stats(),
        this.db.admin().serverStatus()
      ]);

      return {
        database: stats.db,
        collections: stats.collections,
        dataSize: stats.dataSize,
        storageSize: stats.storageSize,
        indexes: stats.indexes,
        version: serverStatus.version,
        uptime: serverStatus.uptime
      };
    } catch (error) {
      logger.error('Error getting database info:', error);
      return { error: error.message };
    }
  }

  /**
   * Get collection handle
   */
  getCollection (name) {
    if (!this.collections[name]) {
      throw new Error(`Collection ${name} not initialized`);
    }
    return this.collections[name];
  }

  /**
   * Create document with validation
   */
  async insertOne (collectionName, document) {
    try {
      const collection = this.getCollection(collectionName);
      const now = new Date();

      const documentWithTimestamps = {
        ...document,
        _id: document._id || new ObjectId(),
        createdAt: document.createdAt || now,
        updatedAt: now
      };

      const result = await collection.insertOne(documentWithTimestamps);

      if (result.acknowledged) {
        return { ...documentWithTimestamps, _id: result.insertedId };
      } else {
        throw new Error('Insert operation not acknowledged');
      }
    } catch (error) {
      handleDatabaseError(error);
    }
  }

  /**
   * Find documents with pagination
   */
  async find (collectionName, filter = {}, options = {}) {
    try {
      const collection = this.getCollection(collectionName);

      const {
        limit = 50,
        offset = 0,
        sort = { createdAt: -1 },
        projection = {}
      } = options;

      const cursor = collection
        .find(filter, { projection })
        .sort(sort)
        .skip(offset)
        .limit(limit);

      const documents = await cursor.toArray();

      // Get total count for pagination
      const total = await collection.countDocuments(filter);

      return {
        documents,
        total,
        limit,
        offset,
        hasMore: offset + documents.length < total
      };
    } catch (error) {
      handleDatabaseError(error);
    }
  }

  /**
   * Find single document
   */
  async findOne (collectionName, filter, options = {}) {
    try {
      const collection = this.getCollection(collectionName);
      return await collection.findOne(filter, options);
    } catch (error) {
      handleDatabaseError(error);
    }
  }

  /**
   * Update document
   */
  async updateOne (collectionName, filter, update, options = {}) {
    try {
      const collection = this.getCollection(collectionName);

      const updateDoc = {
        ...update,
        $set: {
          ...update.$set,
          updatedAt: new Date()
        }
      };

      const result = await collection.updateOne(filter, updateDoc, options);

      if (options.returnDocument === 'after' || options.returnOriginal === false) {
        return await collection.findOne(filter);
      }

      return result;
    } catch (error) {
      handleDatabaseError(error);
    }
  }

  /**
   * Delete document
   */
  async deleteOne (collectionName, filter) {
    try {
      const collection = this.getCollection(collectionName);
      return await collection.deleteOne(filter);
    } catch (error) {
      handleDatabaseError(error);
    }
  }

  /**
   * Aggregate data
   */
  async aggregate (collectionName, pipeline) {
    try {
      const collection = this.getCollection(collectionName);
      return await collection.aggregate(pipeline).toArray();
    } catch (error) {
      handleDatabaseError(error);
    }
  }

  /**
   * Count documents
   */
  async countDocuments (collectionName, filter = {}) {
    try {
      const collection = this.getCollection(collectionName);
      return await collection.countDocuments(filter);
    } catch (error) {
      handleDatabaseError(error);
    }
  }

  /**
   * Create ObjectId from string
   */
  createObjectId (id) {
    if (!id) return new ObjectId();
    if (ObjectId.isValid(id)) {
      return new ObjectId(id);
    }
    throw new Error(`Invalid ObjectId: ${id}`);
  }

  /**
   * Check if string is valid ObjectId
   */
  isValidObjectId (id) {
    return ObjectId.isValid(id);
  }

  /**
   * Get MongoDB client for advanced operations
   */
  getClient () {
    return this.client;
  }

  /**
   * Get database handle
   */
  getDatabase () {
    return this.db;
  }

  /**
   * Check if connected
   */
  isConnectedToDatabase () {
    return this.isConnected && this.client && this.db;
  }

  /**
   * Start transaction
   */
  async withTransaction (callback) {
    if (!this.isConnectedToDatabase()) {
      throw new ServiceUnavailableError('Database not connected');
    }

    const session = this.client.startSession();

    try {
      return await session.withTransaction(callback);
    } finally {
      await session.endSession();
    }
  }
}

module.exports = DatabaseService;
