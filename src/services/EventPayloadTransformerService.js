/**
 * Event Payload Transformer Service for Huly Webhook Service
 * Transforms MongoDB change events into webhook payload format
 */

const crypto = require('crypto');
const logger = require('../utils/logger');

class EventPayloadTransformerService {
  constructor (config) {
    this.config = config;
    this.transformers = new Map();
    this.fieldTransformers = new Map();
    this.payloadFilters = new Map();
    this.defaultPayloadVersion = '1.0';

    // Initialize default transformers
    this.initializeDefaultTransformers();
  }

  initializeDefaultTransformers () {
    // Default field transformers
    this.fieldTransformers.set('_id', (value) => value ? value.toString() : null);
    this.fieldTransformers.set('modifiedOn', (value) => value ? new Date(value).toISOString() : null);
    this.fieldTransformers.set('createdOn', (value) => value ? new Date(value).toISOString() : null);
    this.fieldTransformers.set('modifiedBy', (value) => value ? value.toString() : null);
    this.fieldTransformers.set('createdBy', (value) => value ? value.toString() : null);
    this.fieldTransformers.set('attachedTo', (value) => value ? value.toString() : null);
    this.fieldTransformers.set('attachedToClass', (value) => value ? value.toString() : null);
    this.fieldTransformers.set('space', (value) => value ? value.toString() : null);
    this.fieldTransformers.set('dueDate', (value) => value ? new Date(value).toISOString() : null);

    // Entity-specific transformers
    this.transformers.set('issue', this.transformIssueEvent.bind(this));
    this.transformers.set('project', this.transformProjectEvent.bind(this));
    this.transformers.set('user', this.transformUserEvent.bind(this));
    this.transformers.set('task', this.transformTaskEvent.bind(this));
    this.transformers.set('comment', this.transformCommentEvent.bind(this));
    this.transformers.set('attachment', this.transformAttachmentEvent.bind(this));
    this.transformers.set('contact', this.transformContactEvent.bind(this));
    this.transformers.set('organization', this.transformOrganizationEvent.bind(this));
    this.transformers.set('document', this.transformDocumentEvent.bind(this));
    this.transformers.set('message', this.transformMessageEvent.bind(this));
    this.transformers.set('workspace', this.transformWorkspaceEvent.bind(this));
    this.transformers.set('team', this.transformTeamEvent.bind(this));
    this.transformers.set('calendar', this.transformCalendarEvent.bind(this));
    this.transformers.set('channel', this.transformChannelEvent.bind(this));
    this.transformers.set('board', this.transformBoardEvent.bind(this));
    this.transformers.set('card', this.transformCardEvent.bind(this));
    this.transformers.set('lead', this.transformLeadEvent.bind(this));
    this.transformers.set('candidate', this.transformCandidateEvent.bind(this));
    this.transformers.set('application', this.transformApplicationEvent.bind(this));
    this.transformers.set('vacancy', this.transformVacancyEvent.bind(this));
    this.transformers.set('review', this.transformReviewEvent.bind(this));
    this.transformers.set('inventory', this.transformInventoryEvent.bind(this));
    this.transformers.set('request', this.transformRequestEvent.bind(this));
    this.transformers.set('tag', this.transformTagEvent.bind(this));
    this.transformers.set('template', this.transformTemplateEvent.bind(this));
    this.transformers.set('workflow', this.transformWorkflowEvent.bind(this));
    this.transformers.set('notification', this.transformNotificationEvent.bind(this));
    this.transformers.set('activity', this.transformActivityEvent.bind(this));
    this.transformers.set('account', this.transformAccountEvent.bind(this));
    this.transformers.set('space', this.transformSpaceEvent.bind(this));
    this.transformers.set('preference', this.transformPreferenceEvent.bind(this));
    this.transformers.set('setting', this.transformSettingEvent.bind(this));
    this.transformers.set('chunk', this.transformChunkEvent.bind(this));
    this.transformers.set('blob', this.transformBlobEvent.bind(this));
    this.transformers.set('transaction', this.transformTransactionEvent.bind(this));
    this.transformers.set('audit', this.transformAuditEvent.bind(this));

    // Default payload filters
    this.payloadFilters.set('sensitive', this.filterSensitiveFields.bind(this));
    this.payloadFilters.set('minimal', this.filterMinimalFields.bind(this));
    this.payloadFilters.set('detailed', this.filterDetailedFields.bind(this));
  }

