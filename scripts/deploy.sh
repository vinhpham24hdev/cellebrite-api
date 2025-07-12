#!/bin/bash

# AWS Credentials Setup Guide

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
NC='\033[0m'

print_status() {
  echo -e "${1}${2}${NC}"
}

print_status $PURPLE "
╔══════════════════════════════════════════════════════════════╗
║                🔐 AWS CREDENTIALS SETUP                      ║
╚══════════════════════════════════════════════════════════════╝"

print_status $YELLOW "🔍 Checking current AWS configuration..."

# Check if AWS CLI is installed
if ! command -v aws &> /dev/null; then
    print_status $RED "❌ AWS CLI not installed"
    print_status $YELLOW "📥 Installing AWS CLI..."
    
    # Try different installation methods
    if command -v brew &> /dev/null; then
        # macOS with Homebrew
        brew install awscli
    elif command -v apt-get &> /dev/null; then
        # Ubuntu/Debian
        sudo apt-get update
        sudo apt-get install awscli
    elif command -v yum &> /dev/null; then
        # Amazon Linux/CentOS/RHEL
        sudo yum install awscli
    elif command -v pip3 &> /dev/null; then
        # Python pip
        pip3 install awscli --user
    else
        print_status $RED "❌ Cannot install AWS CLI automatically"
        print_status $YELLOW "Please install manually:"
        echo "   macOS: brew install awscli"
        echo "   Ubuntu: sudo apt-get install awscli"
        echo "   Python: pip3 install awscli"
        echo "   Or download from: https://aws.amazon.com/cli/"
        exit 1
    fi
    
    print_status $GREEN "✅ AWS CLI installed"
fi

# Check current credentials
print_status $YELLOW "🔍 Checking existing credentials..."

if aws sts get-caller-identity &>/dev/null; then
    print_status $GREEN "✅ AWS credentials already configured!"
    
    AWS_ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
    AWS_USER=$(aws sts get-caller-identity --query Arn --output text)
    AWS_REGION=$(aws configure get region 2>/dev/null || echo "Not set")
    
    print_status $BLUE "📋 Current Configuration:"
    echo "   Account ID: $AWS_ACCOUNT"
    echo "   User/Role: $AWS_USER"
    echo "   Region: $AWS_REGION"
    
    read -p "Do you want to reconfigure? (y/N): " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        print_status $GREEN "✅ Using existing credentials"
        exit 0
    fi
fi

print_status $YELLOW "⚙️  Setting up AWS credentials..."

echo ""
print_status $YELLOW "📋 Choose setup method:"
echo "   1) AWS Configure (Interactive - Recommended)"
echo "   2) Environment Variables"
echo "   3) AWS Profile"
echo "   4) IAM Role (for EC2/Lambda)"
echo "   5) Help - How to get AWS credentials"
echo ""
read -p "Choose option (1-5): " choice

case $choice in
    1)
        print_status $BLUE "🔧 Running AWS Configure..."
        print_status $YELLOW "You'll need:"
        echo "   - AWS Access Key ID"
        echo "   - AWS Secret Access Key"
        echo "   - Default region (ap-southeast-2 recommended)"
        echo "   - Output format (json recommended)"
        echo ""
        
        aws configure
        
        # Test the configuration
        print_status $YELLOW "🧪 Testing configuration..."
        if aws sts get-caller-identity &>/dev/null; then
            print_status $GREEN "✅ AWS credentials configured successfully!"
            
            AWS_ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
            print_status $BLUE "📋 Account: $AWS_ACCOUNT"
        else
            print_status $RED "❌ Configuration test failed"
            exit 1
        fi
        ;;
        
    2)
        print_status $BLUE "🌱 Setting up Environment Variables..."
        echo ""
        print_status $YELLOW "Enter your AWS credentials:"
        
        read -p "AWS Access Key ID: " AWS_ACCESS_KEY_ID
        read -s -p "AWS Secret Access Key: " AWS_SECRET_ACCESS_KEY
        echo ""
        read -p "Default region [ap-southeast-2]: " AWS_DEFAULT_REGION
        AWS_DEFAULT_REGION=${AWS_DEFAULT_REGION:-ap-southeast-2}
        
        # Export for current session
        export AWS_ACCESS_KEY_ID="$AWS_ACCESS_KEY_ID"
        export AWS_SECRET_ACCESS_KEY="$AWS_SECRET_ACCESS_KEY"
        export AWS_DEFAULT_REGION="$AWS_DEFAULT_REGION"
        
        # Add to .env file for persistence
        if [ -f ".env" ]; then
            # Remove existing AWS lines
            grep -v "^AWS_" .env > .env.tmp || true
            mv .env.tmp .env
        fi
        
        cat >> .env << EOF

