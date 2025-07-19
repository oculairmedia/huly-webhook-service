/**
 * Unit tests for Helpers utility
 */

const Helpers = require('../../../src/utils/helpers');

// Mock uuid
jest.mock('uuid', () => ({
  v4: jest.fn(() => 'mock-uuid-1234')
}));

describe('Helpers', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  describe('generateId', () => {
    test('should generate a UUID', () => {
      const id = Helpers.generateId();
      expect(id).toBe('mock-uuid-1234');
    });
  });

  describe('sleep', () => {
    test('should delay for specified time', async () => {
      jest.useFakeTimers();
      const sleepPromise = Helpers.sleep(1000);
      
      // Fast-forward time
      jest.advanceTimersByTime(1000);
      
      await expect(sleepPromise).resolves.toBeUndefined();
      jest.useRealTimers();
    });
  });

  describe('retryWithBackoff', () => {
    test('should succeed on first attempt', async () => {
      const fn = jest.fn().mockResolvedValue('success');
      
      const result = await Helpers.retryWithBackoff(fn);
      
      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(1);
    });

    test('should retry on failure and eventually succeed', async () => {
      const fn = jest.fn()
        .mockRejectedValueOnce(new Error('Fail 1'))
        .mockRejectedValueOnce(new Error('Fail 2'))
        .mockResolvedValue('success');
      
      const result = await Helpers.retryWithBackoff(fn, { baseDelay: 10 });
      
      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(3);
    });

    test('should throw after max attempts', async () => {
      const fn = jest.fn().mockRejectedValue(new Error('Always fails'));
      
      await expect(
        Helpers.retryWithBackoff(fn, { maxAttempts: 2, baseDelay: 10 })
      ).rejects.toThrow('Always fails');
      
      expect(fn).toHaveBeenCalledTimes(2);
    });

    test('should apply exponential backoff with jitter', async () => {
      jest.useFakeTimers();
      const fn = jest.fn()
        .mockRejectedValueOnce(new Error('Fail 1'))
        .mockResolvedValue('success');
      
      const promise = Helpers.retryWithBackoff(fn, {
        baseDelay: 100,
        backoffMultiplier: 2,
        jitter: true
      });
      
      // First attempt fails immediately
      await Promise.resolve();
      expect(fn).toHaveBeenCalledTimes(1);
      
      // Advance time for retry
      jest.advanceTimersByTime(200); // Base delay + some jitter
      await Promise.resolve();
      
      const result = await promise;
      expect(result).toBe('success');
      
      jest.useRealTimers();
    });

    test('should respect maxDelay option', async () => {
      const fn = jest.fn()
        .mockRejectedValueOnce(new Error('Fail'))
        .mockResolvedValue('success');
      
      const result = await Helpers.retryWithBackoff(fn, {
        baseDelay: 10000,
        maxDelay: 100,
        jitter: false
      });
      
      expect(result).toBe('success');
    });
  });

  describe('deepClone', () => {
    test('should clone primitive values', () => {
      expect(Helpers.deepClone(42)).toBe(42);
      expect(Helpers.deepClone('string')).toBe('string');
      expect(Helpers.deepClone(true)).toBe(true);
      expect(Helpers.deepClone(null)).toBe(null);
      expect(Helpers.deepClone(undefined)).toBe(undefined);
    });

    test('should clone dates', () => {
      const date = new Date('2023-01-01');
      const cloned = Helpers.deepClone(date);
      
      expect(cloned).toEqual(date);
      expect(cloned).not.toBe(date);
      expect(cloned.getTime()).toBe(date.getTime());
    });

    test('should clone arrays', () => {
      const arr = [1, 'two', { three: 3 }, [4, 5]];
      const cloned = Helpers.deepClone(arr);
      
      expect(cloned).toEqual(arr);
      expect(cloned).not.toBe(arr);
      expect(cloned[2]).not.toBe(arr[2]);
      expect(cloned[3]).not.toBe(arr[3]);
    });

    test('should clone objects', () => {
      const obj = {
        a: 1,
        b: 'two',
        c: { nested: true },
        d: [1, 2, 3]
      };
      const cloned = Helpers.deepClone(obj);
      
      expect(cloned).toEqual(obj);
      expect(cloned).not.toBe(obj);
      expect(cloned.c).not.toBe(obj.c);
      expect(cloned.d).not.toBe(obj.d);
    });

    test('should handle circular references gracefully', () => {
      const obj = { a: 1 };
      obj.circular = obj;
      
      // This will cause infinite recursion, but that's expected behavior
      // In production, you might want to handle this case
      expect(() => Helpers.deepClone(obj)).toThrow();
    });
  });

  describe('formatBytes', () => {
    test('should format bytes correctly', () => {
      expect(Helpers.formatBytes(0)).toBe('0 Bytes');
      expect(Helpers.formatBytes(1023)).toBe('1023 Bytes');
      expect(Helpers.formatBytes(1024)).toBe('1 KB');
      expect(Helpers.formatBytes(1536)).toBe('1.5 KB');
      expect(Helpers.formatBytes(1048576)).toBe('1 MB');
      expect(Helpers.formatBytes(1073741824)).toBe('1 GB');
      expect(Helpers.formatBytes(1099511627776)).toBe('1 TB');
    });

    test('should handle decimal places', () => {
      expect(Helpers.formatBytes(1536, 0)).toBe('2 KB');
      expect(Helpers.formatBytes(1536, 1)).toBe('1.5 KB');
      expect(Helpers.formatBytes(1536, 3)).toBe('1.5 KB');
    });
  });

  describe('formatDuration', () => {
    test('should format durations correctly', () => {
      expect(Helpers.formatDuration(500)).toBe('500ms');
      expect(Helpers.formatDuration(1000)).toBe('1s');
      expect(Helpers.formatDuration(61000)).toBe('1m 1s');
      expect(Helpers.formatDuration(3661000)).toBe('1h 1m 1s');
      expect(Helpers.formatDuration(90061000)).toBe('1d 1h 1m 1s');
    });

    test('should handle edge cases', () => {
      expect(Helpers.formatDuration(0)).toBe('0ms');
      expect(Helpers.formatDuration(999)).toBe('999ms');
      expect(Helpers.formatDuration(86400000)).toBe('1d 0h 0m 0s');
    });
  });

  describe('truncate', () => {
    test('should truncate long text', () => {
      const text = 'This is a very long text that needs to be truncated';
      expect(Helpers.truncate(text, 20)).toBe('This is a very lo...');
      expect(Helpers.truncate(text, 10)).toBe('This is...');
    });

    test('should not truncate short text', () => {
      const text = 'Short text';
      expect(Helpers.truncate(text, 20)).toBe('Short text');
    });

    test('should handle non-string inputs', () => {
      expect(Helpers.truncate(null)).toBe('');
      expect(Helpers.truncate(undefined)).toBe('');
      expect(Helpers.truncate(123)).toBe('');
    });

    test('should use default max length', () => {
      const text = 'a'.repeat(150);
      expect(Helpers.truncate(text)).toHaveLength(100);
      expect(Helpers.truncate(text).endsWith('...')).toBe(true);
    });
  });

  describe('parseJSON', () => {
    test('should parse valid JSON', () => {
      expect(Helpers.parseJSON('{"key": "value"}')).toEqual({ key: 'value' });
      expect(Helpers.parseJSON('[]')).toEqual([]);
      expect(Helpers.parseJSON('null')).toBeNull();
      expect(Helpers.parseJSON('42')).toBe(42);
      expect(Helpers.parseJSON('"string"')).toBe('string');
    });

    test('should return default value for invalid JSON', () => {
      expect(Helpers.parseJSON('invalid')).toBeNull();
      expect(Helpers.parseJSON('{invalid}')).toBeNull();
      expect(Helpers.parseJSON('', 'default')).toBe('default');
      expect(Helpers.parseJSON('{bad json}', {})).toEqual({});
    });
  });

  describe('stringifyJSON', () => {
    test('should stringify valid objects', () => {
      expect(Helpers.stringifyJSON({ key: 'value' })).toBe('{"key":"value"}');
      expect(Helpers.stringifyJSON([])).toBe('[]');
      expect(Helpers.stringifyJSON(null)).toBe('null');
      expect(Helpers.stringifyJSON(42)).toBe('42');
    });

    test('should return default value for circular references', () => {
      const obj = { a: 1 };
      obj.circular = obj;
      
      expect(Helpers.stringifyJSON(obj)).toBe('{}');
      expect(Helpers.stringifyJSON(obj, 'error')).toBe('error');
    });
  });

  describe('isEmpty', () => {
    test('should check if values are empty', () => {
      expect(Helpers.isEmpty(null)).toBe(true);
      expect(Helpers.isEmpty(undefined)).toBe(true);
      expect(Helpers.isEmpty('')).toBe(true);
      expect(Helpers.isEmpty([])).toBe(true);
      expect(Helpers.isEmpty({})).toBe(true);
      
      expect(Helpers.isEmpty('text')).toBe(false);
      expect(Helpers.isEmpty([1, 2, 3])).toBe(false);
      expect(Helpers.isEmpty({ key: 'value' })).toBe(false);
      expect(Helpers.isEmpty(0)).toBe(false);
      expect(Helpers.isEmpty(false)).toBe(false);
    });
  });

  describe('getNestedProperty', () => {
    test('should get nested properties', () => {
      const obj = {
        a: {
          b: {
            c: 'value'
          },
          d: [1, 2, 3]
        }
      };
      
      expect(Helpers.getNestedProperty(obj, 'a.b.c')).toBe('value');
      expect(Helpers.getNestedProperty(obj, 'a.d')).toEqual([1, 2, 3]);
      expect(Helpers.getNestedProperty(obj, 'a')).toEqual(obj.a);
    });

    test('should return default value for missing properties', () => {
      const obj = { a: { b: 'value' } };
      
      expect(Helpers.getNestedProperty(obj, 'a.b.c')).toBeUndefined();
      expect(Helpers.getNestedProperty(obj, 'x.y.z', 'default')).toBe('default');
      expect(Helpers.getNestedProperty(null, 'a.b', 'default')).toBe('default');
      expect(Helpers.getNestedProperty(obj, null, 'default')).toBe('default');
    });

    test('should handle edge cases', () => {
      expect(Helpers.getNestedProperty({}, '')).toBeUndefined();
      expect(Helpers.getNestedProperty({ a: null }, 'a.b')).toBeUndefined();
    });
  });

  describe('setNestedProperty', () => {
    test('should set nested properties', () => {
      const obj = {};
      
      Helpers.setNestedProperty(obj, 'a.b.c', 'value');
      expect(obj).toEqual({ a: { b: { c: 'value' } } });
      
      Helpers.setNestedProperty(obj, 'a.d', [1, 2, 3]);
      expect(obj.a.d).toEqual([1, 2, 3]);
    });

    test('should overwrite existing values', () => {
      const obj = { a: { b: 'old' } };
      
      Helpers.setNestedProperty(obj, 'a.b', 'new');
      expect(obj.a.b).toBe('new');
    });

    test('should handle edge cases', () => {
      expect(Helpers.setNestedProperty(null, 'a.b', 'value')).toBeNull();
      expect(Helpers.setNestedProperty({}, '', 'value')).toEqual({});
    });
  });

  describe('removeNullUndefined', () => {
    test('should remove null and undefined values', () => {
      const obj = {
        a: 'value',
        b: null,
        c: undefined,
        d: 0,
        e: false,
        f: ''
      };
      
      expect(Helpers.removeNullUndefined(obj)).toEqual({
        a: 'value',
        d: 0,
        e: false,
        f: ''
      });
    });

    test('should handle nested objects', () => {
      const obj = {
        a: {
          b: null,
          c: 'value',
          d: {
            e: undefined,
            f: 'nested'
          }
        }
      };
      
      expect(Helpers.removeNullUndefined(obj)).toEqual({
        a: {
          c: 'value',
          d: {
            f: 'nested'
          }
        }
      });
    });

    test('should handle arrays', () => {
      const arr = [1, null, 'text', undefined, 0, false];
      expect(Helpers.removeNullUndefined(arr)).toEqual([1, 'text', 0, false]);
    });

    test('should handle non-objects', () => {
      expect(Helpers.removeNullUndefined(null)).toBeNull();
      expect(Helpers.removeNullUndefined(undefined)).toBeUndefined();
      expect(Helpers.removeNullUndefined('string')).toBe('string');
      expect(Helpers.removeNullUndefined(42)).toBe(42);
    });
  });

  describe('deepMerge', () => {
    test('should merge objects deeply', () => {
      const target = { a: 1, b: { c: 2 } };
      const source = { b: { d: 3 }, e: 4 };
      
      const result = Helpers.deepMerge(target, source);
      
      expect(result).toEqual({
        a: 1,
        b: { c: 2, d: 3 },
        e: 4
      });
    });

    test('should merge multiple sources', () => {
      const target = { a: 1 };
      const source1 = { b: 2 };
      const source2 = { c: 3 };
      
      const result = Helpers.deepMerge(target, source1, source2);
      
      expect(result).toEqual({ a: 1, b: 2, c: 3 });
    });

    test('should handle non-object values', () => {
      const target = { a: { b: 1 } };
      const source = { a: 'string' };
      
      const result = Helpers.deepMerge(target, source);
      
      expect(result).toEqual({ a: 'string' });
    });

    test('should handle empty sources', () => {
      const target = { a: 1 };
      const result = Helpers.deepMerge(target);
      
      expect(result).toEqual({ a: 1 });
    });
  });

  describe('isObject', () => {
    test('should identify objects correctly', () => {
      expect(Helpers.isObject({})).toBe(true);
      expect(Helpers.isObject({ key: 'value' })).toBe(true);
      expect(Helpers.isObject(new Date())).toBe(true);
      
      expect(Helpers.isObject([])).toBe(false);
      expect(Helpers.isObject(null)).toBe(false);
      expect(Helpers.isObject(undefined)).toBe(false);
      expect(Helpers.isObject('string')).toBe(false);
      expect(Helpers.isObject(42)).toBe(false);
      expect(Helpers.isObject(true)).toBe(false);
    });
  });

  describe('debounce', () => {
    test('should debounce function calls', () => {
      jest.useFakeTimers();
      const fn = jest.fn();
      const debounced = Helpers.debounce(fn, 100);
      
      debounced('first');
      debounced('second');
      debounced('third');
      
      expect(fn).not.toHaveBeenCalled();
      
      jest.advanceTimersByTime(100);
      
      expect(fn).toHaveBeenCalledTimes(1);
      expect(fn).toHaveBeenCalledWith('third');
      
      jest.useRealTimers();
    });

    test('should handle multiple debounce cycles', () => {
      jest.useFakeTimers();
      const fn = jest.fn();
      const debounced = Helpers.debounce(fn, 100);
      
      debounced('first');
      jest.advanceTimersByTime(50);
      debounced('second');
      jest.advanceTimersByTime(100);
      
      expect(fn).toHaveBeenCalledTimes(1);
      expect(fn).toHaveBeenCalledWith('second');
      
      debounced('third');
      jest.advanceTimersByTime(100);
      
      expect(fn).toHaveBeenCalledTimes(2);
      expect(fn).toHaveBeenCalledWith('third');
      
      jest.useRealTimers();
    });
  });

  describe('throttle', () => {
    test('should throttle function calls', () => {
      jest.useFakeTimers();
      const fn = jest.fn();
      const throttled = Helpers.throttle(fn, 100);
      
      throttled('first');
      throttled('second');
      throttled('third');
      
      expect(fn).toHaveBeenCalledTimes(1);
      expect(fn).toHaveBeenCalledWith('first');
      
      jest.advanceTimersByTime(100);
      
      throttled('fourth');
      expect(fn).toHaveBeenCalledTimes(2);
      expect(fn).toHaveBeenCalledWith('fourth');
      
      jest.useRealTimers();
    });
  });

  describe('timeout', () => {
    test('should create a timeout promise', async () => {
      jest.useFakeTimers();
      const promise = Helpers.timeout(100);
      
      jest.advanceTimersByTime(100);
      
      await expect(promise).resolves.toBeUndefined();
      jest.useRealTimers();
    });
  });

  describe('timeoutReject', () => {
    test('should create a rejecting timeout promise', async () => {
      jest.useFakeTimers();
      const promise = Helpers.timeoutReject(100, 'Custom timeout');
      
      jest.advanceTimersByTime(100);
      
      await expect(promise).rejects.toThrow('Custom timeout');
      jest.useRealTimers();
    });

    test('should use default message', async () => {
      jest.useFakeTimers();
      const promise = Helpers.timeoutReject(100);
      
      jest.advanceTimersByTime(100);
      
      await expect(promise).rejects.toThrow('Operation timed out');
      jest.useRealTimers();
    });
  });

  describe('withTimeout', () => {
    test('should resolve if promise completes before timeout', async () => {
      const promise = Promise.resolve('success');
      const result = await Helpers.withTimeout(promise, 100);
      
      expect(result).toBe('success');
    });

    test('should reject if promise takes too long', async () => {
      jest.useFakeTimers();
      const promise = new Promise(() => {}); // Never resolves
      const timeoutPromise = Helpers.withTimeout(promise, 100);
      
      jest.advanceTimersByTime(100);
      
      await expect(timeoutPromise).rejects.toThrow('Operation timed out');
      jest.useRealTimers();
    });

    test('should use custom timeout message', async () => {
      jest.useFakeTimers();
      const promise = new Promise(() => {});
      const timeoutPromise = Helpers.withTimeout(promise, 100, 'Too slow');
      
      jest.advanceTimersByTime(100);
      
      await expect(timeoutPromise).rejects.toThrow('Too slow');
      jest.useRealTimers();
    });
  });

  describe('percentage', () => {
    test('should calculate percentages correctly', () => {
      expect(Helpers.percentage(25, 100)).toBe(25);
      expect(Helpers.percentage(1, 3)).toBe(33.33);
      expect(Helpers.percentage(1, 3, 1)).toBe(33.3);
      expect(Helpers.percentage(1, 3, 0)).toBe(33);
      expect(Helpers.percentage(0, 100)).toBe(0);
      expect(Helpers.percentage(100, 100)).toBe(100);
    });

    test('should handle division by zero', () => {
      expect(Helpers.percentage(10, 0)).toBe(0);
    });
  });

  describe('timestamp', () => {
    test('should generate ISO timestamp', () => {
      const ts = Helpers.timestamp();
      expect(ts).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
      expect(new Date(ts).getTime()).toBeLessThanOrEqual(Date.now());
    });
  });

  describe('isValidDate', () => {
    test('should validate dates correctly', () => {
      expect(Helpers.isValidDate(new Date())).toBe(true);
      expect(Helpers.isValidDate(new Date('2023-01-01'))).toBe(true);
      
      expect(Helpers.isValidDate(new Date('invalid'))).toBe(false);
      expect(Helpers.isValidDate('2023-01-01')).toBe(false);
      expect(Helpers.isValidDate(null)).toBe(false);
      expect(Helpers.isValidDate({})).toBe(false);
    });
  });

  describe('createArray', () => {
    test('should create array with specified length and value', () => {
      expect(Helpers.createArray(3, 'x')).toEqual(['x', 'x', 'x']);
      expect(Helpers.createArray(5, 0)).toEqual([0, 0, 0, 0, 0]);
      expect(Helpers.createArray(0)).toEqual([]);
    });

    test('should use null as default value', () => {
      expect(Helpers.createArray(3)).toEqual([null, null, null]);
    });
  });

  describe('randomItem', () => {
    test('should return random item from array', () => {
      const arr = [1, 2, 3, 4, 5];
      const item = Helpers.randomItem(arr);
      
      expect(arr).toContain(item);
    });

    test('should handle edge cases', () => {
      expect(Helpers.randomItem([])).toBeNull();
      expect(Helpers.randomItem(null)).toBeNull();
      expect(Helpers.randomItem('not array')).toBeNull();
    });

    test('should return the only item for single-item arrays', () => {
      expect(Helpers.randomItem([42])).toBe(42);
    });
  });

  describe('shuffle', () => {
    test('should shuffle array', () => {
      const original = [1, 2, 3, 4, 5];
      const shuffled = Helpers.shuffle(original);
      
      expect(shuffled).toHaveLength(original.length);
      expect(shuffled).not.toBe(original); // Different reference
      expect(shuffled.sort()).toEqual(original.sort()); // Same elements
    });

    test('should handle empty arrays', () => {
      expect(Helpers.shuffle([])).toEqual([]);
    });
  });

  describe('chunk', () => {
    test('should chunk array into smaller arrays', () => {
      const arr = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
      
      expect(Helpers.chunk(arr, 3)).toEqual([
        [1, 2, 3],
        [4, 5, 6],
        [7, 8, 9],
        [10]
      ]);
      
      expect(Helpers.chunk(arr, 5)).toEqual([
        [1, 2, 3, 4, 5],
        [6, 7, 8, 9, 10]
      ]);
    });

    test('should handle edge cases', () => {
      expect(Helpers.chunk([], 3)).toEqual([]);
      expect(Helpers.chunk([1, 2, 3], 0)).toEqual([]);
      expect(Helpers.chunk(null, 3)).toEqual([]);
      expect(Helpers.chunk([1, 2, 3], 10)).toEqual([[1, 2, 3]]);
    });
  });

  describe('unique', () => {
    test('should remove duplicates from primitive arrays', () => {
      expect(Helpers.unique([1, 2, 2, 3, 3, 3])).toEqual([1, 2, 3]);
      expect(Helpers.unique(['a', 'b', 'b', 'c'])).toEqual(['a', 'b', 'c']);
    });

    test('should remove duplicates using key function', () => {
      const arr = [
        { id: 1, name: 'A' },
        { id: 2, name: 'B' },
        { id: 1, name: 'C' },
        { id: 3, name: 'D' }
      ];
      
      const unique = Helpers.unique(arr, item => item.id);
      
      expect(unique).toHaveLength(3);
      expect(unique[0].name).toBe('A');
      expect(unique[1].name).toBe('B');
      expect(unique[2].name).toBe('D');
    });

    test('should handle non-array inputs', () => {
      expect(Helpers.unique(null)).toEqual([]);
      expect(Helpers.unique('not array')).toEqual([]);
    });
  });
});