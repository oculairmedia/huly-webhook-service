/**
 * Delivery History Service for Huly Webhook Service
 * Manages webhook delivery history, analytics, and reporting
 */

const logger = require('../utils/logger');

class DeliveryHistoryService {
  constructor (config, databaseService) {
    this.config = config;
    this.db = databaseService;
    this.retentionPeriod = config.deliveryHistory?.retentionPeriod || 90; // days
    this.batchSize = config.deliveryHistory?.batchSize || 1000;
    this.compressionEnabled = config.deliveryHistory?.compression || true;
    this.analyticsEnabled = config.deliveryHistory?.analytics !== false;

    // In-memory cache for recent deliveries
    this.recentDeliveries = new Map();
    this.maxCacheSize = config.deliveryHistory?.maxCacheSize || 10000;

    // Analytics data
    this.analytics = {
      totalDeliveries: 0,
      successfulDeliveries: 0,
      failedDeliveries: 0,
      averageResponseTime: 0,
      deliveriesByStatus: {},
      deliveriesByWebhook: {},
      deliveriesByEventType: {},
      deliveriesByHour: {},
      deliveriesByDay: {},
      errorsByType: {},
      responseTimes: []
    };

    this.initialize();
  }

  /**
   * Initialize the delivery history service
   */
  async initialize () {
    try {
      logger.info('Initializing Delivery History Service...');

      // Load recent analytics data
      if (this.analyticsEnabled) {
        await this.loadAnalytics();
      }

      // Start cleanup interval
      this.startCleanupInterval();

      // Start analytics update interval
      if (this.analyticsEnabled) {
        this.startAnalyticsUpdateInterval();
      }

      logger.info('Delivery History Service initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize Delivery History Service:', error);
      throw error;
    }
  }

  /**
   * Record delivery attempt
   * @param {Object} delivery - Delivery information
   * @param {Object} result - Delivery result
   * @returns {string} - History record ID
   */
  async recordDelivery (delivery, result) {
    try {
      const historyRecord = {
        id: this.generateHistoryId(),
        webhookId: delivery.webhook._id,
        webhookName: delivery.webhook.name,
        webhookUrl: delivery.webhook.url,
        eventType: delivery.payload.event,
        eventId: delivery.payload.id,
        payload: this.compressionEnabled ? this.compressPayload(delivery.payload) : delivery.payload,
        result: {
          success: result.success,
          statusCode: result.statusCode,
          responseTime: result.responseTime,
          error: result.error,
          headers: result.headers,
          bodySize: result.body ? result.body.length : 0
        },
        attempt: delivery.attempt || 1,
        maxAttempts: delivery.maxAttempts || 3,
        timestamp: new Date(),
        deliveryId: delivery.id,
        metadata: {
          userAgent: delivery.headers?.['User-Agent'],
          ipAddress: delivery.metadata?.ipAddress,
          documentId: delivery.payload.data?.id,
          documentType: delivery.payload.data?.type,
          operation: delivery.payload.data?.operation
        }
      };

      // Store in database
      await this.db.create('delivery_history', historyRecord);

      // Add to cache
      this.addToCache(historyRecord);

      // Update analytics
      if (this.analyticsEnabled) {
        this.updateAnalytics(historyRecord);
      }

      logger.debug(`Recorded delivery history: ${historyRecord.id}`, {
        webhookId: historyRecord.webhookId,
        eventType: historyRecord.eventType,
        success: result.success,
        statusCode: result.statusCode,
        responseTime: result.responseTime
      });

      return historyRecord.id;
    } catch (error) {
      logger.error('Error recording delivery history:', error);
      throw error;
    }
  }

  /**
   * Get delivery history
   * @param {Object} query - Query parameters
   * @returns {Array} - Delivery history records
   */
  async getDeliveryHistory (query = {}) {
    try {
      const filter = this.buildFilter(query);
      const options = this.buildQueryOptions(query);

      const records = await this.db.findMany('delivery_history', filter, options);

      // Decompress payloads if needed
      if (this.compressionEnabled) {
        records.forEach(record => {
          if (record.payload && record.payload.compressed) {
            record.payload = this.decompressPayload(record.payload);
          }
        });
      }

      return records;
    } catch (error) {
      logger.error('Error getting delivery history:', error);
      throw error;
    }
  }

