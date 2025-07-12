# Cellebrite Screen Capture API 🚀

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
├── serverless.yml        # Serverless Framework configuration
├── package.json          # Dependencies and scripts
└── webpack.config.js     # Webpack configuration
```

## 🚀 Quick Setup (3 Steps)

### Step 1: Install Dependencies

```bash
# Clone repository
git clone <repository-url>
cd cellebrite-screen-capture-api

# Install dependencies
npm install

# Install Serverless Framework (if not already installed)
npm install -g serverless
```

### Step 2: Configure AWS

**Option A: Using AWS Configure (Recommended)**
```bash
aws configure
# AWS Access Key ID: your-access-key
# AWS Secret Access Key: your-secret-key  
# Default region: ap-southeast-2
# Default output format: json
```

**Option B: Environment Variables**
```bash
export AWS_ACCESS_KEY_ID=your-access-key
export AWS_SECRET_ACCESS_KEY=your-secret-key
export AWS_DEFAULT_REGION=ap-southeast-2
```

### Step 3: Deploy

```bash
# Create .env file
cp .env.development .env

# Generate JWT secret
echo "JWT_SECRET=$(openssl rand -base64 32)" >> .env

# Deploy
serverless deploy --stage dev --region ap-southeast-2
```

**🎉 Done! API will be automatically deployed with all resources.**

---

## 🛠️ Detailed Setup

### Prerequisites

- **Node.js 18+** - [Download](https://nodejs.org/)
- **AWS CLI** - [Install Guide](https://docs.aws.amazon.com/cli/latest/userguide/install-cliv2.html)
- **AWS Account** with sufficient permissions

### 1. Project Installation

```bash
# Clone and install
git clone <repository-url>
cd cellebrite-screen-capture-api
npm install

# Check versions
node -v  # >= 18.0.0
npm -v
aws --version
```

### 2. AWS Credentials Setup

#### Method 1: AWS IAM User (Recommended)

1. **Create IAM User** in AWS Console:
   - Go to IAM → Users → Create user
   - Username: `cellebrite-api-user`

2. **Add Permissions** - Attach these policies:
   ```
   ✅ AmazonS3FullAccess
   ✅ AmazonDynamoDBFullAccess  
   ✅ AWSLambdaFullAccess
   ✅ IAMFullAccess
   ✅ AmazonAPIGatewayAdministrator
   ✅ AWSCloudFormationFullAccess
   ✅ CloudWatchLogsFullAccess
   ```

3. **Create Access Keys**:
   - Security credentials → Create access key
   - Choose "CLI" → Create access key
   - **Save credentials securely!**

4. **Configure AWS CLI**:
   ```bash
   aws configure
   # Enter access key, secret key, region: ap-southeast-2
   ```

#### Method 2: Admin Access (Fastest for development)

```bash
# Attach AdminAccess policy to user
aws iam attach-user-policy \
  --user-name cellebrite-api-user \
  --policy-arn arn:aws:iam::aws:policy/AdministratorAccess
```

### 3. Environment Configuration

```bash
# Create .env file from template
cp .env.development .env

# Generate secure JWT secret
openssl rand -base64 32  # Copy output

# Update .env file
JWT_SECRET=your-generated-secret-here
STAGE=dev
REGION=ap-southeast-2
NODE_ENV=development
```

### 4. Local Development (Optional)

```bash
# Test locally before deployment
npm run dev

# API will run at http://localhost:3001
# Test: curl http://localhost:3001/health
```

### 5. Deployment

#### Option A: Deploy Script (Recommended)
```bash
# Make script executable
chmod +x scripts/deploy.sh

# Deploy with auto-fix
./scripts/deploy.sh --stage dev --region ap-southeast-2
```

#### Option B: Manual Deploy
```bash
# Validate config
serverless config validate

# Deploy
serverless deploy --stage dev --region ap-southeast-2 --verbose

# Get API endpoint  
serverless info --stage dev
```

### 6. Verify Deployment

```bash
# Test health endpoint
curl https://your-api-endpoint/health

# Test login with demo user
curl -X POST https://your-api-endpoint/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "username": "demo",
    "password": "password"
  }'
```

---

## 📚 API Documentation

### Base URL
- **Development**: `https://api-gateway-id.execute-api.ap-southeast-2.amazonaws.com/dev`
- **Production**: `https://api-gateway-id.execute-api.ap-southeast-2.amazonaws.com/production`

### Demo Credentials
```json
{
  "username": "demo",
  "password": "password"
}
```

### Authentication

