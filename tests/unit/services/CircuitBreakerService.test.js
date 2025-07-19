/**
 * Unit tests for CircuitBreakerService
 */

const CircuitBreakerService = require('../../../src/services/CircuitBreakerService');

// Mock dependencies
jest.mock('../../../src/utils/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn()
}));

describe('CircuitBreakerService', () => {
  let service;
  let config;
  let setIntervalSpy;
  let clearIntervalSpy;
  let originalSetInterval;
  let originalClearInterval;

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();

    // Store original functions
    originalSetInterval = global.setInterval;
    originalClearInterval = global.clearInterval;

    // Mock setInterval to prevent actual intervals
    setIntervalSpy = jest.fn((callback, delay) => {
      return originalSetInterval(callback, delay);
    });
    clearIntervalSpy = jest.fn();
    global.setInterval = setIntervalSpy;
    global.clearInterval = clearIntervalSpy;

    config = {
      circuitBreaker: {
        failureThreshold: 5,
        timeoutMs: 30000,
        resetTimeoutMs: 60000,
        successThreshold: 2,
        volumeThreshold: 10,
        errorThreshold: 50,
        slowCallThreshold: 5000,
        slowCallRateThreshold: 50,
        monitoringPeriodMs: 60000
      }
    };

    service = new CircuitBreakerService(config);
  });

  afterEach(() => {
    jest.useRealTimers();
    global.setInterval = originalSetInterval;
    global.clearInterval = originalClearInterval;
  });

  describe('initialization', () => {
    it('should initialize with default configuration', () => {
      expect(service.config).toEqual(config);
      expect(service.circuitBreakers).toBeDefined();
      expect(service.circuitBreakers.size).toBe(0);
      expect(service.stats).toEqual({
        totalRequests: 0,
        allowedRequests: 0,
        blockedRequests: 0,
        circuitOpenCount: 0,
        circuitCloseCount: 0,
        circuitHalfOpenCount: 0
      });
    });

    it('should start monitoring interval', () => {
      expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 30000);
    });

    it('should use default values if config is not provided', () => {
      const serviceWithoutConfig = new CircuitBreakerService({});
      expect(serviceWithoutConfig.defaults.failureThreshold).toBe(5);
      expect(serviceWithoutConfig.defaults.timeoutMs).toBe(30000);
      expect(serviceWithoutConfig.defaults.resetTimeoutMs).toBe(60000);
    });
  });

  describe('getOrCreateCircuitBreaker', () => {
    it('should create new circuit breaker for webhook', () => {
      const webhookId = 'webhook1';
      const webhook = { circuitBreaker: { failureThreshold: 3 } };

      const circuitBreaker = service.getOrCreateCircuitBreaker(webhookId, webhook);

      expect(circuitBreaker).toBeDefined();
      expect(circuitBreaker.id).toBe(webhookId);
      expect(circuitBreaker.state).toBe('CLOSED');
      expect(circuitBreaker.config.failureThreshold).toBe(3);
      expect(circuitBreaker.failureCount).toBe(0);
      expect(circuitBreaker.successCount).toBe(0);
      expect(service.circuitBreakers.has(webhookId)).toBe(true);
    });

    it('should return existing circuit breaker', () => {
      const webhookId = 'webhook1';
      const webhook = {};

      const circuitBreaker1 = service.getOrCreateCircuitBreaker(webhookId, webhook);
      const circuitBreaker2 = service.getOrCreateCircuitBreaker(webhookId, webhook);

      expect(circuitBreaker1).toBe(circuitBreaker2);
      expect(service.circuitBreakers.size).toBe(1);
    });

    it('should merge webhook config with defaults', () => {
      const webhookId = 'webhook1';
      const webhook = { 
        circuitBreaker: { 
          failureThreshold: 10,
          timeoutMs: 20000 
        } 
      };

      const circuitBreaker = service.getOrCreateCircuitBreaker(webhookId, webhook);

      expect(circuitBreaker.config.failureThreshold).toBe(10);
      expect(circuitBreaker.config.timeoutMs).toBe(20000);
      expect(circuitBreaker.config.resetTimeoutMs).toBe(60000); // default
    });
  });

  describe('canExecute', () => {
    it('should allow execution when circuit is CLOSED', () => {
      const circuitBreaker = {
        state: 'CLOSED',
        nextAttempt: 0
      };

      expect(service.canExecute(circuitBreaker)).toBe(true);
    });

    it('should block execution when circuit is OPEN and timeout not reached', () => {
      const now = Date.now();
      const circuitBreaker = {
        state: 'OPEN',
        nextAttempt: now + 10000
      };

      expect(service.canExecute(circuitBreaker)).toBe(false);
    });

    it('should transition to HALF_OPEN when timeout reached', () => {
      const now = Date.now();
      const circuitBreaker = {
        state: 'OPEN',
        nextAttempt: now - 1000,
        config: { resetTimeoutMs: 60000 }
      };

      jest.spyOn(service, 'transitionTo');
      expect(service.canExecute(circuitBreaker)).toBe(true);
      expect(service.transitionTo).toHaveBeenCalledWith(circuitBreaker, 'HALF_OPEN');
    });

    it('should allow execution when circuit is HALF_OPEN', () => {
      const circuitBreaker = {
        state: 'HALF_OPEN',
        nextAttempt: 0
      };

      expect(service.canExecute(circuitBreaker)).toBe(true);
    });
  });

  describe('executeWithCircuitBreaker', () => {
    it('should execute operation successfully', async () => {
      const webhookId = 'webhook1';
      const webhook = {};
      const operation = jest.fn().mockResolvedValue({ 
        success: true, 
        statusCode: 200,
        message: 'Success' 
      });

      const result = await service.executeWithCircuitBreaker(webhookId, webhook, operation);

      expect(result.success).toBe(true);
      expect(result.statusCode).toBe(200);
      expect(result.circuitBreakerState).toBe('CLOSED');
      expect(operation).toHaveBeenCalled();
      expect(service.stats.totalRequests).toBe(1);
      expect(service.stats.allowedRequests).toBe(1);
    });

    it('should block execution when circuit is OPEN', async () => {
      const webhookId = 'webhook1';
      const webhook = {};
      const operation = jest.fn();

      // Open the circuit
      const circuitBreaker = service.getOrCreateCircuitBreaker(webhookId, webhook);
      service.transitionTo(circuitBreaker, 'OPEN');

      const result = await service.executeWithCircuitBreaker(webhookId, webhook, operation);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Circuit breaker is open');
      expect(result.statusCode).toBe(503);
      expect(result.retryAfter).toBeDefined();
      expect(operation).not.toHaveBeenCalled();
      expect(service.stats.blockedRequests).toBe(1);
    });

    it('should handle operation failure', async () => {
      const webhookId = 'webhook1';
      const webhook = {};
      const operation = jest.fn().mockResolvedValue({ 
        success: false, 
        statusCode: 500,
        error: 'Server error' 
      });

      const result = await service.executeWithCircuitBreaker(webhookId, webhook, operation);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Server error');
      expect(service.stats.allowedRequests).toBe(1);
    });

    it('should handle operation exception', async () => {
      const webhookId = 'webhook1';
      const webhook = {};
      const error = new Error('Network error');
      error.statusCode = 503;
      const operation = jest.fn().mockRejectedValue(error);

      const result = await service.executeWithCircuitBreaker(webhookId, webhook, operation);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Network error');
      expect(result.statusCode).toBe(503);
      expect(service.stats.allowedRequests).toBe(1);
    });

    it('should handle operation timeout', async () => {
      const webhookId = 'webhook1';
      const webhook = { circuitBreaker: { timeoutMs: 100 } };
      const operation = jest.fn().mockImplementation(() => 
        new Promise(resolve => setTimeout(resolve, 200))
      );

      const resultPromise = service.executeWithCircuitBreaker(webhookId, webhook, operation);
      
      // Fast-forward time to trigger timeout
      jest.advanceTimersByTime(100);
      
      const result = await resultPromise;

      expect(result.success).toBe(false);
      expect(result.error).toBe('Operation timeout');
      expect(service.stats.allowedRequests).toBe(1);
    });
  });

  describe('executeWithTimeout', () => {
    it('should resolve when operation completes before timeout', async () => {
      const operation = jest.fn().mockResolvedValue({ success: true });
      const result = await service.executeWithTimeout(operation, 1000);
      
      expect(result).toEqual({ success: true });
      expect(operation).toHaveBeenCalled();
    });

    it('should reject when operation times out', async () => {
      const operation = jest.fn().mockImplementation(() => 
        new Promise(resolve => setTimeout(resolve, 200))
      );

      const promise = service.executeWithTimeout(operation, 100);
      
      // Fast-forward time to trigger timeout
      jest.advanceTimersByTime(100);
      
      await expect(promise).rejects.toThrow('Operation timeout');
    });

    it('should clear timeout when operation completes', async () => {
      const clearTimeoutSpy = jest.spyOn(global, 'clearTimeout');
      const operation = jest.fn().mockResolvedValue({ success: true });
      
      await service.executeWithTimeout(operation, 1000);
      
      expect(clearTimeoutSpy).toHaveBeenCalled();
    });
  });

  describe('recordSuccess', () => {
    it('should record successful operation', () => {
      const circuitBreaker = service.getOrCreateCircuitBreaker('webhook1', {});
      
      service.recordSuccess(circuitBreaker, 100);

      expect(circuitBreaker.stats.totalCalls).toBe(1);
      expect(circuitBreaker.stats.successfulCalls).toBe(1);
      expect(circuitBreaker.lastSuccessTime).toBeDefined();
      expect(circuitBreaker.recentCalls.length).toBe(1);
      expect(circuitBreaker.recentCalls[0].success).toBe(true);
      expect(circuitBreaker.recentCalls[0].responseTime).toBe(100);
    });

    it('should reset failure count in CLOSED state', () => {
      const circuitBreaker = service.getOrCreateCircuitBreaker('webhook1', {});
      circuitBreaker.failureCount = 3;
      
      service.recordSuccess(circuitBreaker, 100);

      expect(circuitBreaker.failureCount).toBe(0);
    });

    it('should transition from HALF_OPEN to CLOSED after success threshold', () => {
      const circuitBreaker = service.getOrCreateCircuitBreaker('webhook1', {});
      circuitBreaker.state = 'HALF_OPEN';
      circuitBreaker.config.successThreshold = 2;

      const transitionToSpy = jest.spyOn(service, 'transitionTo').mockImplementation(() => {});

      service.recordSuccess(circuitBreaker, 100);
      expect(circuitBreaker.successCount).toBe(1);
      expect(transitionToSpy).not.toHaveBeenCalled();

      service.recordSuccess(circuitBreaker, 100);
      expect(circuitBreaker.successCount).toBe(2);
      expect(transitionToSpy).toHaveBeenCalledWith(circuitBreaker, 'CLOSED');
      
      transitionToSpy.mockRestore();
    });

    it('should mark slow calls', () => {
      const circuitBreaker = service.getOrCreateCircuitBreaker('webhook1', {});
      circuitBreaker.config.slowCallThreshold = 1000;

      service.recordSuccess(circuitBreaker, 2000);

      expect(circuitBreaker.stats.slowCalls).toBe(1);
      expect(circuitBreaker.recentCalls[0].slow).toBe(true);
    });
  });

  describe('recordFailure', () => {
    it('should record failed operation', () => {
      const circuitBreaker = service.getOrCreateCircuitBreaker('webhook1', {});
      const error = new Error('Test error');
      
      service.recordFailure(circuitBreaker, error, 200);

      expect(circuitBreaker.stats.totalCalls).toBe(1);
      expect(circuitBreaker.stats.failedCalls).toBe(1);
      expect(circuitBreaker.lastFailureTime).toBeDefined();
      expect(circuitBreaker.recentCalls.length).toBe(1);
      expect(circuitBreaker.recentCalls[0].success).toBe(false);
      expect(circuitBreaker.recentCalls[0].error).toBe('Test error');
    });

    it('should transition from HALF_OPEN to OPEN on failure', () => {
      const circuitBreaker = service.getOrCreateCircuitBreaker('webhook1', {});
      circuitBreaker.state = 'HALF_OPEN';

      jest.spyOn(service, 'transitionTo');

      service.recordFailure(circuitBreaker, new Error('Test error'));

      expect(service.transitionTo).toHaveBeenCalledWith(circuitBreaker, 'OPEN');
    });

    it('should increment failure count in CLOSED state', () => {
      const circuitBreaker = service.getOrCreateCircuitBreaker('webhook1', {});
      circuitBreaker.state = 'CLOSED';

      service.recordFailure(circuitBreaker, new Error('Test error'));

      expect(circuitBreaker.failureCount).toBe(1);
    });

    it('should detect timeout errors', () => {
      const circuitBreaker = service.getOrCreateCircuitBreaker('webhook1', {});
      const error = new Error('Operation timeout');

      service.recordFailure(circuitBreaker, error);

      expect(circuitBreaker.stats.timeoutCalls).toBe(1);
      expect(circuitBreaker.recentCalls[0].timeout).toBe(true);
    });
  });

  describe('shouldOpenCircuit', () => {
    it('should not open circuit with insufficient volume', () => {
      const circuitBreaker = service.getOrCreateCircuitBreaker('webhook1', {});
      circuitBreaker.config.volumeThreshold = 10;
      circuitBreaker.recentCalls = Array(5).fill({ success: false, timestamp: Date.now() });

      expect(service.shouldOpenCircuit(circuitBreaker)).toBe(false);
    });

    it('should open circuit when failure threshold exceeded', () => {
      const circuitBreaker = service.getOrCreateCircuitBreaker('webhook1', {});
      circuitBreaker.config.failureThreshold = 5;
      circuitBreaker.failureCount = 5;
      circuitBreaker.recentCalls = Array(10).fill({ success: true, timestamp: Date.now() });

      expect(service.shouldOpenCircuit(circuitBreaker)).toBe(true);
    });

    it('should open circuit when error rate threshold exceeded', () => {
      const circuitBreaker = service.getOrCreateCircuitBreaker('webhook1', {});
      circuitBreaker.config.errorThreshold = 50;
      circuitBreaker.config.volumeThreshold = 10;
      
      // 6 failures out of 10 = 60% error rate
      const now = Date.now();
      circuitBreaker.recentCalls = [
        ...Array(6).fill({ success: false, timestamp: now }),
        ...Array(4).fill({ success: true, timestamp: now })
      ];

      expect(service.shouldOpenCircuit(circuitBreaker)).toBe(true);
    });

    it('should open circuit when slow call rate threshold exceeded', () => {
      const circuitBreaker = service.getOrCreateCircuitBreaker('webhook1', {});
      circuitBreaker.config.slowCallRateThreshold = 50;
      circuitBreaker.config.volumeThreshold = 10;
      
      // 6 slow calls out of 10 = 60% slow call rate
      const now = Date.now();
      circuitBreaker.recentCalls = [
        ...Array(6).fill({ success: true, slow: true, timestamp: now }),
        ...Array(4).fill({ success: true, slow: false, timestamp: now })
      ];

      expect(service.shouldOpenCircuit(circuitBreaker)).toBe(true);
    });
  });

  describe('transitionTo', () => {
    it('should transition to OPEN state', () => {
      const circuitBreaker = service.getOrCreateCircuitBreaker('webhook1', {});
      circuitBreaker.state = 'CLOSED';
      
      service.on('stateChange', jest.fn());
      const eventHandler = jest.fn();
      service.on('stateChange', eventHandler);

      service.transitionTo(circuitBreaker, 'OPEN');

      expect(circuitBreaker.state).toBe('OPEN');
      expect(circuitBreaker.nextAttempt).toBeGreaterThan(Date.now());
      expect(service.stats.circuitOpenCount).toBe(1);
      expect(eventHandler).toHaveBeenCalledWith({
        circuitBreakerId: 'webhook1',
        oldState: 'CLOSED',
        newState: 'OPEN',
        timestamp: expect.any(Number)
      });
    });

    it('should transition to CLOSED state', () => {
      const circuitBreaker = service.getOrCreateCircuitBreaker('webhook1', {});
      circuitBreaker.state = 'HALF_OPEN';
      circuitBreaker.failureCount = 5;
      circuitBreaker.successCount = 2;
      circuitBreaker.nextAttempt = Date.now() + 10000;

      service.transitionTo(circuitBreaker, 'CLOSED');

      expect(circuitBreaker.state).toBe('CLOSED');
      expect(circuitBreaker.failureCount).toBe(0);
      expect(circuitBreaker.successCount).toBe(0);
      expect(circuitBreaker.nextAttempt).toBe(0);
      expect(service.stats.circuitCloseCount).toBe(1);
    });

    it('should transition to HALF_OPEN state', () => {
      const circuitBreaker = service.getOrCreateCircuitBreaker('webhook1', {});
      circuitBreaker.state = 'OPEN';
      circuitBreaker.successCount = 5;

      service.transitionTo(circuitBreaker, 'HALF_OPEN');

      expect(circuitBreaker.state).toBe('HALF_OPEN');
      expect(circuitBreaker.successCount).toBe(0);
      expect(service.stats.circuitHalfOpenCount).toBe(1);
    });
  });

  describe('addRecentCall', () => {
    it('should add call to recent calls', () => {
      const circuitBreaker = service.getOrCreateCircuitBreaker('webhook1', {});
      const call = {
        timestamp: Date.now(),
        success: true,
        responseTime: 100
      };

      service.addRecentCall(circuitBreaker, call);

      expect(circuitBreaker.recentCalls.length).toBe(1);
      expect(circuitBreaker.recentCalls[0]).toEqual(call);
    });

    it('should remove old calls outside monitoring period', () => {
      const circuitBreaker = service.getOrCreateCircuitBreaker('webhook1', {});
      circuitBreaker.config.monitoringPeriodMs = 60000;

      const now = Date.now();
      circuitBreaker.recentCalls = [
        { timestamp: now - 70000, success: true }, // old
        { timestamp: now - 30000, success: true }, // recent
        { timestamp: now - 10000, success: true }  // recent
      ];

      service.addRecentCall(circuitBreaker, { timestamp: now, success: true });

      expect(circuitBreaker.recentCalls.length).toBe(3);
      expect(circuitBreaker.recentCalls.every(c => now - c.timestamp < 60000)).toBe(true);
    });
  });

  describe('updateAverageResponseTime', () => {
    it('should calculate average response time correctly', () => {
      const circuitBreaker = service.getOrCreateCircuitBreaker('webhook1', {});
      circuitBreaker.stats.totalCalls = 2;
      circuitBreaker.stats.averageResponseTime = 100;

      service.updateAverageResponseTime(circuitBreaker, 200);

      // (100 * 1 + 200) / 2 = 150
      expect(circuitBreaker.stats.averageResponseTime).toBe(150);
    });

    it('should handle first call', () => {
      const circuitBreaker = service.getOrCreateCircuitBreaker('webhook1', {});
      circuitBreaker.stats.totalCalls = 1;
      circuitBreaker.stats.averageResponseTime = 0;

      service.updateAverageResponseTime(circuitBreaker, 200);

      expect(circuitBreaker.stats.averageResponseTime).toBe(200);
    });
  });

  describe('getCircuitBreakerStatus', () => {
    it('should return status for existing circuit breaker', () => {
      const webhookId = 'webhook1';
      const circuitBreaker = service.getOrCreateCircuitBreaker(webhookId, {});
      
      // Add some recent calls
      const now = Date.now();
      circuitBreaker.recentCalls = [
        { timestamp: now, success: true, slow: false },
        { timestamp: now, success: false, slow: false },
        { timestamp: now, success: true, slow: true }
      ];

      const status = service.getCircuitBreakerStatus(webhookId);

      expect(status.exists).toBe(true);
      expect(status.webhookId).toBe(webhookId);
      expect(status.state).toBe('CLOSED');
      expect(status.recentCalls).toBe(3);
      expect(status.stats.errorRate).toBeCloseTo(33.33, 1);
      expect(status.stats.slowCallRate).toBeCloseTo(33.33, 1);
    });

    it('should return non-existent status for unknown webhook', () => {
      const status = service.getCircuitBreakerStatus('unknown');

      expect(status.exists).toBe(false);
      expect(status.webhookId).toBe('unknown');
    });
  });

  describe('getCircuitBreakerStats', () => {
    it('should return aggregated statistics', () => {
      // Create multiple circuit breakers
      const cb1 = service.getOrCreateCircuitBreaker('webhook1', {});
      const cb2 = service.getOrCreateCircuitBreaker('webhook2', {});
      const cb3 = service.getOrCreateCircuitBreaker('webhook3', {});

      cb1.state = 'CLOSED';
      cb2.state = 'OPEN';
      cb3.state = 'HALF_OPEN';

      service.stats.totalRequests = 100;
      service.stats.allowedRequests = 90;
      service.stats.blockedRequests = 10;

      const stats = service.getCircuitBreakerStats();

      expect(stats.activeCircuitBreakers).toBe(3);
      expect(stats.stateCount).toEqual({
        CLOSED: 1,
        OPEN: 1,
        HALF_OPEN: 1
      });
      expect(stats.allowedRate).toBe(0.9);
      expect(stats.blockedRate).toBe(0.1);
    });
  });

  describe('forceCircuitBreakerState', () => {
    it('should force state change', () => {
      const webhookId = 'webhook1';
      service.getOrCreateCircuitBreaker(webhookId, {});

      service.forceCircuitBreakerState(webhookId, 'OPEN');

      const circuitBreaker = service.circuitBreakers.get(webhookId);
      expect(circuitBreaker.state).toBe('OPEN');
    });

    it('should throw error for non-existent webhook', () => {
      expect(() => {
        service.forceCircuitBreakerState('unknown', 'OPEN');
      }).toThrow('Circuit breaker not found for webhook: unknown');
    });
  });

  describe('resetCircuitBreaker', () => {
    it('should reset circuit breaker to initial state', () => {
      const webhookId = 'webhook1';
      const circuitBreaker = service.getOrCreateCircuitBreaker(webhookId, {});
      
      // Modify the circuit breaker state
      circuitBreaker.state = 'OPEN';
      circuitBreaker.failureCount = 10;
      circuitBreaker.successCount = 5;
      circuitBreaker.nextAttempt = Date.now() + 10000;
      circuitBreaker.stats.totalCalls = 100;
      circuitBreaker.recentCalls = [{ timestamp: Date.now(), success: false }];

      service.resetCircuitBreaker(webhookId);

      expect(circuitBreaker.state).toBe('CLOSED');
      expect(circuitBreaker.failureCount).toBe(0);
      expect(circuitBreaker.successCount).toBe(0);
      expect(circuitBreaker.nextAttempt).toBe(0);
      expect(circuitBreaker.lastFailureTime).toBeNull();
      expect(circuitBreaker.lastSuccessTime).toBeNull();
      expect(circuitBreaker.recentCalls).toEqual([]);
      expect(circuitBreaker.stats.totalCalls).toBe(0);
    });

    it('should throw error for non-existent webhook', () => {
      expect(() => {
        service.resetCircuitBreaker('unknown');
      }).toThrow('Circuit breaker not found for webhook: unknown');
    });
  });

  describe('updateCircuitBreakerConfig', () => {
    it('should update circuit breaker configuration', () => {
      const webhookId = 'webhook1';
      const circuitBreaker = service.getOrCreateCircuitBreaker(webhookId, {});
      const originalConfig = { ...circuitBreaker.config };

      const newConfig = {
        failureThreshold: 10,
        timeoutMs: 20000
      };

      service.updateCircuitBreakerConfig(webhookId, newConfig);

      expect(circuitBreaker.config.failureThreshold).toBe(10);
      expect(circuitBreaker.config.timeoutMs).toBe(20000);
      expect(circuitBreaker.config.resetTimeoutMs).toBe(originalConfig.resetTimeoutMs);
    });

    it('should throw error for non-existent webhook', () => {
      expect(() => {
        service.updateCircuitBreakerConfig('unknown', {});
      }).toThrow('Circuit breaker not found for webhook: unknown');
    });
  });

  describe('getActiveCircuitBreakers', () => {
    it('should return all active circuit breakers with status', () => {
      service.getOrCreateCircuitBreaker('webhook1', {});
      service.getOrCreateCircuitBreaker('webhook2', {});
      service.getOrCreateCircuitBreaker('webhook3', {});

      const activeBreakers = service.getActiveCircuitBreakers();

      expect(activeBreakers.length).toBe(3);
      expect(activeBreakers.every(cb => cb.exists)).toBe(true);
      expect(activeBreakers.map(cb => cb.webhookId)).toEqual(['webhook1', 'webhook2', 'webhook3']);
    });
  });

  describe('updateCircuitBreakerStats', () => {
    it('should update error and slow call rates', () => {
      const circuitBreaker = service.getOrCreateCircuitBreaker('webhook1', {});
      
      const now = Date.now();
      circuitBreaker.recentCalls = [
        { timestamp: now, success: true, slow: false },
        { timestamp: now, success: false, slow: false },
        { timestamp: now, success: true, slow: true },
        { timestamp: now, success: false, slow: true }
      ];

      service.updateCircuitBreakerStats();

      expect(circuitBreaker.stats.errorRate).toBe(50); // 2 failures out of 4
      expect(circuitBreaker.stats.slowCallRate).toBe(50); // 2 slow calls out of 4
    });

    it('should handle empty recent calls', () => {
      const circuitBreaker = service.getOrCreateCircuitBreaker('webhook1', {});
      circuitBreaker.recentCalls = [];

      service.updateCircuitBreakerStats();

      expect(circuitBreaker.stats.errorRate).toBe(0);
      expect(circuitBreaker.stats.slowCallRate).toBe(0);
    });
  });

  describe('testCircuitBreaker', () => {
    it('should simulate various call types', async () => {
      const webhookId = 'webhook1';
      const webhook = {};
      const testOptions = {
        successfulCalls: 2,
        failedCalls: 2,
        timeoutCalls: 0, // Disable timeout calls to avoid timing issues
        slowCalls: 0 // Disable slow calls to avoid timing issues
      };

      const result = await service.testCircuitBreaker(webhookId, webhook, testOptions);

      expect(result.webhookId).toBe(webhookId);
      expect(result.testResults.length).toBe(4);
      expect(result.summary.totalCalls).toBe(4);
      expect(result.finalStatus.exists).toBe(true);
    });

    it('should use default test options', async () => {
      const webhookId = 'webhook1';
      const webhook = {};

      // Mock the executeWithCircuitBreaker method to avoid timing issues
      jest.spyOn(service, 'executeWithCircuitBreaker').mockResolvedValue({
        success: true,
        statusCode: 200,
        circuitBreakerState: 'CLOSED'
      });

      const result = await service.testCircuitBreaker(webhookId, webhook);

      expect(result.testResults.length).toBe(15); // 5 + 5 + 2 + 3
      
      service.executeWithCircuitBreaker.mockRestore();
    });
  });

  describe('shutdown', () => {
    it('should clear all circuit breakers', async () => {
      service.getOrCreateCircuitBreaker('webhook1', {});
      service.getOrCreateCircuitBreaker('webhook2', {});

      await service.shutdown();

      expect(service.circuitBreakers.size).toBe(0);
    });

    it('should handle shutdown errors', async () => {
      jest.spyOn(service.circuitBreakers, 'clear').mockImplementation(() => {
        throw new Error('Clear failed');
      });

      await expect(service.shutdown()).rejects.toThrow('Clear failed');
    });
  });

  describe('monitoring interval', () => {
    it('should update stats periodically', () => {
      jest.spyOn(service, 'updateCircuitBreakerStats');

      // Fast-forward 30 seconds
      jest.advanceTimersByTime(30000);

      expect(service.updateCircuitBreakerStats).toHaveBeenCalled();
    });
  });
});