  /**
   * Transform MongoDB change event into webhook payload
   * @param {Object} changeEvent - MongoDB change stream event
   * @param {Object} eventDetails - Event details from EventTypeDetectionService
   * @param {Object} webhook - Webhook configuration
   * @returns {Object} - Transformed webhook payload
   */
  transformEvent (changeEvent, eventDetails, webhook) {
    try {
      const basePayload = this.createBasePayload(changeEvent, eventDetails, webhook);

      // Apply entity-specific transformation
      const entityType = eventDetails.entityType;
      const transformer = this.transformers.get(entityType);

      if (transformer) {
        const entityPayload = transformer(changeEvent, eventDetails, webhook);
        Object.assign(basePayload.data, entityPayload);
      } else {
        // Use generic transformation
        const genericPayload = this.transformGenericEvent(changeEvent, eventDetails, webhook);
        Object.assign(basePayload.data, genericPayload);
      }

      // Apply payload filters
      const filteredPayload = this.applyPayloadFilters(basePayload, webhook);

      // Add webhook-specific metadata
      this.addWebhookMetadata(filteredPayload, webhook);

      return filteredPayload;
    } catch (error) {
      logger.error('Error transforming event payload:', error);
      throw error;
    }
  }

  /**
   * Create base payload structure
   * @param {Object} changeEvent - MongoDB change stream event
   * @param {Object} eventDetails - Event details
   * @param {Object} webhook - Webhook configuration
   * @returns {Object} - Base payload structure
   */
  createBasePayload (changeEvent, eventDetails, _webhook) {
    const timestamp = new Date().toISOString();
    const eventId = this.generateEventId(changeEvent);

    return {
      id: eventId,
      event: eventDetails.eventType,
      timestamp,
      version: this.defaultPayloadVersion,
      source: {
        service: 'huly-webhook-service',
        version: this.config.version || '1.0.0',
        instance: process.env.HOSTNAME || 'localhost'
      },
      data: {
        id: this.getDocumentId(changeEvent),
        type: eventDetails.entityType,
        operation: changeEvent.operationType,
        collection: eventDetails.collection,
        namespace: eventDetails.namespace,
        timestamp: eventDetails.timestamp
      },
      metadata: {
        resumeToken: changeEvent._id,
        wallTime: changeEvent.wallTime,
        documentKey: changeEvent.documentKey
      }
    };
  }

  /**
   * Generate unique event ID
   * @param {Object} changeEvent - MongoDB change stream event
   * @returns {string} - Unique event ID
   */
  generateEventId (changeEvent) {
    const resumeToken = changeEvent._id;
    const timestamp = Date.now();
    const random = crypto.randomBytes(4).toString('hex');

    return `huly_${timestamp}_${random}_${resumeToken}`;
  }

  /**
   * Get document ID from change event
   * @param {Object} changeEvent - MongoDB change stream event
   * @returns {string} - Document ID
   */
  getDocumentId (changeEvent) {
    if (changeEvent.documentKey && changeEvent.documentKey._id) {
      return changeEvent.documentKey._id.toString();
    }
    return null;
  }

  /**
   * Transform generic event (fallback)
   * @param {Object} changeEvent - MongoDB change stream event
   * @param {Object} eventDetails - Event details
   * @param {Object} webhook - Webhook configuration
   * @returns {Object} - Transformed data
   */
  transformGenericEvent (changeEvent, _eventDetails, _webhook) {
    const data = {
      document: this.transformDocument(changeEvent.fullDocument),
      previousDocument: this.transformDocument(changeEvent.fullDocumentBeforeChange),
      updateDescription: changeEvent.updateDescription
    };

    return this.applyFieldTransformers(data);
  }

