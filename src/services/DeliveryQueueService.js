/**
 * Delivery Queue Service for Huly Webhook Service
 * Manages webhook delivery queue with priority, retry, and dead letter queue
 */

const EventEmitter = require('events');
const logger = require('../utils/logger');

class DeliveryQueueService extends EventEmitter {
  constructor (config) {
    super();
    this.config = config;
    this.queues = new Map();
    this.priorityQueues = new Map();
    this.deadLetterQueue = [];
    this.processing = new Map();
    this.isRunning = false;
    this.processors = new Map();
    this.stats = {
      totalQueued: 0,
      totalProcessed: 0,
      totalFailed: 0,
      totalRetried: 0,
      totalDeadLettered: 0,
      processingTimes: []
    };

    // Queue configuration
    this.maxQueueSize = config.queue?.maxSize || 10000;
    this.maxConcurrentDeliveries = config.queue?.maxConcurrent || 10;
    this.processingInterval = config.queue?.processingInterval || 100;
    this.maxRetries = config.queue?.maxRetries || 3;
    this.retryDelay = config.queue?.retryDelay || 1000;
    this.deadLetterMaxSize = config.queue?.deadLetterMaxSize || 1000;

    // Priority levels
    this.priorities = {
      HIGH: 1,
      MEDIUM: 2,
      LOW: 3
    };

    // Initialize priority queues
    this.initializePriorityQueues();
  }

  /**
   * Initialize priority queues
   */
  initializePriorityQueues () {
    for (const [, priority] of Object.entries(this.priorities)) {
      this.priorityQueues.set(priority, []);
    }
  }

  /**
   * Start the delivery queue service
   */
  async start () {
    if (this.isRunning) {
      logger.warn('Delivery queue service is already running');
      return;
    }

    try {
      logger.info('Starting delivery queue service...');
      this.isRunning = true;

      // Start processing loop
      this.startProcessingLoop();

      // Start cleanup interval
      this.startCleanupInterval();

      logger.info('Delivery queue service started successfully');
      this.emit('started');
    } catch (error) {
      logger.error('Failed to start delivery queue service:', error);
      throw error;
    }
  }

  /**
   * Stop the delivery queue service
   */
  async stop () {
    if (!this.isRunning) {
      logger.warn('Delivery queue service is not running');
      return;
    }

    try {
      logger.info('Stopping delivery queue service...');
      this.isRunning = false;

      // Stop all processors
      for (const [processorId, processor] of this.processors) {
        clearInterval(processor.interval);
        this.processors.delete(processorId);
      }

      // Wait for current processing to complete
      await this.waitForProcessingToComplete();

      logger.info('Delivery queue service stopped successfully');
      this.emit('stopped');
    } catch (error) {
      logger.error('Error stopping delivery queue service:', error);
      throw error;
    }
  }

  /**
   * Add delivery to queue
   * @param {Object} delivery - Delivery object
   * @param {string} priority - Priority level ('HIGH', 'MEDIUM', 'LOW')
   * @returns {string} - Delivery ID
   */
  async addDelivery (delivery, priority = 'MEDIUM') {
    try {
      // Validate delivery
      this.validateDelivery(delivery);

      // Check queue capacity
      if (this.getTotalQueueSize() >= this.maxQueueSize) {
        throw new Error('Queue capacity exceeded');
      }

      // Create delivery item
      const deliveryItem = {
        id: delivery.id || this.generateDeliveryId(),
        webhook: delivery.webhook,
        payload: delivery.payload,
        url: delivery.url,
        headers: delivery.headers || {},
        priority: this.priorities[priority] || this.priorities.MEDIUM,
        attempts: 0,
        maxAttempts: delivery.maxAttempts || this.maxRetries,
        createdAt: new Date(),
        scheduledFor: delivery.scheduledFor || new Date(),
        metadata: delivery.metadata || {}
      };

      // Add to appropriate priority queue
      const priorityQueue = this.priorityQueues.get(deliveryItem.priority);
      priorityQueue.push(deliveryItem);

      // Update statistics
      this.stats.totalQueued++;

      logger.debug(`Added delivery ${deliveryItem.id} to queue with priority ${priority}`);
      this.emit('delivery-queued', deliveryItem);

      return deliveryItem.id;
    } catch (error) {
      logger.error('Error adding delivery to queue:', error);
      throw error;
    }
  }

