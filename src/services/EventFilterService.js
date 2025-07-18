/**
 * Event Filter Service for Huly Webhook Service
 * Provides expression engine for filtering events based on webhook configuration
 */

const logger = require('../utils/logger');

class EventFilterService {
  constructor (config) {
    this.config = config;
    this.operators = new Map();
    this.functions = new Map();
    this.compiledFilters = new Map();

    // Initialize default operators and functions
    this.initializeOperators();
    this.initializeFunctions();
  }

  /**
   * Initialize comparison operators
   */
  initializeOperators () {
    // Equality operators
    this.operators.set('==', (a, b) => a === b);
    this.operators.set('!=', (a, b) => a !== b);
    this.operators.set('=', (a, b) => a === b);
    this.operators.set('<>', (a, b) => a !== b);

    // Comparison operators
    this.operators.set('>', (a, b) => a > b);
    this.operators.set('<', (a, b) => a < b);
    this.operators.set('>=', (a, b) => a >= b);
    this.operators.set('<=', (a, b) => a <= b);

    // String operators
    this.operators.set('contains', (a, b) => {
      if (typeof a !== 'string' || typeof b !== 'string') return false;
      return a.toLowerCase().includes(b.toLowerCase());
    });

    this.operators.set('startsWith', (a, b) => {
      if (typeof a !== 'string' || typeof b !== 'string') return false;
      return a.toLowerCase().startsWith(b.toLowerCase());
    });

    this.operators.set('endsWith', (a, b) => {
      if (typeof a !== 'string' || typeof b !== 'string') return false;
      return a.toLowerCase().endsWith(b.toLowerCase());
    });

    this.operators.set('matches', (a, b) => {
      if (typeof a !== 'string' || typeof b !== 'string') return false;
      try {
        const regex = new RegExp(b, 'i');
        return regex.test(a);
      } catch (error) {
        return false;
      }
    });

    // Array operators
    this.operators.set('in', (a, b) => {
      if (!Array.isArray(b)) return false;
      return b.includes(a);
    });

    this.operators.set('notIn', (a, b) => {
      if (!Array.isArray(b)) return false;
      return !b.includes(a);
    });

    this.operators.set('hasAny', (a, b) => {
      if (!Array.isArray(a) || !Array.isArray(b)) return false;
      return a.some(item => b.includes(item));
    });

    this.operators.set('hasAll', (a, b) => {
      if (!Array.isArray(a) || !Array.isArray(b)) return false;
      return b.every(item => a.includes(item));
    });

    // Existence operators
    this.operators.set('exists', (a, b) => {
      return a !== undefined && a !== null;
    });

    this.operators.set('notExists', (a, b) => {
      return a === undefined || a === null;
    });

    // Type operators
    this.operators.set('isString', (a, b) => typeof a === 'string');
    this.operators.set('isNumber', (a, b) => typeof a === 'number');
    this.operators.set('isBoolean', (a, b) => typeof a === 'boolean');
    this.operators.set('isArray', (a, b) => Array.isArray(a));
    this.operators.set('isObject', (a, b) => typeof a === 'object' && a !== null && !Array.isArray(a));
    this.operators.set('isNull', (a, b) => a === null);
    this.operators.set('isUndefined', (a, b) => a === undefined);

    // Date operators
    this.operators.set('before', (a, b) => {
      const dateA = new Date(a);
      const dateB = new Date(b);
      return dateA < dateB;
    });

    this.operators.set('after', (a, b) => {
      const dateA = new Date(a);
      const dateB = new Date(b);
      return dateA > dateB;
    });

    this.operators.set('between', (a, b) => {
      if (!Array.isArray(b) || b.length !== 2) return false;
      const dateA = new Date(a);
      const dateStart = new Date(b[0]);
      const dateEnd = new Date(b[1]);
      return dateA >= dateStart && dateA <= dateEnd;
    });
  }