All endpoints (except `/health` and `/auth/login`) require JWT token:

```http
Authorization: Bearer <jwt-token>
```

### Core Endpoints

#### 🔐 Authentication
```http
POST /auth/login         # Login
GET  /auth/me           # Current user info
POST /auth/logout       # Logout
POST /auth/refresh      # Refresh token
```

#### 📁 Case Management
```http
GET    /cases           # Get cases list
POST   /cases           # Create new case
GET    /cases/{id}      # Get case details
PATCH  /cases/{id}      # Update case
DELETE /cases/{id}      # Delete case
GET    /cases/stats     # Get case statistics
```

#### 📂 File Upload
```http
POST   /upload/presigned-url              # Get presigned URL
POST   /upload/confirm                    # Confirm upload
GET    /upload/cases/{caseId}/files       # Get case files
GET    /upload/download/{fileKey}         # Download file
DELETE /upload/file                      # Delete file
```

#### 🏥 Health Check
```http
GET /health            # Check API status
```

### Example Usage

#### Login
```bash
curl -X POST https://your-api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username": "demo", "password": "password"}'
```

#### Create Case
```bash
curl -X POST https://your-api/cases \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{
    "title": "Website Investigation",
    "description": "Security analysis case",
    "priority": "high",
    "tags": ["security", "web"]
  }'
```

---

## 🗄️ Database Schema

### Users Table
- `id` (Primary Key) - User ID
- `username` (GSI) - Username for login
- `email` (GSI) - Email address
- `role` - User role (analyst, admin, etc.)
- `isActive` - Account status

### Cases Table  
- `id` (Primary Key) - Case ID (format: Case-YYYYMMDDXXXX)
- `title` - Case title
- `status` - active | pending | closed | archived
- `priority` - low | medium | high | critical
- `createdAt` (GSI) - Timestamp
- `assignedTo` (GSI) - Assigned user

### Files Table
- `id` (Primary Key) - File ID
- `fileKey` (GSI) - S3 object key
- `caseId` (GSI) - Associated case
- `captureType` - screenshot | video
- `status` - pending | completed | failed

---

## 🔧 Development Commands

```bash
# Local development
npm run dev                    # Start serverless offline

# Build and deploy
npm run build                  # Build with webpack  
npm run deploy                 # Deploy to AWS
npm run deploy:production      # Deploy to production

# Monitoring
npm run info                   # Get deployment info
npm run logs                   # View function logs

# Cleanup
npm run clean                  # Clean build artifacts
npm run remove                 # Remove AWS stack
```

## 🚨 Troubleshooting

### Common Issues

#### 1. "AWS credentials not configured"
```bash
# Check credentials
aws sts get-caller-identity

# Reconfigure
aws configure
```

#### 2. "Cannot find module" errors  
```bash
# Clean and reinstall
rm -rf node_modules .webpack
npm install
```

#### 3. "Bucket already exists"
```bash
# Update bucket name in .env
S3_BUCKET=your-unique-bucket-name-$(date +%s)
```

#### 4. Deployment fails
```bash
# Check IAM permissions
aws iam list-attached-user-policies --user-name your-user

# Validate serverless config
serverless config validate
```

#### 5. Health check fails
```bash
# Check deployment status
serverless info --stage dev

# View logs
serverless logs -f health --stage dev --tail
```

### Debug Commands

```bash
# Test specific function
serverless invoke -f health --stage dev

# View detailed logs
aws logs tail /aws/lambda/cellebrite-screen-capture-api-dev-health

# Check DynamoDB tables
aws dynamodb list-tables --region ap-southeast-2

# Check S3 buckets  
aws s3 ls
```

---

## 🚀 Production Deployment

### 1. Environment Setup
```bash
# Use production config
cp .env.production .env

# Generate production JWT secret
echo "JWT_SECRET=$(openssl rand -base64 64)" >> .env

# Set CORS origin
echo "CORS_ORIGIN=https://your-frontend-domain.com" >> .env
```

### 2. Deploy
```bash
serverless deploy --stage production --region ap-southeast-2
```

### 3. Post-deployment
```bash
# Test production API
curl https://your-production-api/health

# Monitor logs
serverless logs -f health --stage production --tail
```

---

## 📊 Monitoring & Logs

### CloudWatch Logs
```bash
# View real-time logs
serverless logs -f functionName --stage dev --tail

# View specific time range
serverless logs -f functionName --startTime 1h --stage dev
```

