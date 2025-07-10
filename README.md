# Cellebrite Screen Capture API

AWS Lambda backend for the Cellebrite Screen Capture Tool, built with Serverless Framework, DynamoDB, and S3.

## 🏗️ Architecture

- **AWS Lambda** - Serverless functions for API endpoints
- **DynamoDB** - NoSQL database for users, cases, and file metadata
- **S3** - Object storage for screenshots and videos
- **API Gateway** - REST API with CORS support
- **JWT** - Authentication and authorization

## 📁 Project Structure

```
├── src/
│   ├── handlers/           # Lambda function handlers
│   │   ├── auth.js        # Authentication endpoints
│   │   ├── cases.js       # Case management endpoints
│   │   ├── upload.js      # File upload endpoints
│   │   └── health.js      # Health check endpoint
│   ├── middleware/        # Middleware functions
│   │   └── auth.js        # JWT authentication middleware
│   └── utils/             # Utility functions
│       └── response.js    # Response helpers
├── scripts/               # Deployment and utility scripts
│   └── deploy.sh         # Automated deployment script
├── serverless.yml        # Serverless Framework configuration
├── package.json          # Dependencies and scripts
└── webpack.config.js     # Webpack configuration
```

## 🚀 Quick Start

### Prerequisites

- Node.js 18+
- AWS CLI configured with appropriate permissions
- Serverless Framework

### Installation

```bash
# Clone the repository (if separate from frontend)
git clone <repository-url>
cd cellebrite-screen-capture-api

# Install dependencies
npm install

# Install Serverless Framework globally (if not installed)
npm install -g serverless
```

### Configuration

1. **Environment Variables** (create `.env` file):
```bash
# Required for production
JWT_SECRET=your-super-secret-jwt-key-change-in-production

# Optional
CORS_ORIGIN=*
```

2. **AWS Credentials**: Configure AWS CLI or use environment variables:
```bash
aws configure
# OR
export AWS_ACCESS_KEY_ID=your-access-key
export AWS_SECRET_ACCESS_KEY=your-secret-key
```

### Deployment

#### Option 1: Using the deployment script (Recommended)
```bash
# Development deployment
./scripts/deploy.sh --stage dev --region ap-southeast-2

# Production deployment
./scripts/deploy.sh --stage production --region ap-southeast-2 --profile production
```

#### Option 2: Manual deployment
```bash
# Development
serverless deploy --stage dev --region ap-southeast-2

# Production
serverless deploy --stage production --region ap-southeast-2
```

### Local Development

```bash
# Start offline development server
npm run dev

# The API will be available at http://localhost:3001
```

## 📚 API Documentation

### Base URL
- **Development**: `https://api-dev.your-domain.com`
- **Production**: `https://api.your-domain.com`

### Authentication

All endpoints except `/health` and `/auth/login` require JWT authentication:

```http
Authorization: Bearer <jwt-token>
```

### Endpoints

#### Health Check
```http
GET /health
```

#### Authentication
```http
POST /auth/login
POST /auth/logout
GET /auth/me
POST /auth/refresh
```

#### Cases
```http
GET /cases
POST /cases
GET /cases/{id}
PATCH /cases/{id}
DELETE /cases/{id}
GET /cases/stats
GET /cases/tags
PATCH /cases/bulk-update
PATCH /cases/{id}/metadata
GET /cases/export
```

#### File Upload
```http
POST /upload/presigned-url
POST /upload/confirm
DELETE /upload/file
GET /upload/cases/{caseId}/files
GET /upload/download/{fileKey}
GET /upload/stats
```

### Example Requests

#### Login
```bash
curl -X POST https://api.your-domain.com/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "username": "demo.user@cellebrite.com",
    "password": "password"
  }'
```

#### Create Case
```bash
curl -X POST https://api.your-domain.com/cases \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <jwt-token>" \
  -d '{
    "title": "Investigation Case",
    "description": "Website security analysis",
    "priority": "high",
    "tags": ["security", "analysis"]
  }'
```

#### Get Presigned Upload URL
```bash
curl -X POST https://api.your-domain.com/upload/presigned-url \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <jwt-token>" \
  -d '{
    "fileName": "screenshot.png",
    "fileType": "image/png",
    "caseId": "Case-202412150001",
    "captureType": "screenshot",
    "fileSize": 1048576
  }'
```

## 🗄️ Database Schema

### Users Table
```json
{
  "id": "string (Primary Key)",
  "username": "string (GSI)",
  "email": "string (GSI)",
  "firstName": "string",
  "lastName": "string",
  "role": "string",
  "permissions": ["string"],
  "password": "string (hashed)",
  "createdAt": "string (ISO)",
  "lastLogin": "string (ISO)",
  "isActive": "boolean"
}
```

### Cases Table
```json
{
  "id": "string (Primary Key)",
  "title": "string",
  "description": "string",
  "status": "active|pending|closed|archived",
  "priority": "low|medium|high|critical",
  "tags": ["string"],
  "createdAt": "string (ISO, GSI)",
  "updatedAt": "string (ISO)",
  "createdBy": "string",
  "assignedTo": "string (GSI)",
  "metadata": {
    "totalScreenshots": "number",
    "totalVideos": "number",
    "totalFileSize": "number",
    "lastActivity": "string (ISO)"
  }
}
```