  /**
   * Initialize utility functions
   */
  initializeFunctions () {
    // String functions
    this.functions.set('toLowerCase', (value) => {
      return typeof value === 'string' ? value.toLowerCase() : value;
    });

    this.functions.set('toUpperCase', (value) => {
      return typeof value === 'string' ? value.toUpperCase() : value;
    });

    this.functions.set('trim', (value) => {
      return typeof value === 'string' ? value.trim() : value;
    });

    this.functions.set('length', (value) => {
      if (typeof value === 'string' || Array.isArray(value)) {
        return value.length;
      }
      return 0;
    });

    // Array functions
    this.functions.set('first', (value) => {
      return Array.isArray(value) && value.length > 0 ? value[0] : undefined;
    });

    this.functions.set('last', (value) => {
      return Array.isArray(value) && value.length > 0 ? value[value.length - 1] : undefined;
    });

    this.functions.set('size', (value) => {
      if (Array.isArray(value)) return value.length;
      if (typeof value === 'object' && value !== null) return Object.keys(value).length;
      return 0;
    });

    // Math functions
    this.functions.set('abs', (value) => {
      return typeof value === 'number' ? Math.abs(value) : value;
    });

    this.functions.set('floor', (value) => {
      return typeof value === 'number' ? Math.floor(value) : value;
    });

    this.functions.set('ceil', (value) => {
      return typeof value === 'number' ? Math.ceil(value) : value;
    });

    this.functions.set('round', (value) => {
      return typeof value === 'number' ? Math.round(value) : value;
    });

    // Date functions
    this.functions.set('now', () => new Date());
    this.functions.set('today', () => {
      const now = new Date();
      return new Date(now.getFullYear(), now.getMonth(), now.getDate());
    });

    this.functions.set('toDate', (value) => {
      return new Date(value);
    });

    this.functions.set('formatDate', (value, format = 'ISO') => {
      const date = new Date(value);
      if (format === 'ISO') return date.toISOString();
      if (format === 'date') return date.toDateString();
      if (format === 'time') return date.toTimeString();
      return date.toString();
    });

    // Utility functions
    this.functions.set('coalesce', (...args) => {
      return args.find(arg => arg !== null && arg !== undefined);
    });

    this.functions.set('default', (value, defaultValue) => {
      return value !== null && value !== undefined ? value : defaultValue;
    });

    this.functions.set('type', (value) => {
      if (value === null) return 'null';
      if (Array.isArray(value)) return 'array';
      return typeof value;
    });
  }

  /**
   * Evaluate filter expression against event data
   * @param {string} expression - Filter expression
   * @param {Object} eventData - Event data to evaluate
   * @returns {boolean} - Whether event matches filter
   */
  evaluateFilter (expression, eventData) {
    try {
      if (!expression || expression.trim() === '') {
        return true; // Empty filter matches all events
      }

      // Check if filter is already compiled
      let compiledFilter = this.compiledFilters.get(expression);
      if (!compiledFilter) {
        compiledFilter = this.compileFilter(expression);
        this.compiledFilters.set(expression, compiledFilter);
      }

      const result = this.executeCompiledFilter(compiledFilter, eventData);

      logger.debug('Filter evaluation result:', {
        expression,
        result,
        eventType: eventData.event
      });

      return result;
    } catch (error) {
      logger.error('Error evaluating filter:', error);
      return false; // Reject events on filter error
    }
  }

  /**
   * Compile filter expression into executable form
   * @param {string} expression - Filter expression
   * @returns {Object} - Compiled filter
   */
  compileFilter (expression) {
    try {
      // Parse the expression
      const ast = this.parseExpression(expression);

      // Compile the AST
      const compiled = this.compileAST(ast);

      return compiled;
    } catch (error) {
      logger.error('Error compiling filter:', error);
      throw new Error(`Invalid filter expression: ${error.message}`);
    }
  }

  /**
   * Parse filter expression into AST
   * @param {string} expression - Filter expression
   * @returns {Object} - Abstract Syntax Tree
   */
  parseExpression (expression) {
    // Simple expression parser
    // This is a basic implementation - in production, you'd want a more robust parser

    const tokens = this.tokenize(expression);
    return this.parseTokens(tokens);
  }