  /**
   * Transform issue event
   * @param {Object} changeEvent - MongoDB change stream event
   * @param {Object} eventDetails - Event details
   * @param {Object} webhook - Webhook configuration
   * @returns {Object} - Transformed issue data
   */
  transformIssueEvent (changeEvent, _eventDetails, _webhook) {
    const document = changeEvent.fullDocument;
    const previousDocument = changeEvent.fullDocumentBeforeChange;

    const issueData = {
      issue: {
        id: this.getDocumentId(changeEvent),
        title: document?.title,
        description: document?.description,
        status: document?.status,
        priority: document?.priority,
        assignee: document?.assignee,
        reporter: document?.createdBy,
        labels: document?.labels || [],
        components: document?.components || [],
        milestone: document?.milestone,
        dueDate: document?.dueDate,
        estimation: document?.estimation,
        progress: document?.progress,
        project: document?.space,
        parent: document?.parent,
        children: document?.childInfo || [],
        createdOn: document?.createdOn,
        modifiedOn: document?.modifiedOn,
        createdBy: document?.createdBy,
        modifiedBy: document?.modifiedBy
      }
    };

    // Add previous values for updates
    if (previousDocument && changeEvent.operationType === 'update') {
      issueData.previousIssue = {
        status: previousDocument.status,
        priority: previousDocument.priority,
        assignee: previousDocument.assignee,
        title: previousDocument.title,
        description: previousDocument.description,
        labels: previousDocument.labels || [],
        components: previousDocument.components || [],
        milestone: previousDocument.milestone,
        dueDate: previousDocument.dueDate,
        estimation: previousDocument.estimation,
        progress: previousDocument.progress,
        modifiedOn: previousDocument.modifiedOn,
        modifiedBy: previousDocument.modifiedBy
      };
    }

    // Add changed fields for updates
    if (changeEvent.updateDescription) {
      issueData.changes = this.extractChangedFields(changeEvent.updateDescription);
    }

    return this.applyFieldTransformers(issueData);
  }

  /**
   * Transform project event
   * @param {Object} changeEvent - MongoDB change stream event
   * @param {Object} eventDetails - Event details
   * @param {Object} webhook - Webhook configuration
   * @returns {Object} - Transformed project data
   */
  transformProjectEvent (changeEvent, _eventDetails, _webhook) {
    const document = changeEvent.fullDocument;
    const previousDocument = changeEvent.fullDocumentBeforeChange;

    const projectData = {
      project: {
        id: this.getDocumentId(changeEvent),
        name: document?.name,
        description: document?.description,
        identifier: document?.identifier,
        archived: document?.archived,
        private: document?.private,
        members: document?.members || [],
        owners: document?.owners || [],
        defaultIssueStatus: document?.defaultIssueStatus,
        defaultAssignee: document?.defaultAssignee,
        createdOn: document?.createdOn,
        modifiedOn: document?.modifiedOn,
        createdBy: document?.createdBy,
        modifiedBy: document?.modifiedBy
      }
    };

    // Add previous values for updates
    if (previousDocument && changeEvent.operationType === 'update') {
      projectData.previousProject = {
        name: previousDocument.name,
        description: previousDocument.description,
        archived: previousDocument.archived,
        private: previousDocument.private,
        members: previousDocument.members || [],
        owners: previousDocument.owners || [],
        defaultIssueStatus: previousDocument.defaultIssueStatus,
        defaultAssignee: previousDocument.defaultAssignee,
        modifiedOn: previousDocument.modifiedOn,
        modifiedBy: previousDocument.modifiedBy
      };
    }

    // Add changed fields for updates
    if (changeEvent.updateDescription) {
      projectData.changes = this.extractChangedFields(changeEvent.updateDescription);
    }

    return this.applyFieldTransformers(projectData);
  }