  /**
   * Get delivery statistics
   * @param {Object} query - Query parameters
   * @returns {Object} - Delivery statistics
   */
  async getDeliveryStats (query = {}) {
    try {
      const filter = this.buildFilter(query);

      // Get aggregated statistics from database
      const stats = await this.db.aggregate('delivery_history', [
        { $match: filter },
        {
          $group: {
            _id: null,
            totalDeliveries: { $sum: 1 },
            successfulDeliveries: { $sum: { $cond: ['$result.success', 1, 0] } },
            failedDeliveries: { $sum: { $cond: ['$result.success', 0, 1] } },
            averageResponseTime: { $avg: '$result.responseTime' },
            minResponseTime: { $min: '$result.responseTime' },
            maxResponseTime: { $max: '$result.responseTime' },
            totalAttempts: { $sum: '$attempt' },
            uniqueWebhooks: { $addToSet: '$webhookId' },
            uniqueEventTypes: { $addToSet: '$eventType' }
          }
        }
      ]);

      const result = stats[0] || {
        totalDeliveries: 0,
        successfulDeliveries: 0,
        failedDeliveries: 0,
        averageResponseTime: 0,
        minResponseTime: 0,
        maxResponseTime: 0,
        totalAttempts: 0,
        uniqueWebhooks: [],
        uniqueEventTypes: []
      };

      // Calculate success rate
      result.successRate = result.totalDeliveries > 0
        ? result.successfulDeliveries / result.totalDeliveries
        : 0;

      // Calculate failure rate
      result.failureRate = result.totalDeliveries > 0
        ? result.failedDeliveries / result.totalDeliveries
        : 0;

      // Calculate average attempts
      result.averageAttempts = result.totalDeliveries > 0
        ? result.totalAttempts / result.totalDeliveries
        : 0;

      // Get count of unique items
      result.uniqueWebhookCount = result.uniqueWebhooks.length;
      result.uniqueEventTypeCount = result.uniqueEventTypes.length;

      return result;
    } catch (error) {
      logger.error('Error getting delivery stats:', error);
      throw error;
    }
  }

  /**
   * Get delivery trends
   * @param {Object} query - Query parameters
   * @returns {Object} - Delivery trends
   */
  async getDeliveryTrends (query = {}) {
    try {
      const filter = this.buildFilter(query);
      const groupBy = query.groupBy || 'hour'; // hour, day, week, month

      let groupExpression;
      let dateFormat;

      switch (groupBy) {
      case 'hour':
        groupExpression = {
          year: { $year: '$timestamp' },
          month: { $month: '$timestamp' },
          day: { $dayOfMonth: '$timestamp' },
          hour: { $hour: '$timestamp' }
        };
        dateFormat = '%Y-%m-%d %H:00:00';
        break;
      case 'day':
        groupExpression = {
          year: { $year: '$timestamp' },
          month: { $month: '$timestamp' },
          day: { $dayOfMonth: '$timestamp' }
        };
        dateFormat = '%Y-%m-%d';
        break;
      case 'week':
        groupExpression = {
          year: { $year: '$timestamp' },
          week: { $week: '$timestamp' }
        };
        dateFormat = '%Y-W%V';
        break;
      case 'month':
        groupExpression = {
          year: { $year: '$timestamp' },
          month: { $month: '$timestamp' }
        };
        dateFormat = '%Y-%m';
        break;
      default:
        groupExpression = {
          year: { $year: '$timestamp' },
          month: { $month: '$timestamp' },
          day: { $dayOfMonth: '$timestamp' },
          hour: { $hour: '$timestamp' }
        };
        dateFormat = '%Y-%m-%d %H:00:00';
      }

      const trends = await this.db.aggregate('delivery_history', [
        { $match: filter },
        {
          $group: {
            _id: groupExpression,
            totalDeliveries: { $sum: 1 },
            successfulDeliveries: { $sum: { $cond: ['$result.success', 1, 0] } },
            failedDeliveries: { $sum: { $cond: ['$result.success', 0, 1] } },
            averageResponseTime: { $avg: '$result.responseTime' },
            timestamp: { $first: '$timestamp' }
          }
        },
        {
          $addFields: {
            successRate: {
              $cond: [
                { $eq: ['$totalDeliveries', 0] },
                0,
                { $divide: ['$successfulDeliveries', '$totalDeliveries'] }
              ]
            },
            period: {
              $dateToString: {
                format: dateFormat,
                date: '$timestamp'
              }
            }
          }
        },
        { $sort: { _id: 1 } }
      ]);

      return trends;
    } catch (error) {
      logger.error('Error getting delivery trends:', error);
      throw error;
    }
  }

