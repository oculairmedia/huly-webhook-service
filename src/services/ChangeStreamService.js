/**
 * Change Stream service for Huly Webhook Service
 * Monitors MongoDB change streams for real-time event detection
 */

const { MongoClient } = require('mongodb');
const EventEmitter = require('events');
const logger = require('../utils/logger');
const ResumeTokenService = require('./ResumeTokenService');

class ChangeStreamService extends EventEmitter {
  constructor (config, databaseService) {
    super();
    this.config = config;
    this.db = databaseService;
    this.client = null;
    this.changeStream = null;
    this.isRunning = false;
    this.resumeToken = null;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 10;
    this.reconnectDelay = 1000;
    this.eventsProcessed = 0;
    this.lastEvent = null;
    this.stats = {
      totalEvents: 0,
      eventsByType: {},
      eventsByCollection: {},
      processingTimes: []
    };

    // Initialize Resume Token Service
    this.resumeTokenService = new ResumeTokenService(config, databaseService);
  }

  async initialize () {
    try {
      logger.info('Initializing Change Stream Service...');

      // Initialize Resume Token Service
      await this.resumeTokenService.initialize();

      // Load existing resume token
      this.resumeToken = await this.resumeTokenService.loadResumeToken();

      // Connect to MongoDB
      this.client = new MongoClient(this.config.database.url, {
        useUnifiedTopology: true,
        maxPoolSize: 10,
        serverSelectionTimeoutMS: 5000,
        socketTimeoutMS: 45000
      });

      await this.client.connect();
      logger.info('Connected to MongoDB for Change Stream monitoring');

      // Start the change stream
      await this.startChangeStream();

      this.isRunning = true;
      logger.info('Change Stream Service initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize Change Stream Service:', error);
      throw error;
    }
  }

  async startChangeStream () {
    try {
      const db = this.client.db(this.config.database.name);

      // Define the change stream options
      const options = {
        fullDocument: 'updateLookup',
        fullDocumentBeforeChange: 'whenAvailable'
      };

      // Add resume token if available
      if (this.resumeToken) {
        options.resumeAfter = this.resumeToken;
        logger.info('Resuming change stream from token:', this.resumeToken);
      }

      // Create the change stream
      this.changeStream = db.watch([], options);

      // Handle change stream events
      this.changeStream.on('change', (changeEvent) => {
        this.handleChangeEvent(changeEvent);
      });

      this.changeStream.on('error', (error) => {
        logger.error('Change stream error:', error);
        this.handleChangeStreamError(error);
      });

      this.changeStream.on('close', () => {
        logger.warn('Change stream closed');
        if (this.isRunning) {
          this.attemptReconnection();
        }
      });

      this.changeStream.on('end', () => {
        logger.warn('Change stream ended');
        if (this.isRunning) {
          this.attemptReconnection();
        }
      });

      logger.info('Change stream started successfully');
    } catch (error) {
      logger.error('Failed to start change stream:', error);
      throw error;
    }
  }

  async handleChangeEvent (changeEvent) {
    try {
      const startTime = Date.now();

      logger.debug('Change event received:', {
        operationType: changeEvent.operationType,
        ns: changeEvent.ns,
        documentKey: changeEvent.documentKey
      });

      // Store the resume token for fault tolerance
      this.resumeToken = changeEvent._id;

      // Save resume token using ResumeTokenService
      await this.resumeTokenService.saveResumeToken(changeEvent._id);

      this.eventsProcessed++;
      this.lastEvent = {
        operationType: changeEvent.operationType,
        ns: changeEvent.ns,
        timestamp: new Date()
      };

      // Update statistics
      this.updateStats(changeEvent, startTime);

      // Emit the change event for processing
      this.emit('change', changeEvent);

      // Update reconnection state on successful event
      this.reconnectAttempts = 0;

      const processingTime = Date.now() - startTime;
      this.stats.processingTimes.push(processingTime);

      // Keep only last 100 processing times for average calculation
      if (this.stats.processingTimes.length > 100) {
        this.stats.processingTimes.shift();
      }
    } catch (error) {
      logger.error('Error handling change event:', error);
    }
  }

