/**
 * Cryptographic utilities for webhook signatures and security
 */

const crypto = require('crypto');

class CryptoUtils {
  /**
   * Generate HMAC-SHA256 signature for webhook payload
   * @param {string} payload - The payload to sign
   * @param {string} secret - The secret key
   * @returns {string} The signature in hex format
   */
  static generateHmacSignature (payload, secret) {
    if (!payload || !secret) {
      throw new Error('Payload and secret are required for signature generation');
    }

    const hmac = crypto.createHmac('sha256', secret);
    hmac.update(payload, 'utf8');
    return hmac.digest('hex');
  }

  /**
   * Generate webhook signature header value
   * @param {string} payload - The payload to sign
   * @param {string} secret - The secret key
   * @returns {string} The signature header value (sha256=...)
   */
  static generateWebhookSignature (payload, secret) {
    const signature = this.generateHmacSignature(payload, secret);
    return `sha256=${signature}`;
  }

  /**
   * Verify webhook signature
   * @param {string} payload - The payload to verify
   * @param {string} signature - The signature to verify against
   * @param {string} secret - The secret key
   * @returns {boolean} True if signature is valid
   */
  static verifyWebhookSignature (payload, signature, secret) {
    if (!payload || !signature || !secret) {
      return false;
    }

    try {
      const expectedSignature = this.generateWebhookSignature(payload, secret);

      // Use timing-safe comparison to prevent timing attacks
      return crypto.timingSafeEqual(
        Buffer.from(signature),
        Buffer.from(expectedSignature)
      );
    } catch (error) {
      return false;
    }
  }

  /**
   * Generate a secure random secret
   * @param {number} length - The length of the secret in bytes
   * @returns {string} A secure random secret in hex format
   */
  static generateSecret (length = 32) {
    return crypto.randomBytes(length).toString('hex');
  }

  /**
   * Generate a secure random API key
   * @param {number} length - The length of the API key in bytes
   * @returns {string} A secure random API key in base64 format
   */
  static generateApiKey (length = 32) {
    return crypto.randomBytes(length).toString('base64url');
  }

  /**
   * Hash a string using SHA-256
   * @param {string} input - The string to hash
   * @returns {string} The hash in hex format
   */
  static sha256 (input) {
    return crypto.createHash('sha256').update(input).digest('hex');
  }

  /**
   * Hash a string using SHA-1 (for compatibility)
   * @param {string} input - The string to hash
   * @returns {string} The hash in hex format
   */
  static sha1 (input) {
    return crypto.createHash('sha1').update(input).digest('hex');
  }

  /**
   * Generate a secure random UUID v4
   * @returns {string} A UUID v4 string
   */
  static generateUUID () {
    return crypto.randomUUID();
  }

  /**
   * Constant-time string comparison
   * @param {string} a - First string
   * @param {string} b - Second string
   * @returns {boolean} True if strings are equal
   */
  static timingSafeEqual (a, b) {
    if (typeof a !== 'string' || typeof b !== 'string') {
      return false;
    }

    if (a.length !== b.length) {
      return false;
    }

    try {
      return crypto.timingSafeEqual(
        Buffer.from(a, 'utf8'),
        Buffer.from(b, 'utf8')
      );
    } catch (error) {
      return false;
    }
  }

  /**
   * Generate a cryptographically secure random number
   * @param {number} min - Minimum value (inclusive)
   * @param {number} max - Maximum value (exclusive)
   * @returns {number} A secure random number
   */
  static secureRandom (min = 0, max = 1) {
    const range = max - min;
    const bytesNeeded = Math.ceil(Math.log2(range) / 8);
    // const maxValue = Math.pow(256, bytesNeeded); // Not used in calculation
    const randomBytes = crypto.randomBytes(bytesNeeded);

    let randomValue = 0;
    for (let i = 0; i < bytesNeeded; i++) {
      randomValue = (randomValue << 8) + randomBytes[i];
    }

    return min + (randomValue % range);
  }

  /**
   * Generate a secure random string
   * @param {number} length - The length of the string
   * @param {string} chars - The characters to use (default: alphanumeric)
   * @returns {string} A secure random string
   */
  static secureRandomString (length = 32, chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789') {
    let result = '';
    for (let i = 0; i < length; i++) {
      result += chars.charAt(this.secureRandom(0, chars.length));
    }
    return result;
  }

  /**
   * Encrypt data using AES-256-GCM
   * @param {string} data - The data to encrypt
   * @param {string} key - The encryption key
   * @returns {object} Object containing encrypted data, IV, and auth tag
   */
  static encrypt (data, key) {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv('aes-256-gcm', Buffer.from(key).slice(0, 32), iv);
    cipher.setAAD(Buffer.from('webhook-service', 'utf8'));

    let encrypted = cipher.update(data, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    const authTag = cipher.getAuthTag();

    return {
      encrypted,
      iv: iv.toString('hex'),
      authTag: authTag.toString('hex')
    };
  }

  /**
   * Decrypt data using AES-256-GCM
   * @param {string} encrypted - The encrypted data
   * @param {string} key - The encryption key
   * @param {string} iv - The initialization vector
   * @param {string} authTag - The authentication tag
   * @returns {string} The decrypted data
   */
  static decrypt (encrypted, key, iv, authTag) {
    const decipher = crypto.createDecipheriv('aes-256-gcm', Buffer.from(key).slice(0, 32), Buffer.from(iv, 'hex'));
    decipher.setAAD(Buffer.from('webhook-service', 'utf8'));
    decipher.setAuthTag(Buffer.from(authTag, 'hex'));

    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    return decrypted;
  }

  /**
   * Generate a deterministic hash for deduplication
   * @param {object} data - The data to hash
   * @returns {string} A deterministic hash
   */
  static generateDeduplicationHash (data) {
    const normalizedData = JSON.stringify(data, Object.keys(data).sort());
    return this.sha256(normalizedData);
  }

  /**
   * Validate signature format
   * @param {string} signature - The signature to validate
   * @returns {boolean} True if signature format is valid
   */
  static isValidSignatureFormat (signature) {
    if (typeof signature !== 'string') {
      return false;
    }

    // Check for sha256= prefix
    if (!signature.startsWith('sha256=')) {
      return false;
    }

    // Check hex format
    const hex = signature.substring(7);
    return /^[a-f0-9]{64}$/i.test(hex);
  }

  /**
   * Generate a secure webhook secret with validation
   * @param {number} minLength - Minimum length in characters
   * @returns {string} A secure webhook secret
   */
  static generateWebhookSecret (minLength = 32) {
    if (minLength < 16) {
      throw new Error('Webhook secret must be at least 16 characters long');
    }

    const secret = this.generateSecret(Math.ceil(minLength / 2));
    return secret.substring(0, minLength);
  }
}

module.exports = CryptoUtils;