  /**
   * Transform user event
   * @param {Object} changeEvent - MongoDB change stream event
   * @param {Object} eventDetails - Event details
   * @param {Object} webhook - Webhook configuration
   * @returns {Object} - Transformed user data
   */
  transformUserEvent (changeEvent, _eventDetails, _webhook) {
    const document = changeEvent.fullDocument;
    const previousDocument = changeEvent.fullDocumentBeforeChange;

    const userData = {
      user: {
        id: this.getDocumentId(changeEvent),
        name: document?.name,
        email: document?.email,
        avatar: document?.avatar,
        active: document?.active,
        role: document?.role,
        location: document?.location,
        createdOn: document?.createdOn,
        modifiedOn: document?.modifiedOn
      }
    };

    // Add previous values for updates
    if (previousDocument && changeEvent.operationType === 'update') {
      userData.previousUser = {
        name: previousDocument.name,
        email: previousDocument.email,
        avatar: previousDocument.avatar,
        active: previousDocument.active,
        role: previousDocument.role,
        location: previousDocument.location,
        modifiedOn: previousDocument.modifiedOn
      };
    }

    // Add changed fields for updates
    if (changeEvent.updateDescription) {
      userData.changes = this.extractChangedFields(changeEvent.updateDescription);
    }

    return this.applyFieldTransformers(userData);
  }

  /**
   * Transform task event
   * @param {Object} changeEvent - MongoDB change stream event
   * @param {Object} eventDetails - Event details
   * @param {Object} webhook - Webhook configuration
   * @returns {Object} - Transformed task data
   */
  transformTaskEvent (changeEvent, _eventDetails, _webhook) {
    const document = changeEvent.fullDocument;
    const previousDocument = changeEvent.fullDocumentBeforeChange;

    const taskData = {
      task: {
        id: this.getDocumentId(changeEvent),
        title: document?.title,
        description: document?.description,
        status: document?.status,
        assignee: document?.assignee,
        dueDate: document?.dueDate,
        priority: document?.priority,
        progress: document?.progress,
        estimation: document?.estimation,
        project: document?.space,
        parent: document?.parent,
        createdOn: document?.createdOn,
        modifiedOn: document?.modifiedOn,
        createdBy: document?.createdBy,
        modifiedBy: document?.modifiedBy
      }
    };

    // Add previous values for updates
    if (previousDocument && changeEvent.operationType === 'update') {
      taskData.previousTask = {
        title: previousDocument.title,
        description: previousDocument.description,
        status: previousDocument.status,
        assignee: previousDocument.assignee,
        dueDate: previousDocument.dueDate,
        priority: previousDocument.priority,
        progress: previousDocument.progress,
        estimation: previousDocument.estimation,
        modifiedOn: previousDocument.modifiedOn,
        modifiedBy: previousDocument.modifiedBy
      };
    }

    // Add changed fields for updates
    if (changeEvent.updateDescription) {
      taskData.changes = this.extractChangedFields(changeEvent.updateDescription);
    }

    return this.applyFieldTransformers(taskData);
  }

  /**
   * Transform comment event
   * @param {Object} changeEvent - MongoDB change stream event
   * @param {Object} eventDetails - Event details
   * @param {Object} webhook - Webhook configuration
   * @returns {Object} - Transformed comment data
   */
  transformCommentEvent (changeEvent, _eventDetails, _webhook) {
    const document = changeEvent.fullDocument;

    const commentData = {
      comment: {
        id: this.getDocumentId(changeEvent),
        message: document?.message,
        attachedTo: document?.attachedTo,
        attachedToClass: document?.attachedToClass,
        author: document?.createdBy,
        createdOn: document?.createdOn,
        modifiedOn: document?.modifiedOn,
        modifiedBy: document?.modifiedBy
      }
    };

    return this.applyFieldTransformers(commentData);
  }

