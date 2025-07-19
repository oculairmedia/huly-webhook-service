/**
 * Unit tests for WebhookEvent model
 */

const WebhookEvent = require('../../../src/models/WebhookEvent');
const {
  createWebhookEvent,
  createIssueCreatedEvent,
  createIssueUpdatedEvent,
  createIssueStatusChangedEvent,
  createIssueAssignedEvent,
  createProjectCreatedEvent,
  createCommentCreatedEvent,
  createProcessedEvent,
  createExpiredEvent,
  createMockChangeStreamEvent
} = require('../../../src/models/factories/webhookEventFactory');

describe('WebhookEvent Model', () => {
  describe('Constructor', () => {
    test('should create event with default values', () => {
      const event = new WebhookEvent();
      
      expect(event.id).toBeDefined();
      expect(event.type).toBe('');
      expect(event.timestamp).toBeInstanceOf(Date);
      expect(event.workspace).toBe('');
      expect(event.data).toEqual({});
      expect(event.changes).toEqual({});
      expect(event.metadata).toEqual({});
      expect(event.sourceDocument).toBeNull();
      expect(event.sourceCollection).toBe('');
      expect(event.processed).toBe(false);
      expect(event.processedAt).toBeNull();
      expect(event.createdAt).toBeInstanceOf(Date);
    });

    test('should create event with provided data', () => {
      const data = {
        id: 'event-123',
        type: 'issue.created',
        workspace: 'workspace-1',
        data: { id: 'issue-1', title: 'Test Issue' },
        sourceCollection: 'tracker:class:Issue'
      };
      
      const event = new WebhookEvent(data);
      
      expect(event.id).toBe(data.id);
      expect(event.type).toBe(data.type);
      expect(event.workspace).toBe(data.workspace);
      expect(event.data).toEqual(data.data);
      expect(event.sourceCollection).toBe(data.sourceCollection);
    });
  });

  describe('Validation', () => {
    test('should validate valid event', () => {
      const event = createWebhookEvent();
      
      expect(() => event.validate()).not.toThrow();
    });

    test('should fail validation without required fields', () => {
      const event = new WebhookEvent();
      
      expect(() => event.validate()).toThrow('WebhookEvent validation failed');
    });

    test('should fail validation with invalid event type', () => {
      const event = createWebhookEvent({ type: 'invalid.type' });
      
      expect(() => event.validate()).toThrow();
    });

    test('should validate all valid event types', () => {
      const eventTypes = [
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
      ];
      
      eventTypes.forEach(type => {
        const event = createWebhookEvent({ type });
        expect(() => event.validate()).not.toThrow();
      });
    });
  });

  describe('toObject', () => {
    test('should convert event to plain object', () => {
      const event = createWebhookEvent();
      const obj = event.toObject();
      
      expect(obj).toEqual({
        id: event.id,
        type: event.type,
        timestamp: event.timestamp,
        workspace: event.workspace,
        data: event.data,
        changes: event.changes,
        metadata: event.metadata,
        sourceDocument: event.sourceDocument,
        sourceCollection: event.sourceCollection,
        processed: event.processed,
        processedAt: event.processedAt,
        createdAt: event.createdAt
      });
    });
  });

  describe('toWebhookPayload', () => {
    test('should convert event to webhook payload format', () => {
      const event = createWebhookEvent();
      const payload = event.toWebhookPayload();
      
      expect(payload).toEqual({
        id: event.id,
        type: event.type,
        timestamp: event.timestamp.toISOString(),
        workspace: event.workspace,
        data: event.data,
        changes: event.changes
      });
      
      // Should not include internal fields
      expect(payload.sourceDocument).toBeUndefined();
      expect(payload.processed).toBeUndefined();
    });
  });

  describe('fromDocument', () => {
    test('should create event from database document', () => {
      const doc = {
        id: 'event-123',
        type: 'issue.created',
        workspace: 'workspace-1',
        data: { id: 'issue-1' }
      };
      
      const event = WebhookEvent.fromDocument(doc);
      
      expect(event).toBeInstanceOf(WebhookEvent);
      expect(event.id).toBe(doc.id);
      expect(event.type).toBe(doc.type);
    });
  });

  describe('fromChangeStream', () => {
    test('should create event from insert change stream', () => {
      const changeEvent = createMockChangeStreamEvent('insert', {
        _id: 'issue-123',
        _class: 'tracker:class:Issue',
        title: 'New Issue',
        status: 'Open',
        space: 'project-123'
      });
      
      const event = WebhookEvent.fromChangeStream(changeEvent);
      
      expect(event.type).toBe('issue.created');
      expect(event.data.id).toBe('issue-123');
      expect(event.data.title).toBe('New Issue');
      expect(event.sourceCollection).toBe('tracker:class:Issue');
    });

    test('should create event from update change stream', () => {
      const changeEvent = createMockChangeStreamEvent('update', 
        { _id: 'issue-123', status: 'In Progress' },
        {
          updatedFields: { status: 'In Progress' },
          removedFields: []
        }
      );
      
      const event = WebhookEvent.fromChangeStream(changeEvent);
      
      expect(event.type).toBe('issue.status_changed');
      expect(event.changes.status).toEqual({ to: 'In Progress' });
    });

    test('should create event from delete change stream', () => {
      const changeEvent = createMockChangeStreamEvent('delete');
      
      const event = WebhookEvent.fromChangeStream(changeEvent);
      
      expect(event.type).toBe('issue.deleted');
      expect(event.data.deleted).toBe(true);
    });
  });

  describe('detectEventType', () => {
    test('should detect issue events', () => {
      expect(WebhookEvent.detectEventType({
        operationType: 'insert',
        ns: { coll: 'tracker:class:Issue' }
      })).toBe('issue.created');
      
      expect(WebhookEvent.detectEventType({
        operationType: 'delete',
        ns: { coll: 'tracker:class:Issue' }
      })).toBe('issue.deleted');
    });

    test('should detect project events', () => {
      expect(WebhookEvent.detectEventType({
        operationType: 'insert',
        ns: { coll: 'core:class:Space' }
      })).toBe('project.created');
      
      expect(WebhookEvent.detectEventType({
        operationType: 'update',
        ns: { coll: 'core:class:Space' }
      })).toBe('project.updated');
    });

    test('should detect comment events', () => {
      expect(WebhookEvent.detectEventType({
        operationType: 'insert',
        ns: { coll: 'chunter:class:Comment' }
      })).toBe('comment.created');
    });

    test('should detect attachment events', () => {
      expect(WebhookEvent.detectEventType({
        operationType: 'insert',
        ns: { coll: 'attachment:class:Attachment' }
      })).toBe('attachment.added');
    });
  });

  describe('detectUpdateType', () => {
    test('should detect status change', () => {
      const changeEvent = {
        updateDescription: {
          updatedFields: { status: 'In Progress' }
        }
      };
      
      expect(WebhookEvent.detectUpdateType(changeEvent)).toBe('issue.status_changed');
    });

    test('should detect assignee change', () => {
      const changeEvent = {
        updateDescription: {
          updatedFields: { assignee: 'user-123' }
        }
      };
      
      expect(WebhookEvent.detectUpdateType(changeEvent)).toBe('issue.assigned');
    });

    test('should default to generic update', () => {
      const changeEvent = {
        updateDescription: {
          updatedFields: { title: 'Updated Title' }
        }
      };
      
      expect(WebhookEvent.detectUpdateType(changeEvent)).toBe('issue.updated');
    });
  });

  describe('extractWorkspace', () => {
    test('should extract workspace from document', () => {
      expect(WebhookEvent.extractWorkspace({
        fullDocument: { workspace: 'workspace-1' }
      })).toBe('workspace-1');
      
      expect(WebhookEvent.extractWorkspace({
        fullDocument: { space: 'space-1' }
      })).toBe('space-1');
      
      expect(WebhookEvent.extractWorkspace({
        fullDocument: { project: 'project-1' }
      })).toBe('project-1');
    });

    test('should return default when workspace not found', () => {
      expect(WebhookEvent.extractWorkspace({})).toBe('default');
    });
  });

  describe('transformDocumentData', () => {
    test('should transform Huly document to standard format', () => {
      const document = {
        _id: 'doc-123',
        _class: 'tracker:class:Issue',
        title: 'Test Issue',
        description: 'Test description',
        status: 'Open',
        priority: 'High',
        assignee: 'user-123',
        space: 'project-123',
        createdOn: Date.now(),
        modifiedOn: Date.now()
      };
      
      const transformed = WebhookEvent.transformDocumentData(document);
      
      expect(transformed.id).toBe('doc-123');
      expect(transformed.type).toBe('tracker:class:Issue');
      expect(transformed.title).toBe('Test Issue');
      expect(transformed.project.id).toBe('project-123');
      expect(transformed.createdAt).toBeInstanceOf(Date);
      expect(transformed.updatedAt).toBeInstanceOf(Date);
    });
  });

  describe('extractChanges', () => {
    test('should extract updated fields', () => {
      const changeEvent = {
        operationType: 'update',
        updateDescription: {
          updatedFields: {
            status: 'In Progress',
            priority: 'High'
          }
        }
      };
      
      const changes = WebhookEvent.extractChanges(changeEvent);
      
      expect(changes.status).toEqual({ to: 'In Progress' });
      expect(changes.priority).toEqual({ to: 'High' });
    });

    test('should extract removed fields', () => {
      const changeEvent = {
        operationType: 'update',
        updateDescription: {
          removedFields: ['description', 'tags']
        }
      };
      
      const changes = WebhookEvent.extractChanges(changeEvent);
      
      expect(changes.description).toEqual({ removed: true });
      expect(changes.tags).toEqual({ removed: true });
    });

    test('should return empty object for non-update operations', () => {
      expect(WebhookEvent.extractChanges({
        operationType: 'insert'
      })).toEqual({});
    });
  });

  describe('markAsProcessed', () => {
    test('should mark event as processed', () => {
      const event = createWebhookEvent();
      
      expect(event.processed).toBe(false);
      expect(event.processedAt).toBeNull();
      
      event.markAsProcessed();
      
      expect(event.processed).toBe(true);
      expect(event.processedAt).toBeInstanceOf(Date);
    });
  });

  describe('getAge', () => {
    test('should return event age in milliseconds', () => {
      const event = createWebhookEvent({
        timestamp: new Date(Date.now() - 5000) // 5 seconds ago
      });
      
      const age = event.getAge();
      
      expect(age).toBeGreaterThanOrEqual(5000);
      expect(age).toBeLessThan(6000);
    });
  });

  describe('isExpired', () => {
    test('should check if event is expired', () => {
      const freshEvent = createWebhookEvent();
      const oldEvent = createExpiredEvent(25); // 25 hours old
      
      expect(freshEvent.isExpired()).toBe(false);
      expect(oldEvent.isExpired()).toBe(true);
    });

    test('should use custom max age', () => {
      const event = createWebhookEvent({
        timestamp: new Date(Date.now() - 3600000) // 1 hour ago
      });
      
      expect(event.isExpired(7200000)).toBe(false); // 2 hour max age
      expect(event.isExpired(1800000)).toBe(true); // 30 minute max age
    });
  });

  describe('Factory Functions', () => {
    test('should create issue created event', () => {
      const event = createIssueCreatedEvent({
        title: 'New Issue',
        priority: 'High'
      });
      
      expect(event.type).toBe('issue.created');
      expect(event.data.title).toBe('New Issue');
      expect(event.data.priority).toBe('High');
    });

    test('should create issue updated event', () => {
      const event = createIssueUpdatedEvent({
        title: { from: 'Old', to: 'New' }
      });
      
      expect(event.type).toBe('issue.updated');
      expect(event.changes.title).toEqual({ from: 'Old', to: 'New' });
    });

    test('should create issue status changed event', () => {
      const event = createIssueStatusChangedEvent('Open', 'Closed');
      
      expect(event.type).toBe('issue.status_changed');
      expect(event.changes.status).toEqual({ from: 'Open', to: 'Closed' });
      expect(event.data.status).toBe('Closed');
    });

    test('should create issue assigned event', () => {
      const event = createIssueAssignedEvent('user-456');
      
      expect(event.type).toBe('issue.assigned');
      expect(event.changes.assignee).toEqual({ from: null, to: 'user-456' });
      expect(event.data.assignee).toBe('user-456');
    });

    test('should create project created event', () => {
      const event = createProjectCreatedEvent({
        name: 'New Project'
      });
      
      expect(event.type).toBe('project.created');
      expect(event.data.name).toBe('New Project');
      expect(event.sourceCollection).toBe('core:class:Space');
    });

    test('should create comment created event', () => {
      const event = createCommentCreatedEvent({
        text: 'Test comment',
        issueId: 'issue-789'
      });
      
      expect(event.type).toBe('comment.created');
      expect(event.data.text).toBe('Test comment');
      expect(event.data.issueId).toBe('issue-789');
    });

    test('should create processed event', () => {
      const event = createProcessedEvent();
      
      expect(event.processed).toBe(true);
      expect(event.processedAt).toBeInstanceOf(Date);
    });

    test('should create expired event', () => {
      const event = createExpiredEvent(48); // 48 hours old
      
      expect(event.isExpired()).toBe(true);
      expect(event.getAge()).toBeGreaterThan(48 * 60 * 60 * 1000 - 1000);
    });
  });
});