  /**
   * Get webhook-specific delivery history
   * @param {string} webhookId - Webhook ID
   * @param {Object} query - Query parameters
   * @returns {Array} - Delivery history for webhook
   */
  async getWebhookDeliveryHistory (webhookId, query = {}) {
    query.webhookId = webhookId;
    return await this.getDeliveryHistory(query);
  }

  /**
   * Get delivery history for specific event
   * @param {string} eventId - Event ID
   * @param {Object} query - Query parameters
   * @returns {Array} - Delivery history for event
   */
  async getEventDeliveryHistory (eventId, query = {}) {
    query.eventId = eventId;
    return await this.getDeliveryHistory(query);
  }

  /**
   * Get failed deliveries
   * @param {Object} query - Query parameters
   * @returns {Array} - Failed delivery records
   */
  async getFailedDeliveries (query = {}) {
    query.success = false;
    return await this.getDeliveryHistory(query);
  }

  /**
   * Get slow deliveries
   * @param {number} threshold - Response time threshold in ms
   * @param {Object} query - Query parameters
   * @returns {Array} - Slow delivery records
   */
  async getSlowDeliveries (threshold = 5000, query = {}) {
    const filter = this.buildFilter(query);
    filter['result.responseTime'] = { $gte: threshold };

    const options = this.buildQueryOptions(query);
    return await this.db.findMany('delivery_history', filter, options);
  }

  /**
   * Get delivery error analysis
   * @param {Object} query - Query parameters
   * @returns {Object} - Error analysis
   */
  async getErrorAnalysis (query = {}) {
    try {
      const filter = this.buildFilter(query);
      filter['result.success'] = false;

      const errorAnalysis = await this.db.aggregate('delivery_history', [
        { $match: filter },
        {
          $group: {
            _id: '$result.statusCode',
            count: { $sum: 1 },
            webhooks: { $addToSet: '$webhookId' },
            eventTypes: { $addToSet: '$eventType' },
            errors: { $addToSet: '$result.error' },
            averageResponseTime: { $avg: '$result.responseTime' },
            lastOccurrence: { $max: '$timestamp' }
          }
        },
        {
          $addFields: {
            statusCode: '$_id',
            webhookCount: { $size: '$webhooks' },
            eventTypeCount: { $size: '$eventTypes' }
          }
        },
        { $sort: { count: -1 } }
      ]);

      return errorAnalysis;
    } catch (error) {
      logger.error('Error getting error analysis:', error);
      throw error;
    }
  }

  /**
   * Export delivery history
   * @param {Object} query - Query parameters
   * @param {string} format - Export format (json, csv)
   * @returns {Object} - Export result
   */
  async exportDeliveryHistory (query = {}, format = 'json') {
    try {
      const records = await this.getDeliveryHistory(query);

      if (format === 'csv') {
        return this.convertToCSV(records);
      } else {
        return {
          format: 'json',
          data: records,
          count: records.length,
          exportedAt: new Date()
        };
      }
    } catch (error) {
      logger.error('Error exporting delivery history:', error);
      throw error;
    }
  }

  /**
   * Cleanup old delivery history
   * @returns {number} - Number of cleaned records
   */
  async cleanupOldHistory () {
    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - this.retentionPeriod);

      const result = await this.db.deleteMany('delivery_history', {
        timestamp: { $lt: cutoffDate }
      });

