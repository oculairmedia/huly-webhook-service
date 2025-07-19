/**
 * Mock Database Adapter for testing
 * 
 * This mock adapter provides an in-memory implementation
 * of the DatabaseAdapter interface for testing purposes.
 */

const DatabaseAdapter = require('../../src/adapters/DatabaseAdapter');

class MockDatabaseAdapter extends DatabaseAdapter {
  constructor () {
    super();
    this.collections = {};
    this._isConnected = false;
    this.idCounter = 1;
    
    // Track method calls for assertions
    this.calls = {
      connect: 0,
      disconnect: 0,
      ping: 0,
      insertOne: [],
      find: [],
      findOne: [],
      updateOne: [],
      deleteOne: [],
      aggregate: [],
      countDocuments: [],
      withTransaction: []
    };
  }

  async connect () {
    this.calls.connect++;
    this._isConnected = true;
  }

  async disconnect () {
    this.calls.disconnect++;
    this._isConnected = false;
    this.collections = {};
  }

  async ping () {
    this.calls.ping++;
    if (!this._isConnected) {
      throw new Error('Database not connected');
    }
    return true;
  }

  isConnected () {
    return this._isConnected;
  }

  async getInfo () {
    return {
      database: 'mock',
      collections: Object.keys(this.collections).length,
      dataSize: 1000,
      storageSize: 2000,
      indexes: 5,
      version: '1.0.0',
      uptime: 3600
    };
  }

  async initializeCollections (collectionNames, indexes = {}) {
    for (const name of collectionNames) {
      if (!this.collections[name]) {
        this.collections[name] = {
          documents: [],
          indexes: indexes[name] || []
        };
      }
    }
  }

  async insertOne (collectionName, document) {
    this.calls.insertOne.push({ collectionName, document });
    
    const collection = this._getCollection(collectionName);
    const now = new Date();
    const docWithId = {
      ...document,
      _id: document._id || `mock-id-${this.idCounter++}`,
      createdAt: document.createdAt || now,
      updatedAt: now
    };
    
    collection.documents.push(docWithId);
    return docWithId;
  }

  async find (collectionName, filter = {}, options = {}) {
    this.calls.find.push({ collectionName, filter, options });
    
    const collection = this._getCollection(collectionName);
    let documents = this._filterDocuments(collection.documents, filter);
    
    // Apply sort
    if (options.sort) {
      documents = this._sortDocuments(documents, options.sort);
    }
    
    // Apply pagination
    const offset = options.offset || 0;
    const limit = options.limit || 50;
    const paginatedDocs = documents.slice(offset, offset + limit);
    
    return {
      documents: paginatedDocs,
      total: documents.length,
      limit,
      offset,
      hasMore: offset + paginatedDocs.length < documents.length
    };
  }

  async findOne (collectionName, filter, options = {}) {
    this.calls.findOne.push({ collectionName, filter, options });
    
    const collection = this._getCollection(collectionName);
    const documents = this._filterDocuments(collection.documents, filter);
    return documents[0] || null;
  }

  async updateOne (collectionName, filter, update, options = {}) {
    this.calls.updateOne.push({ collectionName, filter, update, options });
    
    const collection = this._getCollection(collectionName);
    const docIndex = collection.documents.findIndex(doc => 
      this._matchesFilter(doc, filter)
    );
    
    if (docIndex === -1) {
      return { modifiedCount: 0, acknowledged: true };
    }
    
    const updatedDoc = this._applyUpdate(collection.documents[docIndex], update);
    collection.documents[docIndex] = updatedDoc;
    
    if (options.returnDocument === 'after') {
      return updatedDoc;
    }
    
    return { modifiedCount: 1, acknowledged: true };
  }

