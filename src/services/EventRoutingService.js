/**
 * Event Routing Service for Huly Webhook Service
 * Handles collection-specific event routing and webhook targeting
 */

const logger = require('../utils/logger');

class EventRoutingService {
  constructor (config) {
    this.config = config;
    this.routingRules = new Map();
    this.collectionMappings = new Map();
    this.webhookTargets = new Map();
    this.routingStats = {
      totalEvents: 0,
      routedEvents: 0,
      droppedEvents: 0,
      routingErrors: 0,
      routesByCollection: {},
      routesByWebhook: {},
      routesByEventType: {}
    };

    // Initialize default routing rules
    this.initializeDefaultRoutes();
  }

  /**
   * Initialize default routing rules
   */
  initializeDefaultRoutes () {
    // Core Huly collection routing
    this.collectionMappings.set('tx', {
      collections: ['tx'],
      eventTypes: ['transaction.*'],
      priority: 'high',
      description: 'Transaction events'
    });

    this.collectionMappings.set('issues', {
      collections: ['issues'],
      eventTypes: ['issue.*'],
      priority: 'high',
      description: 'Issue management events'
    });

    this.collectionMappings.set('projects', {
      collections: ['projects'],
      eventTypes: ['project.*'],
      priority: 'high',
      description: 'Project management events'
    });

    this.collectionMappings.set('users', {
      collections: ['users'],
      eventTypes: ['user.*'],
      priority: 'medium',
      description: 'User management events'
    });

    this.collectionMappings.set('documents', {
      collections: ['documents'],
      eventTypes: ['document.*'],
      priority: 'medium',
      description: 'Document management events'
    });

    this.collectionMappings.set('comments', {
      collections: ['comments'],
      eventTypes: ['comment.*'],
      priority: 'medium',
      description: 'Comment events'
    });

    this.collectionMappings.set('attachments', {
      collections: ['attachments'],
      eventTypes: ['attachment.*'],
      priority: 'low',
      description: 'Attachment events'
    });

    // Team collaboration
    this.collectionMappings.set('teams', {
      collections: ['teams'],
      eventTypes: ['team.*'],
      priority: 'medium',
      description: 'Team management events'
    });

    this.collectionMappings.set('workspaces', {
      collections: ['workspaces'],
      eventTypes: ['workspace.*'],
      priority: 'high',
      description: 'Workspace events'
    });

    // Communication
    this.collectionMappings.set('channels', {
      collections: ['channels'],
      eventTypes: ['channel.*'],
      priority: 'medium',
      description: 'Channel events'
    });

    this.collectionMappings.set('messages', {
      collections: ['messages'],
      eventTypes: ['message.*'],
      priority: 'medium',
      description: 'Message events'
    });

    // CRM
    this.collectionMappings.set('contacts', {
      collections: ['contacts'],
      eventTypes: ['contact.*'],
      priority: 'medium',
      description: 'Contact management events'
    });

    this.collectionMappings.set('organizations', {
      collections: ['organizations'],
      eventTypes: ['organization.*'],
      priority: 'medium',
      description: 'Organization events'
    });

    this.collectionMappings.set('leads', {
      collections: ['leads'],
      eventTypes: ['lead.*'],
      priority: 'medium',
      description: 'Lead management events'
    });

    // HR/Recruitment
    this.collectionMappings.set('candidates', {
      collections: ['candidates'],
      eventTypes: ['candidate.*'],
      priority: 'medium',
      description: 'Candidate management events'
    });

    this.collectionMappings.set('applications', {
      collections: ['applications'],
      eventTypes: ['application.*'],
      priority: 'medium',
      description: 'Application events'
    });

    this.collectionMappings.set('vacancies', {
      collections: ['vacancies'],
      eventTypes: ['vacancy.*'],
      priority: 'medium',
      description: 'Vacancy management events'
    });

    // System collections
    this.collectionMappings.set('audit', {
      collections: ['audit'],
      eventTypes: ['audit.*'],
      priority: 'low',
      description: 'Audit trail events'
    });

    this.collectionMappings.set('notifications', {
      collections: ['notifications'],
      eventTypes: ['notification.*'],
      priority: 'low',
      description: 'Notification events'
    });

    this.collectionMappings.set('activity', {
      collections: ['activity'],
      eventTypes: ['activity.*'],
      priority: 'low',
      description: 'Activity tracking events'
    });
  }

