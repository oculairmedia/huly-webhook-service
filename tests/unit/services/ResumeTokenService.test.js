/**
 * Unit tests for ResumeTokenService with dependency injection
 */

const ResumeTokenService = require('../../../src/services/ResumeTokenService');
const MockDatabaseAdapter = require('../../mocks/MockDatabaseAdapter');
const MockFileSystem = require('../../mocks/MockFileSystem');

// Mock logger
jest.mock('../../../src/utils/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn()
}));

const logger = require('../../../src/utils/logger');

describe('ResumeTokenService', () => {
  let service;
  let mockConfig;
  let mockDb;
  let mockFs;

  beforeEach(() => {
    jest.clearAllMocks();
    
    mockDb = new MockDatabaseAdapter();
    mockFs = new MockFileSystem();
    
    mockConfig = {
      resumeToken: {
        filePath: './data/resume_token.json',
        mode: 'file',
        saveInterval: 1000,
        maxHistory: 10
      }
    };

    service = new ResumeTokenService(mockConfig, mockDb, mockFs);
  });

  afterEach(async () => {
    // Clean up timers
    if (service.saveTimer) {
      clearTimeout(service.saveTimer);
    }
    if (service.periodicSaveInterval) {
      clearInterval(service.periodicSaveInterval);
    }
  });

  describe('Constructor', () => {
    test('should initialize with default values', () => {
      const minimalConfig = {};
      const minimalService = new ResumeTokenService(minimalConfig, mockDb, mockFs);
      
      expect(minimalService.tokenFilePath).toBe('./data/resume_token.json');
      expect(minimalService.persistenceMode).toBe('file');
      expect(minimalService.saveInterval).toBe(5000);
      expect(minimalService.maxTokenHistory).toBe(100);
      expect(minimalService.currentToken).toBeNull();
      expect(minimalService.tokenHistory).toEqual([]);
      expect(minimalService.initialized).toBe(false);
    });

    test('should accept custom configuration', () => {
      expect(service.tokenFilePath).toBe('./data/resume_token.json');
      expect(service.persistenceMode).toBe('file');
      expect(service.saveInterval).toBe(1000);
      expect(service.maxTokenHistory).toBe(10);
    });

    test('should inject file system dependency', () => {
      expect(service.fs).toBe(mockFs);
    });
  });

  describe('initialize', () => {
    test('should initialize successfully', async () => {
      await service.initialize();

      expect(mockFs.hasDirectory('./data')).toBe(true);
      expect(service.initialized).toBe(true);
      expect(service.periodicSaveInterval).toBeDefined();
      expect(logger.info).toHaveBeenCalledWith('Resume Token Service initialized successfully');
    });

    test('should not initialize twice', async () => {
      await service.initialize();
      logger.info.mockClear();
      
      await service.initialize();
      
      expect(logger.warn).toHaveBeenCalledWith('Resume Token Service already initialized');
      expect(logger.info).not.toHaveBeenCalledWith('Resume Token Service initialized successfully');
    });

    test('should handle initialization errors', async () => {
      mockFs.mkdir = jest.fn().mockRejectedValue(new Error('mkdir failed'));
      
      await expect(service.initialize()).rejects.toThrow('mkdir failed');
      expect(service.initialized).toBe(false);
    });
  });

  describe('loadResumeToken', () => {
    describe('file mode', () => {
      test('should load token from file', async () => {
        const tokenData = {
          token: { _data: 'test-token' },
          history: [{ token: { _data: 'old-token' }, timestamp: new Date() }],
          lastSaved: new Date().toISOString()
        };
        
        mockFs.setFile('./data/resume_token.json', JSON.stringify(tokenData));
        
        const result = await service.loadResumeToken();
        
        expect(result).toEqual(tokenData.token);
        expect(service.currentToken).toEqual(tokenData.token);
        expect(service.tokenHistory).toEqual(tokenData.history);
        expect(service.lastSaved).toBeInstanceOf(Date);
      });

      test('should return null when file does not exist', async () => {
        const result = await service.loadResumeToken();
        
        expect(result).toBeNull();
        expect(logger.info).toHaveBeenCalledWith('No resume token file found, starting fresh');
      });

      test('should handle file read errors', async () => {
        mockFs.readFile = jest.fn().mockRejectedValue(new Error('Read error'));
        
        const result = await service.loadResumeToken();
        
        expect(result).toBeNull();
        expect(logger.error).toHaveBeenCalledWith('Error loading resume token:', expect.any(Error));
      });
    });

    describe('database mode', () => {
      beforeEach(() => {
        service.persistenceMode = 'database';
      });

      test('should load token from database', async () => {
        const tokenDoc = {
          service: 'webhook-change-stream',
          token: { _data: 'db-token' },
          history: [],
          lastSaved: new Date()
        };
        
        mockDb.setCollectionData('resume_tokens', [tokenDoc]);
        
        const result = await service.loadResumeToken();
        
        expect(result).toEqual(tokenDoc.token);
        expect(service.currentToken).toEqual(tokenDoc.token);
      });

      test('should return null when token not in database', async () => {
        const result = await service.loadResumeToken();
        
        expect(result).toBeNull();
      });
    });
  });

  describe('saveResumeToken', () => {
    const mockToken = { _data: 'test-token-123' };

    test('should save token immediately when forced', async () => {
      await service.saveResumeToken(mockToken, true);
      
      expect(service.currentToken).toEqual(mockToken);
      expect(service.tokenHistory).toHaveLength(1);
      expect(mockFs.hasFile('./data/resume_token.json')).toBe(true);
      
      const savedData = JSON.parse(mockFs.getFile('./data/resume_token.json'));
      expect(savedData.token).toEqual(mockToken);
    });

    test('should schedule save when not forced', async () => {
      jest.useFakeTimers();
      
      await service.saveResumeToken(mockToken);
      
      expect(service.currentToken).toEqual(mockToken);
      expect(service.pendingSave).toBe(true);
      expect(mockFs.hasFile('./data/resume_token.json')).toBe(false);
      
      // Fast forward to trigger scheduled save
      jest.advanceTimersByTime(1000);
      await Promise.resolve(); // Let async operations complete
      
      expect(mockFs.hasFile('./data/resume_token.json')).toBe(true);
      
      jest.useRealTimers();
    });

    test('should ignore null token', async () => {
      await service.saveResumeToken(null);
      
      expect(service.currentToken).toBeNull();
      expect(service.tokenHistory).toHaveLength(0);
    });

    test('should handle save errors gracefully', async () => {
      mockFs.writeFile = jest.fn().mockRejectedValue(new Error('Write error'));
      
      await service.saveResumeToken(mockToken, true);
      
      expect(logger.error).toHaveBeenCalledWith('Error saving resume token:', expect.any(Error));
    });
  });

  describe('persistToken', () => {
    beforeEach(() => {
      service.currentToken = { _data: 'test-token' };
      service.tokenHistory = [{ token: service.currentToken, timestamp: new Date() }];
    });

    test('should save to file with atomic rename', async () => {
      await service.persistToken();
      
      expect(mockFs.hasFile('./data/resume_token.json')).toBe(true);
      expect(service.lastSaved).toBeInstanceOf(Date);
      expect(service.pendingSave).toBe(false);
    });

    test('should save to database when in database mode', async () => {
      service.persistenceMode = 'database';
      await mockDb.connect();
      
      await service.persistToken();
      
      const tokens = mockDb.getCollectionData('resume_tokens');
      expect(tokens).toHaveLength(1);
      expect(tokens[0].token).toEqual(service.currentToken);
    });

    test('should clean up temp file on error', async () => {
      mockFs.rename = jest.fn().mockRejectedValue(new Error('Rename failed'));
      
      await expect(service.persistToken()).rejects.toThrow('Rename failed');
      
      expect(mockFs.hasFile('./data/resume_token.json.tmp')).toBe(false);
    });
  });

  describe('Token History', () => {
    test('should add token to history', () => {
      const token1 = { _data: 'token-1' };
      const token2 = { _data: 'token-2' };
      
      service.addToHistory(token1);
      service.addToHistory(token2);
      
      expect(service.tokenHistory).toHaveLength(2);
      expect(service.tokenHistory[0].token).toEqual(token2); // Most recent first
      expect(service.tokenHistory[1].token).toEqual(token1);
    });

    test('should limit history size', () => {
      service.maxTokenHistory = 3;
      
      for (let i = 0; i < 5; i++) {
        service.addToHistory({ _data: `token-${i}` });
      }
      
      expect(service.tokenHistory).toHaveLength(3);
      expect(service.tokenHistory[0].token._data).toBe('token-4'); // Most recent
    });

    test('should get token history with limit', () => {
      for (let i = 0; i < 5; i++) {
        service.addToHistory({ _data: `token-${i}` });
      }
      
      const history = service.getTokenHistory(2);
      
      expect(history).toHaveLength(2);
      expect(history[0].token._data).toBe('token-4');
      expect(history[1].token._data).toBe('token-3');
    });
  });

  describe('clearTokens', () => {
    beforeEach(async () => {
      service.currentToken = { _data: 'test-token' };
      service.tokenHistory = [{ token: service.currentToken, timestamp: new Date() }];
      await service.persistToken();
    });

    test('should clear tokens from file', async () => {
      expect(mockFs.hasFile('./data/resume_token.json')).toBe(true);
      
      await service.clearTokens();
      
      expect(service.currentToken).toBeNull();
      expect(service.tokenHistory).toEqual([]);
      expect(service.lastSaved).toBeNull();
      expect(mockFs.hasFile('./data/resume_token.json')).toBe(false);
    });

    test('should clear tokens from database', async () => {
      service.persistenceMode = 'database';
      await mockDb.connect();
      
      await service.clearTokens();
      
      const tokens = mockDb.getCollectionData('resume_tokens');
      expect(tokens).toHaveLength(0);
    });

    test('should handle file not found error', async () => {
      mockFs.files.clear(); // Remove the file
      
      await expect(service.clearTokens()).resolves.not.toThrow();
      expect(logger.info).toHaveBeenCalledWith('Resume tokens cleared successfully');
    });
  });

  describe('validateToken', () => {
    test('should validate object tokens with _data', () => {
      expect(service.validateToken({ _data: 'token' })).toBe(true);
    });

    test('should validate object tokens with _id', () => {
      expect(service.validateToken({ _id: 'token-id' })).toBe(true);
    });

    test('should validate string tokens', () => {
      expect(service.validateToken('string-token')).toBe(true);
    });

    test('should reject invalid tokens', () => {
      expect(service.validateToken(null)).toBe(false);
      expect(service.validateToken(undefined)).toBe(false);
      expect(service.validateToken({})).toBe(false);
      expect(service.validateToken('')).toBe(false);
      expect(service.validateToken(123)).toBe(false);
    });
  });

  describe('Token Statistics', () => {
    test('should return token stats', async () => {
      service.currentToken = { _data: 'current' };
      service.tokenHistory = [{}, {}, {}];
      service.lastSaved = new Date();
      service.pendingSave = true;
      
      const stats = service.getTokenStats();
      
      expect(stats).toEqual({
        hasCurrentToken: true,
        historyCount: 3,
        lastSaved: service.lastSaved,
        persistenceMode: 'file',
        pendingSave: true,
        filePath: './data/resume_token.json'
      });
    });
  });

  describe('Backup and Restore', () => {
    const testToken = { _data: 'backup-test-token' };

    beforeEach(async () => {
      service.currentToken = testToken;
      service.tokenHistory = [{ token: testToken, timestamp: new Date() }];
    });

    test('should backup token', async () => {
      const result = await service.backupToken();
      
      expect(result.success).toBe(true);
      expect(result.backupPath).toMatch(/_backup_\d+\.json$/);
      expect(mockFs.hasFile(result.backupPath)).toBe(true);
      
      const backupData = JSON.parse(mockFs.getFile(result.backupPath));
      expect(backupData.token).toEqual(testToken);
    });

    test('should restore token from backup', async () => {
      const backupPath = './data/resume_token_backup_123.json';
      const backupData = {
        token: { _data: 'restored-token' },
        history: [],
        timestamp: new Date()
      };
      
      mockFs.setFile(backupPath, JSON.stringify(backupData));
      
      const result = await service.restoreToken(backupPath);
      
      expect(result.success).toBe(true);
      expect(service.currentToken).toEqual(backupData.token);
      expect(mockFs.hasFile('./data/resume_token.json')).toBe(true);
    });

    test('should handle restore errors', async () => {
      const result = await service.restoreToken('./nonexistent.json');
      
      expect(result.success).toBe(false);
      expect(result.error).toContain('ENOENT');
    });
  });

  describe('cleanupBackups', () => {
    test('should cleanup old backup files', async () => {
      const now = Date.now();
      const oldDate = new Date(now - 40 * 24 * 60 * 60 * 1000); // 40 days old
      const recentDate = new Date(now - 10 * 24 * 60 * 60 * 1000); // 10 days old
      
      // Mock file system with backup files
      mockFs.setFile('./data/resume_token_backup_old.json', '{}');
      mockFs.setFile('./data/resume_token_backup_recent.json', '{}');
      mockFs.setFile('./data/other_file.json', '{}');
      
      // Mock stat to return different ages
      const originalStat = mockFs.stat.bind(mockFs);
      mockFs.stat = jest.fn(async (path) => {
        const result = await originalStat(path);
        if (path.includes('_backup_old')) {
          result.mtime = oldDate;
        } else if (path.includes('_backup_recent')) {
          result.mtime = recentDate;
        }
        return result;
      });
      
      const result = await service.cleanupBackups(30);
      
      expect(result.success).toBe(true);
      expect(result.cleaned).toBe(1);
      expect(mockFs.hasFile('./data/resume_token_backup_old.json')).toBe(false);
      expect(mockFs.hasFile('./data/resume_token_backup_recent.json')).toBe(true);
      expect(mockFs.hasFile('./data/other_file.json')).toBe(true);
    });
  });

  describe('shutdown', () => {
    test('should shutdown cleanly', async () => {
      await service.initialize();
      service.pendingSave = true;
      service.currentToken = { _data: 'shutdown-token' };
      
      await service.shutdown();
      
      expect(service.saveTimer).toBeNull();
      expect(service.periodicSaveInterval).toBeNull();
      expect(service.initialized).toBe(false);
      expect(mockFs.hasFile('./data/resume_token.json')).toBe(true);
    });

    test('should handle shutdown errors', async () => {
      mockFs.writeFile = jest.fn().mockRejectedValue(new Error('Write failed'));
      service.pendingSave = true;
      service.currentToken = { _data: 'token' };
      
      await expect(service.shutdown()).rejects.toThrow('Write failed');
    });
  });

  describe('Periodic Saving', () => {
    test('should save periodically when pending', async () => {
      jest.useFakeTimers();
      
      service.startPeriodicSaving();
      service.currentToken = { _data: 'periodic-token' };
      service.pendingSave = true;
      
      // Fast forward 30 seconds
      jest.advanceTimersByTime(30000);
      await Promise.resolve();
      
      expect(mockFs.hasFile('./data/resume_token.json')).toBe(true);
      
      jest.useRealTimers();
    });

    test('should not save when no pending save', async () => {
      jest.useFakeTimers();
      
      service.startPeriodicSaving();
      service.currentToken = { _data: 'periodic-token' };
      service.pendingSave = false;
      
      jest.advanceTimersByTime(30000);
      await Promise.resolve();
      
      expect(mockFs.hasFile('./data/resume_token.json')).toBe(false);
      
      jest.useRealTimers();
    });
  });
});