  /**
   * Tokenize expression string
   * @param {string} expression - Expression string
   * @returns {Array} - Token array
   */
  tokenize (expression) {
    const tokens = [];
    let current = 0;

    while (current < expression.length) {
      let char = expression[current];

      // Skip whitespace
      if (/\s/.test(char)) {
        current++;
        continue;
      }

      // String literals
      if (char === '"' || char === '\'') {
        const quote = char;
        let value = '';
        current++;

        while (current < expression.length && expression[current] !== quote) {
          if (expression[current] === '\\' && current + 1 < expression.length) {
            current++;
            char = expression[current];
            if (char === 'n') value += '\n';
            else if (char === 't') value += '\t';
            else if (char === 'r') value += '\r';
            else value += char;
          } else {
            value += expression[current];
          }
          current++;
        }

        if (current < expression.length) current++; // Skip closing quote
        tokens.push({ type: 'string', value });
        continue;
      }

      // Numbers
      if (/\d/.test(char)) {
        let value = '';
        while (current < expression.length && /[\d.]/.test(expression[current])) {
          value += expression[current];
          current++;
        }
        tokens.push({ type: 'number', value: parseFloat(value) });
        continue;
      }

      // Identifiers and keywords
      if (/[a-zA-Z_]/.test(char)) {
        let value = '';
        while (current < expression.length && /[a-zA-Z0-9_.]/.test(expression[current])) {
          value += expression[current];
          current++;
        }

        // Check for boolean literals
        if (value === 'true' || value === 'false') {
          tokens.push({ type: 'boolean', value: value === 'true' });
        } else if (value === 'null') {
          tokens.push({ type: 'null', value: null });
        } else if (value === 'undefined') {
          tokens.push({ type: 'undefined', value: undefined });
        } else {
          tokens.push({ type: 'identifier', value });
        }
        continue;
      }

      // Operators
      if (char === '=' && current + 1 < expression.length && expression[current + 1] === '=') {
        tokens.push({ type: 'operator', value: '==' });
        current += 2;
        continue;
      }

      if (char === '!' && current + 1 < expression.length && expression[current + 1] === '=') {
        tokens.push({ type: 'operator', value: '!=' });
        current += 2;
        continue;
      }

      if (char === '<' && current + 1 < expression.length && expression[current + 1] === '=') {
        tokens.push({ type: 'operator', value: '<=' });
        current += 2;
        continue;
      }

      if (char === '>' && current + 1 < expression.length && expression[current + 1] === '=') {
        tokens.push({ type: 'operator', value: '>=' });
        current += 2;
        continue;
      }

      if (char === '<' && current + 1 < expression.length && expression[current + 1] === '>') {
        tokens.push({ type: 'operator', value: '<>' });
        current += 2;
        continue;
      }

      if (char === '&' && current + 1 < expression.length && expression[current + 1] === '&') {
        tokens.push({ type: 'operator', value: '&&' });
        current += 2;
        continue;
      }

      if (char === '|' && current + 1 < expression.length && expression[current + 1] === '|') {
        tokens.push({ type: 'operator', value: '||' });
        current += 2;
        continue;
      }

      // Single character tokens
      if ('()[]{}=<>!&|'.includes(char)) {
        tokens.push({ type: 'operator', value: char });
        current++;
        continue;
      }

      // Unknown character
      throw new Error(`Unexpected character: ${char} at position ${current}`);
    }

    return tokens;
  }

  /**
   * Parse tokens into AST
   * @param {Array} tokens - Token array
   * @returns {Object} - AST node
   */
  parseTokens (tokens) {
    let current = 0;

    function parseExpression () {
      return parseOrExpression();
    }

    function parseOrExpression () {
      let left = parseAndExpression();

      while (current < tokens.length && tokens[current].value === '||') {
        const operator = tokens[current].value;
        current++;
        const right = parseAndExpression();
        left = { type: 'binary', operator, left, right };
      }

      return left;
    }

    function parseAndExpression () {
      let left = parseComparisonExpression();

      while (current < tokens.length && tokens[current].value === '&&') {
        const operator = tokens[current].value;
        current++;
        const right = parseComparisonExpression();
        left = { type: 'binary', operator, left, right };
      }

      return left;
    }

    function parseComparisonExpression () {
      let left = parsePrimaryExpression();

      const comparisonOps = ['==', '!=', '>', '<', '>=', '<=', '<>', '=', 'contains', 'startsWith', 'endsWith', 'matches', 'in', 'notIn', 'hasAny', 'hasAll', 'exists', 'notExists', 'before', 'after', 'between'];

      while (current < tokens.length && comparisonOps.includes(tokens[current].value)) {
        const operator = tokens[current].value;
        current++;
        const right = parsePrimaryExpression();
        left = { type: 'binary', operator, left, right };
      }

      return left;
    }

    function parsePrimaryExpression () {
      const token = tokens[current];

      if (!token) {
        throw new Error('Unexpected end of expression');
      }

      if (token.value === '(') {
        current++;
        const expr = parseExpression();
        if (current >= tokens.length || tokens[current].value !== ')') {
          throw new Error('Expected closing parenthesis');
        }
        current++;
        return expr;
      }

      if (token.value === '!') {
        current++;
        const expr = parsePrimaryExpression();
        return { type: 'unary', operator: '!', operand: expr };
      }

      if (token.type === 'identifier') {
        current++;

        // Check for function call
        if (current < tokens.length && tokens[current].value === '(') {
          current++;
          const args = [];

          while (current < tokens.length && tokens[current].value !== ')') {
            args.push(parseExpression());
            if (current < tokens.length && tokens[current].value === ',') {
              current++;
            }
          }

          if (current >= tokens.length || tokens[current].value !== ')') {
            throw new Error('Expected closing parenthesis in function call');
          }
          current++;

          return { type: 'function', name: token.value, args };
        }

        return { type: 'identifier', name: token.value };
      }

      if (token.type === 'string' || token.type === 'number' || token.type === 'boolean' || token.type === 'null' || token.type === 'undefined') {
        current++;
        return { type: 'literal', value: token.value };
      }

      if (token.value === '[') {
        current++;
        const elements = [];

        while (current < tokens.length && tokens[current].value !== ']') {
          elements.push(parseExpression());
          if (current < tokens.length && tokens[current].value === ',') {
            current++;
          }
        }

        if (current >= tokens.length || tokens[current].value !== ']') {
          throw new Error('Expected closing bracket');
        }
        current++;

        return { type: 'array', elements };
      }

      throw new Error(`Unexpected token: ${token.value}`);
    }

    return parseExpression();
  }