  /**
   * Transform attachment event
   * @param {Object} changeEvent - MongoDB change stream event
   * @param {Object} eventDetails - Event details
   * @param {Object} webhook - Webhook configuration
   * @returns {Object} - Transformed attachment data
   */
  transformAttachmentEvent (changeEvent, _eventDetails, _webhook) {
    const document = changeEvent.fullDocument;

    const attachmentData = {
      attachment: {
        id: this.getDocumentId(changeEvent),
        name: document?.name,
        type: document?.type,
        size: document?.size,
        file: document?.file,
        attachedTo: document?.attachedTo,
        attachedToClass: document?.attachedToClass,
        createdOn: document?.createdOn,
        createdBy: document?.createdBy
      }
    };

    return this.applyFieldTransformers(attachmentData);
  }

  // Stub implementations for other entity types
  transformContactEvent (changeEvent, eventDetails, webhook) {
    return this.transformGenericEvent(changeEvent, eventDetails, webhook);
  }

  transformOrganizationEvent (changeEvent, eventDetails, webhook) {
    return this.transformGenericEvent(changeEvent, eventDetails, webhook);
  }

  transformDocumentEvent (changeEvent, eventDetails, webhook) {
    return this.transformGenericEvent(changeEvent, eventDetails, webhook);
  }

  transformMessageEvent (changeEvent, eventDetails, webhook) {
    return this.transformGenericEvent(changeEvent, eventDetails, webhook);
  }

  transformWorkspaceEvent (changeEvent, eventDetails, webhook) {
    return this.transformGenericEvent(changeEvent, eventDetails, webhook);
  }

  transformTeamEvent (changeEvent, eventDetails, webhook) {
    return this.transformGenericEvent(changeEvent, eventDetails, webhook);
  }

  transformCalendarEvent (changeEvent, eventDetails, webhook) {
    return this.transformGenericEvent(changeEvent, eventDetails, webhook);
  }

  transformChannelEvent (changeEvent, eventDetails, webhook) {
    return this.transformGenericEvent(changeEvent, eventDetails, webhook);
  }

  transformBoardEvent (changeEvent, eventDetails, webhook) {
    return this.transformGenericEvent(changeEvent, eventDetails, webhook);
  }

  transformCardEvent (changeEvent, eventDetails, webhook) {
    return this.transformGenericEvent(changeEvent, eventDetails, webhook);
  }

  transformLeadEvent (changeEvent, eventDetails, webhook) {
    return this.transformGenericEvent(changeEvent, eventDetails, webhook);
  }

  transformCandidateEvent (changeEvent, eventDetails, webhook) {
    return this.transformGenericEvent(changeEvent, eventDetails, webhook);
  }

  transformApplicationEvent (changeEvent, eventDetails, webhook) {
    return this.transformGenericEvent(changeEvent, eventDetails, webhook);
  }

  transformVacancyEvent (changeEvent, eventDetails, webhook) {
    return this.transformGenericEvent(changeEvent, eventDetails, webhook);
  }

  transformReviewEvent (changeEvent, eventDetails, webhook) {
    return this.transformGenericEvent(changeEvent, eventDetails, webhook);
  }

  transformInventoryEvent (changeEvent, eventDetails, webhook) {
    return this.transformGenericEvent(changeEvent, eventDetails, webhook);
  }

  transformRequestEvent (changeEvent, eventDetails, webhook) {
    return this.transformGenericEvent(changeEvent, eventDetails, webhook);
  }

  transformTagEvent (changeEvent, eventDetails, webhook) {
    return this.transformGenericEvent(changeEvent, eventDetails, webhook);
  }

  transformTemplateEvent (changeEvent, eventDetails, webhook) {
    return this.transformGenericEvent(changeEvent, eventDetails, webhook);
  }

  transformWorkflowEvent (changeEvent, eventDetails, webhook) {
    return this.transformGenericEvent(changeEvent, eventDetails, webhook);
  }

  transformNotificationEvent (changeEvent, eventDetails, webhook) {
    return this.transformGenericEvent(changeEvent, eventDetails, webhook);
  }

  transformActivityEvent (changeEvent, eventDetails, webhook) {
    return this.transformGenericEvent(changeEvent, eventDetails, webhook);
  }

  transformAccountEvent (changeEvent, eventDetails, webhook) {
    return this.transformGenericEvent(changeEvent, eventDetails, webhook);
  }

