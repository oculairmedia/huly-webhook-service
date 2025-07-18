/**
 * WebhookEvent model for MongoDB operations
 * Defines the structure for webhook event data
 */

const Joi = require('joi');
const { v4: uuidv4 } = require('uuid');

class WebhookEvent {
  constructor (data = {}) {
    this.id = data.id || uuidv4();
    this.type = data.type || '';
    this.timestamp = data.timestamp || new Date();
    this.workspace = data.workspace || '';
    this.data = data.data || {};
    this.changes = data.changes || {};
    this.metadata = data.metadata || {};
    this.sourceDocument = data.sourceDocument || null;
    this.sourceCollection = data.sourceCollection || '';
    this.processed = data.processed || false;
    this.processedAt = data.processedAt || null;
    this.createdAt = data.createdAt || new Date();
  }

  // Validation schema
  static get schema () {
    return Joi.object({
      id: Joi.string().uuid().optional(),
      type: Joi.string().valid(
        'issue.created',
        'issue.updated',
        'issue.deleted',
        'issue.status_changed',
        'issue.assigned',
        'project.created',
        'project.updated',
        'project.archived',
        'comment.created',
        'attachment.added'
      ).required(),
      timestamp: Joi.date().default(() => new Date()),
      workspace: Joi.string().required(),
      data: Joi.object().required(),
      changes: Joi.object().optional(),
      metadata: Joi.object().optional(),
      sourceDocument: Joi.object().optional(),
      sourceCollection: Joi.string().optional(),
      processed: Joi.boolean().default(false),
      processedAt: Joi.date().optional(),
      createdAt: Joi.date().default(() => new Date())
    });
  }

  // Validation method
  validate () {
    const { error, value } = WebhookEvent.schema.validate(this.toObject());
    if (error) {
      throw new Error(`WebhookEvent validation failed: ${error.details[0].message}`);
    }
    return value;
  }

  // Convert to plain object for MongoDB
  toObject () {
    return {
      id: this.id,
      type: this.type,
      timestamp: this.timestamp,
      workspace: this.workspace,
      data: this.data,
      changes: this.changes,
      metadata: this.metadata,
      sourceDocument: this.sourceDocument,
      sourceCollection: this.sourceCollection,
      processed: this.processed,
      processedAt: this.processedAt,
      createdAt: this.createdAt
    };
  }

  // Convert to webhook payload format
  toWebhookPayload () {
    return {
      id: this.id,
      type: this.type,
      timestamp: this.timestamp.toISOString(),
      workspace: this.workspace,
      data: this.data,
      changes: this.changes
    };
  }

  // Factory method from MongoDB document
  static fromDocument (doc) {
    return new WebhookEvent(doc);
  }

  // Factory method from MongoDB Change Stream event
  static fromChangeStream (changeEvent, eventType = null) {
    const event = new WebhookEvent();

    event.type = eventType || WebhookEvent.detectEventType(changeEvent);
    event.timestamp = new Date();
    event.workspace = WebhookEvent.extractWorkspace(changeEvent);
    event.data = WebhookEvent.transformEventData(changeEvent);
    event.changes = WebhookEvent.extractChanges(changeEvent);
    event.sourceDocument = changeEvent.fullDocument;
    event.sourceCollection = changeEvent.ns?.coll || '';
    event.metadata = {
      operationType: changeEvent.operationType,
      clusterTime: changeEvent.clusterTime,
      txnNumber: changeEvent.txnNumber,
      lsid: changeEvent.lsid
    };

    return event;
  }

