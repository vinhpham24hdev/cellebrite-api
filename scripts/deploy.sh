#!/bin/bash

# Cellebrite Screen Capture API - Deployment Script
set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Default values
STAGE="dev"
REGION="ap-southeast-2"
PROFILE=""
VERBOSE=false

# Parse command line arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    --stage)
      STAGE="$2"
      shift 2
      ;;
    --region)
      REGION="$2"
      shift 2
      ;;
    --profile)
      PROFILE="$2"
      shift 2
      ;;
    --verbose)
      VERBOSE=true
      shift
      ;;
    --help)
      echo "Usage: $0 [OPTIONS]"
      echo ""
      echo "Options:"
      echo "  --stage STAGE     Deployment stage (dev, staging, production) [default: dev]"
      echo "  --region REGION   AWS region [default: ap-southeast-2]"
      echo "  --profile PROFILE AWS profile to use"
      echo "  --verbose         Enable verbose output"
      echo "  --help           Show this help message"
      exit 0
      ;;
    *)
      echo "Unknown option $1"
      exit 1
      ;;
  esac
done

# Function to print colored output
print_status() {
  local color=$1
  local message=$2
  echo -e "${color}${message}${NC}"
}

print_status $BLUE "🚀 Deploying Cellebrite Screen Capture API"
print_status $BLUE "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Check prerequisites
print_status $YELLOW "📋 Checking prerequisites..."

# Check if Node.js is installed
if ! command -v node &> /dev/null; then
    print_status $RED "❌ Node.js is not installed"
    exit 1
fi

# Check if npm is installed
if ! command -v npm &> /dev/null; then
    print_status $RED "❌ npm is not installed"
    exit 1
fi

# Check if serverless is installed
if ! command -v serverless &> /dev/null; then
    print_status $RED "❌ Serverless Framework is not installed"
    print_status $YELLOW "📦 Installing Serverless Framework..."
    npm install -g serverless
fi

# Check if AWS CLI is installed
if ! command -v aws &> /dev/null; then
    print_status $RED "❌ AWS CLI is not installed"
    print_status $YELLOW "Please install AWS CLI and configure credentials"
    exit 1
fi

print_status $GREEN "✅ Prerequisites check passed"

# Environment validation
print_status $YELLOW "🔧 Validating environment..."

if [[ "$STAGE" == "production" ]]; then
    print_status $YELLOW "⚠️  You are deploying to PRODUCTION"
    read -p "Are you sure you want to continue? (y/N): " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        print_status $YELLOW "Deployment cancelled"
        exit 0
    fi
fi

# Set AWS profile if provided
if [[ -n "$PROFILE" ]]; then
    export AWS_PROFILE=$PROFILE
    print_status $BLUE "📋 Using AWS profile: $PROFILE"
fi

# Verify AWS credentials
if ! aws sts get-caller-identity &> /dev/null; then
    print_status $RED "❌ AWS credentials not configured or invalid"
    exit 1
fi

AWS_ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
print_status $GREEN "✅ AWS credentials verified (Account: $AWS_ACCOUNT_ID)"

# Set environment variables
export STAGE=$STAGE
export REGION=$REGION

print_status $BLUE "🎯 Deployment Configuration:"
print_status $BLUE "   Stage: $STAGE"
print_status $BLUE "   Region: $REGION"
print_status $BLUE "   AWS Account: $AWS_ACCOUNT_ID"

# Install dependencies
print_status $YELLOW "📦 Installing dependencies..."
npm ci

if [[ $VERBOSE == true ]]; then
    npm audit
fi

print_status $GREEN "✅ Dependencies installed"

# Run tests (if they exist)
if [[ -f "package.json" ]] && npm run | grep -q "test"; then
    print_status $YELLOW "🧪 Running tests..."
    npm test
    print_status $GREEN "✅ Tests passed"
fi

# Check for required environment variables
print_status $YELLOW "🔍 Checking environment variables..."

if [[ "$STAGE" == "production" ]]; then
    if [[ -z "$JWT_SECRET" ]]; then
        print_status $RED "❌ JWT_SECRET environment variable is required for production"
        exit 1
    fi
fi

# Generate JWT secret for non-production environments
if [[ -z "$JWT_SECRET" ]]; then
    JWT_SECRET=$(openssl rand -base64 32)
    export JWT_SECRET
    print_status $YELLOW "🔑 Generated JWT secret for $STAGE environment"
fi

print_status $GREEN "✅ Environment variables validated"

# Deploy the stack
print_status $YELLOW "🚀 Deploying serverless stack..."

DEPLOY_CMD="serverless deploy --stage $STAGE --region $REGION"

if [[ $VERBOSE == true ]]; then
    DEPLOY_CMD="$DEPLOY_CMD --verbose"
fi

if ! eval $DEPLOY_CMD; then
    print_status $RED "❌ Deployment failed"
    exit 1
fi

print_status $GREEN "✅ Deployment completed successfully"

# Get deployment info
print_status $YELLOW "📊 Getting deployment information..."
API_ENDPOINT=$(serverless info --stage $STAGE --region $REGION | grep "GET - " | head -1 | awk '{print $3}' | sed 's/\/health//')

if [[ -n "$API_ENDPOINT" ]]; then
    print_status $GREEN "✅ API Endpoint: $API_ENDPOINT"
    
    # Test health endpoint
    print_status $YELLOW "🏥 Testing health endpoint..."
    if curl -s -f "$API_ENDPOINT/health" > /dev/null; then
        print_status $GREEN "✅ Health check passed"
    else
        print_status $YELLOW "⚠️  Health check failed (API might still be initializing)"
    fi
else
    print_status $YELLOW "⚠️  Could not determine API endpoint"
fi

# Print post-deployment information
print_status $BLUE "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
print_status $GREEN "🎉 Deployment completed successfully!"
print_status $BLUE "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

echo ""
print_status $BLUE "📋 Deployment Summary:"
print_status $BLUE "   Stage: $STAGE"
print_status $BLUE "   Region: $REGION"
if [[ -n "$API_ENDPOINT" ]]; then
    print_status $BLUE "   API Endpoint: $API_ENDPOINT"
fi

echo ""
print_status $YELLOW "📝 Next Steps:"
echo "   1. Update your frontend VITE_API_BASE_URL to: $API_ENDPOINT"
echo "   2. Test the API endpoints"
echo "   3. Configure your frontend environment variables"

echo ""
print_status $YELLOW "🛠️  Useful Commands:"
echo "   View logs: serverless logs -f <function-name> --stage $STAGE"
echo "   Remove stack: serverless remove --stage $STAGE --region $REGION"
echo "   Update stack: ./scripts/deploy.sh --stage $STAGE --region $REGION"

echo ""
print_status $GREEN "🎯 Deployment completed at $(date)"