  async deleteOne (collectionName, filter) {
    this.calls.deleteOne.push({ collectionName, filter });
    
    const collection = this._getCollection(collectionName);
    const docIndex = collection.documents.findIndex(doc =>
      this._matchesFilter(doc, filter)
    );
    
    if (docIndex === -1) {
      return { deletedCount: 0, acknowledged: true };
    }
    
    collection.documents.splice(docIndex, 1);
    return { deletedCount: 1, acknowledged: true };
  }

  async aggregate (collectionName, pipeline) {
    this.calls.aggregate.push({ collectionName, pipeline });
    
    // Simple mock aggregation - just return filtered documents
    const collection = this._getCollection(collectionName);
    return collection.documents;
  }

  async countDocuments (collectionName, filter = {}) {
    this.calls.countDocuments.push({ collectionName, filter });
    
    const collection = this._getCollection(collectionName);
    const documents = this._filterDocuments(collection.documents, filter);
    return documents.length;
  }

  createId (id) {
    if (!id) return `mock-id-${this.idCounter++}`;
    return id;
  }

  isValidId (id) {
    return typeof id === 'string' && id.length > 0;
  }

  async withTransaction (callback) {
    this.calls.withTransaction.push({ callback });
    
    // Mock transaction - just execute the callback
    return await callback();
  }

  async watchCollection (collectionName, pipeline = [], options = {}) {
    // Mock change stream
    return {
      on: jest.fn(),
      close: jest.fn()
    };
  }

  async createIndexes (collectionName, indexes) {
    const collection = this._getCollection(collectionName);
    collection.indexes.push(...indexes);
    return indexes.map((_, i) => `index_${i}`);
  }

  async insertMany (collectionName, documents) {
    const collection = this._getCollection(collectionName);
    const now = new Date();
    
    const docsWithIds = documents.map(doc => ({
      ...doc,
      _id: doc._id || `mock-id-${this.idCounter++}`,
      createdAt: doc.createdAt || now,
      updatedAt: now
    }));
    
    collection.documents.push(...docsWithIds);
    
    return {
      insertedCount: documents.length,
      acknowledged: true,
      insertedIds: docsWithIds.map(d => d._id)
    };
  }

  async updateMany (collectionName, filter, update, options = {}) {
    const collection = this._getCollection(collectionName);
    const matchingDocs = this._filterDocuments(collection.documents, filter);
    
    matchingDocs.forEach(doc => {
      const docIndex = collection.documents.findIndex(d => d._id === doc._id);
      collection.documents[docIndex] = this._applyUpdate(doc, update);
    });
    
    return {
      modifiedCount: matchingDocs.length,
      acknowledged: true
    };
  }

  async deleteMany (collectionName, filter) {
    const collection = this._getCollection(collectionName);
    const matchingDocs = this._filterDocuments(collection.documents, filter);
    const count = matchingDocs.length;
    
    collection.documents = collection.documents.filter(doc =>
      !this._matchesFilter(doc, filter)
    );
    
    return {
      deletedCount: count,
      acknowledged: true
    };
  }

  async findOneAndUpdate (collectionName, filter, update, options = {}) {
    const collection = this._getCollection(collectionName);
    const docIndex = collection.documents.findIndex(doc => 
      this._matchesFilter(doc, filter)
    );
    
    if (docIndex === -1) {
      return null;
    }
    
    const updatedDoc = this._applyUpdate(collection.documents[docIndex], update);
    collection.documents[docIndex] = updatedDoc;
    
    return updatedDoc;
  }

  async findOneAndDelete (collectionName, filter, options = {}) {
    const doc = await this.findOne(collectionName, filter);
    if (doc) {
      await this.deleteOne(collectionName, filter);
    }
    return doc;
  }

