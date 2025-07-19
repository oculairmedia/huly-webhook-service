/**
 * Factory functions for creating WebhookEvent instances
 * This improves testability by providing controlled creation of event objects
 */

const WebhookEvent = require('../WebhookEvent');
const { v4: uuidv4 } = require('uuid');

/**
 * Create a webhook event with default values
 * @param {Object} overrides - Values to override defaults
 * @returns {WebhookEvent} - New webhook event instance
 */
function createWebhookEvent (overrides = {}) {
  const data = {
    id: uuidv4(),
    type: 'issue.created',
    timestamp: new Date(),
    workspace: 'test-workspace',
    data: {
      id: 'issue-123',
      title: 'Test Issue',
      description: 'Test issue description',
      status: 'Open',
      priority: 'Medium'
    },
    changes: {},
    metadata: {},
    sourceDocument: null,
    sourceCollection: 'tracker:class:Issue',
    processed: false,
    processedAt: null,
    createdAt: new Date(),
    ...overrides
  };

  return new WebhookEvent(data);
}

/**
 * Create an issue created event
 * @param {Object} issueData - Issue data
 * @param {Object} overrides - Other values to override
 * @returns {WebhookEvent} - New issue created event
 */
function createIssueCreatedEvent (issueData = {}, overrides = {}) {
  const defaultIssueData = {
    id: `issue-${uuidv4()}`,
    title: 'New Issue',
    description: 'Issue description',
    status: 'Open',
    priority: 'Medium',
    assignee: null,
    project: { id: 'project-1', name: 'Test Project' },
    createdAt: new Date()
  };

  return createWebhookEvent({
    type: 'issue.created',
    data: { ...defaultIssueData, ...issueData },
    sourceCollection: 'tracker:class:Issue',
    ...overrides
  });
}

/**
 * Create an issue updated event
 * @param {Object} changes - Changes made to the issue
 * @param {Object} issueData - Current issue data
 * @param {Object} overrides - Other values to override
 * @returns {WebhookEvent} - New issue updated event
 */
function createIssueUpdatedEvent (changes = {}, issueData = {}, overrides = {}) {
  const defaultChanges = {
    title: { from: 'Old Title', to: 'New Title' }
  };

  const defaultIssueData = {
    id: `issue-${uuidv4()}`,
    title: 'Updated Issue',
    description: 'Issue description',
    status: 'In Progress',
    priority: 'High'
  };

  return createWebhookEvent({
    type: 'issue.updated',
    data: { ...defaultIssueData, ...issueData },
    changes: { ...defaultChanges, ...changes },
    sourceCollection: 'tracker:class:Issue',
    ...overrides
  });
}

/**
 * Create an issue status changed event
 * @param {string} fromStatus - Previous status
 * @param {string} toStatus - New status
 * @param {Object} issueData - Issue data
 * @param {Object} overrides - Other values to override
 * @returns {WebhookEvent} - New status changed event
 */
function createIssueStatusChangedEvent (
  fromStatus = 'Open',
  toStatus = 'In Progress',
  issueData = {},
  overrides = {}
) {
  const changes = {
    status: { from: fromStatus, to: toStatus }
  };

  return createWebhookEvent({
    type: 'issue.status_changed',
    data: {
      ...issueData,
      status: toStatus
    },
    changes,
    sourceCollection: 'tracker:class:Issue',
    ...overrides
  });
}

/**
 * Create an issue assigned event
 * @param {string} assigneeId - New assignee ID
 * @param {Object} issueData - Issue data
 * @param {Object} overrides - Other values to override
 * @returns {WebhookEvent} - New assigned event
 */
function createIssueAssignedEvent (assigneeId = 'user-123', issueData = {}, overrides = {}) {
  const changes = {
    assignee: { from: null, to: assigneeId }
  };

  return createWebhookEvent({
    type: 'issue.assigned',
    data: {
      ...issueData,
      assignee: assigneeId
    },
    changes,
    sourceCollection: 'tracker:class:Issue',
    ...overrides
  });
}

/**
 * Create a project created event
 * @param {Object} projectData - Project data
 * @param {Object} overrides - Other values to override
 * @returns {WebhookEvent} - New project created event
 */