  updateStats (changeEvent, _startTime) {
    this.stats.totalEvents++;

    // Update event type statistics
    const operationType = changeEvent.operationType;
    if (!this.stats.eventsByType[operationType]) {
      this.stats.eventsByType[operationType] = 0;
    }
    this.stats.eventsByType[operationType]++;

    // Update collection statistics
    const collection = changeEvent.ns ? changeEvent.ns.coll : 'unknown';
    if (!this.stats.eventsByCollection[collection]) {
      this.stats.eventsByCollection[collection] = 0;
    }
    this.stats.eventsByCollection[collection]++;
  }

  handleChangeStreamError (error) {
    logger.error('Change stream error occurred:', error);

    // Emit error event for external handling
    this.emit('error', error);

    // Attempt to reconnect if the service is still running
    if (this.isRunning) {
      this.attemptReconnection();
    }
  }

  async attemptReconnection () {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      logger.error('Max reconnection attempts reached, stopping Change Stream Service');
      this.emit('maxReconnectAttemptsReached');
      return;
    }

    this.reconnectAttempts++;
    const delay = this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1);

    logger.info(`Attempting to reconnect change stream (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts}) in ${delay}ms`);

    setTimeout(async () => {
      try {
        await this.closeChangeStream();
        await this.startChangeStream();
        logger.info('Change stream reconnected successfully');
      } catch (error) {
        logger.error('Failed to reconnect change stream:', error);
        this.attemptReconnection();
      }
    }, delay);
  }

  async closeChangeStream () {
    if (this.changeStream) {
      try {
        await this.changeStream.close();
        this.changeStream = null;
        logger.info('Change stream closed');
      } catch (error) {
        logger.error('Error closing change stream:', error);
      }
    }
  }

  async shutdown () {
    try {
      logger.info('Shutting down Change Stream Service...');
      this.isRunning = false;

      await this.closeChangeStream();

      if (this.client) {
        await this.client.close();
        this.client = null;
        logger.info('MongoDB client disconnected');
      }

      // Shutdown Resume Token Service
      if (this.resumeTokenService) {
        await this.resumeTokenService.shutdown();
      }

      logger.info('Change Stream Service shut down successfully');
    } catch (error) {
      logger.error('Error during Change Stream Service shutdown:', error);
      throw error;
    }
  }

  // Legacy methods for backward compatibility
  async start () {
    await this.initialize();
  }

  async stop () {
    await this.shutdown();
  }

  isActive () {
    return this.isRunning;
  }

  getStatus () {
    return {
      active: this.isRunning,
      connected: this.client && this.client.topology && this.client.topology.isConnected(),
      eventsProcessed: this.eventsProcessed,
      lastEvent: this.lastEvent,
      resumeToken: !!this.resumeToken,
      reconnectAttempts: this.reconnectAttempts
    };
  }

  async getPerformanceStats (_period) {
    const processingTimes = this.stats.processingTimes;
    const averageProcessingTime = processingTimes.length > 0
      ? processingTimes.reduce((a, b) => a + b, 0) / processingTimes.length
      : 0;

    return {
      eventsProcessed: this.stats.totalEvents,
      averageProcessingTime,
      errorRate: this.reconnectAttempts / Math.max(this.stats.totalEvents, 1)
    };
  }

  async getEventStats (_query) {
    return {
      totalEvents: this.stats.totalEvents,
      eventsByType: { ...this.stats.eventsByType },
      eventsByCollection: { ...this.stats.eventsByCollection }
    };
  }

  // Method to get the current resume token (for persistence)
  getResumeToken () {
    return this.resumeToken;
  }

  // Method to set resume token (for loading from persistence)
  setResumeToken (token) {
    this.resumeToken = token;
    logger.info('Resume token set for change stream recovery');
  }
}

module.exports = ChangeStreamService;
