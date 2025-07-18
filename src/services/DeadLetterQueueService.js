/**
 * Dead Letter Queue Service for Huly Webhook Service
 * Handles permanently failed webhook deliveries with retry policies and management
 */

const EventEmitter = require('events');
const logger = require('../utils/logger');

class DeadLetterQueueService extends EventEmitter {
  constructor (config, databaseService) {
    super();
    this.config = config;
    this.db = databaseService;
    this.deadLetterQueue = [];
    this.maxQueueSize = config.deadLetterQueue?.maxSize || 10000;
    this.retentionPeriod = config.deadLetterQueue?.retentionPeriod || 30; // days
    this.batchSize = config.deadLetterQueue?.batchSize || 100;
    this.persistenceEnabled = config.deadLetterQueue?.persistence !== false;
    this.autoCleanupEnabled = config.deadLetterQueue?.autoCleanup !== false;

    // Statistics
    this.stats = {
      totalAdded: 0,
      totalRetried: 0,
      totalPurged: 0,
      totalExpired: 0,
      currentSize: 0,
      oldestEntry: null,
      newestEntry: null
    };

    // Initialize
    this.initialize();
  }

  /**
   * Initialize the dead letter queue service
   */
  async initialize () {
    try {
      logger.info('Initializing Dead Letter Queue Service...');

      // Load existing dead letter items from database
      if (this.persistenceEnabled) {
        await this.loadDeadLetterItems();
      }

      // Start cleanup interval
      if (this.autoCleanupEnabled) {
        this.startAutoCleanup();
      }

      logger.info('Dead Letter Queue Service initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize Dead Letter Queue Service:', error);
      throw error;
    }
  }

  /**
   * Add delivery to dead letter queue
   * @param {Object} delivery - Failed delivery
   * @param {Object} failureReason - Reason for failure
   * @returns {string} - Dead letter entry ID
   */
  async addToDeadLetterQueue (delivery, failureReason) {
    try {
      const deadLetterEntry = {
        id: this.generateDeadLetterEntryId(),
        delivery,
        failureReason,
        originalAttempts: delivery.attempts || 0,
        deadLetteredAt: new Date(),
        retryCount: 0,
        lastRetryAt: null,
        status: 'dead-lettered',
        metadata: {
          webhookId: delivery.webhook?._id,
          webhookUrl: delivery.webhook?.url,
          eventType: delivery.payload?.event,
          documentId: delivery.payload?.data?.id,
          originalDeliveryId: delivery.id
        }
      };

      // Add to in-memory queue
      this.deadLetterQueue.push(deadLetterEntry);

      // Trim queue if it exceeds max size
      if (this.deadLetterQueue.length > this.maxQueueSize) {
        const removed = this.deadLetterQueue.shift();
        logger.warn('Dead letter queue full, removing oldest entry:', removed.id);
        this.stats.totalPurged++;
      }

      // Persist to database
      if (this.persistenceEnabled) {
        await this.persistDeadLetterEntry(deadLetterEntry);
      }

      // Update statistics
      this.updateStats();

      logger.info(`Added delivery to dead letter queue: ${deadLetterEntry.id}`, {
        webhookId: deadLetterEntry.metadata.webhookId,
        eventType: deadLetterEntry.metadata.eventType,
        failureReason: failureReason.error || failureReason.message
      });

      this.emit('entry-added', deadLetterEntry);
      return deadLetterEntry.id;
    } catch (error) {
      logger.error('Error adding to dead letter queue:', error);
      throw error;
    }
  }

  /**
   * Retry delivery from dead letter queue
   * @param {string} entryId - Dead letter entry ID
   * @returns {Object} - Retry result
   */
  async retryDeadLetterEntry (entryId) {
    try {
      const entryIndex = this.deadLetterQueue.findIndex(entry => entry.id === entryId);
      if (entryIndex === -1) {
        throw new Error(`Dead letter entry not found: ${entryId}`);
      }

      const entry = this.deadLetterQueue[entryIndex];

      // Update retry information
      entry.retryCount++;
      entry.lastRetryAt = new Date();
      entry.status = 'retrying';

      // Persist update
      if (this.persistenceEnabled) {
        await this.updateDeadLetterEntry(entry);
      }

      // Emit retry event for external processing
      this.emit('entry-retry', entry);

      logger.info(`Retrying dead letter entry: ${entryId}`, {
        retryCount: entry.retryCount,
        webhookId: entry.metadata.webhookId,
        eventType: entry.metadata.eventType
      });

      // Return the delivery object for re-processing
      return {
        success: true,
        delivery: {
          ...entry.delivery,
          retryFromDeadLetter: true,
          deadLetterEntryId: entryId
        }
      };
    } catch (error) {
      logger.error(`Error retrying dead letter entry ${entryId}:`, error);
      return {
        success: false,
        error: error.message
      };
    }
  }

