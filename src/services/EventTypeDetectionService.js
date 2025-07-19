/**
 * Event Type Detection Service for Huly Webhook Service
 * Analyzes MongoDB change events to determine webhook event types
 */

const logger = require('../utils/logger');

class EventTypeDetectionService {
  constructor (config) {
    this.config = config;
    this.eventTypeRules = new Map();
    this.collectionMappings = new Map();
    this.fieldMappings = new Map();
    this.customRules = new Map();

    // Initialize default rules
    this.initializeDefaultRules();
  }

  initializeDefaultRules () {
    // Core Huly collection mappings
    this.collectionMappings.set('tx', 'transaction');
    this.collectionMappings.set('issues', 'issue');
    this.collectionMappings.set('projects', 'project');
    this.collectionMappings.set('users', 'user');
    this.collectionMappings.set('documents', 'document');
    this.collectionMappings.set('comments', 'comment');
    this.collectionMappings.set('attachments', 'attachment');
    this.collectionMappings.set('workspaces', 'workspace');
    this.collectionMappings.set('organizations', 'organization');
    this.collectionMappings.set('teams', 'team');
    this.collectionMappings.set('contacts', 'contact');
    this.collectionMappings.set('tasks', 'task');
    this.collectionMappings.set('calendar', 'calendar');
    this.collectionMappings.set('channels', 'channel');
    this.collectionMappings.set('messages', 'message');
    this.collectionMappings.set('boards', 'board');
    this.collectionMappings.set('cards', 'card');
    this.collectionMappings.set('leads', 'lead');
    this.collectionMappings.set('candidates', 'candidate');
    this.collectionMappings.set('applications', 'application');
    this.collectionMappings.set('reviews', 'review');
    this.collectionMappings.set('vacancies', 'vacancy');
    this.collectionMappings.set('inventory', 'inventory');
    this.collectionMappings.set('requests', 'request');
    this.collectionMappings.set('tags', 'tag');
    this.collectionMappings.set('templates', 'template');
    this.collectionMappings.set('workflows', 'workflow');
    this.collectionMappings.set('notifications', 'notification');
    this.collectionMappings.set('audit', 'audit');
    this.collectionMappings.set('activity', 'activity');
    this.collectionMappings.set('chunks', 'chunk');
    this.collectionMappings.set('blobs', 'blob');
    this.collectionMappings.set('accounts', 'account');
    this.collectionMappings.set('space', 'space');
    this.collectionMappings.set('preference', 'preference');
    this.collectionMappings.set('setting', 'setting');

    // Operation type mappings
    this.eventTypeRules.set('insert', (changeEvent) => {
      const entityType = this.getEntityType(changeEvent);
      return `${entityType}.created`;
    });

    this.eventTypeRules.set('update', (changeEvent) => {
      const entityType = this.getEntityType(changeEvent);
      const updateType = this.getUpdateType(changeEvent);
      return `${entityType}.${updateType}`;
    });

    this.eventTypeRules.set('delete', (changeEvent) => {
      const entityType = this.getEntityType(changeEvent);
      return `${entityType}.deleted`;
    });

    this.eventTypeRules.set('replace', (changeEvent) => {
      const entityType = this.getEntityType(changeEvent);
      return `${entityType}.replaced`;
    });

    this.eventTypeRules.set('invalidate', (_changeEvent) => {
      return 'collection.invalidated';
    });

    // Field-based event type mappings
    this.fieldMappings.set('status', 'status_changed');
    this.fieldMappings.set('assignee', 'assigned');
    this.fieldMappings.set('priority', 'priority_changed');
    this.fieldMappings.set('dueDate', 'due_date_changed');
    this.fieldMappings.set('title', 'title_changed');
    this.fieldMappings.set('description', 'description_changed');
    this.fieldMappings.set('labels', 'labels_changed');
    this.fieldMappings.set('components', 'components_changed');
    this.fieldMappings.set('milestone', 'milestone_changed');
    this.fieldMappings.set('estimation', 'estimation_changed');
    this.fieldMappings.set('progress', 'progress_changed');
    this.fieldMappings.set('archived', 'archived_changed');
    this.fieldMappings.set('space', 'space_changed');
    this.fieldMappings.set('parent', 'parent_changed');
    this.fieldMappings.set('childInfo', 'children_changed');
    this.fieldMappings.set('comments', 'commented');
    this.fieldMappings.set('attachments', 'attachment_added');
    this.fieldMappings.set('tags', 'tagged');
    this.fieldMappings.set('collaborators', 'collaborator_changed');
    this.fieldMappings.set('visibility', 'visibility_changed');
    this.fieldMappings.set('permissions', 'permissions_changed');
    this.fieldMappings.set('location', 'location_changed');
    this.fieldMappings.set('contact', 'contact_changed');
    this.fieldMappings.set('organization', 'organization_changed');
    this.fieldMappings.set('role', 'role_changed');
    this.fieldMappings.set('active', 'activation_changed');
    this.fieldMappings.set('metadata', 'metadata_changed');
    this.fieldMappings.set('template', 'template_changed');
    this.fieldMappings.set('workflow', 'workflow_changed');
    this.fieldMappings.set('integration', 'integration_changed');
  }