  // Detect event type from change stream event
  static detectEventType (changeEvent) {
    const { operationType, ns } = changeEvent;
    const collection = ns?.coll || '';

    // Issue events
    if (collection === 'tracker:class:Issue' || collection.includes('Issue')) {
      switch (operationType) {
      case 'insert':
        return 'issue.created';
      case 'update':
        return WebhookEvent.detectUpdateType(changeEvent);
      case 'delete':
        return 'issue.deleted';
      default:
        return 'issue.updated';
      }
    }

    // Project events
    if (collection === 'core:class:Space' || collection.includes('Space') || collection.includes('Project')) {
      switch (operationType) {
      case 'insert':
        return 'project.created';
      case 'update':
        return 'project.updated';
      case 'delete':
        return 'project.archived';
      default:
        return 'project.updated';
      }
    }

    // Comment events
    if (collection === 'chunter:class:Comment' || collection.includes('Comment')) {
      return 'comment.created';
    }

    // Attachment events
    if (collection === 'attachment:class:Attachment' || collection.includes('Attachment')) {
      return 'attachment.added';
    }

    // Default to generic update
    return 'issue.updated';
  }

  // Detect specific update type for issues
  static detectUpdateType (changeEvent) {
    const updatedFields = changeEvent.updateDescription?.updatedFields || {};

    // Check if status changed
    if (updatedFields.status !== undefined) {
      return 'issue.status_changed';
    }

    // Check if assignee changed
    if (updatedFields.assignee !== undefined) {
      return 'issue.assigned';
    }

    // Default to generic update
    return 'issue.updated';
  }

  // Extract workspace from change event
  static extractWorkspace (changeEvent) {
    // Try to extract workspace from the document
    const doc = changeEvent.fullDocument || changeEvent.documentKey || {};

    // Look for workspace field in various locations
    return doc.workspace || doc.space || doc.project || 'default';
  }

  // Transform change event data to webhook format
  static transformEventData (changeEvent) {
    const { operationType, fullDocument, documentKey } = changeEvent;

    if (operationType === 'delete') {
      return {
        id: documentKey._id,
        deleted: true
      };
    }

    if (!fullDocument) {
      return {};
    }

    // Transform based on document type
    return WebhookEvent.transformDocumentData(fullDocument);
  }

  // Transform document data to standard format
  static transformDocumentData (document) {
    const transformed = {
      id: document._id || document.id,
      ...document
    };

    // Handle Huly-specific fields
    if (document._class) {
      transformed.type = document._class;
    }

    if (document.space) {
      transformed.project = {
        id: document.space,
        name: document.spaceName || 'Unknown Project'
      };
    }

    if (document.assignee) {
      transformed.assignee = document.assignee;
    }

    if (document.status) {
      transformed.status = document.status;
    }

    if (document.priority) {
      transformed.priority = document.priority;
    }

    if (document.title) {
      transformed.title = document.title;
    }

    if (document.description) {
      transformed.description = document.description;
    }

    if (document.createdOn) {
      transformed.createdAt = new Date(document.createdOn);
    }

    if (document.modifiedOn) {
      transformed.updatedAt = new Date(document.modifiedOn);
    }

    return transformed;
  }

  // Extract changes from update event
  static extractChanges (changeEvent) {
    const { operationType, updateDescription } = changeEvent;

    if (operationType !== 'update' || !updateDescription) {
      return {};
    }

    const changes = {};
    const { updatedFields, removedFields } = updateDescription;

    // Process updated fields
    if (updatedFields) {
      Object.keys(updatedFields).forEach(field => {
        changes[field] = {
          to: updatedFields[field]
        };
      });
    }

    // Process removed fields
    if (removedFields) {
      removedFields.forEach(field => {
        changes[field] = {
          removed: true
        };
      });
    }

    return changes;
  }

  // Mark event as processed
  markAsProcessed () {
    this.processed = true;
    this.processedAt = new Date();
  }

  // Get event age in milliseconds
  getAge () {
    return Date.now() - this.timestamp.getTime();
  }

  // Check if event is expired based on age
  isExpired (maxAge = 24 * 60 * 60 * 1000) { // 24 hours default
    return this.getAge() > maxAge;
  }
}

module.exports = WebhookEvent;