  /**
   * Route event to appropriate webhooks
   * @param {Object} changeEvent - MongoDB change event
   * @param {Object} eventDetails - Event details from EventTypeDetectionService
   * @param {Array} availableWebhooks - Available webhooks
   * @returns {Array} - Targeted webhooks
   */
  routeEvent (changeEvent, eventDetails, availableWebhooks) {
    try {
      this.routingStats.totalEvents++;

      const collection = eventDetails.collection;
      const eventType = eventDetails.eventType;
      const entityType = eventDetails.entityType;

      logger.debug('Routing event:', {
        collection,
        eventType,
        entityType,
        availableWebhooks: availableWebhooks.length
      });

      // Find matching webhooks
      const targetedWebhooks = this.findTargetedWebhooks(
        collection,
        eventType,
        entityType,
        availableWebhooks,
        changeEvent
      );

      // Update routing statistics
      this.updateRoutingStats(collection, eventType, targetedWebhooks);

      if (targetedWebhooks.length > 0) {
        this.routingStats.routedEvents++;
        logger.debug(`Routed event to ${targetedWebhooks.length} webhooks`);
      } else {
        this.routingStats.droppedEvents++;
        logger.debug('Event dropped - no matching webhooks found');
      }

      return targetedWebhooks;
    } catch (error) {
      this.routingStats.routingErrors++;
      logger.error('Error routing event:', error);
      return [];
    }
  }

  /**
   * Find webhooks that should receive this event
   * @param {string} collection - MongoDB collection name
   * @param {string} eventType - Event type
   * @param {string} entityType - Entity type
   * @param {Array} availableWebhooks - Available webhooks
   * @param {Object} changeEvent - Change event for additional context
   * @returns {Array} - Matching webhooks
   */
  findTargetedWebhooks (collection, eventType, entityType, availableWebhooks, changeEvent) {
    const matchingWebhooks = [];

    for (const webhook of availableWebhooks) {
      if (this.webhookMatchesEvent(webhook, collection, eventType, entityType, changeEvent)) {
        matchingWebhooks.push(webhook);
      }
    }

    return matchingWebhooks;
  }

  /**
   * Check if webhook matches the event
   * @param {Object} webhook - Webhook configuration
   * @param {string} collection - Collection name
   * @param {string} eventType - Event type
   * @param {string} entityType - Entity type
   * @param {Object} changeEvent - Change event
   * @returns {boolean} - Whether webhook matches
   */
  webhookMatchesEvent (webhook, collection, eventType, entityType, changeEvent) {
    try {
      // Check if webhook is enabled
      if (!webhook.enabled) {
        return false;
      }

      // Check collection filters
      if (!this.matchesCollectionFilter(webhook, collection)) {
        return false;
      }

      // Check event type filters
      if (!this.matchesEventTypeFilter(webhook, eventType)) {
        return false;
      }

      // Check entity type filters
      if (!this.matchesEntityTypeFilter(webhook, entityType)) {
        return false;
      }

      // Check custom routing rules
      if (!this.matchesCustomRules(webhook, collection, eventType, entityType, changeEvent)) {
        return false;
      }

      return true;
    } catch (error) {
      logger.error('Error checking webhook match:', error);
      return false;
    }
  }

  /**
   * Check if webhook matches collection filter
   * @param {Object} webhook - Webhook configuration
   * @param {string} collection - Collection name
   * @returns {boolean} - Whether it matches
   */
  matchesCollectionFilter (webhook, collection) {
    // If no collection filter specified, match all
    if (!webhook.collectionFilter || webhook.collectionFilter.length === 0) {
      return true;
    }

    // Check if collection is in the filter list
    return webhook.collectionFilter.includes(collection);
  }

