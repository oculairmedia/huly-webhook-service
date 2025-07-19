/**
 * DatabaseAdapter Interface
 *
 * This defines the contract that all database adapters must implement.
 * This abstraction allows us to swap database implementations without
 * changing the business logic in our services.
 */

class DatabaseAdapter {
  /**
   * Connect to the database
   * @returns {Promise<void>}
   */
  async connect () {
    throw new Error('Method connect() must be implemented');
  }

  /**
   * Disconnect from the database
   * @returns {Promise<void>}
   */
  async disconnect () {
    throw new Error('Method disconnect() must be implemented');
  }

  /**
   * Ping the database to check connectivity
   * @returns {Promise<boolean>}
   */
  async ping () {
    throw new Error('Method ping() must be implemented');
  }

  /**
   * Check if connected to database
   * @returns {boolean}
   */
  isConnected () {
    throw new Error('Method isConnected() must be implemented');
  }

  /**
   * Get database information
   * @returns {Promise<Object>}
   */
  async getInfo () {
    throw new Error('Method getInfo() must be implemented');
  }

  /**
   * Initialize collections with indexes
   * @param {Array<string>} collectionNames - Names of collections to initialize
   * @param {Object} indexes - Collection indexes configuration
   * @returns {Promise<void>}
   */
  async initializeCollections (_collectionNames, _indexes) {
    throw new Error('Method initializeCollections() must be implemented');
  }

  /**
   * Insert a single document
   * @param {string} collectionName - Name of the collection
   * @param {Object} document - Document to insert
   * @returns {Promise<Object>} - The inserted document with generated ID
   */
  async insertOne (_collectionName, _document) {
    throw new Error('Method insertOne() must be implemented');
  }

  /**
   * Find documents with pagination
   * @param {string} collectionName - Name of the collection
   * @param {Object} filter - Query filter
   * @param {Object} options - Query options (limit, offset, sort, projection)
   * @returns {Promise<Object>} - Object with documents array and pagination metadata
   */
  async find (_collectionName, _filter = {}, _options = {}) {
    throw new Error('Method find() must be implemented');
  }

  /**
   * Find a single document
   * @param {string} collectionName - Name of the collection
   * @param {Object} filter - Query filter
   * @param {Object} options - Query options
   * @returns {Promise<Object|null>} - The found document or null
   */
  async findOne (_collectionName, _filter, _options = {}) {
    throw new Error('Method findOne() must be implemented');
  }

  /**
   * Update a single document
   * @param {string} collectionName - Name of the collection
   * @param {Object} filter - Query filter
   * @param {Object} update - Update operations
   * @param {Object} options - Update options
   * @returns {Promise<Object>} - Update result or updated document
   */
  async updateOne (_collectionName, _filter, _update, _options = {}) {
    throw new Error('Method updateOne() must be implemented');
  }

  /**
   * Delete a single document
   * @param {string} collectionName - Name of the collection
   * @param {Object} filter - Query filter
   * @returns {Promise<Object>} - Delete result
   */
  async deleteOne (_collectionName, _filter) {
    throw new Error('Method deleteOne() must be implemented');
  }

  /**
   * Perform aggregation
   * @param {string} collectionName - Name of the collection
   * @param {Array} pipeline - Aggregation pipeline
   * @returns {Promise<Array>} - Aggregation results
   */
  async aggregate (_collectionName, _pipeline) {
    throw new Error('Method aggregate() must be implemented');
  }

  /**
   * Count documents
   * @param {string} collectionName - Name of the collection
   * @param {Object} filter - Query filter
   * @returns {Promise<number>} - Document count
   */
  async countDocuments (_collectionName, _filter = {}) {
    throw new Error('Method countDocuments() must be implemented');
  }

  /**
   * Create a valid ID from string
   * @param {string} id - String ID
   * @returns {*} - Database-specific ID type
   */
  createId (_id) {
    throw new Error('Method createId() must be implemented');
  }

  /**
   * Check if a string is a valid ID
   * @param {string} id - String to check
   * @returns {boolean}
   */
  isValidId (_id) {
    throw new Error('Method isValidId() must be implemented');
  }

  /**
   * Execute operations within a transaction
   * @param {Function} callback - Async function to execute within transaction
   * @returns {Promise<*>} - Result of the callback
   */
  async withTransaction (_callback) {
    throw new Error('Method withTransaction() must be implemented');
  }

  /**
   * Watch for changes in a collection
   * @param {string} collectionName - Name of the collection
   * @param {Array} pipeline - Change stream pipeline
   * @param {Object} options - Watch options
   * @returns {Promise<Object>} - Change stream
   */
  async watchCollection (_collectionName, _pipeline = [], _options = {}) {
    throw new Error('Method watchCollection() must be implemented');
  }

  /**
   * Create indexes on a collection
   * @param {string} collectionName - Name of the collection
   * @param {Array<Object>} indexes - Array of index specifications
   * @returns {Promise<Array<string>>} - Created index names
   */
  async createIndexes (_collectionName, _indexes) {
    throw new Error('Method createIndexes() must be implemented');
  }

  /**
   * Insert multiple documents
   * @param {string} collectionName - Name of the collection
   * @param {Array<Object>} documents - Documents to insert
   * @returns {Promise<Object>} - Insert result
   */
  async insertMany (_collectionName, _documents) {
    throw new Error('Method insertMany() must be implemented');
  }

  /**
   * Update multiple documents
   * @param {string} collectionName - Name of the collection
   * @param {Object} filter - Query filter
   * @param {Object} update - Update operations
   * @param {Object} options - Update options
   * @returns {Promise<Object>} - Update result
   */
  async updateMany (_collectionName, _filter, _update, _options = {}) {
    throw new Error('Method updateMany() must be implemented');
  }

  /**
   * Delete multiple documents
   * @param {string} collectionName - Name of the collection
   * @param {Object} filter - Query filter
   * @returns {Promise<Object>} - Delete result
   */
  async deleteMany (_collectionName, _filter) {
    throw new Error('Method deleteMany() must be implemented');
  }

  /**
   * Find one and update atomically
   * @param {string} collectionName - Name of the collection
   * @param {Object} filter - Query filter
   * @param {Object} update - Update operations
   * @param {Object} options - Operation options
   * @returns {Promise<Object|null>} - Updated document
   */
  async findOneAndUpdate (_collectionName, _filter, _update, _options = {}) {
    throw new Error('Method findOneAndUpdate() must be implemented');
  }

  /**
   * Find one and delete atomically
   * @param {string} collectionName - Name of the collection
   * @param {Object} filter - Query filter
   * @param {Object} options - Operation options
   * @returns {Promise<Object|null>} - Deleted document
   */
  async findOneAndDelete (_collectionName, _filter, _options = {}) {
    throw new Error('Method findOneAndDelete() must be implemented');
  }

  /**
   * Bulk write operations
   * @param {string} collectionName - Name of the collection
   * @param {Array<Object>} operations - Array of write operations
   * @param {Object} options - Bulk write options
   * @returns {Promise<Object>} - Bulk write result
   */
  async bulkWrite (_collectionName, _operations, _options = {}) {
    throw new Error('Method bulkWrite() must be implemented');
  }
}

module.exports = DatabaseAdapter;