  async bulkWrite (collectionName, operations, options = {}) {
    let insertedCount = 0;
    let modifiedCount = 0;
    let deletedCount = 0;
    
    for (const op of operations) {
      if (op.insertOne) {
        await this.insertOne(collectionName, op.insertOne.document);
        insertedCount++;
      } else if (op.updateOne) {
        const result = await this.updateOne(
          collectionName,
          op.updateOne.filter,
          op.updateOne.update
        );
        if (result.modifiedCount) modifiedCount++;
      } else if (op.deleteOne) {
        const result = await this.deleteOne(collectionName, op.deleteOne.filter);
        if (result.deletedCount) deletedCount++;
      }
    }
    
    return {
      insertedCount,
      modifiedCount,
      deletedCount,
      acknowledged: true
    };
  }

  // Helper methods

  _getCollection (name) {
    if (!this.collections[name]) {
      this.collections[name] = {
        documents: [],
        indexes: []
      };
    }
    return this.collections[name];
  }

  _filterDocuments (documents, filter) {
    if (!filter || Object.keys(filter).length === 0) {
      return [...documents];
    }
    
    return documents.filter(doc => this._matchesFilter(doc, filter));
  }

  _matchesFilter (doc, filter) {
    for (const [key, value] of Object.entries(filter)) {
      // Handle dot notation
      const keys = key.split('.');
      let docValue = doc;
      
      for (const k of keys) {
        docValue = docValue?.[k];
      }
      
      // Handle different filter operators
      if (typeof value === 'object' && value !== null) {
        // Handle operators like $in, $gt, etc.
        if (value.$in && !value.$in.includes(docValue)) return false;
        if (value.$gt && !(docValue > value.$gt)) return false;
        if (value.$gte && !(docValue >= value.$gte)) return false;
        if (value.$lt && !(docValue < value.$lt)) return false;
        if (value.$lte && !(docValue <= value.$lte)) return false;
        if (value.$ne && docValue === value.$ne) return false;
      } else {
        // Direct equality
        if (docValue !== value) return false;
      }
    }
    
    return true;
  }

  _sortDocuments (documents, sort) {
    const sortedDocs = [...documents];
    const sortKeys = Object.entries(sort);
    
    sortedDocs.sort((a, b) => {
      for (const [key, direction] of sortKeys) {
        const aVal = a[key];
        const bVal = b[key];
        
        if (aVal < bVal) return direction === 1 ? -1 : 1;
        if (aVal > bVal) return direction === 1 ? 1 : -1;
      }
      return 0;
    });
    
    return sortedDocs;
  }

  _applyUpdate (doc, update) {
    const updatedDoc = { ...doc };
    
    if (update.$set) {
      Object.assign(updatedDoc, update.$set);
    }
    
    if (update.$inc) {
      for (const [key, value] of Object.entries(update.$inc)) {
        updatedDoc[key] = (updatedDoc[key] || 0) + value;
      }
    }
    
    if (update.$push) {
      for (const [key, value] of Object.entries(update.$push)) {
        if (!Array.isArray(updatedDoc[key])) {
          updatedDoc[key] = [];
        }
        updatedDoc[key].push(value);
      }
    }
    
    if (update.$pull) {
      for (const [key, value] of Object.entries(update.$pull)) {
        if (Array.isArray(updatedDoc[key])) {
          updatedDoc[key] = updatedDoc[key].filter(item => item !== value);
        }
      }
    }
    
    // Always update updatedAt
    updatedDoc.updatedAt = new Date();
    
    return updatedDoc;
  }

  // Test helper methods

  reset () {
    this.collections = {};
    this.idCounter = 1;
    this.calls = {
      connect: 0,
      disconnect: 0,
      ping: 0,
      insertOne: [],
      find: [],
      findOne: [],
      updateOne: [],
      deleteOne: [],
      aggregate: [],
      countDocuments: [],
      withTransaction: []
    };
  }

  getCollectionData (collectionName) {
    const collection = this.collections[collectionName];
    return collection ? collection.documents : [];
  }

  setCollectionData (collectionName, documents) {
    this._getCollection(collectionName).documents = documents;
  }
}

module.exports = MockDatabaseAdapter;