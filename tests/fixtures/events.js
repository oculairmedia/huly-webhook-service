/**
 * Event test fixtures for Huly webhook events
 */

const { ObjectId } = require('mongodb');

// Issue events
const issueCreatedEvent = {
  id: 'evt_issue_created_001',
  type: 'issue.created',
  timestamp: new Date('2025-01-19T10:00:00Z'),
  workspace: 'test-workspace',
  data: {
    issue: {
      _id: new ObjectId('607f1f77bcf86cd799439011'),
      identifier: 'WEBHOOK-100',
      title: 'Test issue for webhook',
      description: 'This is a test issue',
      status: 'backlog',
      priority: 'medium',
      assignee: null,
      project: {
        _id: new ObjectId('607f1f77bcf86cd799439021'),
        identifier: 'WEBHOOK',
        name: 'Webhook Project'
      },
      createdBy: 'user@example.com',
      createdAt: new Date('2025-01-19T10:00:00Z'),
      updatedAt: new Date('2025-01-19T10:00:00Z')
    }
  }
};

const issueUpdatedEvent = {
  id: 'evt_issue_updated_001',
  type: 'issue.updated',
  timestamp: new Date('2025-01-19T11:00:00Z'),
  workspace: 'test-workspace',
  data: {
    issue: {
      _id: new ObjectId('607f1f77bcf86cd799439011'),
      identifier: 'WEBHOOK-100',
      title: 'Updated test issue',
      description: 'This is an updated test issue',
      status: 'in-progress',
      priority: 'high',
      assignee: 'developer@example.com',
      project: {
        _id: new ObjectId('607f1f77bcf86cd799439021'),
        identifier: 'WEBHOOK',
        name: 'Webhook Project'
      },
      createdBy: 'user@example.com',
      createdAt: new Date('2025-01-19T10:00:00Z'),
      updatedAt: new Date('2025-01-19T11:00:00Z')
    }
  },
  changes: {
    title: {
      from: 'Test issue for webhook',
      to: 'Updated test issue'
    },
    status: {
      from: 'backlog',
      to: 'in-progress'
    },
    priority: {
      from: 'medium',
      to: 'high'
    },
    assignee: {
      from: null,
      to: 'developer@example.com'
    }
  }
};

const issueDeletedEvent = {
  id: 'evt_issue_deleted_001',
  type: 'issue.deleted',
  timestamp: new Date('2025-01-19T12:00:00Z'),
  workspace: 'test-workspace',
  data: {
    issue: {
      _id: new ObjectId('607f1f77bcf86cd799439011'),
      identifier: 'WEBHOOK-100',
      project: {
        _id: new ObjectId('607f1f77bcf86cd799439021'),
        identifier: 'WEBHOOK',
        name: 'Webhook Project'
      }
    }
  }
};

// Project events
const projectCreatedEvent = {
  id: 'evt_project_created_001',
  type: 'project.created',
  timestamp: new Date('2025-01-19T09:00:00Z'),
  workspace: 'test-workspace',
  data: {
    project: {
      _id: new ObjectId('607f1f77bcf86cd799439022'),
      identifier: 'NEWPROJ',
      name: 'New Project',
      description: 'A newly created project',
      createdBy: 'admin@example.com',
      createdAt: new Date('2025-01-19T09:00:00Z')
    }
  }
};

const projectUpdatedEvent = {
  id: 'evt_project_updated_001',
  type: 'project.updated',
  timestamp: new Date('2025-01-19T09:30:00Z'),
  workspace: 'test-workspace',
  data: {
    project: {
      _id: new ObjectId('607f1f77bcf86cd799439022'),
      identifier: 'NEWPROJ',
      name: 'Updated Project Name',
      description: 'Updated project description',
      updatedAt: new Date('2025-01-19T09:30:00Z')
    }
  },
  changes: {
    name: {
      from: 'New Project',
      to: 'Updated Project Name'
    },
    description: {
      from: 'A newly created project',
      to: 'Updated project description'
    }
  }
};

// Comment event
const commentCreatedEvent = {
  id: 'evt_comment_created_001',
  type: 'comment.created',
  timestamp: new Date('2025-01-19T10:30:00Z'),
  workspace: 'test-workspace',
  data: {
    comment: {
      _id: new ObjectId('607f1f77bcf86cd799439031'),
      content: 'This is a test comment',
      issue: {
        _id: new ObjectId('607f1f77bcf86cd799439011'),
        identifier: 'WEBHOOK-100'
      },
      author: 'user@example.com',
      createdAt: new Date('2025-01-19T10:30:00Z')
    }
  }
};

