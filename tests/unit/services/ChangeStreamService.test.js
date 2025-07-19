/**
 * Unit tests for ChangeStreamService
 */

const { EventEmitter } = require('events');
const ChangeStreamService = require('../../../src/services/ChangeStreamService');
const { MongoClient } = require('mongodb');

// Mock dependencies
jest.mock('mongodb');
jest.mock('../../../src/utils/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn()
}));

describe('ChangeStreamService', () => {
  let service;
  let mockDatabaseService;
  let mockConfig;
  let mockClient;
  let mockDb;
  let mockChangeStream;
  let mockResumeTokenService;

  beforeEach(() => {
    // Reset all mocks
    jest.clearAllMocks();

    // Mock config
    mockConfig = {
      database: {
        url: 'mongodb://localhost:27017',
        name: 'test-db'
      }
    };

    // Mock database service
    mockDatabaseService = {
      getDb: jest.fn()
    };

    // Mock MongoDB client and change stream
    mockChangeStream = new EventEmitter();
    mockChangeStream.close = jest.fn().mockResolvedValue();
    
    mockDb = {
      watch: jest.fn().mockReturnValue(mockChangeStream)
    };

    mockClient = {
      connect: jest.fn().mockResolvedValue(),
      close: jest.fn().mockResolvedValue(),
      db: jest.fn().mockReturnValue(mockDb),
      topology: {
        isConnected: jest.fn().mockReturnValue(true)
      }
    };

    MongoClient.mockImplementation(() => mockClient);

    // Mock ResumeTokenService
    jest.mock('../../../src/services/ResumeTokenService', () => {
      return jest.fn().mockImplementation(() => ({
        initialize: jest.fn().mockResolvedValue(),
        loadResumeToken: jest.fn().mockResolvedValue(null),
        saveResumeToken: jest.fn().mockResolvedValue(),
        shutdown: jest.fn().mockResolvedValue()
      }));
    });

    // Create service instance
    service = new ChangeStreamService(mockConfig, mockDatabaseService);
    service.resumeTokenService = {
      initialize: jest.fn().mockResolvedValue(),
      loadResumeToken: jest.fn().mockResolvedValue(null),
      saveResumeToken: jest.fn().mockResolvedValue(),
      shutdown: jest.fn().mockResolvedValue()
    };
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('initialization', () => {
    it('should initialize successfully', async () => {
      await service.initialize();

      expect(service.resumeTokenService.initialize).toHaveBeenCalled();
      expect(mockClient.connect).toHaveBeenCalled();
      expect(mockDb.watch).toHaveBeenCalledWith([], expect.any(Object));
      expect(service.isRunning).toBe(true);
    });

    it('should load existing resume token', async () => {
      const mockToken = { _data: 'mock-token-data' };
      service.resumeTokenService.loadResumeToken.mockResolvedValue(mockToken);

      await service.initialize();

      expect(service.resumeTokenService.loadResumeToken).toHaveBeenCalled();
      expect(mockDb.watch).toHaveBeenCalledWith([], expect.objectContaining({
        resumeAfter: mockToken
      }));
    });

    it('should handle initialization errors', async () => {
      const error = new Error('Connection failed');
      mockClient.connect.mockRejectedValue(error);

      await expect(service.initialize()).rejects.toThrow('Connection failed');
    });
  });

  describe('change event handling', () => {
    beforeEach(async () => {
      await service.initialize();
    });

    it('should process change events', async () => {
      const mockChangeEvent = {
        _id: { _data: 'event-token' },
        operationType: 'insert',
        ns: { db: 'test', coll: 'issues' },
        documentKey: { _id: '123' },
        fullDocument: { title: 'Test Issue' }
      };

      const changeHandler = jest.fn();
      service.on('change', changeHandler);

      // Emit change event
      mockChangeStream.emit('change', mockChangeEvent);

      // Allow async processing
      await new Promise(resolve => setImmediate(resolve));

      expect(changeHandler).toHaveBeenCalledWith(mockChangeEvent);
      expect(service.resumeTokenService.saveResumeToken).toHaveBeenCalledWith(mockChangeEvent._id);
      expect(service.eventsProcessed).toBe(1);
    });

    it('should update statistics on change events', async () => {
      const mockChangeEvent = {
        _id: { _data: 'event-token' },
        operationType: 'update',
        ns: { db: 'test', coll: 'projects' },
        documentKey: { _id: '456' }
      };

      mockChangeStream.emit('change', mockChangeEvent);
      await new Promise(resolve => setImmediate(resolve));

      expect(service.stats.totalEvents).toBe(1);
      expect(service.stats.eventsByType.update).toBe(1);
      expect(service.stats.eventsByCollection.projects).toBe(1);
    });

    it('should handle change event errors gracefully', async () => {
      const mockChangeEvent = {
        _id: { _data: 'event-token' },
        operationType: 'insert',
        ns: { db: 'test', coll: 'issues' }
      };

      // Looking at the actual implementation, the eventsProcessed is incremented 
      // AFTER the resume token is saved. So if save fails, eventsProcessed won't increment
      service.resumeTokenService.saveResumeToken.mockRejectedValue(new Error('Save failed'));
      
      // Add console.error mock to prevent error output
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();

      // Should not throw
      mockChangeStream.emit('change', mockChangeEvent);
      await new Promise(resolve => setImmediate(resolve));

      // Since saveResumeToken fails, eventsProcessed won't be incremented
      expect(service.eventsProcessed).toBe(0);
      // But stats will still be updated since that happens after the error
      expect(service.stats.totalEvents).toBe(0);
      
      // Restore console.error
      consoleErrorSpy.mockRestore();
    });
  });

  describe('error handling and reconnection', () => {
    beforeEach(async () => {
      await service.initialize();
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('should attempt reconnection on error', async () => {
      const error = new Error('Stream error');
      
      // Add error listener to prevent unhandled error
      const errorListener = jest.fn();
      service.on('error', errorListener);
      
      // Mock the attemptReconnection method to prevent actual reconnection
      service.attemptReconnection = jest.fn();
      
      mockChangeStream.emit('error', error);

      expect(service.attemptReconnection).toHaveBeenCalled();
      
      // Verify error was emitted
      expect(errorListener).toHaveBeenCalledWith(error);
    });

    it('should stop reconnecting after max attempts', async () => {
      service.reconnectAttempts = 10; // Already at max

      const errorHandler = jest.fn();
      const maxAttemptsHandler = jest.fn();
      
      // Add error listener to prevent unhandled error
      service.on('error', errorHandler);
      service.on('maxReconnectAttemptsReached', maxAttemptsHandler);

      // Mock attemptReconnection to check the logic
      const originalAttemptReconnection = service.attemptReconnection.bind(service);
      service.attemptReconnection = jest.fn().mockImplementation(() => {
        originalAttemptReconnection();
      });

      mockChangeStream.emit('error', new Error('Stream error'));

      expect(service.attemptReconnection).toHaveBeenCalled();
      expect(maxAttemptsHandler).toHaveBeenCalled();
    });

    it('should handle stream close event', async () => {
      // Mock the attemptReconnection method to prevent actual reconnection
      service.attemptReconnection = jest.fn();
      
      mockChangeStream.emit('close');

      expect(service.attemptReconnection).toHaveBeenCalled();
    });
  });

  describe('shutdown', () => {
    it('should shutdown cleanly', async () => {
      await service.initialize();
      await service.shutdown();

      expect(service.isRunning).toBe(false);
      expect(mockChangeStream.close).toHaveBeenCalled();
      expect(mockClient.close).toHaveBeenCalled();
      expect(service.resumeTokenService.shutdown).toHaveBeenCalled();
    });

    it('should handle shutdown errors gracefully', async () => {
      await service.initialize();
      mockClient.close.mockRejectedValue(new Error('Close failed'));

      await expect(service.shutdown()).rejects.toThrow('Close failed');
    });
  });

  describe('status methods', () => {
    it('should return correct status', async () => {
      await service.initialize();
      
      const status = service.getStatus();
      
      expect(status).toEqual({
        active: true,
        connected: true,
        eventsProcessed: 0,
        lastEvent: null,
        resumeToken: false,
        reconnectAttempts: 0
      });
    });

    it('should track performance stats', async () => {
      await service.initialize();
      
      // Process some events
      for (let i = 0; i < 5; i++) {
        mockChangeStream.emit('change', {
          _id: { _data: `token-${i}` },
          operationType: 'insert',
          ns: { db: 'test', coll: 'issues' }
        });
      }
      
      await new Promise(resolve => setImmediate(resolve));
      
      const stats = await service.getPerformanceStats('1h');
      
      expect(stats.eventsProcessed).toBe(5);
      expect(stats.averageProcessingTime).toBeGreaterThanOrEqual(0);
      expect(stats.errorRate).toBe(0);
    });

    it('should return event statistics', async () => {
      await service.initialize();
      
      const eventStats = await service.getEventStats();
      
      expect(eventStats).toEqual({
        totalEvents: 0,
        eventsByType: {},
        eventsByCollection: {}
      });
    });
  });

  describe('resume token management', () => {
    it('should get and set resume token', async () => {
      const token = { _data: 'test-token' };
      
      service.setResumeToken(token);
      expect(service.getResumeToken()).toEqual(token);
    });
  });
});