  /**
   * Detect event type from MongoDB change event
   * @param {Object} changeEvent - MongoDB change stream event
   * @returns {string} - Detected event type
   */
  detectEventType (changeEvent) {
    try {
      const operationType = changeEvent.operationType;

      // Check for custom rules first
      const customEventType = this.applyCustomRules(changeEvent);
      if (customEventType) {
        return customEventType;
      }

      // Apply default rules based on operation type
      const ruleFunction = this.eventTypeRules.get(operationType);
      if (ruleFunction) {
        return ruleFunction(changeEvent);
      }

      // Fallback to generic event type
      const entityType = this.getEntityType(changeEvent);
      return `${entityType}.${operationType}`;
    } catch (error) {
      logger.error('Error detecting event type:', error);
      return 'unknown.event';
    }
  }

  /**
   * Get entity type from change event
   * @param {Object} changeEvent - MongoDB change stream event
   * @returns {string} - Entity type
   */
  getEntityType (changeEvent) {
    const collection = changeEvent.ns ? changeEvent.ns.coll : 'unknown';
    return this.collectionMappings.get(collection) || collection;
  }

  /**
   * Determine update type based on changed fields
   * @param {Object} changeEvent - MongoDB change stream event
   * @returns {string} - Update type
   */
  getUpdateType (changeEvent) {
    try {
      const updateDescription = changeEvent.updateDescription;
      if (!updateDescription) {
        return 'updated';
      }

      const updatedFields = updateDescription.updatedFields || {};
      const removedFields = updateDescription.removedFields || [];

      // Check for specific field updates
      const fieldNames = Object.keys(updatedFields);
      const allFields = [...fieldNames, ...removedFields];

      // Find the most specific field mapping
      for (const field of allFields) {
        // Check exact field match
        if (this.fieldMappings.has(field)) {
          return this.fieldMappings.get(field);
        }

        // Check field prefix match (e.g., 'labels.0' matches 'labels')
        for (const [mappedField, eventType] of this.fieldMappings) {
          if (field.startsWith(mappedField + '.') || field.startsWith(mappedField + '[')) {
            return eventType;
          }
        }
      }

      // Check for array operations
      if (fieldNames.some(field => field.includes('$'))) {
        return 'array_updated';
      }

      // Check for nested object updates
      if (fieldNames.some(field => field.includes('.'))) {
        return 'nested_updated';
      }

      return 'updated';
    } catch (error) {
      logger.error('Error determining update type:', error);
      return 'updated';
    }
  }