  transformSpaceEvent (changeEvent, eventDetails, webhook) {
    return this.transformGenericEvent(changeEvent, eventDetails, webhook);
  }

  transformPreferenceEvent (changeEvent, eventDetails, webhook) {
    return this.transformGenericEvent(changeEvent, eventDetails, webhook);
  }

  transformSettingEvent (changeEvent, eventDetails, webhook) {
    return this.transformGenericEvent(changeEvent, eventDetails, webhook);
  }

  transformChunkEvent (changeEvent, eventDetails, webhook) {
    return this.transformGenericEvent(changeEvent, eventDetails, webhook);
  }

  transformBlobEvent (changeEvent, eventDetails, webhook) {
    return this.transformGenericEvent(changeEvent, eventDetails, webhook);
  }

  transformTransactionEvent (changeEvent, eventDetails, webhook) {
    return this.transformGenericEvent(changeEvent, eventDetails, webhook);
  }

  transformAuditEvent (changeEvent, eventDetails, webhook) {
    return this.transformGenericEvent(changeEvent, eventDetails, webhook);
  }

  /**
   * Transform document with field transformers
   * @param {Object} document - MongoDB document
   * @returns {Object} - Transformed document
   */
  transformDocument (document) {
    if (!document) return null;

    const transformed = {};

    for (const [key, value] of Object.entries(document)) {
      const transformer = this.fieldTransformers.get(key);
      if (transformer) {
        transformed[key] = transformer(value);
      } else {
        transformed[key] = value;
      }
    }

    return transformed;
  }

  /**
   * Apply field transformers to data
   * @param {Object} data - Data to transform
   * @returns {Object} - Transformed data
   */
  applyFieldTransformers (data) {
    if (!data || typeof data !== 'object') return data;

    const transformed = {};

    for (const [key, value] of Object.entries(data)) {
      if (typeof value === 'object' && value !== null) {
        if (Array.isArray(value)) {
          transformed[key] = value.map(item => this.applyFieldTransformers(item));
        } else {
          transformed[key] = this.applyFieldTransformers(value);
        }
      } else {
        const transformer = this.fieldTransformers.get(key);
        if (transformer) {
          transformed[key] = transformer(value);
        } else {
          transformed[key] = value;
        }
      }
    }

    return transformed;
  }

  /**
   * Extract changed fields from update description
   * @param {Object} updateDescription - MongoDB update description
   * @returns {Object} - Changed fields
   */
  extractChangedFields (updateDescription) {
    const changes = {};

    if (updateDescription.updatedFields) {
      changes.updated = updateDescription.updatedFields;
    }

    if (updateDescription.removedFields && updateDescription.removedFields.length > 0) {
      changes.removed = updateDescription.removedFields;
    }

    if (updateDescription.truncatedArrays && updateDescription.truncatedArrays.length > 0) {
      changes.truncated = updateDescription.truncatedArrays;
    }

    return changes;
  }

  /**
   * Apply payload filters based on webhook configuration
   * @param {Object} payload - Payload to filter
   * @param {Object} webhook - Webhook configuration
   * @returns {Object} - Filtered payload
   */
  applyPayloadFilters (payload, webhook) {
    if (!webhook.payloadFilter) {
      return payload;
    }

    const filter = this.payloadFilters.get(webhook.payloadFilter);
    if (filter) {
      return filter(payload, webhook);
    }

    return payload;
  }

  /**
   * Filter sensitive fields from payload
   * @param {Object} payload - Payload to filter
   * @param {Object} webhook - Webhook configuration
   * @returns {Object} - Filtered payload
   */
  filterSensitiveFields (payload, _webhook) {
    const sensitiveFields = [
      'password', 'token', 'secret', 'key', 'credential',
      'email', 'phone', 'address', 'ssn', 'birthdate'
    ];

    return this.removeFields(payload, sensitiveFields);
  }

