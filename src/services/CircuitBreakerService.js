/**
 * Circuit Breaker Service for Huly Webhook Service
 * Implements circuit breaker pattern for webhook endpoints
 */

const EventEmitter = require('events');
const logger = require('../utils/logger');

class CircuitBreakerService extends EventEmitter {
  constructor (config) {
    super();
    this.config = config;
    this.circuitBreakers = new Map();
    this.stats = {
      totalRequests: 0,
      allowedRequests: 0,
      blockedRequests: 0,
      circuitOpenCount: 0,
      circuitCloseCount: 0,
      circuitHalfOpenCount: 0
    };

    // Default circuit breaker configuration
    this.defaults = {
      failureThreshold: config.circuitBreaker?.failureThreshold || 5,
      timeoutMs: config.circuitBreaker?.timeoutMs || 30000,
      resetTimeoutMs: config.circuitBreaker?.resetTimeoutMs || 60000,
      successThreshold: config.circuitBreaker?.successThreshold || 2,
      volumeThreshold: config.circuitBreaker?.volumeThreshold || 10,
      errorThreshold: config.circuitBreaker?.errorThreshold || 50, // percentage
      slowCallThreshold: config.circuitBreaker?.slowCallThreshold || 5000,
      slowCallRateThreshold: config.circuitBreaker?.slowCallRateThreshold || 50, // percentage
      monitoringPeriodMs: config.circuitBreaker?.monitoringPeriodMs || 60000
    };

    this.initialize();
  }

  /**
   * Initialize circuit breaker service
   */
  initialize () {
    logger.info('Initializing Circuit Breaker Service...');

    // Start monitoring interval
    this.startMonitoringInterval();

    logger.info('Circuit Breaker Service initialized successfully');
  }

  /**
   * Execute webhook call with circuit breaker protection
   * @param {string} webhookId - Webhook ID
   * @param {Object} webhook - Webhook configuration
   * @param {Function} operation - Operation to execute
   * @returns {Object} - Execution result
   */
  async executeWithCircuitBreaker (webhookId, webhook, operation) {
    const circuitBreaker = this.getOrCreateCircuitBreaker(webhookId, webhook);

    this.stats.totalRequests++;

    try {
      // Check circuit breaker state
      const canExecute = this.canExecute(circuitBreaker);

      if (!canExecute) {
        this.stats.blockedRequests++;
        this.recordFailure(circuitBreaker, new Error('Circuit breaker is OPEN'));

        return {
          success: false,
          error: 'Circuit breaker is open',
          circuitBreakerState: circuitBreaker.state,
          statusCode: 503,
          retryAfter: Math.ceil(circuitBreaker.nextAttempt - Date.now()) / 1000
        };
      }

      // Execute operation with timeout
      const startTime = Date.now();
      const result = await this.executeWithTimeout(operation, circuitBreaker.config.timeoutMs);
      const responseTime = Date.now() - startTime;

      // Record success or failure
      if (result.success) {
        this.recordSuccess(circuitBreaker, responseTime);
        this.stats.allowedRequests++;
      } else {
        this.recordFailure(circuitBreaker, new Error(result.error || 'Operation failed'), responseTime);
        this.stats.allowedRequests++; // Still counted as allowed, just failed
      }

      return {
        ...result,
        circuitBreakerState: circuitBreaker.state,
        responseTime
      };
    } catch (error) {
      this.recordFailure(circuitBreaker, error);
      this.stats.allowedRequests++; // Still counted as allowed, just failed

      return {
        success: false,
        error: error.message,
        circuitBreakerState: circuitBreaker.state,
        statusCode: error.statusCode || 500
      };
    }
  }