  /**
   * Apply custom rules for event type detection
   * @param {Object} changeEvent - MongoDB change stream event
   * @returns {string|null} - Custom event type or null
   */
  applyCustomRules (changeEvent) {
    try {
      const collection = changeEvent.ns ? changeEvent.ns.coll : null;
      const operationType = changeEvent.operationType;

      // Check collection-specific custom rules
      const collectionRules = this.customRules.get(collection);
      if (collectionRules) {
        const rule = collectionRules.get(operationType);
        if (rule && typeof rule === 'function') {
          return rule(changeEvent);
        }
      }

      // Check global custom rules
      const globalRules = this.customRules.get('*');
      if (globalRules) {
        const rule = globalRules.get(operationType);
        if (rule && typeof rule === 'function') {
          return rule(changeEvent);
        }
      }

      return null;
    } catch (error) {
      logger.error('Error applying custom rules:', error);
      return null;
    }
  }

  /**
   * Add custom event type detection rule
   * @param {string} collection - Collection name or '*' for global
   * @param {string} operationType - MongoDB operation type
   * @param {Function} ruleFunction - Function to determine event type
   */
  addCustomRule (collection, operationType, ruleFunction) {
    if (!this.customRules.has(collection)) {
      this.customRules.set(collection, new Map());
    }

    this.customRules.get(collection).set(operationType, ruleFunction);
    logger.info(`Added custom rule for ${collection}.${operationType}`);
  }

  /**
   * Add collection mapping
   * @param {string} collection - MongoDB collection name
   * @param {string} entityType - Entity type name
   */
  addCollectionMapping (collection, entityType) {
    this.collectionMappings.set(collection, entityType);
    logger.info(`Added collection mapping: ${collection} -> ${entityType}`);
  }

  /**
   * Add field mapping
   * @param {string} fieldName - Field name
   * @param {string} eventType - Event type suffix
   */
  addFieldMapping (fieldName, eventType) {
    this.fieldMappings.set(fieldName, eventType);
    logger.info(`Added field mapping: ${fieldName} -> ${eventType}`);
  }

  /**
   * Get detailed event information
   * @param {Object} changeEvent - MongoDB change stream event
   * @returns {Object} - Detailed event information
   */
  getEventDetails (changeEvent) {
    const eventType = this.detectEventType(changeEvent);
    const entityType = this.getEntityType(changeEvent);
    const collection = changeEvent.ns ? changeEvent.ns.coll : 'unknown';

    return {
      eventType,
      entityType,
      collection,
      operationType: changeEvent.operationType,
      documentKey: changeEvent.documentKey,
      timestamp: changeEvent.clusterTime || new Date(),
      namespace: changeEvent.ns,
      hasFullDocument: !!changeEvent.fullDocument,
      hasFullDocumentBeforeChange: !!changeEvent.fullDocumentBeforeChange,
      updateDescription: changeEvent.updateDescription,
      metadata: {
        resumeToken: changeEvent._id,
        wallTime: changeEvent.wallTime
      }
    };
  }

  /**
   * Check if event type should be processed
   * @param {string} eventType - Event type
   * @param {Array} allowedTypes - Allowed event types
   * @returns {boolean} - Whether to process the event
   */
  shouldProcessEvent (eventType, allowedTypes = []) {
    if (!allowedTypes.length) {
      return true;
    }

    // Check exact match
    if (allowedTypes.includes(eventType)) {
      return true;
    }

    // Check pattern match (e.g., 'issue.*' matches 'issue.created')
    return allowedTypes.some(pattern => {
      if (pattern.includes('*')) {
        const regex = new RegExp(pattern.replace(/\*/g, '.*'));
        return regex.test(eventType);
      }
      return false;
    });
  }

  /**
   * Get event type statistics
   * @returns {Object} - Event type statistics
   */
  getEventTypeStats () {
    return {
      totalCollectionMappings: this.collectionMappings.size,
      totalFieldMappings: this.fieldMappings.size,
      totalCustomRules: Array.from(this.customRules.values()).reduce((sum, rules) => sum + rules.size, 0),
      collectionMappings: Array.from(this.collectionMappings.entries()),
      fieldMappings: Array.from(this.fieldMappings.entries()),
      customRules: Array.from(this.customRules.entries()).map(([collection, rules]) => ({
        collection,
        rules: Array.from(rules.keys())
      }))
    };
  }
}

module.exports = EventTypeDetectionService;
