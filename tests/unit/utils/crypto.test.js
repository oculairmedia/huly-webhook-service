/**
 * Unit tests for CryptoUtils
 */

const CryptoUtils = require('../../../src/utils/crypto');
const crypto = require('crypto');

describe('CryptoUtils', () => {
  describe('generateHmacSignature', () => {
    test('should generate valid HMAC-SHA256 signature', () => {
      const payload = 'test payload';
      const secret = 'test-secret-key';
      
      const signature = CryptoUtils.generateHmacSignature(payload, secret);
      
      expect(signature).toBeDefined();
      expect(typeof signature).toBe('string');
      expect(signature).toHaveLength(64); // SHA256 hex length
      expect(signature).toMatch(/^[a-f0-9]+$/); // Hex format
    });

    test('should generate consistent signatures for same input', () => {
      const payload = 'test payload';
      const secret = 'test-secret-key';
      
      const signature1 = CryptoUtils.generateHmacSignature(payload, secret);
      const signature2 = CryptoUtils.generateHmacSignature(payload, secret);
      
      expect(signature1).toBe(signature2);
    });

    test('should generate different signatures for different payloads', () => {
      const secret = 'test-secret-key';
      
      const signature1 = CryptoUtils.generateHmacSignature('payload1', secret);
      const signature2 = CryptoUtils.generateHmacSignature('payload2', secret);
      
      expect(signature1).not.toBe(signature2);
    });

    test('should generate different signatures for different secrets', () => {
      const payload = 'test payload';
      
      const signature1 = CryptoUtils.generateHmacSignature(payload, 'secret1');
      const signature2 = CryptoUtils.generateHmacSignature(payload, 'secret2');
      
      expect(signature1).not.toBe(signature2);
    });

    test('should throw error for missing payload', () => {
      expect(() => {
        CryptoUtils.generateHmacSignature(null, 'secret');
      }).toThrow('Payload and secret are required for signature generation');

      expect(() => {
        CryptoUtils.generateHmacSignature('', 'secret');
      }).toThrow('Payload and secret are required for signature generation');
    });

    test('should throw error for missing secret', () => {
      expect(() => {
        CryptoUtils.generateHmacSignature('payload', null);
      }).toThrow('Payload and secret are required for signature generation');

      expect(() => {
        CryptoUtils.generateHmacSignature('payload', '');
      }).toThrow('Payload and secret are required for signature generation');
    });

    test('should handle special characters in payload', () => {
      const payload = 'test 🚀 payload with émojis & special chars: !@#$%^&*()';
      const secret = 'test-secret';
      
      const signature = CryptoUtils.generateHmacSignature(payload, secret);
      
      expect(signature).toBeDefined();
      expect(signature).toHaveLength(64);
    });

    test('should handle JSON payloads', () => {
      const payload = JSON.stringify({ test: 'data', number: 123 });
      const secret = 'test-secret';
      
      const signature = CryptoUtils.generateHmacSignature(payload, secret);
      
      expect(signature).toBeDefined();
      expect(signature).toHaveLength(64);
    });
  });

  describe('generateWebhookSignature', () => {
    test('should generate webhook signature with sha256 prefix', () => {
      const payload = 'test payload';
      const secret = 'test-secret-key';
      
      const signature = CryptoUtils.generateWebhookSignature(payload, secret);
      
      expect(signature).toMatch(/^sha256=[a-f0-9]{64}$/);
      expect(signature.startsWith('sha256=')).toBe(true);
    });

    test('should generate consistent webhook signatures', () => {
      const payload = 'test payload';
      const secret = 'test-secret-key';
      
      const signature1 = CryptoUtils.generateWebhookSignature(payload, secret);
      const signature2 = CryptoUtils.generateWebhookSignature(payload, secret);
      
      expect(signature1).toBe(signature2);
    });

    test('should throw error for invalid inputs', () => {
      expect(() => {
        CryptoUtils.generateWebhookSignature(null, 'secret');
      }).toThrow('Payload and secret are required for signature generation');
    });
  });

  describe('verifyWebhookSignature', () => {
    test('should verify valid signature', () => {
      const payload = 'test payload';
      const secret = 'test-secret-key';
      const signature = CryptoUtils.generateWebhookSignature(payload, secret);
      
      const isValid = CryptoUtils.verifyWebhookSignature(payload, signature, secret);
      
      expect(isValid).toBe(true);
    });

    test('should reject invalid signature', () => {
      const payload = 'test payload';
      const secret = 'test-secret-key';
      const invalidSignature = 'sha256=invalid';
      
      const isValid = CryptoUtils.verifyWebhookSignature(payload, invalidSignature, secret);
      
      expect(isValid).toBe(false);
    });

    test('should reject signature with wrong secret', () => {
      const payload = 'test payload';
      const secret1 = 'test-secret-key1';
      const secret2 = 'test-secret-key2';
      const signature = CryptoUtils.generateWebhookSignature(payload, secret1);
      
      const isValid = CryptoUtils.verifyWebhookSignature(payload, signature, secret2);
      
      expect(isValid).toBe(false);
    });

    test('should reject signature for different payload', () => {
      const payload1 = 'test payload 1';
      const payload2 = 'test payload 2';
      const secret = 'test-secret-key';
      const signature = CryptoUtils.generateWebhookSignature(payload1, secret);
      
      const isValid = CryptoUtils.verifyWebhookSignature(payload2, signature, secret);
      
      expect(isValid).toBe(false);
    });

    test('should return false for missing parameters', () => {
      const payload = 'test';
      const secret = 'secret';
      const signature = 'sha256=test';
      
      expect(CryptoUtils.verifyWebhookSignature(null, signature, secret)).toBe(false);
      expect(CryptoUtils.verifyWebhookSignature(payload, null, secret)).toBe(false);
      expect(CryptoUtils.verifyWebhookSignature(payload, signature, null)).toBe(false);
      expect(CryptoUtils.verifyWebhookSignature('', signature, secret)).toBe(false);
      expect(CryptoUtils.verifyWebhookSignature(payload, '', secret)).toBe(false);
      expect(CryptoUtils.verifyWebhookSignature(payload, signature, '')).toBe(false);
    });

    test('should handle malformed signatures gracefully', () => {
      const payload = 'test';
      const secret = 'secret';
      
      expect(CryptoUtils.verifyWebhookSignature(payload, 'invalid', secret)).toBe(false);
      expect(CryptoUtils.verifyWebhookSignature(payload, 'sha256=', secret)).toBe(false);
      expect(CryptoUtils.verifyWebhookSignature(payload, 'sha1=abc', secret)).toBe(false);
    });

    test('should be case sensitive for signatures', () => {
      const payload = 'test payload';
      const secret = 'test-secret-key';
      const signature = CryptoUtils.generateWebhookSignature(payload, secret);
      const upperSignature = signature.toUpperCase();
      
      const isValid = CryptoUtils.verifyWebhookSignature(payload, upperSignature, secret);
      
      expect(isValid).toBe(false);
    });
  });

  describe('generateApiKey', () => {
    test('should generate API key of specified length', () => {
      const key = CryptoUtils.generateApiKey(32);
      
      expect(key).toBeDefined();
      expect(key).toHaveLength(64); // 32 bytes = 64 hex chars
      expect(key).toMatch(/^[a-f0-9]+$/);
    });

    test('should generate unique API keys', () => {
      const key1 = CryptoUtils.generateApiKey(32);
      const key2 = CryptoUtils.generateApiKey(32);
      
      expect(key1).not.toBe(key2);
    });

    test('should use default length if not specified', () => {
      const key = CryptoUtils.generateApiKey();
      
      expect(key).toHaveLength(64); // Default 32 bytes = 64 hex chars
    });

    test('should handle different lengths', () => {
      const key16 = CryptoUtils.generateApiKey(16);
      const key64 = CryptoUtils.generateApiKey(64);
      
      expect(key16).toHaveLength(32); // 16 bytes = 32 hex chars
      expect(key64).toHaveLength(128); // 64 bytes = 128 hex chars
    });
  });

  describe('hashPassword', () => {
    test('should hash password with salt', async () => {
      const password = 'testPassword123';
      
      const hash = await CryptoUtils.hashPassword(password);
      
      expect(hash).toBeDefined();
      expect(typeof hash).toBe('string');
      expect(hash).not.toBe(password);
      expect(hash.split(':')).toHaveLength(2); // salt:hash format
    });

    test('should generate different hashes for same password', async () => {
      const password = 'testPassword123';
      
      const hash1 = await CryptoUtils.hashPassword(password);
      const hash2 = await CryptoUtils.hashPassword(password);
      
      expect(hash1).not.toBe(hash2); // Different salts
    });

    test('should handle empty password', async () => {
      await expect(CryptoUtils.hashPassword('')).rejects.toThrow('Password is required');
    });

    test('should handle null password', async () => {
      await expect(CryptoUtils.hashPassword(null)).rejects.toThrow('Password is required');
    });
  });

  describe('verifyPassword', () => {
    test('should verify correct password', async () => {
      const password = 'testPassword123';
      const hash = await CryptoUtils.hashPassword(password);
      
      const isValid = await CryptoUtils.verifyPassword(password, hash);
      
      expect(isValid).toBe(true);
    });

    test('should reject incorrect password', async () => {
      const password = 'testPassword123';
      const wrongPassword = 'wrongPassword';
      const hash = await CryptoUtils.hashPassword(password);
      
      const isValid = await CryptoUtils.verifyPassword(wrongPassword, hash);
      
      expect(isValid).toBe(false);
    });

    test('should handle invalid hash format', async () => {
      const password = 'testPassword123';
      
      const isValid = await CryptoUtils.verifyPassword(password, 'invalid-hash');
      
      expect(isValid).toBe(false);
    });

    test('should handle missing parameters', async () => {
      const password = 'test';
      const hash = await CryptoUtils.hashPassword(password);
      
      expect(await CryptoUtils.verifyPassword(null, hash)).toBe(false);
      expect(await CryptoUtils.verifyPassword(password, null)).toBe(false);
      expect(await CryptoUtils.verifyPassword('', hash)).toBe(false);
      expect(await CryptoUtils.verifyPassword(password, '')).toBe(false);
    });
  });

  describe('encryptData', () => {
    test('should encrypt and decrypt data', () => {
      const data = 'sensitive data';
      const key = crypto.randomBytes(32).toString('hex');
      
      const encrypted = CryptoUtils.encryptData(data, key);
      const decrypted = CryptoUtils.decryptData(encrypted, key);
      
      expect(decrypted).toBe(data);
    });

    test('should produce different ciphertexts for same data', () => {
      const data = 'sensitive data';
      const key = crypto.randomBytes(32).toString('hex');
      
      const encrypted1 = CryptoUtils.encryptData(data, key);
      const encrypted2 = CryptoUtils.encryptData(data, key);
      
      expect(encrypted1).not.toBe(encrypted2); // Different IVs
    });

    test('should handle JSON data', () => {
      const data = { user: 'test', id: 123 };
      const key = crypto.randomBytes(32).toString('hex');
      
      const encrypted = CryptoUtils.encryptData(JSON.stringify(data), key);
      const decrypted = CryptoUtils.decryptData(encrypted, key);
      
      expect(JSON.parse(decrypted)).toEqual(data);
    });

    test('should throw error for invalid key', () => {
      expect(() => {
        CryptoUtils.encryptData('data', 'short-key');
      }).toThrow();
    });
  });

  describe('decryptData', () => {
    test('should fail with wrong key', () => {
      const data = 'sensitive data';
      const key1 = crypto.randomBytes(32).toString('hex');
      const key2 = crypto.randomBytes(32).toString('hex');
      
      const encrypted = CryptoUtils.encryptData(data, key1);
      
      expect(() => {
        CryptoUtils.decryptData(encrypted, key2);
      }).toThrow();
    });

    test('should fail with corrupted data', () => {
      const key = crypto.randomBytes(32).toString('hex');
      
      expect(() => {
        CryptoUtils.decryptData('invalid:data', key);
      }).toThrow();
    });
  });

  describe('generateNonce', () => {
    test('should generate nonce of specified length', () => {
      const nonce = CryptoUtils.generateNonce(16);
      
      expect(nonce).toHaveLength(32); // 16 bytes = 32 hex chars
      expect(nonce).toMatch(/^[a-f0-9]+$/);
    });

    test('should generate unique nonces', () => {
      const nonce1 = CryptoUtils.generateNonce(16);
      const nonce2 = CryptoUtils.generateNonce(16);
      
      expect(nonce1).not.toBe(nonce2);
    });
  });

  describe('timingSafeEqual', () => {
    test('should return true for equal strings', () => {
      const str = 'test-string-123';
      
      const result = CryptoUtils.timingSafeEqual(str, str);
      
      expect(result).toBe(true);
    });

    test('should return false for different strings', () => {
      const str1 = 'test-string-123';
      const str2 = 'test-string-456';
      
      const result = CryptoUtils.timingSafeEqual(str1, str2);
      
      expect(result).toBe(false);
    });

    test('should return false for different lengths', () => {
      const str1 = 'short';
      const str2 = 'longer-string';
      
      const result = CryptoUtils.timingSafeEqual(str1, str2);
      
      expect(result).toBe(false);
    });

    test('should handle empty strings', () => {
      expect(CryptoUtils.timingSafeEqual('', '')).toBe(true);
      expect(CryptoUtils.timingSafeEqual('test', '')).toBe(false);
      expect(CryptoUtils.timingSafeEqual('', 'test')).toBe(false);
    });
  });
});