  /**
   * Get or create circuit breaker for webhook
   * @param {string} webhookId - Webhook ID
   * @param {Object} webhook - Webhook configuration
   * @returns {Object} - Circuit breaker instance
   */
  getOrCreateCircuitBreaker (webhookId, webhook) {
    let circuitBreaker = this.circuitBreakers.get(webhookId);

    if (!circuitBreaker) {
      const config = {
        ...this.defaults,
        ...webhook.circuitBreaker
      };

      circuitBreaker = {
        id: webhookId,
        state: 'CLOSED',
        config,
        failureCount: 0,
        successCount: 0,
        nextAttempt: 0,
        lastFailureTime: null,
        lastSuccessTime: null,
        recentCalls: [],
        stats: {
          totalCalls: 0,
          successfulCalls: 0,
          failedCalls: 0,
          timeoutCalls: 0,
          slowCalls: 0,
          averageResponseTime: 0,
          errorRate: 0,
          slowCallRate: 0
        },
        createdAt: Date.now()
      };

      this.circuitBreakers.set(webhookId, circuitBreaker);

      logger.debug(`Created circuit breaker for webhook ${webhookId}`, config);
    }

    return circuitBreaker;
  }

  /**
   * Check if operation can be executed
   * @param {Object} circuitBreaker - Circuit breaker instance
   * @returns {boolean} - Whether operation can be executed
   */
  canExecute (circuitBreaker) {
    const now = Date.now();

    switch (circuitBreaker.state) {
    case 'CLOSED':
      return true;

    case 'OPEN':
      // Check if reset timeout has passed
      if (now >= circuitBreaker.nextAttempt) {
        this.transitionTo(circuitBreaker, 'HALF_OPEN');
        return true;
      }
      return false;

    case 'HALF_OPEN':
      return true;

    default:
      return false;
    }
  }