  /**
   * Filter payload to minimal fields
   * @param {Object} payload - Payload to filter
   * @param {Object} webhook - Webhook configuration
   * @returns {Object} - Filtered payload
   */
  filterMinimalFields (payload, _webhook) {
    const minimalFields = ['id', 'event', 'timestamp', 'data.id', 'data.type', 'data.operation'];
    return this.keepOnlyFields(payload, minimalFields);
  }

  /**
   * Keep detailed fields in payload
   * @param {Object} payload - Payload to filter
   * @param {Object} webhook - Webhook configuration
   * @returns {Object} - Filtered payload
   */
  filterDetailedFields (payload, _webhook) {
    // Return full payload for detailed filter
    return payload;
  }

  /**
   * Remove specific fields from payload
   * @param {Object} payload - Payload to filter
   * @param {Array} fieldsToRemove - Fields to remove
   * @returns {Object} - Filtered payload
   */
  removeFields (payload, fieldsToRemove) {
    const filtered = JSON.parse(JSON.stringify(payload));

    const removeFromObject = (obj, fields) => {
      for (const field of fields) {
        if (field.includes('.')) {
          const [parent, child] = field.split('.', 2);
          if (obj[parent] && typeof obj[parent] === 'object') {
            removeFromObject(obj[parent], [child]);
          }
        } else {
          delete obj[field];
        }
      }
    };

    removeFromObject(filtered, fieldsToRemove);
    return filtered;
  }

  /**
   * Keep only specific fields in payload
   * @param {Object} payload - Payload to filter
   * @param {Array} fieldsToKeep - Fields to keep
   * @returns {Object} - Filtered payload
   */
  keepOnlyFields (payload, fieldsToKeep) {
    const filtered = {};

    for (const field of fieldsToKeep) {
      if (field.includes('.')) {
        const [parent, child] = field.split('.', 2);
        if (payload[parent]) {
          if (!filtered[parent]) filtered[parent] = {};
          if (payload[parent][child] !== undefined) {
            filtered[parent][child] = payload[parent][child];
          }
        }
      } else {
        if (payload[field] !== undefined) {
          filtered[field] = payload[field];
        }
      }
    }

    return filtered;
  }

  /**
   * Add webhook-specific metadata to payload
   * @param {Object} payload - Payload to enhance
   * @param {Object} webhook - Webhook configuration
   */
  addWebhookMetadata (payload, webhook) {
    payload.webhook = {
      id: webhook.id,
      name: webhook.name,
      url: webhook.url,
      version: webhook.version || '1.0',
      deliveryId: crypto.randomUUID(),
      attempt: 1,
      maxAttempts: webhook.maxRetries || 3
    };
  }

  /**
   * Add custom transformer for specific entity type
   * @param {string} entityType - Entity type
   * @param {Function} transformer - Transformer function
   */
  addCustomTransformer (entityType, transformer) {
    this.transformers.set(entityType, transformer);
    logger.info(`Added custom transformer for entity type: ${entityType}`);
  }

  /**
   * Add custom field transformer
   * @param {string} fieldName - Field name
   * @param {Function} transformer - Transformer function
   */
  addCustomFieldTransformer (fieldName, transformer) {
    this.fieldTransformers.set(fieldName, transformer);
    logger.info(`Added custom field transformer for field: ${fieldName}`);
  }

  /**
   * Add custom payload filter
   * @param {string} filterName - Filter name
   * @param {Function} filter - Filter function
   */
  addCustomPayloadFilter (filterName, filter) {
    this.payloadFilters.set(filterName, filter);
    logger.info(`Added custom payload filter: ${filterName}`);
  }

  /**
   * Get transformer statistics
   * @returns {Object} - Transformer statistics
   */
  getTransformerStats () {
    return {
      totalTransformers: this.transformers.size,
      totalFieldTransformers: this.fieldTransformers.size,
      totalPayloadFilters: this.payloadFilters.size,
      transformers: Array.from(this.transformers.keys()),
      fieldTransformers: Array.from(this.fieldTransformers.keys()),
      payloadFilters: Array.from(this.payloadFilters.keys())
    };
  }
}

module.exports = EventPayloadTransformerService;