  /**
   * Check if webhook matches event type filter
   * @param {Object} webhook - Webhook configuration
   * @param {string} eventType - Event type
   * @returns {boolean} - Whether it matches
   */
  matchesEventTypeFilter (webhook, eventType) {
    // If no event type filter specified, match all
    if (!webhook.eventTypeFilter || webhook.eventTypeFilter.length === 0) {
      return true;
    }

    // Check exact matches
    if (webhook.eventTypeFilter.includes(eventType)) {
      return true;
    }

    // Check pattern matches
    for (const pattern of webhook.eventTypeFilter) {
      if (this.matchesPattern(eventType, pattern)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Check if webhook matches entity type filter
   * @param {Object} webhook - Webhook configuration
   * @param {string} entityType - Entity type
   * @returns {boolean} - Whether it matches
   */
  matchesEntityTypeFilter (webhook, entityType) {
    // If no entity type filter specified, match all
    if (!webhook.entityTypeFilter || webhook.entityTypeFilter.length === 0) {
      return true;
    }

    // Check if entity type is in the filter list
    return webhook.entityTypeFilter.includes(entityType);
  }

  /**
   * Check if webhook matches custom routing rules
   * @param {Object} webhook - Webhook configuration
   * @param {string} collection - Collection name
   * @param {string} eventType - Event type
   * @param {string} entityType - Entity type
   * @param {Object} changeEvent - Change event
   * @returns {boolean} - Whether it matches
   */
  matchesCustomRules (webhook, collection, eventType, entityType, changeEvent) {
    // If no custom rules specified, match all
    if (!webhook.customRules || webhook.customRules.length === 0) {
      return true;
    }

    // Apply custom rules
    for (const rule of webhook.customRules) {
      if (!this.evaluateCustomRule(rule, collection, eventType, entityType, changeEvent)) {
        return false;
      }
    }

    return true;
  }

  /**
   * Evaluate custom routing rule
   * @param {Object} rule - Custom rule
   * @param {string} collection - Collection name
   * @param {string} eventType - Event type
   * @param {string} entityType - Entity type
   * @param {Object} changeEvent - Change event
   * @returns {boolean} - Whether rule matches
   */
  evaluateCustomRule (rule, collection, eventType, entityType, changeEvent) {
    try {
      switch (rule.type) {
      case 'collection':
        return this.evaluateCollectionRule(rule, collection);
      case 'eventType':
        return this.evaluateEventTypeRule(rule, eventType);
      case 'entityType':
        return this.evaluateEntityTypeRule(rule, entityType);
      case 'field':
        return this.evaluateFieldRule(rule, changeEvent);
      case 'namespace':
        return this.evaluateNamespaceRule(rule, changeEvent);
      case 'documentId':
        return this.evaluateDocumentIdRule(rule, changeEvent);
      case 'operationType':
        return this.evaluateOperationTypeRule(rule, changeEvent);
      case 'custom':
        return this.evaluateCustomFunction(rule, collection, eventType, entityType, changeEvent);
      default:
        logger.warn('Unknown custom rule type:', rule.type);
        return true;
      }
    } catch (error) {
      logger.error('Error evaluating custom rule:', error);
      return false;
    }
  }

  /**
   * Evaluate collection rule
   * @param {Object} rule - Rule configuration
   * @param {string} collection - Collection name
   * @returns {boolean} - Whether rule matches
   */
  evaluateCollectionRule (rule, collection) {
    switch (rule.operator) {
    case 'equals':
      return collection === rule.value;
    case 'not_equals':
      return collection !== rule.value;
    case 'in':
      return Array.isArray(rule.value) && rule.value.includes(collection);
    case 'not_in':
      return Array.isArray(rule.value) && !rule.value.includes(collection);
    case 'matches':
      return this.matchesPattern(collection, rule.value);
    case 'not_matches':
      return !this.matchesPattern(collection, rule.value);
    default:
      return true;
    }
  }

  /**
   * Evaluate event type rule
   * @param {Object} rule - Rule configuration
   * @param {string} eventType - Event type
   * @returns {boolean} - Whether rule matches
   */
  evaluateEventTypeRule (rule, eventType) {
    switch (rule.operator) {
    case 'equals':
      return eventType === rule.value;
    case 'not_equals':
      return eventType !== rule.value;
    case 'in':
      return Array.isArray(rule.value) && rule.value.includes(eventType);
    case 'not_in':
      return Array.isArray(rule.value) && !rule.value.includes(eventType);
    case 'matches':
      return this.matchesPattern(eventType, rule.value);
    case 'not_matches':
      return !this.matchesPattern(eventType, rule.value);
    case 'starts_with':
      return eventType.startsWith(rule.value);
    case 'ends_with':
      return eventType.endsWith(rule.value);
    case 'contains':
      return eventType.includes(rule.value);
    default:
      return true;
    }
  }

  /**
   * Evaluate entity type rule
   * @param {Object} rule - Rule configuration
   * @param {string} entityType - Entity type
   * @returns {boolean} - Whether rule matches
   */
  evaluateEntityTypeRule (rule, entityType) {
    return this.evaluateEventTypeRule(rule, entityType); // Same logic
  }

  /**
   * Evaluate field rule
   * @param {Object} rule - Rule configuration
   * @param {Object} changeEvent - Change event
   * @returns {boolean} - Whether rule matches
   */
  evaluateFieldRule (rule, changeEvent) {
    const fieldValue = this.getFieldValue(changeEvent, rule.field);

    switch (rule.operator) {
    case 'exists':
      return fieldValue !== undefined && fieldValue !== null;
    case 'not_exists':
      return fieldValue === undefined || fieldValue === null;
    case 'equals':
      return fieldValue === rule.value;
    case 'not_equals':
      return fieldValue !== rule.value;
    case 'in':
      return Array.isArray(rule.value) && rule.value.includes(fieldValue);
    case 'not_in':
      return Array.isArray(rule.value) && !rule.value.includes(fieldValue);
    case 'matches':
      return typeof fieldValue === 'string' && this.matchesPattern(fieldValue, rule.value);
    case 'greater_than':
      return fieldValue > rule.value;
    case 'less_than':
      return fieldValue < rule.value;
    case 'greater_than_or_equal':
      return fieldValue >= rule.value;
    case 'less_than_or_equal':
      return fieldValue <= rule.value;
    default:
      return true;
    }
  }

  /**
   * Evaluate namespace rule
   * @param {Object} rule - Rule configuration
   * @param {Object} changeEvent - Change event
   * @returns {boolean} - Whether rule matches
   */
  evaluateNamespaceRule (rule, changeEvent) {
    const namespace = changeEvent.ns ? `${changeEvent.ns.db}.${changeEvent.ns.coll}` : '';
    return this.evaluateEventTypeRule({ ...rule, value: rule.value }, namespace);
  }

  /**
   * Evaluate document ID rule
   * @param {Object} rule - Rule configuration
   * @param {Object} changeEvent - Change event
   * @returns {boolean} - Whether rule matches
   */
  evaluateDocumentIdRule (rule, changeEvent) {
    const documentId = changeEvent.documentKey ? changeEvent.documentKey._id : null;
    const documentIdStr = documentId ? documentId.toString() : '';
    return this.evaluateEventTypeRule({ ...rule, value: rule.value }, documentIdStr);
  }

  /**
   * Evaluate operation type rule
   * @param {Object} rule - Rule configuration
   * @param {Object} changeEvent - Change event
   * @returns {boolean} - Whether rule matches
   */
  evaluateOperationTypeRule (rule, changeEvent) {
    const operationType = changeEvent.operationType || '';
    return this.evaluateEventTypeRule({ ...rule, value: rule.value }, operationType);
  }

  /**
   * Evaluate custom function rule
   * @param {Object} rule - Rule configuration
   * @param {string} collection - Collection name
   * @param {string} eventType - Event type
   * @param {string} entityType - Entity type
   * @param {Object} changeEvent - Change event
   * @returns {boolean} - Whether rule matches
   */
  evaluateCustomFunction (rule, collection, eventType, entityType, changeEvent) {
    try {
      // This would be implemented with a safe eval or plugin system
      // For now, return true to allow the event through
      logger.debug('Custom function rule evaluation not implemented:', rule);
      return true;
    } catch (error) {
      logger.error('Error evaluating custom function:', error);
      return false;
    }
  }

  /**
   * Get field value from change event
   * @param {Object} changeEvent - Change event
   * @param {string} fieldPath - Field path (dot notation)
   * @returns {*} - Field value
   */
  getFieldValue (changeEvent, fieldPath) {
    const paths = fieldPath.split('.');
    let current = changeEvent;

    for (const path of paths) {
      if (current && typeof current === 'object' && path in current) {
        current = current[path];
      } else {
        return undefined;
      }
    }

    return current;
  }

  /**
   * Check if string matches pattern
   * @param {string} str - String to check
   * @param {string} pattern - Pattern (supports wildcards)
   * @returns {boolean} - Whether string matches pattern
   */
  matchesPattern (str, pattern) {
    if (!pattern) return true;

    // Convert wildcard pattern to regex
    const regex = new RegExp(
      pattern.replace(/\*/g, '.*').replace(/\?/g, '.'),
      'i'
    );

    return regex.test(str);
  }

  /**
   * Update routing statistics
   * @param {string} collection - Collection name
   * @param {string} eventType - Event type
   * @param {Array} targetedWebhooks - Targeted webhooks
   */
  updateRoutingStats (collection, eventType, targetedWebhooks) {
    // Update collection stats
    this.routingStats.routesByCollection[collection] =
      (this.routingStats.routesByCollection[collection] || 0) + 1;

    // Update event type stats
    this.routingStats.routesByEventType[eventType] =
      (this.routingStats.routesByEventType[eventType] || 0) + 1;

    // Update webhook stats
    for (const webhook of targetedWebhooks) {
      this.routingStats.routesByWebhook[webhook._id] =
        (this.routingStats.routesByWebhook[webhook._id] || 0) + 1;
    }
  }

  /**
   * Add custom routing rule
   * @param {string} name - Rule name
   * @param {Object} rule - Rule configuration
   */
  addCustomRoutingRule (name, rule) {
    this.routingRules.set(name, rule);
    logger.info(`Added custom routing rule: ${name}`);
  }

  /**
   * Remove custom routing rule
   * @param {string} name - Rule name
   */
  removeCustomRoutingRule (name) {
    this.routingRules.delete(name);
    logger.info(`Removed custom routing rule: ${name}`);
  }

  /**
   * Get routing statistics
   * @returns {Object} - Routing statistics
   */
  getRoutingStats () {
    return {
      ...this.routingStats,
      routingSuccessRate: this.routingStats.totalEvents > 0
        ? this.routingStats.routedEvents / this.routingStats.totalEvents
        : 0,
      dropRate: this.routingStats.totalEvents > 0
        ? this.routingStats.droppedEvents / this.routingStats.totalEvents
        : 0,
      errorRate: this.routingStats.totalEvents > 0
        ? this.routingStats.routingErrors / this.routingStats.totalEvents
        : 0
    };
  }

  /**
   * Get available collection mappings
   * @returns {Object} - Collection mappings
   */
  getCollectionMappings () {
    return Object.fromEntries(this.collectionMappings);
  }

  /**
   * Get routing rules
   * @returns {Object} - Routing rules
   */
  getRoutingRules () {
    return Object.fromEntries(this.routingRules);
  }

  /**
   * Reset routing statistics
   */
  resetRoutingStats () {
    this.routingStats = {
      totalEvents: 0,
      routedEvents: 0,
      droppedEvents: 0,
      routingErrors: 0,
      routesByCollection: {},
      routesByWebhook: {},
      routesByEventType: {}
    };
    logger.info('Routing statistics reset');
  }

  /**
   * Test webhook routing
   * @param {Object} webhook - Webhook configuration
   * @param {Object} testEvent - Test event
   * @returns {Object} - Test result
   */
  testWebhookRouting (webhook, testEvent) {
    try {
      const matches = this.webhookMatchesEvent(
        webhook,
        testEvent.collection,
        testEvent.eventType,
        testEvent.entityType,
        testEvent.changeEvent
      );

      return {
        matches,
        webhook: {
          id: webhook._id,
          name: webhook.name,
          url: webhook.url
        },
        testEvent: {
          collection: testEvent.collection,
          eventType: testEvent.eventType,
          entityType: testEvent.entityType
        },
        filters: {
          collectionFilter: webhook.collectionFilter,
          eventTypeFilter: webhook.eventTypeFilter,
          entityTypeFilter: webhook.entityTypeFilter,
          customRules: webhook.customRules
        }
      };
    } catch (error) {
      logger.error('Error testing webhook routing:', error);
      return {
        matches: false,
        error: error.message
      };
    }
  }
}

module.exports = EventRoutingService;