// MongoDB Change Stream events (raw format)
const mongoChangeEventInsert = {
  _id: {
    _data: '8265A3B4F8000000012B022C0100296E5A1004E2'
  },
  operationType: 'insert',
  clusterTime: new Date('2025-01-19T10:00:00Z'),
  ns: {
    db: 'huly',
    coll: 'issues'
  },
  documentKey: {
    _id: new ObjectId('607f1f77bcf86cd799439011')
  },
  fullDocument: {
    _id: new ObjectId('607f1f77bcf86cd799439011'),
    _class: 'tracker:class:Issue',
    space: new ObjectId('607f1f77bcf86cd799439021'),
    title: 'Test issue for webhook',
    description: 'This is a test issue',
    status: 'tracker:status:Backlog',
    priority: 'medium',
    createdOn: Date.now(),
    modifiedOn: Date.now()
  }
};

const mongoChangeEventUpdate = {
  _id: {
    _data: '8265A3B4F8000000022B022C0100296E5A1004E2'
  },
  operationType: 'update',
  clusterTime: new Date('2025-01-19T11:00:00Z'),
  ns: {
    db: 'huly',
    coll: 'issues'
  },
  documentKey: {
    _id: new ObjectId('607f1f77bcf86cd799439011')
  },
  updateDescription: {
    updatedFields: {
      title: 'Updated test issue',
      status: 'tracker:status:InProgress',
      priority: 'high',
      modifiedOn: Date.now()
    },
    removedFields: []
  },
  fullDocument: {
    _id: new ObjectId('607f1f77bcf86cd799439011'),
    _class: 'tracker:class:Issue',
    space: new ObjectId('607f1f77bcf86cd799439021'),
    title: 'Updated test issue',
    description: 'This is a test issue',
    status: 'tracker:status:InProgress',
    priority: 'high',
    createdOn: Date.now() - 3600000,
    modifiedOn: Date.now()
  }
};

const mongoChangeEventDelete = {
  _id: {
    _data: '8265A3B4F8000000032B022C0100296E5A1004E2'
  },
  operationType: 'delete',
  clusterTime: new Date('2025-01-19T12:00:00Z'),
  ns: {
    db: 'huly',
    coll: 'issues'
  },
  documentKey: {
    _id: new ObjectId('607f1f77bcf86cd799439011')
  }
};

module.exports = {
  // Webhook-ready events
  issueCreatedEvent,
  issueUpdatedEvent,
  issueDeletedEvent,
  projectCreatedEvent,
  projectUpdatedEvent,
  commentCreatedEvent,

  // MongoDB change stream events
  mongoChangeEventInsert,
  mongoChangeEventUpdate,
  mongoChangeEventDelete,

  // Collections
  issueEvents: [
    issueCreatedEvent,
    issueUpdatedEvent,
    issueDeletedEvent
  ],

  projectEvents: [
    projectCreatedEvent,
    projectUpdatedEvent
  ],

  allEvents: [
    issueCreatedEvent,
    issueUpdatedEvent,
    issueDeletedEvent,
    projectCreatedEvent,
    projectUpdatedEvent,
    commentCreatedEvent
  ],

  // Factory functions
  createIssueEvent(type = 'created', overrides = {}) {
    const baseEvent = {
      id: `evt_issue_${type}_${Date.now()}`,
      type: `issue.${type}`,
      timestamp: new Date(),
      workspace: 'test-workspace',
      data: {
        issue: {
          _id: new ObjectId(),
          identifier: `TEST-${Math.floor(Math.random() * 1000)}`,
          title: 'Test issue',
          description: 'Test description',
          status: 'backlog',
          priority: 'medium',
          project: {
            _id: new ObjectId(),
            identifier: 'TEST',
            name: 'Test Project'
          },
          createdAt: new Date(),
          updatedAt: new Date()
        }
      }
    };

    return { ...baseEvent, ...overrides };
  },

  createMongoChangeEvent(operationType = 'insert', collection = 'issues', overrides = {}) {
    const baseEvent = {
      _id: { _data: `8265A3B4F8${Date.now()}` },
      operationType,
      clusterTime: new Date(),
      ns: {
        db: 'huly',
        coll: collection
      },
      documentKey: {
        _id: new ObjectId()
      }
    };

    if (operationType === 'insert' || operationType === 'update') {
      baseEvent.fullDocument = {
        _id: baseEvent.documentKey._id,
        _class: `tracker:class:${collection.slice(0, -1)}`,
        modifiedOn: Date.now()
      };
    }

    return { ...baseEvent, ...overrides };
  }
};