# AWS Credentials
AWS_ACCESS_KEY_ID=$AWS_ACCESS_KEY_ID
AWS_SECRET_ACCESS_KEY=$AWS_SECRET_ACCESS_KEY
AWS_DEFAULT_REGION=$AWS_DEFAULT_REGION
EOF
        
        print_status $GREEN "✅ Environment variables set"
        
        # Test the configuration
        print_status $YELLOW "🧪 Testing configuration..."
        if aws sts get-caller-identity &>/dev/null; then
            print_status $GREEN "✅ AWS credentials working!"
        else
            print_status $RED "❌ Configuration test failed"
            exit 1
        fi
        ;;
        
    3)
        print_status $BLUE "👤 Setting up AWS Profile..."
        
        read -p "Enter profile name: " PROFILE_NAME
        
        aws configure --profile "$PROFILE_NAME"
        
        # Test the profile
        print_status $YELLOW "🧪 Testing profile..."
        if aws sts get-caller-identity --profile "$PROFILE_NAME" &>/dev/null; then
            print_status $GREEN "✅ Profile '$PROFILE_NAME' configured successfully!"
            
            # Set as default profile
            export AWS_PROFILE="$PROFILE_NAME"
            echo "AWS_PROFILE=$PROFILE_NAME" >> .env
            
            print_status $BLUE "📋 Profile set as default for this project"
        else
            print_status $RED "❌ Profile configuration test failed"
            exit 1
        fi
        ;;
        
    4)
        print_status $BLUE "🏢 Setting up IAM Role..."
        print_status $YELLOW "For IAM roles, credentials are automatically provided by:"
        echo "   - EC2 instances with attached IAM role"
        echo "   - Lambda functions with execution role"
        echo "   - ECS tasks with task role"
        echo ""
        print_status $YELLOW "Make sure your environment has the IAM role attached"
        
        # Test if role-based auth works
        if aws sts get-caller-identity &>/dev/null; then
            print_status $GREEN "✅ IAM role authentication working!"
        else
            print_status $RED "❌ No IAM role found or insufficient permissions"
            exit 1
        fi
        ;;
        
    5)
        print_status $BLUE "🆘 How to Get AWS Credentials..."
        echo ""
        print_status $YELLOW "📋 Step-by-step guide:"
        echo ""
        echo "1. 🌐 Go to AWS Console: https://console.aws.amazon.com/"
        echo ""
        echo "2. 🔐 Sign in to your AWS account"
        echo ""
        echo "3. 👤 Go to IAM (Identity and Access Management):"
        echo "   - Search 'IAM' in the search bar"
        echo "   - Click on IAM service"
        echo ""
        echo "4. 👥 Create or select a user:"
        echo "   - Click 'Users' in left sidebar"
        echo "   - Click 'Create user' (or select existing user)"
        echo "   - Enter username (e.g., 'serverless-deploy')"
        echo ""
        echo "5. 🔑 Create Access Keys:"
        echo "   - Click on the user name"
        echo "   - Go to 'Security credentials' tab"
        echo "   - Click 'Create access key'"
        echo "   - Choose 'Command Line Interface (CLI)'"
        echo "   - Click 'Create access key'"
        echo ""
        echo "6. 📝 Save credentials:"
        echo "   - Copy 'Access key ID'"
        echo "   - Copy 'Secret access key'"
        echo "   - Store them securely!"
        echo ""
        echo "7. 🔒 Set permissions:"
        echo "   - Attach these policies to the user:"
        echo "     * AmazonS3FullAccess"
        echo "     * AmazonDynamoDBFullAccess"
        echo "     * AWSLambdaFullAccess"
        echo "     * IAMFullAccess"
        echo "     * CloudFormationFullAccess"
        echo "     * APIGatewayAdministrator"
        echo ""
        print_status $YELLOW "⚠️  SECURITY BEST PRACTICES:"
        echo "   - Use IAM roles instead of access keys when possible"
        echo "   - Create separate users for different projects"
        echo "   - Regularly rotate access keys"
        echo "   - Use least privilege principle"
        echo "   - Enable MFA on your AWS account"
        echo ""
        
        read -p "Have you created the credentials? (y/N): " -n 1 -r
        echo
        if [[ $REPLY =~ ^[Yy]$ ]]; then
            print_status $YELLOW "Great! Now run this script again and choose option 1"
        fi
        
        exit 0
        ;;
        
    *)
        print_status $RED "Invalid choice"
        exit 1
        ;;
esac

# Final verification
print_status $YELLOW "🔍 Final verification..."

if aws sts get-caller-identity &>/dev/null; then
    AWS_ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
    AWS_USER=$(aws sts get-caller-identity --query Arn --output text)
    AWS_REGION=$(aws configure get region 2>/dev/null || echo $AWS_DEFAULT_REGION)
    
    print_status $GREEN "🎉 AWS Credentials Successfully Configured!"
    print_status $BLUE "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    print_status $BLUE "📋 Configuration Summary:"
    echo "   Account ID: $AWS_ACCOUNT"
    echo "   User/Role:  $AWS_USER"
    echo "   Region:     $AWS_REGION"
    print_status $BLUE "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
    
    # Test basic permissions
    print_status $YELLOW "🧪 Testing basic AWS permissions..."
    
    if aws s3 ls &>/dev/null; then
        print_status $GREEN "✅ S3 access: OK"
    else
        print_status $YELLOW "⚠️  S3 access: Limited (may still work for deployment)"
    fi
    
    if aws dynamodb list-tables --region $AWS_REGION &>/dev/null; then
        print_status $GREEN "✅ DynamoDB access: OK"
    else
        print_status $YELLOW "⚠️  DynamoDB access: Limited"
    fi
    
    print_status $GREEN "✅ Ready to deploy!"
    print_status $YELLOW "🚀 You can now run the deployment script"
    
else
    print_status $RED "❌ Credentials verification failed"
    print_status $YELLOW "Please check your configuration and try again"
    exit 1
fi