  /**
   * Remove entry from dead letter queue after successful retry
   * @param {string} entryId - Dead letter entry ID
   */
  async removeFromDeadLetterQueue (entryId) {
    try {
      const entryIndex = this.deadLetterQueue.findIndex(entry => entry.id === entryId);
      if (entryIndex === -1) {
        logger.warn(`Dead letter entry not found for removal: ${entryId}`);
        return;
      }

      const entry = this.deadLetterQueue.splice(entryIndex, 1)[0];

      // Remove from database
      if (this.persistenceEnabled) {
        await this.deleteDeadLetterEntry(entryId);
      }

      // Update statistics
      this.updateStats();

      logger.info(`Removed dead letter entry after successful retry: ${entryId}`);
      this.emit('entry-removed', entry);
    } catch (error) {
      logger.error(`Error removing dead letter entry ${entryId}:`, error);
    }
  }

  /**
   * Update dead letter entry status after retry attempt
   * @param {string} entryId - Dead letter entry ID
   * @param {boolean} success - Whether retry was successful
   * @param {Object} result - Retry result
   */
  async updateDeadLetterEntryStatus (entryId, success, result) {
    try {
      const entry = this.deadLetterQueue.find(entry => entry.id === entryId);
      if (!entry) {
        logger.warn(`Dead letter entry not found for status update: ${entryId}`);
        return;
      }

      if (success) {
        // Remove from queue on successful retry
        await this.removeFromDeadLetterQueue(entryId);
        this.stats.totalRetried++;
      } else {
        // Update failure information
        entry.status = 'dead-lettered';
        entry.lastRetryResult = result;
        entry.lastRetryAt = new Date();

        // Persist update
        if (this.persistenceEnabled) {
          await this.updateDeadLetterEntry(entry);
        }

        logger.info(`Updated dead letter entry status: ${entryId}`, {
          success,
          retryCount: entry.retryCount
        });
      }
    } catch (error) {
      logger.error(`Error updating dead letter entry status ${entryId}:`, error);
    }
  }

  /**
   * Get dead letter queue entries
   * @param {Object} options - Query options
   * @returns {Array} - Dead letter entries
   */
  getDeadLetterEntries (options = {}) {
    let entries = [...this.deadLetterQueue];

    // Filter by webhook ID
    if (options.webhookId) {
      entries = entries.filter(entry => entry.metadata.webhookId === options.webhookId);
    }

    // Filter by event type
    if (options.eventType) {
      entries = entries.filter(entry => entry.metadata.eventType === options.eventType);
    }

    // Filter by status
    if (options.status) {
      entries = entries.filter(entry => entry.status === options.status);
    }

    // Filter by date range
    if (options.fromDate || options.toDate) {
      const fromDate = options.fromDate ? new Date(options.fromDate) : new Date(0);
      const toDate = options.toDate ? new Date(options.toDate) : new Date();

      entries = entries.filter(entry => {
        const entryDate = new Date(entry.deadLetteredAt);
        return entryDate >= fromDate && entryDate <= toDate;
      });
    }

    // Sort by date (newest first)
    entries.sort((a, b) => new Date(b.deadLetteredAt) - new Date(a.deadLetteredAt));

    // Apply pagination
    const limit = options.limit || 100;
    const offset = options.offset || 0;

    return entries.slice(offset, offset + limit);
  }

  /**
   * Get dead letter queue statistics
   * @returns {Object} - Statistics
   */
  getDeadLetterStats () {
    return {
      ...this.stats,
      currentSize: this.deadLetterQueue.length,
      maxSize: this.maxQueueSize,
      retentionPeriod: this.retentionPeriod,
      persistenceEnabled: this.persistenceEnabled
    };
  }

  /**
   * Purge expired entries from dead letter queue
   * @returns {number} - Number of purged entries
   */
  async purgeExpiredEntries () {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - this.retentionPeriod);

      const initialCount = this.deadLetterQueue.length;
      const expiredEntries = [];

      // Find expired entries
      this.deadLetterQueue = this.deadLetterQueue.filter(entry => {
        const entryDate = new Date(entry.deadLetteredAt);
        if (entryDate < cutoffDate) {
          expiredEntries.push(entry);
          return false;
        }
        return true;
      });

      // Remove from database
      if (this.persistenceEnabled && expiredEntries.length > 0) {
        await this.deleteExpiredEntries(expiredEntries);
      }

      const purgedCount = initialCount - this.deadLetterQueue.length;
      this.stats.totalExpired += purgedCount;
      this.updateStats();

      if (purgedCount > 0) {
        logger.info(`Purged ${purgedCount} expired entries from dead letter queue`);
      }

