#!/bin/bash
# scripts/generate-jwt-secret.sh - Generate secure JWT secret

echo "🔐 Generating secure JWT secret..."

# Method 1: Using OpenSSL (recommended)
if command -v openssl &> /dev/null; then
    JWT_SECRET=$(openssl rand -base64 32)
    echo "✅ JWT Secret generated using OpenSSL:"
    echo "JWT_SECRET=$JWT_SECRET"
    echo ""
    echo "📋 Add this to your .env file:"
    echo "JWT_SECRET=$JWT_SECRET"
    
# Method 2: Using Node.js crypto
elif command -v node &> /dev/null; then
    JWT_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('base64'))")
    echo "✅ JWT Secret generated using Node.js crypto:"
    echo "JWT_SECRET=$JWT_SECRET"
    echo ""
    echo "📋 Add this to your .env file:"
    echo "JWT_SECRET=$JWT_SECRET"
    
# Method 3: Using /dev/urandom
elif [[ -r /dev/urandom ]]; then
    JWT_SECRET=$(head -c 32 /dev/urandom | base64)
    echo "✅ JWT Secret generated using /dev/urandom:"
    echo "JWT_SECRET=$JWT_SECRET"
    echo ""
    echo "📋 Add this to your .env file:"
    echo "JWT_SECRET=$JWT_SECRET"
    
else
    echo "❌ Could not generate JWT secret - no suitable method found"
    echo "💡 Please manually generate a 32+ character random string"
    echo "💡 You can use online tools like: https://www.uuidgenerator.net/random-password"
    exit 1
fi

echo ""
echo "⚠️  IMPORTANT SECURITY NOTES:"
echo "   - Keep this secret secure and never commit it to version control"
echo "   - Use different secrets for development and production"
echo "   - Store production secrets in AWS Secrets Manager or similar"
echo "   - Rotate secrets regularly in production"