  /**
   * Execute operation with timeout
   * @param {Function} operation - Operation to execute
   * @param {number} timeoutMs - Timeout in milliseconds
   * @returns {Promise} - Operation result
   */
  async executeWithTimeout (operation, timeoutMs) {
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        reject(new Error('Operation timeout'));
      }, timeoutMs);

      operation()
        .then(result => {
          clearTimeout(timeoutId);
          resolve(result);
        })
        .catch(error => {
          clearTimeout(timeoutId);
          reject(error);
        });
    });
  }

  /**
   * Record successful operation
   * @param {Object} circuitBreaker - Circuit breaker instance
   * @param {number} responseTime - Response time in milliseconds
   */
  recordSuccess (circuitBreaker, responseTime) {
    const now = Date.now();

    // Add to recent calls
    this.addRecentCall(circuitBreaker, {
      timestamp: now,
      success: true,
      responseTime,
      slow: responseTime > circuitBreaker.config.slowCallThreshold
    });

    // Update stats
    circuitBreaker.stats.totalCalls++;
    circuitBreaker.stats.successfulCalls++;
    circuitBreaker.lastSuccessTime = now;

    if (responseTime > circuitBreaker.config.slowCallThreshold) {
      circuitBreaker.stats.slowCalls++;
    }

    this.updateAverageResponseTime(circuitBreaker, responseTime);

    // Handle state transitions
    if (circuitBreaker.state === 'HALF_OPEN') {
      circuitBreaker.successCount++;

      if (circuitBreaker.successCount >= circuitBreaker.config.successThreshold) {
        this.transitionTo(circuitBreaker, 'CLOSED');
      }
    } else if (circuitBreaker.state === 'CLOSED') {
      // Reset failure count on success
      circuitBreaker.failureCount = 0;
    }
  }

  /**
   * Record failed operation
   * @param {Object} circuitBreaker - Circuit breaker instance
   * @param {Error} error - Error that occurred
   * @param {number} responseTime - Response time in milliseconds
   */
  recordFailure (circuitBreaker, error, responseTime = 0) {
    const now = Date.now();
    const isTimeout = error.message.includes('timeout');

    // Add to recent calls
    this.addRecentCall(circuitBreaker, {
      timestamp: now,
      success: false,
      error: error.message,
      responseTime,
      timeout: isTimeout,
      slow: responseTime > circuitBreaker.config.slowCallThreshold
    });

    // Update stats
    circuitBreaker.stats.totalCalls++;
    circuitBreaker.stats.failedCalls++;
    circuitBreaker.lastFailureTime = now;

    if (isTimeout) {
      circuitBreaker.stats.timeoutCalls++;
    }

    if (responseTime > circuitBreaker.config.slowCallThreshold) {
      circuitBreaker.stats.slowCalls++;
    }

    if (responseTime > 0) {
      this.updateAverageResponseTime(circuitBreaker, responseTime);
    }

    // Handle state transitions
    if (circuitBreaker.state === 'HALF_OPEN') {
      this.transitionTo(circuitBreaker, 'OPEN');
    } else if (circuitBreaker.state === 'CLOSED') {
      circuitBreaker.failureCount++;

      if (this.shouldOpenCircuit(circuitBreaker)) {
        this.transitionTo(circuitBreaker, 'OPEN');
      }
    }
  }

  /**
   * Add recent call to circuit breaker history
   * @param {Object} circuitBreaker - Circuit breaker instance
   * @param {Object} call - Call details
   */
  addRecentCall (circuitBreaker, call) {
    circuitBreaker.recentCalls.push(call);

    // Keep only recent calls within monitoring period
    const cutoff = Date.now() - circuitBreaker.config.monitoringPeriodMs;
    circuitBreaker.recentCalls = circuitBreaker.recentCalls.filter(
      c => c.timestamp >= cutoff
    );
  }

  /**
   * Update average response time
   * @param {Object} circuitBreaker - Circuit breaker instance
   * @param {number} responseTime - Response time in milliseconds
   */
  updateAverageResponseTime (circuitBreaker, responseTime) {
    const totalCalls = circuitBreaker.stats.totalCalls;
    const currentAverage = circuitBreaker.stats.averageResponseTime;

    circuitBreaker.stats.averageResponseTime =
      (currentAverage * (totalCalls - 1) + responseTime) / totalCalls;
  }

  /**
   * Check if circuit should be opened
   * @param {Object} circuitBreaker - Circuit breaker instance
   * @returns {boolean} - Whether circuit should be opened
   */
  shouldOpenCircuit (circuitBreaker) {
    const config = circuitBreaker.config;
    const recentCalls = circuitBreaker.recentCalls;

    // Check if we have enough volume
    if (recentCalls.length < config.volumeThreshold) {
      return false;
    }

    // Check failure threshold
    if (circuitBreaker.failureCount >= config.failureThreshold) {
      return true;
    }

    // Check error rate
    const failedCalls = recentCalls.filter(c => !c.success).length;
    const errorRate = (failedCalls / recentCalls.length) * 100;

    if (errorRate >= config.errorThreshold) {
      return true;
    }

    // Check slow call rate
    const slowCalls = recentCalls.filter(c => c.slow).length;
    const slowCallRate = (slowCalls / recentCalls.length) * 100;

    if (slowCallRate >= config.slowCallRateThreshold) {
      return true;
    }

    return false;
  }

  /**
   * Transition circuit breaker to new state
   * @param {Object} circuitBreaker - Circuit breaker instance
   * @param {string} newState - New state (CLOSED, OPEN, HALF_OPEN)
   */
  transitionTo (circuitBreaker, newState) {
    const oldState = circuitBreaker.state;
    circuitBreaker.state = newState;

    logger.info(`Circuit breaker ${circuitBreaker.id} transitioned from ${oldState} to ${newState}`);

    // Update statistics
    switch (newState) {
    case 'OPEN':
      circuitBreaker.nextAttempt = Date.now() + circuitBreaker.config.resetTimeoutMs;
      this.stats.circuitOpenCount++;
      break;
    case 'CLOSED':
      circuitBreaker.failureCount = 0;
      circuitBreaker.successCount = 0;
      circuitBreaker.nextAttempt = 0;
      this.stats.circuitCloseCount++;
      break;
    case 'HALF_OPEN':
      circuitBreaker.successCount = 0;
      this.stats.circuitHalfOpenCount++;
      break;
    }

    // Emit state change event
    this.emit('stateChange', {
      circuitBreakerId: circuitBreaker.id,
      oldState,
      newState,
      timestamp: Date.now()
    });
  }

  /**
   * Get circuit breaker status
   * @param {string} webhookId - Webhook ID
   * @returns {Object} - Circuit breaker status
   */
  getCircuitBreakerStatus (webhookId) {
    const circuitBreaker = this.circuitBreakers.get(webhookId);

    if (!circuitBreaker) {
      return {
        exists: false,
        webhookId
      };
    }

    const recentCalls = circuitBreaker.recentCalls;
    // const successfulCalls = recentCalls.filter(c => c.success).length; // Not used in calculation
    const failedCalls = recentCalls.filter(c => !c.success).length;
    const slowCalls = recentCalls.filter(c => c.slow).length;

    const errorRate = recentCalls.length > 0 ? (failedCalls / recentCalls.length) * 100 : 0;
    const slowCallRate = recentCalls.length > 0 ? (slowCalls / recentCalls.length) * 100 : 0;

    return {
      exists: true,
      webhookId,
      state: circuitBreaker.state,
      config: circuitBreaker.config,
      failureCount: circuitBreaker.failureCount,
      successCount: circuitBreaker.successCount,
      nextAttempt: circuitBreaker.nextAttempt,
      lastFailureTime: circuitBreaker.lastFailureTime,
      lastSuccessTime: circuitBreaker.lastSuccessTime,
      recentCalls: recentCalls.length,
      stats: {
        ...circuitBreaker.stats,
        errorRate,
        slowCallRate
      },
      createdAt: circuitBreaker.createdAt
    };
  }

  /**
   * Get circuit breaker statistics
   * @returns {Object} - Circuit breaker statistics
   */
  getCircuitBreakerStats () {
    const activeCircuitBreakers = this.circuitBreakers.size;
    const stateCount = { CLOSED: 0, OPEN: 0, HALF_OPEN: 0 };

    for (const [, circuitBreaker] of this.circuitBreakers) {
      stateCount[circuitBreaker.state]++;
    }

    return {
      ...this.stats,
      activeCircuitBreakers,
      stateCount,
      allowedRate: this.stats.totalRequests > 0
        ? this.stats.allowedRequests / this.stats.totalRequests
        : 0,
      blockedRate: this.stats.totalRequests > 0
        ? this.stats.blockedRequests / this.stats.totalRequests
        : 0
    };
  }

  /**
   * Force circuit breaker state
   * @param {string} webhookId - Webhook ID
   * @param {string} state - New state (CLOSED, OPEN, HALF_OPEN)
   */
  forceCircuitBreakerState (webhookId, state) {
    const circuitBreaker = this.circuitBreakers.get(webhookId);

    if (!circuitBreaker) {
      throw new Error(`Circuit breaker not found for webhook: ${webhookId}`);
    }

    this.transitionTo(circuitBreaker, state);
    logger.info(`Forced circuit breaker ${webhookId} to state: ${state}`);
  }

  /**
   * Reset circuit breaker
   * @param {string} webhookId - Webhook ID
   */
  resetCircuitBreaker (webhookId) {
    const circuitBreaker = this.circuitBreakers.get(webhookId);

    if (!circuitBreaker) {
      throw new Error(`Circuit breaker not found for webhook: ${webhookId}`);
    }

    circuitBreaker.failureCount = 0;
    circuitBreaker.successCount = 0;
    circuitBreaker.nextAttempt = 0;
    circuitBreaker.lastFailureTime = null;
    circuitBreaker.lastSuccessTime = null;
    circuitBreaker.recentCalls = [];
    circuitBreaker.stats = {
      totalCalls: 0,
      successfulCalls: 0,
      failedCalls: 0,
      timeoutCalls: 0,
      slowCalls: 0,
      averageResponseTime: 0,
      errorRate: 0,
      slowCallRate: 0
    };

    this.transitionTo(circuitBreaker, 'CLOSED');
    logger.info(`Reset circuit breaker for webhook: ${webhookId}`);
  }

  /**
   * Update circuit breaker configuration
   * @param {string} webhookId - Webhook ID
   * @param {Object} newConfig - New configuration
   */
  updateCircuitBreakerConfig (webhookId, newConfig) {
    const circuitBreaker = this.circuitBreakers.get(webhookId);

    if (!circuitBreaker) {
      throw new Error(`Circuit breaker not found for webhook: ${webhookId}`);
    }

    circuitBreaker.config = { ...circuitBreaker.config, ...newConfig };
    logger.info(`Updated circuit breaker config for webhook ${webhookId}`, newConfig);
  }

  /**
   * Get all active circuit breakers
   * @returns {Array} - Active circuit breakers
   */
  getActiveCircuitBreakers () {
    const circuitBreakers = [];

    for (const [webhookId] of this.circuitBreakers) {
      const status = this.getCircuitBreakerStatus(webhookId);
      circuitBreakers.push(status);
    }

    return circuitBreakers;
  }

  /**
   * Start monitoring interval
   */
  startMonitoringInterval () {
    // Update statistics every 30 seconds
    setInterval(() => {
      this.updateCircuitBreakerStats();
    }, 30000);
  }

  /**
   * Update circuit breaker statistics
   */
  updateCircuitBreakerStats () {
    for (const [, circuitBreaker] of this.circuitBreakers) {
      const recentCalls = circuitBreaker.recentCalls;
      // const successfulCalls = recentCalls.filter(c => c.success).length; // Not used
      const failedCalls = recentCalls.filter(c => !c.success).length;
      const slowCalls = recentCalls.filter(c => c.slow).length;

      circuitBreaker.stats.errorRate = recentCalls.length > 0
        ? (failedCalls / recentCalls.length) * 100
        : 0;

      circuitBreaker.stats.slowCallRate = recentCalls.length > 0
        ? (slowCalls / recentCalls.length) * 100
        : 0;
    }
  }

  /**
   * Test circuit breaker
   * @param {string} webhookId - Webhook ID
   * @param {Object} webhook - Webhook configuration
   * @param {Object} testOptions - Test options
   * @returns {Object} - Test results
   */
  async testCircuitBreaker (webhookId, webhook, testOptions = {}) {
    const {
      successfulCalls = 5,
      failedCalls = 5,
      timeoutCalls = 2,
      slowCalls = 3
    } = testOptions;

    const results = [];
    // const circuitBreaker = this.getOrCreateCircuitBreaker(webhookId, webhook); // Not used

    // Simulate successful calls
    for (let i = 0; i < successfulCalls; i++) {
      const result = await this.executeWithCircuitBreaker(webhookId, webhook, async () => ({
        success: true,
        statusCode: 200,
        message: 'Success'
      }));
      results.push({ type: 'success', result });
    }

    // Simulate failed calls
    for (let i = 0; i < failedCalls; i++) {
      const result = await this.executeWithCircuitBreaker(webhookId, webhook, async () => ({
        success: false,
        statusCode: 500,
        error: 'Internal Server Error'
      }));
      results.push({ type: 'failure', result });
    }

    // Simulate timeout calls
    for (let i = 0; i < timeoutCalls; i++) {
      const result = await this.executeWithCircuitBreaker(webhookId, webhook, async () => {
        await new Promise(resolve => setTimeout(resolve, 35000)); // Longer than timeout
        return { success: true, statusCode: 200 };
      });
      results.push({ type: 'timeout', result });
    }

    // Simulate slow calls
    for (let i = 0; i < slowCalls; i++) {
      const result = await this.executeWithCircuitBreaker(webhookId, webhook, async () => {
        await new Promise(resolve => setTimeout(resolve, 6000)); // Slower than threshold
        return { success: true, statusCode: 200 };
      });
      results.push({ type: 'slow', result });
    }

    const finalStatus = this.getCircuitBreakerStatus(webhookId);

    return {
      webhookId,
      testResults: results,
      finalStatus,
      summary: {
        totalCalls: results.length,
        successfulCalls: results.filter(r => r.result.success).length,
        failedCalls: results.filter(r => !r.result.success).length,
        finalState: finalStatus.state
      }
    };
  }

  /**
   * Shutdown the service
   */
  async shutdown () {
    try {
      logger.info('Shutting down Circuit Breaker Service...');

      // Clear all circuit breakers
      this.circuitBreakers.clear();

      logger.info('Circuit Breaker Service shut down successfully');
    } catch (error) {
      logger.error('Error shutting down Circuit Breaker Service:', error);
      throw error;
    }
  }
}

module.exports = CircuitBreakerService;