  /**
   * Process deliveries from queue
   */
  startProcessingLoop () {
    const processorId = 'main-processor';
    const processor = {
      interval: setInterval(() => {
        this.processNextDelivery();
      }, this.processingInterval)
    };

    this.processors.set(processorId, processor);
    logger.info('Started delivery processing loop');
  }

  /**
   * Process next delivery from queue
   */
  async processNextDelivery () {
    if (!this.isRunning) return;

    try {
      // Check if we can process more deliveries
      if (this.processing.size >= this.maxConcurrentDeliveries) {
        return;
      }

      // Get next delivery from priority queues
      const delivery = this.getNextDelivery();
      if (!delivery) {
        return;
      }

      // Check if delivery is scheduled for the future
      if (delivery.scheduledFor > new Date()) {
        // Put back in queue with same priority
        const priorityQueue = this.priorityQueues.get(delivery.priority);
        priorityQueue.push(delivery);
        return;
      }

      // Mark as processing
      this.processing.set(delivery.id, delivery);

      // Process delivery
      await this.processDelivery(delivery);
    } catch (error) {
      logger.error('Error in processing loop:', error);
    }
  }

  /**
   * Get next delivery from priority queues
   * @returns {Object|null} - Next delivery or null if queue is empty
   */
  getNextDelivery () {
    // Process queues in priority order (1 = highest priority)
    for (let priority = 1; priority <= 3; priority++) {
      const queue = this.priorityQueues.get(priority);
      if (queue && queue.length > 0) {
        return queue.shift();
      }
    }
    return null;
  }

  /**
   * Process individual delivery
   * @param {Object} delivery - Delivery to process
   */
  async processDelivery (delivery) {
    const startTime = Date.now();

    try {
      logger.debug(`Processing delivery ${delivery.id} (attempt ${delivery.attempts + 1}/${delivery.maxAttempts})`);

      // Increment attempt count
      delivery.attempts++;
      delivery.lastAttemptAt = new Date();

      // Emit processing event
      this.emit('delivery-processing', delivery);

      // Attempt delivery
      const result = await this.attemptDelivery(delivery);

      // Handle successful delivery
      if (result.success) {
        await this.handleDeliverySuccess(delivery, result);
      } else {
        await this.handleDeliveryFailure(delivery, result);
      }

      // Update processing time statistics
      const processingTime = Date.now() - startTime;
      this.stats.processingTimes.push(processingTime);
      if (this.stats.processingTimes.length > 1000) {
        this.stats.processingTimes.shift();
      }
    } catch (error) {
      logger.error(`Error processing delivery ${delivery.id}:`, error);
      await this.handleDeliveryError(delivery, error);
    } finally {
      // Remove from processing map
      this.processing.delete(delivery.id);
    }
  }

  /**
   * Attempt delivery
   * @param {Object} delivery - Delivery to attempt
   * @returns {Object} - Delivery result
   */
  async attemptDelivery (delivery) {
    return new Promise((resolve) => {
      // Emit delivery attempt event for external processing
      this.emit('delivery-attempt', delivery, (result) => {
        resolve(result);
      });

      // Set timeout for delivery attempt
      setTimeout(() => {
        resolve({
          success: false,
          error: 'Delivery attempt timeout',
          statusCode: 408
        });
      }, 30000); // 30 second timeout
    });
  }

  /**
   * Handle successful delivery
   * @param {Object} delivery - Delivery object
   * @param {Object} result - Delivery result
   */
  async handleDeliverySuccess (delivery, result) {
    try {
      delivery.completedAt = new Date();
      delivery.status = 'completed';
      delivery.result = result;

      // Update statistics
      this.stats.totalProcessed++;

      logger.info(`Delivery ${delivery.id} completed successfully`);
      this.emit('delivery-completed', delivery, result);
    } catch (error) {
      logger.error(`Error handling delivery success for ${delivery.id}:`, error);
    }
  }

  /**
   * Handle delivery failure
   * @param {Object} delivery - Delivery object
   * @param {Object} result - Delivery result
   */
  async handleDeliveryFailure (delivery, result) {
    try {
      delivery.lastError = result.error;
      delivery.lastErrorAt = new Date();

      // Check if we should retry
      if (delivery.attempts < delivery.maxAttempts) {
        await this.scheduleRetry(delivery);
      } else {
        await this.moveToDeadLetterQueue(delivery, result);
      }
    } catch (error) {
      logger.error(`Error handling delivery failure for ${delivery.id}:`, error);
    }
  }