  /**
   * Compile AST into executable form
   * @param {Object} ast - Abstract Syntax Tree
   * @returns {Function} - Compiled filter function
   */
  compileAST (ast) {
    const self = this;

    function compile (node) {
      switch (node.type) {
      case 'literal':
        return () => node.value;

      case 'identifier':
        return (data) => self.getValueByPath(data, node.name);

      case 'binary':
        const leftFn = compile(node.left);
        const rightFn = compile(node.right);
        const operator = self.operators.get(node.operator);

        if (node.operator === '&&') {
          return (data) => leftFn(data) && rightFn(data);
        } else if (node.operator === '||') {
          return (data) => leftFn(data) || rightFn(data);
        } else if (operator) {
          return (data) => operator(leftFn(data), rightFn(data));
        } else {
          throw new Error(`Unknown operator: ${node.operator}`);
        }

      case 'unary':
        const operandFn = compile(node.operand);
        if (node.operator === '!') {
          return (data) => !operandFn(data);
        } else {
          throw new Error(`Unknown unary operator: ${node.operator}`);
        }

      case 'function':
        const func = self.functions.get(node.name);
        if (!func) {
          throw new Error(`Unknown function: ${node.name}`);
        }

        const argFns = node.args.map(arg => compile(arg));
        return (data) => func(...argFns.map(fn => fn(data)));

      case 'array':
        const elementFns = node.elements.map(element => compile(element));
        return (data) => elementFns.map(fn => fn(data));

      default:
        throw new Error(`Unknown node type: ${node.type}`);
      }
    }

    return compile(ast);
  }

  /**
   * Execute compiled filter
   * @param {Function} compiledFilter - Compiled filter function
   * @param {Object} eventData - Event data
   * @returns {boolean} - Filter result
   */
  executeCompiledFilter (compiledFilter, eventData) {
    try {
      const result = compiledFilter(eventData);
      return Boolean(result);
    } catch (error) {
      logger.error('Error executing compiled filter:', error);
      return false;
    }
  }

  /**
   * Get value by dot-notation path
   * @param {Object} data - Data object
   * @param {string} path - Dot-notation path
   * @returns {*} - Value at path
   */
  getValueByPath (data, path) {
    if (!path || !data) return undefined;

    const keys = path.split('.');
    let current = data;

    for (const key of keys) {
      if (current === null || current === undefined) {
        return undefined;
      }

      // Handle array access
      if (key.includes('[') && key.includes(']')) {
        const match = key.match(/^(.+)\[(\d+)\]$/);
        if (match) {
          const [, objectKey, index] = match;
          current = current[objectKey];
          if (Array.isArray(current)) {
            current = current[parseInt(index)];
          } else {
            return undefined;
          }
        } else {
          current = current[key];
        }
      } else {
        current = current[key];
      }
    }

    return current;
  }

  /**
   * Validate filter expression
   * @param {string} expression - Filter expression
   * @returns {Object} - Validation result
   */
  validateFilter (expression) {
    try {
      if (!expression || expression.trim() === '') {
        return { valid: true, message: 'Empty filter is valid' };
      }

      const compiledFilter = this.compileFilter(expression);

      // Test with dummy data
      const testData = {
        event: 'test.event',
        data: { id: 'test', type: 'test' },
        timestamp: new Date().toISOString()
      };

      this.executeCompiledFilter(compiledFilter, testData);

      return { valid: true, message: 'Filter is valid' };
    } catch (error) {
      return { valid: false, message: error.message };
    }
  }

  /**
   * Get filter statistics
   * @returns {Object} - Filter statistics
   */
  getFilterStats () {
    return {
      compiledFilters: this.compiledFilters.size,
      operators: this.operators.size,
      functions: this.functions.size,
      availableOperators: Array.from(this.operators.keys()),
      availableFunctions: Array.from(this.functions.keys())
    };
  }

  /**
   * Clear compiled filter cache
   */
  clearFilterCache () {
    this.compiledFilters.clear();
    logger.info('Cleared compiled filter cache');
  }

  /**
   * Add custom operator
   * @param {string} name - Operator name
   * @param {Function} implementation - Operator implementation
   */
  addCustomOperator (name, implementation) {
    this.operators.set(name, implementation);
    logger.info(`Added custom operator: ${name}`);
  }

  /**
   * Add custom function
   * @param {string} name - Function name
   * @param {Function} implementation - Function implementation
   */
  addCustomFunction (name, implementation) {
    this.functions.set(name, implementation);
    logger.info(`Added custom function: ${name}`);
  }
}

module.exports = EventFilterService;