### Health Monitoring
```bash
# API health check
curl https://your-api/health

# Response format:
{
  "status": "ok",
  "timestamp": "2024-12-15T10:30:00.000Z",
  "checks": {
    "api": {"status": "ok"},
    "dynamodb": {"status": "ok"},
    "s3": {"status": "ok"}
  }
}
```

---

## 🔒 Security Best Practices

### JWT Secrets
- ✅ Use JWT secret >= 32 characters
- ✅ Different secrets for dev/staging/production  
- ✅ Rotate regularly in production
- ✅ Store in AWS Secrets Manager (production)

### IAM Permissions
- ✅ Use least privilege principle
- ✅ Create separate users for different environments
- ✅ Regularly rotate access keys
- ✅ Enable MFA on AWS accounts

### CORS Configuration
```yaml
# Development
CORS_ORIGIN=*

# Production
CORS_ORIGIN=https://your-frontend-domain.com,https://admin.your-domain.com
```

---

## 🔄 CI/CD Pipeline

### GitHub Actions Example
```yaml
# .github/workflows/deploy.yml
name: Deploy API
on:
  push:
    branches: [main]
jobs:
  deploy:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '18'
      - run: npm ci
      - run: serverless deploy --stage production
        env:
          AWS_ACCESS_KEY_ID: ${{ secrets.AWS_ACCESS_KEY_ID }}
          AWS_SECRET_ACCESS_KEY: ${{ secrets.AWS_SECRET_ACCESS_KEY }}
```

---

## 📈 Performance & Scaling

### Lambda Configuration
- **Memory**: 512MB (adjustable)
- **Timeout**: 30 seconds
- **Concurrent executions**: 1000 (default)

### DynamoDB
- **Billing**: Pay-per-request (auto-scaling)
- **Backup**: Point-in-time recovery enabled
- **Encryption**: At rest with AWS managed keys

### S3 Configuration
- **Storage class**: Standard
- **Lifecycle**: 7-day multipart upload cleanup
- **Versioning**: Enabled
- **Encryption**: AES256

---

## 🧪 Testing

### Local Testing
```bash
# Start offline mode
npm run dev

# Test endpoints
curl http://localhost:3001/health
curl -X POST http://localhost:3001/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username": "demo", "password": "password"}'
```

### Unit Tests
```bash
# Run tests (if implemented)
npm test

# Run tests with coverage
npm run test:coverage
```

### Load Testing
```bash
# Example with curl
for i in {1..100}; do
  curl -s https://your-api/health > /dev/null &
done
wait
```

---

## 🔧 Advanced Configuration

### Custom Domains
```yaml
# serverless.yml
custom:
  customDomain:
    domainName: api.your-domain.com
    stage: ${self:provider.stage}
    createRoute53Record: true
```

### VPC Configuration
```yaml
# serverless.yml
provider:
  vpc:
    securityGroupIds:
      - sg-xxxxxxxxx
    subnetIds:
      - subnet-xxxxxxxxx
      - subnet-yyyyyyyyy
```

### Environment Variables
```bash
# Development
NODE_ENV=development
DEBUG_MODE=true
DEMO_USER_ENABLED=true

# Production  
NODE_ENV=production
DEBUG_MODE=false
DEMO_USER_ENABLED=false
RATE_LIMIT_ENABLED=true
```

---

## 📋 Migration Guide

### From v1.0 to v2.0
```bash
# Backup existing data
aws dynamodb create-backup --table-name your-table --backup-name backup-$(date +%s)

# Deploy new version
serverless deploy --stage production

# Verify migration
curl https://your-api/health
```

---

## 🆘 Support & Contributing

### Getting Help
- **Issues**: Create GitHub issues for bugs
- **Documentation**: Check this README and API docs
- **Logs**: Use CloudWatch logs for debugging
- **Community**: Join discussions in project repository

### Contributing
1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit changes (`git commit -m 'Add amazing feature'`)
4. Push to branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

### Development Setup
```bash
# Clone your fork
git clone https://github.com/yourusername/cellebrite-screen-capture-api.git
cd cellebrite-screen-capture-api

# Install dependencies
npm install

# Create feature branch
git checkout -b feature/your-feature

# Make changes and test
npm run dev
npm test

# Submit PR
git push origin feature/your-feature
```

---

## 📄 License

MIT License - see [LICENSE](LICENSE) file for details.

---

## 🏆 Acknowledgments

- **AWS Serverless** team for the amazing platform
- **Serverless Framework** for simplifying deployments
- **Open source community** for the tools and libraries used

---

**🚀 Ready to deploy? Start with the [Quick Setup](#-quick-setup-3-steps) section!**