/**
 * MongoDB implementation of the DatabaseAdapter interface
 *
 * This adapter encapsulates all MongoDB-specific operations,
 * making it easy to test services without a real database connection.
 */

const { MongoClient, ObjectId } = require('mongodb');
const DatabaseAdapter = require('./DatabaseAdapter');
const logger = require('../utils/logger');
const { ServiceUnavailableError, handleDatabaseError } = require('../middleware/errorHandler');

class MongoDBAdapter extends DatabaseAdapter {
  constructor (config) {
    super();
    this.config = config;
    this.client = null;
    this.db = null;
    this._isConnected = false;
    this.collections = {};
  }

  /**
   * Connect to MongoDB
   */
  async connect () {
    try {
      logger.info('Connecting to MongoDB...', { url: this.config.url });

      this.client = new MongoClient(this.config.url, this.config.options);
      await this.client.connect();

      this.db = this.client.db(this.config.dbName);
      this._isConnected = true;

      // Set up monitoring
      this._setupMonitoring();

      logger.info('MongoDB connected successfully', {
        database: this.config.dbName
      });
    } catch (error) {
      logger.error('Failed to connect to MongoDB:', error);
      this._isConnected = false;
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
        this._isConnected = false;
        this.collections = {};
        logger.info('MongoDB disconnected');
      }
    } catch (error) {
      logger.error('Error disconnecting from MongoDB:', error);
      throw error;
    }
  }

  /**
   * Ping database to check connectivity
   */
  async ping () {
    try {
      if (!this._isConnected || !this.db) {
        throw new Error('Database not connected');
      }

      await this.db.admin().ping();
      return true;
    } catch (error) {
      this._isConnected = false;
      throw new ServiceUnavailableError(`Database ping failed: ${error.message}`);
    }
  }

  /**
   * Check if connected to database
   */
  isConnected () {
    return this._isConnected && this.client && this.db;
  }

  /**
   * Get database information
   */
  async getInfo () {
    try {
      if (!this.isConnected()) {
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
   * Initialize collections with indexes
   */
  async initializeCollections (collectionNames, indexes = {}) {
    try {
      for (const collectionName of collectionNames) {
        try {
          await this.db.createCollection(collectionName);
          logger.debug(`Collection ${collectionName} created`);
        } catch (error) {
          if (error.code !== 48) { // Collection already exists
            throw error;
          }
        }

        this.collections[collectionName] = this.db.collection(collectionName);

        // Create indexes if specified
        if (indexes[collectionName]) {
          await this.createIndexes(collectionName, indexes[collectionName]);
        }
      }

      logger.info('Database collections initialized');
    } catch (error) {
      handleDatabaseError(error);
    }
  }

  /**
   * Insert a single document
   */
  async insertOne (collectionName, document) {
    try {
      const collection = this._getCollection(collectionName);
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
      const collection = this._getCollection(collectionName);

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
   * Find a single document
   */
  async findOne (collectionName, filter, options = {}) {
    try {
      const collection = this._getCollection(collectionName);
      return await collection.findOne(filter, options);
    } catch (error) {
      handleDatabaseError(error);
    }
  }

  /**
   * Update a single document
   */
  async updateOne (collectionName, filter, update, options = {}) {
    try {
      const collection = this._getCollection(collectionName);

      // Ensure updatedAt is set
      const updateDoc = this._ensureUpdatedAt(update);

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
   * Delete a single document
   */
  async deleteOne (collectionName, filter) {
    try {
      const collection = this._getCollection(collectionName);
      return await collection.deleteOne(filter);
    } catch (error) {
      handleDatabaseError(error);
    }
  }

  /**
   * Perform aggregation
   */
  async aggregate (collectionName, pipeline) {
    try {
      const collection = this._getCollection(collectionName);
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
      const collection = this._getCollection(collectionName);
      return await collection.countDocuments(filter);
    } catch (error) {
      handleDatabaseError(error);
    }
  }

  /**
   * Create a valid ID from string
   */
  createId (id) {
    if (!id) return new ObjectId();
    if (ObjectId.isValid(id)) {
      return new ObjectId(id);
    }
    throw new Error(`Invalid ObjectId: ${id}`);
  }

  /**
   * Check if a string is a valid ID
   */
  isValidId (id) {
    return ObjectId.isValid(id);
  }

  /**
   * Execute operations within a transaction
   */
  async withTransaction (callback) {
    if (!this.isConnected()) {
      throw new ServiceUnavailableError('Database not connected');
    }

    const session = this.client.startSession();

    try {
      return await session.withTransaction(callback);
    } finally {
      await session.endSession();
    }
  }

  /**
   * Watch for changes in a collection
   */
  async watchCollection (collectionName, pipeline = [], options = {}) {
    try {
      const collection = this._getCollection(collectionName);
      return collection.watch(pipeline, options);
    } catch (error) {
      handleDatabaseError(error);
    }
  }

  /**
   * Create indexes on a collection
   */
  async createIndexes (collectionName, indexes) {
    try {
      const collection = this._getCollection(collectionName);
      const results = [];

      for (const index of indexes) {
        try {
          const result = await collection.createIndex(index.key || index, index.options || {});
          results.push(result);
        } catch (error) {
          logger.warn(`Error creating index on ${collectionName}:`, error.message);
          // Don't throw - indexes are optimization, not critical
        }
      }

      return results;
    } catch (error) {
      handleDatabaseError(error);
    }
  }

  /**
   * Insert multiple documents
   */
  async insertMany (collectionName, documents) {
    try {
      const collection = this._getCollection(collectionName);
      const now = new Date();

      const documentsWithTimestamps = documents.map(doc => ({
        ...doc,
        _id: doc._id || new ObjectId(),
        createdAt: doc.createdAt || now,
        updatedAt: now
      }));

      return await collection.insertMany(documentsWithTimestamps);
    } catch (error) {
      handleDatabaseError(error);
    }
  }

  /**
   * Update multiple documents
   */
  async updateMany (collectionName, filter, update, options = {}) {
    try {
      const collection = this._getCollection(collectionName);
      const updateDoc = this._ensureUpdatedAt(update);
      return await collection.updateMany(filter, updateDoc, options);
    } catch (error) {
      handleDatabaseError(error);
    }
  }

  /**
   * Delete multiple documents
   */
  async deleteMany (collectionName, filter) {
    try {
      const collection = this._getCollection(collectionName);
      return await collection.deleteMany(filter);
    } catch (error) {
      handleDatabaseError(error);
    }
  }

  /**
   * Find one and update atomically
   */
  async findOneAndUpdate (collectionName, filter, update, options = {}) {
    try {
      const collection = this._getCollection(collectionName);
      const updateDoc = this._ensureUpdatedAt(update);

      const result = await collection.findOneAndUpdate(
        filter,
        updateDoc,
        { returnDocument: 'after', ...options }
      );

      return result.value;
    } catch (error) {
      handleDatabaseError(error);
    }
  }

  /**
   * Find one and delete atomically
   */
  async findOneAndDelete (collectionName, filter, options = {}) {
    try {
      const collection = this._getCollection(collectionName);
      const result = await collection.findOneAndDelete(filter, options);
      return result.value;
    } catch (error) {
      handleDatabaseError(error);
    }
  }

  /**
   * Bulk write operations
   */
  async bulkWrite (collectionName, operations, options = {}) {
    try {
      const collection = this._getCollection(collectionName);
      return await collection.bulkWrite(operations, options);
    } catch (error) {
      handleDatabaseError(error);
    }
  }

  // Private helper methods

  /**
   * Get collection handle
   * @private
   */
  _getCollection (name) {
    if (!this.collections[name]) {
      if (!this.db) {
        throw new Error('Database not connected');
      }
      this.collections[name] = this.db.collection(name);
    }
    return this.collections[name];
  }

  /**
   * Ensure updatedAt is set in update operations
   * @private
   */
  _ensureUpdatedAt (update) {
    if (update.$set) {
      return {
        ...update,
        $set: {
          ...update.$set,
          updatedAt: new Date()
        }
      };
    } else if (update.$setOnInsert || update.$inc || update.$push || update.$pull) {
      // For other update operators, add $set if not present
      return {
        ...update,
        $set: {
          ...update.$set,
          updatedAt: new Date()
        }
      };
    } else {
      // For replacement documents
      return {
        ...update,
        updatedAt: new Date()
      };
    }
  }

  /**
   * Setup database monitoring
   * @private
   */
  _setupMonitoring () {
    if (!this.client) return;

    // Monitor connection events
    this.client.on('serverOpening', () => {
      logger.debug('MongoDB server connection opening');
    });

    this.client.on('serverClosed', () => {
      logger.warn('MongoDB server connection closed');
      this._isConnected = false;
    });

    this.client.on('error', (error) => {
      logger.error('MongoDB connection error:', error);
      this._isConnected = false;
    });

    this.client.on('timeout', () => {
      logger.warn('MongoDB connection timeout');
    });
  }

  /**
   * Get native MongoDB client (for advanced operations)
   */
  getNativeClient () {
    return this.client;
  }

  /**
   * Get native MongoDB database handle
   */
  getNativeDb () {
    return this.db;
  }
}

module.exports = MongoDBAdapter;