      const deletedCount = result.deletedCount || 0;

      if (deletedCount > 0) {
        logger.info(`Cleaned up ${deletedCount} old delivery history records`);
      }

      return deletedCount;
    } catch (error) {
      logger.error('Error cleaning up old history:', error);
      return 0;
    }
  }

  /**
   * Build filter from query parameters
   * @param {Object} query - Query parameters
   * @returns {Object} - MongoDB filter
   */
  buildFilter (query) {
    const filter = {};

    if (query.webhookId) {
      filter.webhookId = query.webhookId;
    }

    if (query.eventType) {
      filter.eventType = query.eventType;
    }

    if (query.eventId) {
      filter.eventId = query.eventId;
    }

    if (query.success !== undefined) {
      filter['result.success'] = query.success;
    }

    if (query.statusCode) {
      filter['result.statusCode'] = query.statusCode;
    }

    if (query.fromDate || query.toDate) {
      filter.timestamp = {};
      if (query.fromDate) {
        filter.timestamp.$gte = new Date(query.fromDate);
      }
      if (query.toDate) {
        filter.timestamp.$lte = new Date(query.toDate);
      }
    }

    if (query.minResponseTime !== undefined) {
      filter['result.responseTime'] = { $gte: query.minResponseTime };
    }

    if (query.maxResponseTime !== undefined) {
      filter['result.responseTime'] = {
        ...filter['result.responseTime'],
        $lte: query.maxResponseTime
      };
    }

    return filter;
  }

  /**
   * Build query options
   * @param {Object} query - Query parameters
   * @returns {Object} - Query options
   */
  buildQueryOptions (query) {
    const options = {};

    if (query.limit) {
      options.limit = Math.min(query.limit, 10000); // Cap at 10k
    }

    if (query.skip) {
      options.skip = query.skip;
    }

    // Default sort by timestamp descending
    options.sort = { timestamp: -1 };

    if (query.sortBy) {
      options.sort = {};
      options.sort[query.sortBy] = query.sortOrder === 'asc' ? 1 : -1;
    }

    return options;
  }

  /**
   * Add record to cache
   * @param {Object} record - History record
   */
  addToCache (record) {
    // Add to cache with expiration
    this.recentDeliveries.set(record.id, {
      ...record,
      cachedAt: Date.now()
    });

    // Trim cache if it exceeds max size
    if (this.recentDeliveries.size > this.maxCacheSize) {
      const oldest = Array.from(this.recentDeliveries.entries())
        .sort(([, a], [, b]) => a.cachedAt - b.cachedAt)[0];
      this.recentDeliveries.delete(oldest[0]);
    }
  }

  /**
   * Update analytics
   * @param {Object} record - History record
   */
  updateAnalytics (record) {
    this.analytics.totalDeliveries++;

    if (record.result.success) {
      this.analytics.successfulDeliveries++;
    } else {
      this.analytics.failedDeliveries++;
    }

    // Update response times
    if (record.result.responseTime) {
      this.analytics.responseTimes.push(record.result.responseTime);
      if (this.analytics.responseTimes.length > 10000) {
        this.analytics.responseTimes.shift();
      }

      this.analytics.averageResponseTime =
        this.analytics.responseTimes.reduce((a, b) => a + b, 0) / this.analytics.responseTimes.length;
    }

    // Update counters
    const statusCode = record.result.statusCode || 'unknown';
    this.analytics.deliveriesByStatus[statusCode] = (this.analytics.deliveriesByStatus[statusCode] || 0) + 1;

    this.analytics.deliveriesByWebhook[record.webhookId] = (this.analytics.deliveriesByWebhook[record.webhookId] || 0) + 1;

    this.analytics.deliveriesByEventType[record.eventType] = (this.analytics.deliveriesByEventType[record.eventType] || 0) + 1;

    // Update time-based counters
    const hour = new Date(record.timestamp).getHours();
    const day = new Date(record.timestamp).toDateString();

    this.analytics.deliveriesByHour[hour] = (this.analytics.deliveriesByHour[hour] || 0) + 1;
    this.analytics.deliveriesByDay[day] = (this.analytics.deliveriesByDay[day] || 0) + 1;

    // Update error counters
    if (!record.result.success && record.result.error) {
      this.analytics.errorsByType[record.result.error] = (this.analytics.errorsByType[record.result.error] || 0) + 1;
    }
  }

  /**
   * Load analytics from database
   */
  async loadAnalytics () {
    try {
      // This is a basic implementation - in production you'd want to cache analytics
      const recentStats = await this.getDeliveryStats({
        fromDate: new Date(Date.now() - 24 * 60 * 60 * 1000) // Last 24 hours
      });

      this.analytics.totalDeliveries = recentStats.totalDeliveries;
      this.analytics.successfulDeliveries = recentStats.successfulDeliveries;
      this.analytics.failedDeliveries = recentStats.failedDeliveries;
      this.analytics.averageResponseTime = recentStats.averageResponseTime;
    } catch (error) {
      logger.error('Error loading analytics:', error);
    }
  }

  /**
   * Compress payload for storage
   * @param {Object} payload - Payload to compress
   * @returns {Object} - Compressed payload
   */
  compressPayload (payload) {
    // Simple compression - in production you'd use actual compression
    const payloadString = JSON.stringify(payload);
    if (payloadString.length > 1000) {
      return {
        compressed: true,
        data: payloadString, // In production, use zlib compression
        originalSize: payloadString.length,
        compressedSize: payloadString.length // Would be smaller with real compression
      };
    }
    return payload;
  }

  /**
   * Decompress payload
   * @param {Object} compressedPayload - Compressed payload
   * @returns {Object} - Decompressed payload
   */
  decompressPayload (compressedPayload) {
    if (compressedPayload.compressed) {
      return JSON.parse(compressedPayload.data);
    }
    return compressedPayload;
  }

  /**
   * Convert records to CSV format
   * @param {Array} records - Records to convert
   * @returns {Object} - CSV export result
   */
  convertToCSV (records) {
    const headers = [
      'ID', 'Webhook ID', 'Webhook Name', 'Event Type', 'Success',
      'Status Code', 'Response Time', 'Timestamp', 'Attempt', 'Error'
    ];

    const csvRows = records.map(record => [
      record.id,
      record.webhookId,
      record.webhookName,
      record.eventType,
      record.result.success,
      record.result.statusCode,
      record.result.responseTime,
      record.timestamp.toISOString(),
      record.attempt,
      record.result.error || ''
    ]);

    const csvContent = [headers, ...csvRows]
      .map(row => row.map(field => `"${field}"`).join(','))
      .join('\n');

    return {
      format: 'csv',
      data: csvContent,
      count: records.length,
      exportedAt: new Date()
    };
  }

  /**
   * Generate unique history ID
   * @returns {string} - Unique ID
   */
  generateHistoryId () {
    return `hist_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Start cleanup interval
   */
  startCleanupInterval () {
    // Run cleanup daily
    setInterval(async () => {
      try {
        await this.cleanupOldHistory();
      } catch (error) {
        logger.error('Error in cleanup interval:', error);
      }
    }, 24 * 60 * 60 * 1000); // 24 hours
  }

  /**
   * Start analytics update interval
   */
  startAnalyticsUpdateInterval () {
    // Update analytics every 10 minutes
    setInterval(async () => {
      try {
        await this.loadAnalytics();
      } catch (error) {
        logger.error('Error in analytics update interval:', error);
      }
    }, 10 * 60 * 1000); // 10 minutes
  }

  /**
   * Get current analytics
   * @returns {Object} - Current analytics
   */
  getCurrentAnalytics () {
    return { ...this.analytics };
  }

  /**
   * Shutdown the service
   */
  async shutdown () {
    try {
      logger.info('Shutting down Delivery History Service...');

      // Clear cache
      this.recentDeliveries.clear();

      logger.info('Delivery History Service shut down successfully');
    } catch (error) {
      logger.error('Error shutting down Delivery History Service:', error);
      throw error;
    }
  }
}

module.exports = DeliveryHistoryService;