### Files Table
```json
{
  "id": "string (Primary Key)",
  "fileKey": "string (GSI)",
  "fileName": "string",
  "originalName": "string",
  "fileType": "string",
  "fileSize": "number",
  "caseId": "string (GSI)",
  "captureType": "screenshot|video",
  "uploadedBy": "string",
  "uploadedAt": "string (ISO)",
  "status": "pending|completed|failed",
  "checksum": "string",
  "expiresAt": "string (ISO)"
}
```

## 🔒 Security

### Authentication
- JWT tokens with configurable expiration
- Bcrypt password hashing
- Role-based access control

### Authorization
- Resource-level permissions
- User role validation
- API rate limiting (planned)

### Data Protection
- S3 server-side encryption (AES256)
- HTTPS only communication
- CORS configuration
- Input validation and sanitization

## 🛠️ Configuration

### Environment Variables

| Variable | Description | Default | Required |
|----------|-------------|---------|----------|
| `STAGE` | Deployment stage | `dev` | Yes |
| `REGION` | AWS region | `ap-southeast-2` | Yes |
| `USERS_TABLE` | DynamoDB users table name | Auto-generated | Yes |
| `CASES_TABLE` | DynamoDB cases table name | Auto-generated | Yes |
| `FILES_TABLE` | DynamoDB files table name | Auto-generated | Yes |
| `S3_BUCKET` | S3 bucket name | Auto-generated | Yes |
| `JWT_SECRET` | JWT signing secret | Random (dev) | Yes (prod) |
| `CORS_ORIGIN` | CORS allowed origins | `*` | No |

### DynamoDB Configuration

- **Billing Mode**: Pay-per-request
- **Encryption**: At rest with AWS managed keys
- **Streams**: Enabled for audit logging
- **Global Secondary Indexes**: For efficient querying

### S3 Configuration

- **Encryption**: AES256 server-side encryption
- **Versioning**: Enabled
- **CORS**: Configured for web uploads
- **Lifecycle**: 7-day incomplete multipart upload cleanup

## 📊 Monitoring & Logging

### CloudWatch Metrics
- Lambda function execution metrics
- DynamoDB read/write capacity
- S3 request metrics
- API Gateway metrics

### Logging
- Structured JSON logging
- Request/response logging
- Error tracking with stack traces
- Performance monitoring

### Health Checks
```bash
# Check API health
curl https://api.your-domain.com/health

# Response includes:
# - API status
# - Database connectivity
# - S3 bucket accessibility
# - Environment validation
```

## 🔧 Development

### Local Development
```bash
# Start serverless offline
npm run dev

# Run tests
npm test

# Lint code
npm run lint

# Build for deployment
npm run build
```

### Testing
```bash
# Run all tests
npm test

# Run tests with coverage
npm run test:coverage

# Run tests in watch mode
npm run test:watch
```

### Debugging
```bash
# View function logs
serverless logs -f functionName --stage dev --tail

# View all logs
serverless logs --stage dev --tail

# Debug specific function
serverless invoke -f functionName --stage dev --data '{"test": "data"}'
```

## 🚀 Deployment

### Staging Deployment
```bash
./scripts/deploy.sh --stage staging --region ap-southeast-2
```

### Production Deployment
```bash
# Set production environment variables
export JWT_SECRET="your-production-jwt-secret"

# Deploy with confirmation prompt
./scripts/deploy.sh --stage production --region ap-southeast-2

# Or deploy with specific AWS profile
./scripts/deploy.sh --stage production --region ap-southeast-2 --profile production
```

### Rollback
```bash
# List deployments
serverless deploy list --stage production

# Rollback to previous deployment
serverless rollback --timestamp <timestamp> --stage production
```

### Remove Stack
```bash
serverless remove --stage dev --region ap-southeast-2
```

## 📈 Performance

### Optimization
- Lambda function warming
- DynamoDB query optimization
- S3 presigned URL caching
- Efficient pagination

### Limits
- **File Upload**: 100MB per file
- **Request Timeout**: 30 seconds
- **Concurrent Executions**: 1000 (default)
- **DynamoDB**: Pay-per-request billing

## 🐛 Troubleshooting

### Common Issues

#### Deployment Fails
```bash
# Check AWS credentials
aws sts get-caller-identity

# Check IAM permissions
aws iam get-user

# Validate serverless config
serverless config validate
```

#### Database Connection Issues
```bash
# Check table exists
aws dynamodb describe-table --table-name <table-name>

# Check table status
aws dynamodb list-tables
```

#### S3 Upload Issues
```bash
# Check bucket exists
aws s3 ls s3://<bucket-name>

# Check bucket permissions
aws s3api get-bucket-location --bucket <bucket-name>
```

#### Authentication Issues
- Verify JWT secret is set correctly
- Check token expiration
- Validate user permissions

### Error Codes

| Code | Description | Solution |
|------|-------------|----------|
| 401 | Unauthorized | Check JWT token |
| 403 | Forbidden | Verify user permissions |
| 404 | Not Found | Check resource exists |
| 409 | Conflict | Resource already exists |
| 429 | Rate Limited | Reduce request frequency |
| 500 | Server Error | Check logs for details |

## 📝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests
5. Run linting and tests
6. Submit a pull request

## 📄 License

MIT License - see LICENSE file for details.

## 🆘 Support

- **Issues**: Create GitHub issues for bugs
- **Documentation**: Check API documentation
- **Logs**: Use CloudWatch logs for debugging
- **Monitoring**: Use CloudWatch metrics and alarms