function createProjectCreatedEvent (projectData = {}, overrides = {}) {
  const defaultProjectData = {
    id: `project-${uuidv4()}`,
    name: 'New Project',
    description: 'Project description',
    archived: false,
    createdAt: new Date()
  };

  return createWebhookEvent({
    type: 'project.created',
    data: { ...defaultProjectData, ...projectData },
    sourceCollection: 'core:class:Space',
    ...overrides
  });
}

/**
 * Create a comment created event
 * @param {Object} commentData - Comment data
 * @param {Object} overrides - Other values to override
 * @returns {WebhookEvent} - New comment created event
 */
function createCommentCreatedEvent (commentData = {}, overrides = {}) {
  const defaultCommentData = {
    id: `comment-${uuidv4()}`,
    text: 'This is a comment',
    author: 'user-123',
    issueId: 'issue-456',
    createdAt: new Date()
  };

  return createWebhookEvent({
    type: 'comment.created',
    data: { ...defaultCommentData, ...commentData },
    sourceCollection: 'chunter:class:Comment',
    ...overrides
  });
}

/**
 * Create a webhook event from change stream
 * @param {Object} changeEvent - MongoDB change stream event
 * @returns {WebhookEvent} - New webhook event instance
 */
function createEventFromChangeStream (changeEvent) {
  return WebhookEvent.fromChangeStream(changeEvent);
}

/**
 * Create a processed event
 * @param {Object} overrides - Values to override
 * @returns {WebhookEvent} - New processed event
 */
function createProcessedEvent (overrides = {}) {
  const event = createWebhookEvent({
    processed: true,
    processedAt: new Date(),
    ...overrides
  });

  return event;
}

/**
 * Create an expired event
 * @param {number} ageInHours - Age of the event in hours
 * @param {Object} overrides - Other values to override
 * @returns {WebhookEvent} - New expired event
 */
function createExpiredEvent (ageInHours = 25, overrides = {}) {
  const timestamp = new Date(Date.now() - (ageInHours * 60 * 60 * 1000));

  return createWebhookEvent({
    timestamp,
    createdAt: timestamp,
    ...overrides
  });
}

/**
 * Create multiple webhook events
 * @param {number} count - Number of events to create
 * @param {Function} customizer - Function to customize each event
 * @returns {Array<WebhookEvent>} - Array of webhook event instances
 */
function createMultipleEvents (count = 3, customizer = null) {
  const events = [];
  const types = ['issue.created', 'issue.updated', 'issue.status_changed', 'issue.assigned'];

  for (let i = 0; i < count; i++) {
    const data = {
      type: types[i % types.length],
      data: {
        id: `issue-${i + 1}`,
        title: `Issue ${i + 1}`
      }
    };

    if (customizer) {
      Object.assign(data, customizer(i));
    }

    events.push(createWebhookEvent(data));
  }

  return events;
}

/**
 * Create a mock change stream event
 * @param {string} operationType - Operation type (insert, update, delete)
 * @param {Object} fullDocument - Full document
 * @param {Object} updateDescription - Update description for update operations
 * @returns {Object} - Mock change stream event
 */
function createMockChangeStreamEvent (
  operationType = 'insert',
  fullDocument = null,
  updateDescription = null
) {
  const baseEvent = {
    _id: { _data: uuidv4() },
    operationType,
    clusterTime: new Date(),
    ns: {
      db: 'huly',
      coll: 'tracker:class:Issue'
    },
    documentKey: { _id: uuidv4() }
  };

  if (operationType === 'insert' || operationType === 'update') {
    baseEvent.fullDocument = fullDocument || {
      _id: uuidv4(),
      _class: 'tracker:class:Issue',
      title: 'Test Issue',
      status: 'Open',
      space: 'project-123',
      createdOn: Date.now(),
      modifiedOn: Date.now()
    };
  }

  if (operationType === 'update' && updateDescription) {
    baseEvent.updateDescription = updateDescription;
  }

  return baseEvent;
}

module.exports = {
  createWebhookEvent,
  createIssueCreatedEvent,
  createIssueUpdatedEvent,
  createIssueStatusChangedEvent,
  createIssueAssignedEvent,
  createProjectCreatedEvent,
  createCommentCreatedEvent,
  createEventFromChangeStream,
  createProcessedEvent,
  createExpiredEvent,
  createMultipleEvents,
  createMockChangeStreamEvent
};