      return purgedCount;
    } catch (error) {
      logger.error('Error purging expired entries:', error);
      return 0;
    }
  }

  /**
   * Clear all entries from dead letter queue
   * @returns {number} - Number of cleared entries
   */
  async clearDeadLetterQueue () {
    try {
      const count = this.deadLetterQueue.length;
      this.deadLetterQueue = [];

      // Clear from database
      if (this.persistenceEnabled) {
        await this.db.deleteMany('dead_letter_queue', {});
      }

      this.stats.totalPurged += count;
      this.updateStats();

      logger.info(`Cleared ${count} entries from dead letter queue`);
      this.emit('queue-cleared', count);

      return count;
    } catch (error) {
      logger.error('Error clearing dead letter queue:', error);
      return 0;
    }
  }

  /**
   * Retry all entries in dead letter queue
   * @param {Object} options - Retry options
   * @returns {Object} - Retry results
   */
  async retryAll (options = {}) {
    try {
      const entries = this.getDeadLetterEntries(options);
      const results = {
        total: entries.length,
        successful: 0,
        failed: 0,
        errors: []
      };

      logger.info(`Retrying ${entries.length} dead letter entries`);

      for (const entry of entries) {
        try {
          const result = await this.retryDeadLetterEntry(entry.id);
          if (result.success) {
            results.successful++;
          } else {
            results.failed++;
            results.errors.push({
              entryId: entry.id,
              error: result.error
            });
          }
        } catch (error) {
          results.failed++;
          results.errors.push({
            entryId: entry.id,
            error: error.message
          });
        }
      }

      logger.info('Completed retry all operation', results);
      return results;
    } catch (error) {
      logger.error('Error retrying all dead letter entries:', error);
      throw error;
    }
  }

  /**
   * Generate unique dead letter entry ID
   * @returns {string} - Unique ID
   */
  generateDeadLetterEntryId () {
    return `dlq_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Load dead letter items from database
   */
  async loadDeadLetterItems () {
    try {
      const items = await this.db.findMany('dead_letter_queue', {}, {
        sort: { deadLetteredAt: -1 },
        limit: this.maxQueueSize
      });

      this.deadLetterQueue = items.map(item => ({
        ...item,
        deadLetteredAt: new Date(item.deadLetteredAt),
        lastRetryAt: item.lastRetryAt ? new Date(item.lastRetryAt) : null
      }));

      logger.info(`Loaded ${this.deadLetterQueue.length} dead letter entries from database`);
    } catch (error) {
      logger.error('Error loading dead letter items:', error);
    }
  }

  /**
   * Persist dead letter entry to database
   * @param {Object} entry - Dead letter entry
   */
  async persistDeadLetterEntry (entry) {
    try {
      await this.db.create('dead_letter_queue', {
        ...entry,
        createdAt: new Date(),
        updatedAt: new Date()
      });
    } catch (error) {
      logger.error('Error persisting dead letter entry:', error);
    }
  }

  /**
   * Update dead letter entry in database
   * @param {Object} entry - Dead letter entry
   */
  async updateDeadLetterEntry (entry) {
    try {
      await this.db.updateOne('dead_letter_queue',
        { id: entry.id },
        {
          ...entry,
          updatedAt: new Date()
        }
      );
    } catch (error) {
      logger.error('Error updating dead letter entry:', error);
    }
  }

  /**
   * Delete dead letter entry from database
   * @param {string} entryId - Entry ID
   */
  async deleteDeadLetterEntry (entryId) {
    try {
      await this.db.deleteOne('dead_letter_queue', { id: entryId });
    } catch (error) {
      logger.error('Error deleting dead letter entry:', error);
    }
  }

  /**
   * Delete expired entries from database
   * @param {Array} expiredEntries - Expired entries
   */
  async deleteExpiredEntries (expiredEntries) {
    try {
      const entryIds = expiredEntries.map(entry => entry.id);
      await this.db.deleteMany('dead_letter_queue', {
        id: { $in: entryIds }
      });
    } catch (error) {
      logger.error('Error deleting expired entries:', error);
    }
  }

  /**
   * Update statistics
   */
  updateStats () {
    this.stats.currentSize = this.deadLetterQueue.length;

    if (this.deadLetterQueue.length > 0) {
      const sorted = [...this.deadLetterQueue].sort((a, b) =>
        new Date(a.deadLetteredAt) - new Date(b.deadLetteredAt)
      );
      this.stats.oldestEntry = sorted[0].deadLetteredAt;
      this.stats.newestEntry = sorted[sorted.length - 1].deadLetteredAt;
    } else {
      this.stats.oldestEntry = null;
      this.stats.newestEntry = null;
    }
  }

  /**
   * Start automatic cleanup
   */
  startAutoCleanup () {
    // Run cleanup every hour
    setInterval(async () => {
      try {
        await this.purgeExpiredEntries();
      } catch (error) {
        logger.error('Error in automatic cleanup:', error);
      }
    }, 3600000); // 1 hour
  }

  /**
   * Shutdown the service
   */
  async shutdown () {
    try {
      logger.info('Shutting down Dead Letter Queue Service...');

      // Save any pending changes
      if (this.persistenceEnabled) {
        // Final save is handled automatically by the database service
      }

      logger.info('Dead Letter Queue Service shut down successfully');
    } catch (error) {
      logger.error('Error shutting down Dead Letter Queue Service:', error);
      throw error;
    }
  }
}

module.exports = DeadLetterQueueService;
