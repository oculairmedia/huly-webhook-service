# Huly Webhook Service

A standalone microservice that adds webhook functionality to Huly self-hosted deployments. This service monitors MongoDB for changes and delivers webhook notifications to configured endpoints, enabling external integrations and real-time notifications.

## Features

- **Real-time Change Detection**: Uses MongoDB Change Streams for instant event detection
- **Webhook Management**: RESTful API for creating, configuring, and managing webhooks
- **Reliable Delivery**: Advanced retry mechanisms with exponential backoff and dead letter queue
- **Event Filtering**: Filter events by project, issue type, or custom criteria
- **Security**: HMAC-SHA256 signatures, API key authentication, and IP whitelisting
- **Monitoring**: Comprehensive logging, health checks, and delivery statistics

## Architecture

### Supported Events

- `issue.created` - New issue created
- `issue.updated` - Issue modified
- `issue.deleted` - Issue removed
- `issue.status_changed` - Issue status changed
- `issue.assigned` - Issue assignment changed
- `project.created` - New project created
- `project.updated` - Project settings modified
- `comment.created` - Comment added to issue
- `attachment.added` - File attached to issue

### Event Payload Structure

```json
{
  "id": "unique-event-id",
  "type": "issue.created",
  "timestamp": "2025-07-17T20:45:00Z",
  "workspace": "agentspace",
  "data": {
    "issue": {
      "id": "LMP-123",
      "identifier": "LMP-123",
      "title": "Issue title",
      "description": "Issue description",
      "status": "Backlog",
      "priority": "medium",
      "assignee": null,
      "project": {
        "id": "project-id",
        "identifier": "LMP",
        "name": "Project Name"
      },
      "createdBy": "user@example.com",
      "createdAt": "2025-07-17T20:45:00Z",
      "updatedAt": "2025-07-17T20:45:00Z"
    }
  },
  "changes": {
    "status": {
      "from": "Backlog",
      "to": "In Progress"
    }
  }
}
```

## Installation

### Prerequisites

- Node.js 18+ 
- MongoDB (with replica set for Change Streams)
- Docker and Docker Compose (recommended)

### Quick Start with Docker

1. **Clone and setup**:
   ```bash
   git clone <repository-url>
   cd huly-webhook
   cp .env.example .env
   ```

2. **Configure environment**:
   Edit `.env` file with your MongoDB connection and security settings.

3. **Start the service**:
   ```bash
   docker-compose up -d
   ```

4. **Verify health**:
   ```bash
   curl http://localhost:3456/api/health
   ```

### Manual Installation

1. **Install dependencies**:
   ```bash
   npm install
   ```

2. **Configure environment**:
   ```bash
   cp .env.example .env
   # Edit .env with your configuration
   ```

3. **Start the service**:
   ```bash
   npm start
   ```

## Configuration

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | Service port | `3456` |
| `MONGODB_URL` | MongoDB connection string | `mongodb://localhost:27017/huly` |
| `WEBHOOK_SECRET_KEY` | Secret for HMAC signatures | Required |
| `API_KEY` | API key for webhook management | Required |
| `RETRY_MAX_ATTEMPTS` | Maximum retry attempts | `3` |
| `RETRY_BACKOFF_MULTIPLIER` | Retry backoff multiplier | `2` |
| `LOG_LEVEL` | Logging level | `info` |

See `.env.example` for complete configuration options.

## API Usage

### Webhook Management

#### Create Webhook
```bash
curl -X POST http://localhost:3456/api/webhooks \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-api-key" \
  -d '{
    "name": "My Integration",
    "url": "https://your-app.com/webhook",
    "events": ["issue.created", "issue.updated"],
    "filters": {
      "projects": ["project-id"]
    }
  }'
```

#### List Webhooks
```bash
curl http://localhost:3456/api/webhooks \
  -H "X-API-Key: your-api-key"
```

#### Update Webhook
```bash
curl -X PUT http://localhost:3456/api/webhooks/{id} \
  -H "Content-Type: application/json" \
  -H "X-API-Key: your-api-key" \
  -d '{
    "active": false
  }'
```

#### Delete Webhook
```bash
curl -X DELETE http://localhost:3456/api/webhooks/{id} \
  -H "X-API-Key: your-api-key"
```

### Webhook Verification

Verify webhook signatures to ensure authenticity:

```javascript
const crypto = require('crypto');

function verifyWebhookSignature(payload, signature, secret) {
  const hmac = crypto.createHmac('sha256', secret);
  const expectedSignature = 'sha256=' + hmac.update(payload).digest('hex');
  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expectedSignature)
  );
}

// Usage in your webhook handler
app.post('/webhook', (req, res) => {
  const signature = req.headers['x-hub-signature-256'];
  const payload = JSON.stringify(req.body);
  
  if (verifyWebhookSignature(payload, signature, 'your-webhook-secret')) {
    // Process webhook
    console.log('Webhook verified:', req.body);
    res.status(200).send('OK');
  } else {
    res.status(401).send('Unauthorized');
  }
});
```

## Integration with Huly

### Docker Compose Integration

Add to your Huly `docker-compose.yml`:

```yaml
services:
  huly-webhook:
    image: huly-webhook-service:latest
    restart: unless-stopped
    ports:
      - "3456:3456"
    environment:
      - MONGODB_URL=mongodb://mongodb:27017/huly
      - WEBHOOK_SECRET_KEY=${WEBHOOK_SECRET_KEY}
      - API_KEY=${WEBHOOK_API_KEY}
    networks:
      - huly-network
    depends_on:
      - mongodb
```

### Nginx Configuration

Add webhook service to your Nginx configuration:

```nginx
location /webhook/ {
    proxy_pass http://huly-webhook:3456/;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

## Development

### Running Tests

```bash
npm test                # Run all tests
npm run test:watch      # Run tests in watch mode
```

### Linting

```bash
npm run lint           # Check code style
npm run lint:fix       # Fix code style issues
```

### Development Mode

```bash
npm run dev           # Start with nodemon for auto-reload
```

## Monitoring

### Health Check

```bash
curl http://localhost:3456/api/health
```

Response:
```json
{
  "status": "healthy",
  "timestamp": "2025-07-17T20:45:00Z",
  "mongodb": "connected",
  "changeStreams": "active",
  "version": "1.0.0"
}
```

### Statistics

```bash
curl http://localhost:3456/api/stats \
  -H "X-API-Key: your-api-key"
```

### Logs

View service logs:
```bash
docker-compose logs -f huly-webhook
```

## Troubleshooting

### Common Issues

1. **MongoDB Connection Errors**:
   - Ensure MongoDB is running and accessible
   - Check connection string in `.env`
   - Verify network connectivity

2. **Change Streams Not Working**:
   - MongoDB must be configured as a replica set
   - Check MongoDB version (4.0+ required)

3. **Webhook Delivery Failures**:
   - Check target endpoint availability
   - Verify SSL certificates
   - Review delivery logs

### Debug Mode

Enable debug logging:
```bash
LOG_LEVEL=debug npm start
```

## Security

- Always use HTTPS for webhook endpoints in production
- Store webhook secrets securely
- Implement signature verification in webhook receivers
- Use IP whitelisting for additional security
- Regularly rotate API keys and webhook secrets

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests for new functionality
5. Ensure all tests pass
6. Submit a pull request

## License

MIT License - see [LICENSE](LICENSE) file for details.

## Support

For issues and questions:
- Create an issue in the repository
- Check the troubleshooting section
- Review the logs for error details