  /**
   * Handle delivery error
   * @param {Object} delivery - Delivery object
   * @param {Error} error - Error object
   */
  async handleDeliveryError (delivery, error) {
    try {
      delivery.lastError = error.message;
      delivery.lastErrorAt = new Date();

      // Check if we should retry
      if (delivery.attempts < delivery.maxAttempts) {
        await this.scheduleRetry(delivery);
      } else {
        await this.moveToDeadLetterQueue(delivery, { error: error.message });
      }
    } catch (retryError) {
      logger.error(`Error handling delivery error for ${delivery.id}:`, retryError);
    }
  }

  /**
   * Schedule delivery retry
   * @param {Object} delivery - Delivery object
   */
  async scheduleRetry (delivery) {
    try {
      // Calculate retry delay with exponential backoff
      const delay = this.calculateRetryDelay(delivery.attempts);
      delivery.scheduledFor = new Date(Date.now() + delay);

      // Add back to queue
      const priorityQueue = this.priorityQueues.get(delivery.priority);
      priorityQueue.push(delivery);

      // Update statistics
      this.stats.totalRetried++;

      logger.info(`Scheduled retry for delivery ${delivery.id} in ${delay}ms (attempt ${delivery.attempts}/${delivery.maxAttempts})`);
      this.emit('delivery-retry-scheduled', delivery);
    } catch (error) {
      logger.error(`Error scheduling retry for delivery ${delivery.id}:`, error);
    }
  }

  /**
   * Calculate retry delay with exponential backoff
   * @param {number} attempt - Attempt number
   * @returns {number} - Delay in milliseconds
   */
  calculateRetryDelay (attempt) {
    const baseDelay = this.retryDelay;
    const exponentialDelay = baseDelay * Math.pow(2, attempt - 1);
    const jitter = Math.random() * 1000; // Add jitter to avoid thundering herd
    return Math.min(exponentialDelay + jitter, 300000); // Max 5 minutes
  }

  /**
   * Move delivery to dead letter queue
   * @param {Object} delivery - Delivery object
   * @param {Object} result - Last delivery result
   */
  async moveToDeadLetterQueue (delivery, result) {
    try {
      delivery.status = 'dead-lettered';
      delivery.deadLetteredAt = new Date();
      delivery.finalResult = result;

      // Add to dead letter queue
      this.deadLetterQueue.push(delivery);

      // Trim dead letter queue if it exceeds max size
      if (this.deadLetterQueue.length > this.deadLetterMaxSize) {
        this.deadLetterQueue.shift();
      }

      // Update statistics
      this.stats.totalFailed++;
      this.stats.totalDeadLettered++;

      logger.warn(`Moved delivery ${delivery.id} to dead letter queue after ${delivery.attempts} attempts`);
      this.emit('delivery-dead-lettered', delivery, result);
    } catch (error) {
      logger.error(`Error moving delivery ${delivery.id} to dead letter queue:`, error);
    }
  }

  /**
   * Retry delivery from dead letter queue
   * @param {string} deliveryId - Delivery ID
   * @returns {boolean} - Success status
   */
  async retryDeadLetteredDelivery (deliveryId) {
    try {
      const index = this.deadLetterQueue.findIndex(d => d.id === deliveryId);
      if (index === -1) {
        logger.warn(`Dead lettered delivery ${deliveryId} not found`);
        return false;
      }

      const delivery = this.deadLetterQueue.splice(index, 1)[0];

      // Reset delivery state
      delivery.status = 'queued';
      delivery.attempts = 0;
      delivery.scheduledFor = new Date();
      delete delivery.deadLetteredAt;
      delete delivery.finalResult;

      // Add back to queue
      const priorityQueue = this.priorityQueues.get(delivery.priority);
      priorityQueue.push(delivery);

      logger.info(`Retrying dead lettered delivery ${deliveryId}`);
      this.emit('dead-letter-retried', delivery);

      return true;
    } catch (error) {
      logger.error(`Error retrying dead lettered delivery ${deliveryId}:`, error);
      return false;
    }
  }

  /**
   * Validate delivery object
   * @param {Object} delivery - Delivery to validate
   */
  validateDelivery (delivery) {
    if (!delivery) {
      throw new Error('Delivery object is required');
    }

    if (!delivery.webhook) {
      throw new Error('Webhook configuration is required');
    }

    if (!delivery.payload) {
      throw new Error('Payload is required');
    }

    if (!delivery.url) {
      throw new Error('URL is required');
    }

    // Validate URL format
    try {
      const url = new URL(delivery.url);
      // Ensure URL is valid
      if (!url.protocol || !url.hostname) {
        throw new Error('Invalid URL format');
      }
    } catch (error) {
      throw new Error('Invalid URL format');
    }
  }

