/**
 * Resume Token Service for Huly Webhook Service
 * Handles persistence and recovery of MongoDB Change Stream resume tokens
 */

const fs = require('fs').promises;
const path = require('path');
const logger = require('../utils/logger');

class ResumeTokenService {
  constructor (config, databaseService) {
    this.config = config;
    this.db = databaseService;
    this.tokenFilePath = config.resumeToken?.filePath || './data/resume_token.json';
    this.persistenceMode = config.resumeToken?.mode || 'file'; // 'file' or 'database'
    this.saveInterval = config.resumeToken?.saveInterval || 5000; // 5 seconds
    this.maxTokenHistory = config.resumeToken?.maxHistory || 100;

    // In-memory token storage
    this.currentToken = null;
    this.tokenHistory = [];
    this.lastSaved = null;
    this.pendingSave = false;
    this.saveTimer = null;

    this.initialize();
  }

  /**
   * Initialize the resume token service
   */
  async initialize () {
    try {
      logger.info('Initializing Resume Token Service...');

      // Create data directory if it doesn't exist
      const dataDir = path.dirname(this.tokenFilePath);
      await fs.mkdir(dataDir, { recursive: true });

      // Load existing token
      await this.loadResumeToken();

      // Start periodic saving
      this.startPeriodicSaving();

      logger.info('Resume Token Service initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize Resume Token Service:', error);
      throw error;
    }
  }

  /**
   * Load resume token from persistence
   * @returns {Object|null} - Resume token or null if not found
   */
  async loadResumeToken () {
    try {
      if (this.persistenceMode === 'database') {
        return await this.loadTokenFromDatabase();
      } else {
        return await this.loadTokenFromFile();
      }
    } catch (error) {
      logger.error('Error loading resume token:', error);
      return null;
    }
  }

  /**
   * Load token from file
   * @returns {Object|null} - Resume token or null
   */
  async loadTokenFromFile () {
    try {
      const data = await fs.readFile(this.tokenFilePath, 'utf8');
      const tokenData = JSON.parse(data);

      if (tokenData.token) {
        this.currentToken = tokenData.token;
        this.tokenHistory = tokenData.history || [];
        this.lastSaved = new Date(tokenData.lastSaved);

        logger.info('Resume token loaded from file:', {
          tokenExists: !!this.currentToken,
          historyCount: this.tokenHistory.length,
          lastSaved: this.lastSaved
        });

        return this.currentToken;
      }

      return null;
    } catch (error) {
      if (error.code === 'ENOENT') {
        logger.info('No resume token file found, starting fresh');
        return null;
      }
      throw error;
    }
  }

  /**
   * Load token from database
   * @returns {Object|null} - Resume token or null
   */
  async loadTokenFromDatabase () {
    try {
      const tokenDoc = await this.db.findOne('resume_tokens', {
        service: 'webhook-change-stream'
      });

      if (tokenDoc && tokenDoc.token) {
        this.currentToken = tokenDoc.token;
        this.tokenHistory = tokenDoc.history || [];
        this.lastSaved = tokenDoc.lastSaved;

        logger.info('Resume token loaded from database:', {
          tokenExists: !!this.currentToken,
          historyCount: this.tokenHistory.length,
          lastSaved: this.lastSaved
        });

        return this.currentToken;
      }

      return null;
    } catch (error) {
      logger.error('Error loading token from database:', error);
      return null;
    }
  }

  /**
   * Save resume token to persistence
   * @param {Object} token - Resume token to save
   * @param {boolean} force - Force immediate save
   */
  async saveResumeToken (token, force = false) {
    try {
      if (!token) return;

      // Update in-memory token
      this.currentToken = token;
      this.addToHistory(token);

      // Save immediately if forced or if enough time has passed
      if (force || !this.lastSaved || Date.now() - this.lastSaved.getTime() > this.saveInterval) {
        await this.persistToken();
      } else if (!this.pendingSave) {
        // Schedule save
        this.scheduleTokenSave();
      }
    } catch (error) {
      logger.error('Error saving resume token:', error);
    }
  }

  /**
   * Persist token to storage
   */
  async persistToken () {
    try {
      if (this.persistenceMode === 'database') {
        await this.saveTokenToDatabase();
      } else {
        await this.saveTokenToFile();
      }

      this.lastSaved = new Date();
      this.pendingSave = false;

      logger.debug('Resume token persisted successfully');
    } catch (error) {
      logger.error('Error persisting resume token:', error);
      throw error;
    }
  }

  /**
   * Save token to file
   */
  async saveTokenToFile () {
    const tokenData = {
      token: this.currentToken,
      history: this.tokenHistory,
      lastSaved: new Date().toISOString(),
      service: 'webhook-change-stream'
    };

    const tempFilePath = this.tokenFilePath + '.tmp';

    try {
      // Write to temporary file first
      await fs.writeFile(tempFilePath, JSON.stringify(tokenData, null, 2));

      // Atomic rename
      await fs.rename(tempFilePath, this.tokenFilePath);

      logger.debug('Resume token saved to file');
    } catch (error) {
      // Clean up temporary file on error
      try {
        await fs.unlink(tempFilePath);
      } catch (cleanupError) {
        // Ignore cleanup errors
      }
      throw error;
    }
  }

  /**
   * Save token to database
   */
  async saveTokenToDatabase () {
    const tokenData = {
      service: 'webhook-change-stream',
      token: this.currentToken,
      history: this.tokenHistory,
      lastSaved: new Date(),
      updatedAt: new Date()
    };

    await this.db.upsert('resume_tokens',
      { service: 'webhook-change-stream' },
      tokenData
    );

    logger.debug('Resume token saved to database');
  }

