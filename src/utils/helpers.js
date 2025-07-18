/**
 * Helper utilities for webhook service
 */

const { v4: uuidv4 } = require('uuid');

class Helpers {
  /**
   * Generate a unique ID
   * @returns {string} A unique UUID
   */
  static generateId () {
    return uuidv4();
  }

  /**
   * Sleep for a specified duration
   * @param {number} ms - Milliseconds to sleep
   * @returns {Promise} Promise that resolves after the delay
   */
  static sleep (ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Retry a function with exponential backoff
   * @param {Function} fn - The function to retry
   * @param {object} options - Retry options
   * @returns {Promise} Promise that resolves with the result
   */
  static async retryWithBackoff (fn, options = {}) {
    const {
      maxAttempts = 3,
      baseDelay = 1000,
      maxDelay = 30000,
      backoffMultiplier = 2,
      jitter = true
    } = options;

    let lastError;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error;

        if (attempt === maxAttempts) {
          throw error;
        }

        // Calculate delay with exponential backoff
        let delay = Math.min(baseDelay * Math.pow(backoffMultiplier, attempt - 1), maxDelay);

        // Add jitter to prevent thundering herd
        if (jitter) {
          delay += Math.random() * 1000;
        }

        await this.sleep(delay);
      }
    }

    throw lastError;
  }

  /**
   * Deep clone an object
   * @param {any} obj - The object to clone
   * @returns {any} Deep cloned object
   */
  static deepClone (obj) {
    if (obj === null || typeof obj !== 'object') {
      return obj;
    }

    if (obj instanceof Date) {
      return new Date(obj.getTime());
    }

    if (obj instanceof Array) {
      return obj.map(item => this.deepClone(item));
    }

    if (typeof obj === 'object') {
      const cloned = {};
      for (const key in obj) {
        if (obj.hasOwnProperty(key)) {
          cloned[key] = this.deepClone(obj[key]);
        }
      }
      return cloned;
    }

    return obj;
  }

  /**
   * Format bytes into human readable format
   * @param {number} bytes - Number of bytes
   * @param {number} decimals - Number of decimal places
   * @returns {string} Formatted string
   */
  static formatBytes (bytes, decimals = 2) {
    if (bytes === 0) return '0 Bytes';

    const k = 1024;
    const dm = decimals < 0 ? 0 : decimals;
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB', 'ZB', 'YB'];

    const i = Math.floor(Math.log(bytes) / Math.log(k));

    return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
  }

  /**
   * Format duration into human readable format
   * @param {number} ms - Duration in milliseconds
   * @returns {string} Formatted duration
   */
  static formatDuration (ms) {
    if (ms < 1000) {
      return `${ms}ms`;
    }

    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) {
      return `${days}d ${hours % 24}h ${minutes % 60}m ${seconds % 60}s`;
    } else if (hours > 0) {
      return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    } else {
      return `${seconds}s`;
    }
  }

  /**
   * Truncate text with ellipsis
   * @param {string} text - Text to truncate
   * @param {number} maxLength - Maximum length
   * @returns {string} Truncated text
   */
  static truncate (text, maxLength = 100) {
    if (typeof text !== 'string') return '';
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength - 3) + '...';
  }

  /**
   * Parse JSON safely
   * @param {string} json - JSON string to parse
   * @param {any} defaultValue - Default value if parsing fails
   * @returns {any} Parsed object or default value
   */
  static parseJSON (json, defaultValue = null) {
    try {
      return JSON.parse(json);
    } catch {
      return defaultValue;
    }
  }

  /**
   * Stringify JSON safely
   * @param {any} obj - Object to stringify
   * @param {string} defaultValue - Default value if stringifying fails
   * @returns {string} JSON string or default value
   */
  static stringifyJSON (obj, defaultValue = '{}') {
    try {
      return JSON.stringify(obj);
    } catch {
      return defaultValue;
    }
  }

  /**
   * Check if object is empty
   * @param {any} obj - Object to check
   * @returns {boolean} True if empty
   */
  static isEmpty (obj) {
    if (obj == null) return true;
    if (typeof obj === 'string' || Array.isArray(obj)) return obj.length === 0;
    if (typeof obj === 'object') return Object.keys(obj).length === 0;
    return false;
  }

  /**
   * Get nested property from object
   * @param {object} obj - Object to get property from
   * @param {string} path - Property path (dot notation)
   * @param {any} defaultValue - Default value if property not found
   * @returns {any} Property value or default
   */
  static getNestedProperty (obj, path, defaultValue = undefined) {
    if (!obj || typeof obj !== 'object' || !path) {
      return defaultValue;
    }

    const keys = path.split('.');
    let current = obj;

    for (const key of keys) {
      if (current == null || typeof current !== 'object' || !(key in current)) {
        return defaultValue;
      }
      current = current[key];
    }

    return current;
  }

  /**
   * Set nested property in object
   * @param {object} obj - Object to set property in
   * @param {string} path - Property path (dot notation)
   * @param {any} value - Value to set
   * @returns {object} Modified object
   */
  static setNestedProperty (obj, path, value) {
    if (!obj || typeof obj !== 'object' || !path) {
      return obj;
    }

    const keys = path.split('.');
    let current = obj;

    for (let i = 0; i < keys.length - 1; i++) {
      const key = keys[i];
      if (!(key in current) || typeof current[key] !== 'object') {
        current[key] = {};
      }
      current = current[key];
    }

    current[keys[keys.length - 1]] = value;
    return obj;
  }

  /**
   * Remove undefined and null values from object
   * @param {object} obj - Object to clean
   * @returns {object} Cleaned object
   */
  static removeNullUndefined (obj) {
    if (obj === null || obj === undefined) return obj;
    if (typeof obj !== 'object') return obj;

    if (Array.isArray(obj)) {
      return obj.filter(item => item !== null && item !== undefined);
    }

    const cleaned = {};
    for (const [key, value] of Object.entries(obj)) {
      if (value !== null && value !== undefined) {
        cleaned[key] = typeof value === 'object' ? this.removeNullUndefined(value) : value;
      }
    }
    return cleaned;
  }

  /**
   * Merge objects deeply
   * @param {object} target - Target object
   * @param {...object} sources - Source objects
   * @returns {object} Merged object
   */
  static deepMerge (target, ...sources) {
    if (!sources.length) return target;
    const source = sources.shift();

    if (this.isObject(target) && this.isObject(source)) {
      for (const key in source) {
        if (this.isObject(source[key])) {
          if (!target[key]) Object.assign(target, { [key]: {} });
          this.deepMerge(target[key], source[key]);
        } else {
          Object.assign(target, { [key]: source[key] });
        }
      }
    }

    return this.deepMerge(target, ...sources);
  }

  /**
   * Check if value is an object
   * @param {any} item - Value to check
   * @returns {boolean} True if object
   */
  static isObject (item) {
    return item && typeof item === 'object' && !Array.isArray(item);
  }

  /**
   * Debounce function calls
   * @param {Function} func - Function to debounce
   * @param {number} wait - Wait time in milliseconds
   * @returns {Function} Debounced function
   */
  static debounce (func, wait) {
    let timeout;
    return function executedFunction (...args) {
      const later = () => {
        clearTimeout(timeout);
        func(...args);
      };
      clearTimeout(timeout);
      timeout = setTimeout(later, wait);
    };
  }

  /**
   * Throttle function calls
   * @param {Function} func - Function to throttle
   * @param {number} limit - Limit time in milliseconds
   * @returns {Function} Throttled function
   */
  static throttle (func, limit) {
    let inThrottle;
    return function executedFunction (...args) {
      if (!inThrottle) {
        func.apply(this, args);
        inThrottle = true;
        setTimeout(() => inThrottle = false, limit);
      }
    };
  }

  /**
   * Create a promise that resolves after timeout
   * @param {number} ms - Timeout in milliseconds
   * @returns {Promise} Promise that resolves after timeout
   */
  static timeout (ms) {
    return new Promise((resolve) => {
      setTimeout(resolve, ms);
    });
  }

  /**
   * Create a promise that rejects after timeout
   * @param {number} ms - Timeout in milliseconds
   * @param {string} message - Error message
   * @returns {Promise} Promise that rejects after timeout
   */
  static timeoutReject (ms, message = 'Operation timed out') {
    return new Promise((_, reject) => {
      setTimeout(() => reject(new Error(message)), ms);
    });
  }

  /**
   * Race a promise against a timeout
   * @param {Promise} promise - Promise to race
   * @param {number} ms - Timeout in milliseconds
   * @param {string} message - Timeout error message
   * @returns {Promise} Promise that resolves with result or rejects with timeout
   */
  static withTimeout (promise, ms, message = 'Operation timed out') {
    return Promise.race([
      promise,
      this.timeoutReject(ms, message)
    ]);
  }

  /**
   * Calculate percentage
   * @param {number} value - Value
   * @param {number} total - Total
   * @param {number} decimals - Decimal places
   * @returns {number} Percentage
   */
  static percentage (value, total, decimals = 2) {
    if (total === 0) return 0;
    return Number(((value / total) * 100).toFixed(decimals));
  }

  /**
   * Generate timestamp
   * @returns {string} ISO timestamp
   */
  static timestamp () {
    return new Date().toISOString();
  }

  /**
   * Check if date is valid
   * @param {any} date - Date to check
   * @returns {boolean} True if valid date
   */
  static isValidDate (date) {
    return date instanceof Date && !isNaN(date.getTime());
  }

  /**
   * Create array of specified length with values
   * @param {number} length - Array length
   * @param {any} value - Value to fill with
   * @returns {Array} Array with values
   */
  static createArray (length, value = null) {
    return new Array(length).fill(value);
  }

  /**
   * Get random item from array
   * @param {Array} array - Array to get item from
   * @returns {any} Random item
   */
  static randomItem (array) {
    if (!Array.isArray(array) || array.length === 0) return null;
    return array[Math.floor(Math.random() * array.length)];
  }

  /**
   * Shuffle array
   * @param {Array} array - Array to shuffle
   * @returns {Array} Shuffled array
   */
  static shuffle (array) {
    const shuffled = [...array];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    return shuffled;
  }

  /**
   * Chunk array into smaller arrays
   * @param {Array} array - Array to chunk
   * @param {number} size - Chunk size
   * @returns {Array} Array of chunks
   */
  static chunk (array, size) {
    if (!Array.isArray(array) || size <= 0) return [];

    const chunks = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }

  /**
   * Remove duplicates from array
   * @param {Array} array - Array to deduplicate
   * @param {Function} keyFn - Key function for complex objects
   * @returns {Array} Deduplicated array
   */
  static unique (array, keyFn = null) {
    if (!Array.isArray(array)) return [];

    if (keyFn) {
      const seen = new Set();
      return array.filter(item => {
        const key = keyFn(item);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });
    }

    return [...new Set(array)];
  }
}

module.exports = Helpers;