  /**
   * Generate unique delivery ID
   * @returns {string} - Unique delivery ID
   */
  generateDeliveryId () {
    return `delivery_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Get total queue size across all priority levels
   * @returns {number} - Total queue size
   */
  getTotalQueueSize () {
    let total = 0;
    for (const queue of this.priorityQueues.values()) {
      total += queue.length;
    }
    return total;
  }

  /**
   * Get queue status
   * @returns {Object} - Queue status
   */
  getQueueStatus () {
    const queueSizes = {};
    for (const [priority, queue] of this.priorityQueues.entries()) {
      queueSizes[priority] = queue.length;
    }

    return {
      isRunning: this.isRunning,
      totalQueued: this.getTotalQueueSize(),
      processing: this.processing.size,
      deadLetterQueue: this.deadLetterQueue.length,
      queueSizes,
      maxQueueSize: this.maxQueueSize,
      maxConcurrentDeliveries: this.maxConcurrentDeliveries
    };
  }

  /**
   * Get delivery statistics
   * @returns {Object} - Delivery statistics
   */
  getDeliveryStats () {
    const processingTimes = this.stats.processingTimes;
    const averageProcessingTime = processingTimes.length > 0
      ? processingTimes.reduce((a, b) => a + b, 0) / processingTimes.length
      : 0;

    return {
      ...this.stats,
      averageProcessingTime,
      successRate: this.stats.totalProcessed / Math.max(this.stats.totalQueued, 1),
      failureRate: this.stats.totalFailed / Math.max(this.stats.totalQueued, 1),
      retryRate: this.stats.totalRetried / Math.max(this.stats.totalQueued, 1)
    };
  }

  /**
   * Get deliveries by status
   * @param {string} status - Status to filter by
   * @returns {Array} - Filtered deliveries
   */
  getDeliveriesByStatus (status) {
    const deliveries = [];

    // Search in priority queues
    for (const queue of this.priorityQueues.values()) {
      for (const delivery of queue) {
        if (delivery.status === status || (!delivery.status && status === 'queued')) {
          deliveries.push(delivery);
        }
      }
    }

    // Search in processing map
    for (const delivery of this.processing.values()) {
      if (delivery.status === status || (!delivery.status && status === 'processing')) {
        deliveries.push(delivery);
      }
    }

    // Search in dead letter queue
    if (status === 'dead-lettered') {
      deliveries.push(...this.deadLetterQueue);
    }

    return deliveries;
  }

  /**
   * Clear dead letter queue
   * @returns {number} - Number of cleared deliveries
   */
  clearDeadLetterQueue () {
    const count = this.deadLetterQueue.length;
    this.deadLetterQueue.length = 0;
    logger.info(`Cleared ${count} deliveries from dead letter queue`);
    return count;
  }

  /**
   * Start cleanup interval
   */
  startCleanupInterval () {
    const cleanupInterval = setInterval(() => {
      this.performCleanup();
    }, 300000); // 5 minutes

    this.processors.set('cleanup', { interval: cleanupInterval });
  }

  /**
   * Perform cleanup of old deliveries
   */
  performCleanup () {
    try {
      const now = new Date();
      const maxAge = 24 * 60 * 60 * 1000; // 24 hours

      // Clean up old deliveries from dead letter queue
      const beforeCount = this.deadLetterQueue.length;
      this.deadLetterQueue = this.deadLetterQueue.filter(delivery => {
        return (now - delivery.deadLetteredAt) < maxAge;
      });

      const cleaned = beforeCount - this.deadLetterQueue.length;
      if (cleaned > 0) {
        logger.info(`Cleaned up ${cleaned} old deliveries from dead letter queue`);
      }
    } catch (error) {
      logger.error('Error during cleanup:', error);
    }
  }

  /**
   * Wait for current processing to complete
   * @returns {Promise} - Promise that resolves when processing is complete
   */
  async waitForProcessingToComplete () {
    return new Promise((resolve) => {
      const checkInterval = setInterval(() => {
        if (this.processing.size === 0) {
          clearInterval(checkInterval);
          resolve();
        }
      }, 100);

      // Timeout after 30 seconds
      setTimeout(() => {
        clearInterval(checkInterval);
        resolve();
      }, 30000);
    });
  }
}

module.exports = DeliveryQueueService;