  /**
   * Add token to history
   * @param {Object} token - Token to add
   */
  addToHistory (token) {
    if (!token) return;

    const historyEntry = {
      token,
      timestamp: new Date(),
      _id: token._id || token.toString()
    };

    // Add to beginning of history
    this.tokenHistory.unshift(historyEntry);

    // Trim history to max size
    if (this.tokenHistory.length > this.maxTokenHistory) {
      this.tokenHistory = this.tokenHistory.slice(0, this.maxTokenHistory);
    }
  }

  /**
   * Schedule token save
   */
  scheduleTokenSave () {
    if (this.pendingSave) return;

    this.pendingSave = true;

    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
    }

    this.saveTimer = setTimeout(async () => {
      try {
        await this.persistToken();
      } catch (error) {
        logger.error('Error in scheduled token save:', error);
      }
    }, this.saveInterval);
  }

  /**
   * Start periodic saving
   */
  startPeriodicSaving () {
    // Save every 30 seconds if there's a current token
    setInterval(async () => {
      if (this.currentToken && this.pendingSave) {
        try {
          await this.persistToken();
        } catch (error) {
          logger.error('Error in periodic token save:', error);
        }
      }
    }, 30000);
  }

  /**
   * Get current resume token
   * @returns {Object|null} - Current resume token
   */
  getCurrentToken () {
    return this.currentToken;
  }

  /**
   * Get token history
   * @param {number} limit - Maximum number of tokens to return
   * @returns {Array} - Token history
   */
  getTokenHistory (limit = 10) {
    return this.tokenHistory.slice(0, limit);
  }

  /**
   * Clear current token and history
   */
  async clearTokens () {
    try {
      this.currentToken = null;
      this.tokenHistory = [];
      this.lastSaved = null;

      // Clear from persistence
      if (this.persistenceMode === 'database') {
        await this.db.deleteMany('resume_tokens', { service: 'webhook-change-stream' });
      } else {
        try {
          await fs.unlink(this.tokenFilePath);
        } catch (error) {
          if (error.code !== 'ENOENT') {
            throw error;
          }
        }
      }

      logger.info('Resume tokens cleared successfully');
    } catch (error) {
      logger.error('Error clearing resume tokens:', error);
      throw error;
    }
  }

  /**
   * Validate resume token
   * @param {Object} token - Token to validate
   * @returns {boolean} - Whether token is valid
   */
  validateToken (token) {
    if (!token) return false;

    // Basic validation - MongoDB resume tokens should have _data field
    if (typeof token === 'object' && (token._data || token._id)) {
      return true;
    }

    // String tokens are also valid
    if (typeof token === 'string' && token.length > 0) {
      return true;
    }

    return false;
  }

  /**
   * Get token statistics
   * @returns {Object} - Token statistics
   */
  getTokenStats () {
    return {
      hasCurrentToken: !!this.currentToken,
      historyCount: this.tokenHistory.length,
      lastSaved: this.lastSaved,
      persistenceMode: this.persistenceMode,
      pendingSave: this.pendingSave,
      filePath: this.tokenFilePath
    };
  }

  /**
   * Backup current token
   * @returns {Object} - Backup data
   */
  async backupToken () {
    try {
      const backup = {
        token: this.currentToken,
        history: this.tokenHistory,
        timestamp: new Date(),
        service: 'webhook-change-stream'
      };

      const backupPath = this.tokenFilePath.replace('.json', `_backup_${Date.now()}.json`);
      await fs.writeFile(backupPath, JSON.stringify(backup, null, 2));

      logger.info('Resume token backed up to:', backupPath);
      return { success: true, backupPath };
    } catch (error) {
      logger.error('Error backing up resume token:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Restore token from backup
   * @param {string} backupPath - Path to backup file
   * @returns {Object} - Restore result
   */
  async restoreToken (backupPath) {
    try {
      const data = await fs.readFile(backupPath, 'utf8');
      const backup = JSON.parse(data);

      if (backup.token) {
        this.currentToken = backup.token;
        this.tokenHistory = backup.history || [];

        // Save restored token
        await this.persistToken();

        logger.info('Resume token restored from backup:', backupPath);
        return { success: true, token: this.currentToken };
      } else {
        throw new Error('Invalid backup file format');
      }
    } catch (error) {
      logger.error('Error restoring resume token:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Cleanup old backup files
   * @param {number} maxAge - Maximum age in days
   */
  async cleanupBackups (maxAge = 30) {
    try {
      const dataDir = path.dirname(this.tokenFilePath);
      const files = await fs.readdir(dataDir);

      const backupFiles = files.filter(file =>
        file.includes('_backup_') && file.endsWith('.json')
      );

      const cutoffTime = Date.now() - (maxAge * 24 * 60 * 60 * 1000);
      let cleaned = 0;

      for (const file of backupFiles) {
        const filePath = path.join(dataDir, file);
        const stats = await fs.stat(filePath);

        if (stats.mtime.getTime() < cutoffTime) {
          await fs.unlink(filePath);
          cleaned++;
        }
      }

      if (cleaned > 0) {
        logger.info(`Cleaned up ${cleaned} old backup files`);
      }

      return { success: true, cleaned };
    } catch (error) {
      logger.error('Error cleaning up backup files:', error);
      return { success: false, error: error.message };
    }
  }

  /**
   * Shutdown the service
   */
  async shutdown () {
    try {
      logger.info('Shutting down Resume Token Service...');

      // Clear any pending save timer
      if (this.saveTimer) {
        clearTimeout(this.saveTimer);
      }

      // Save current token if pending
      if (this.pendingSave && this.currentToken) {
        await this.persistToken();
      }

      logger.info('Resume Token Service shut down successfully');
    } catch (error) {
      logger.error('Error shutting down Resume Token Service:', error);
      throw error;
    }
  }
}

module.exports = ResumeTokenService;
