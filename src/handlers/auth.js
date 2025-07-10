const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const Joi = require('joi');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand, UpdateCommand } = require('@aws-sdk/lib-dynamodb');
const { createResponse, handleError, validateRequest } = require('../utils/response');
const { requireAuth } = require('../middleware/auth');

const client = new DynamoDBClient({ region: process.env.REGION });
const ddb = DynamoDBDocumentClient.from(client);

const USERS_TABLE = process.env.USERS_TABLE;
const JWT_SECRET = process.env.JWT_SECRET;
const JWT_EXPIRY = '24h';

// Demo user for development
const DEMO_USER = {
  id: 'demo-user-001',
  username: 'demo.user@cellebrite.com',
  email: 'demo.user@cellebrite.com',
  firstName: 'Demo',
  lastName: 'User',
  role: 'analyst',
  permissions: ['screenshot', 'video', 'case_management'],
  password: '$2a$10$92IXUNpkjO0rOQ5byMi.Ye4oKoEa3Ro9llC/.og/at2.uheWG/igi', // password
  createdAt: new Date().toISOString(),
  lastLogin: null,
  isActive: true
};

// Validation schemas
const loginSchema = Joi.object({
  username: Joi.string().required(),
  password: Joi.string().required()
});

/**
 * Generate JWT token
 */
function generateToken(user) {
  return jwt.sign(
    {
      userId: user.id,
      username: user.username,
      email: user.email,
      role: user.role
    },
    JWT_SECRET,
    { expiresIn: JWT_EXPIRY }
  );
}

/**
 * Get user by username or email
 */
async function getUserByUsernameOrEmail(identifier) {
  try {
    // Try username first
    const usernameQuery = {
      TableName: USERS_TABLE,
      IndexName: 'UsernameIndex',
      KeyConditionExpression: 'username = :username',
      ExpressionAttributeValues: {
        ':username': identifier
      }
    };

    let response = await ddb.send(new QueryCommand(usernameQuery));
    
    if (response.Items && response.Items.length > 0) {
      return response.Items[0];
    }

    // Try email
    const emailQuery = {
      TableName: USERS_TABLE,
      IndexName: 'EmailIndex',
      KeyConditionExpression: 'email = :email',
      ExpressionAttributeValues: {
        ':email': identifier
      }
    };

    response = await ddb.send(new QueryCommand(emailQuery));
    
    if (response.Items && response.Items.length > 0) {
      return response.Items[0];
    }

    // For demo mode - return demo user if credentials match
    if (identifier === DEMO_USER.username || identifier === DEMO_USER.email) {
      return DEMO_USER;
    }

    return null;
  } catch (error) {
    console.error('Error getting user:', error);
    throw error;
  }
}

/**
 * Update user last login
 */
async function updateLastLogin(userId) {
  try {
    const params = {
      TableName: USERS_TABLE,
      Key: { id: userId },
      UpdateExpression: 'SET lastLogin = :lastLogin',
      ExpressionAttributeValues: {
        ':lastLogin': new Date().toISOString()
      }
    };

    await ddb.send(new UpdateCommand(params));
  } catch (error) {
    console.error('Error updating last login:', error);
    // Don't throw error here as it's not critical
  }
}

/**
 * Login handler
 */
async function login(event) {
  try {
    console.log('🔐 Login attempt');

    // Validate request
    const validation = validateRequest(event.body, loginSchema);
    if (!validation.isValid) {
      return createResponse(400, {
        success: false,
        error: 'Invalid request data',
        details: validation.errors
      });
    }

    const { username, password } = validation.data;

    // Get user
    const user = await getUserByUsernameOrEmail(username);
    if (!user) {
      console.log('❌ User not found:', username);
      return createResponse(401, {
        success: false,
        error: 'Invalid credentials'
      });
    }

    // Check if user is active
    if (!user.isActive) {
      console.log('❌ User inactive:', username);
      return createResponse(401, {
        success: false,
        error: 'Account is inactive'
      });
    }

    // Verify password
    const isValidPassword = await bcrypt.compare(password, user.password);
    if (!isValidPassword) {
      console.log('❌ Invalid password for user:', username);
      return createResponse(401, {
        success: false,
        error: 'Invalid credentials'
      });
    }

    // Generate token
    const token = generateToken(user);

    // Update last login (don't wait for this)
    updateLastLogin(user.id).catch(console.error);

    // Remove password from response
    const { password: _, ...userWithoutPassword } = user;

    console.log('✅ Login successful:', username);
    
    return createResponse(200, {
      success: true,
      token,
      expiresIn: JWT_EXPIRY,
      user: userWithoutPassword
    });

  } catch (error) {
    console.error('❌ Login error:', error);
    return handleError(error);
  }
}

/**
 * Get current user handler
 */
async function me(event) {
  try {
    console.log('👤 Get current user');

    // Extract user info from JWT (added by auth middleware)
    const { userId } = event.user;

    // Get fresh user data from database
    const params = {
      TableName: USERS_TABLE,
      Key: { id: userId }
    };

    const response = await ddb.send(new GetCommand(params));
    
    if (!response.Item) {
      return createResponse(404, {
        success: false,
        error: 'User not found'
      });
    }

    const user = response.Item;

    // Remove password from response
    const { password, ...userWithoutPassword } = user;

    console.log('✅ User data retrieved:', user.username);
    
    return createResponse(200, userWithoutPassword);

  } catch (error) {
    console.error('❌ Get user error:', error);
    return handleError(error);
  }
}

/**
 * Logout handler
 */
async function logout(event) {
  try {
    console.log('🔓 Logout');

    // In a more complex system, you might want to blacklist the token
    // For now, just return success as the client will remove the token
    
    return createResponse(200, {
      success: true,
      message: 'Logged out successfully'
    });

  } catch (error) {
    console.error('❌ Logout error:', error);
    return handleError(error);
  }
}

/**
 * Refresh token handler
 */
async function refresh(event) {
  try {
    console.log('🔄 Refresh token');

    // Extract user info from JWT (added by auth middleware)
    const { userId } = event.user;

    // Get fresh user data
    const params = {
      TableName: USERS_TABLE,
      Key: { id: userId }
    };

    const response = await ddb.send(new GetCommand(params));
    
    if (!response.Item) {
      return createResponse(404, {
        success: false,
        error: 'User not found'
      });
    }

    const user = response.Item;

    if (!user.isActive) {
      return createResponse(401, {
        success: false,
        error: 'Account is inactive'
      });
    }

    // Generate new token
    const token = generateToken(user);

    console.log('✅ Token refreshed:', user.username);
    
    return createResponse(200, {
      success: true,
      token,
      expiresIn: JWT_EXPIRY
    });

  } catch (error) {
    console.error('❌ Refresh token error:', error);
    return handleError(error);
  }
}

// Export handlers with middleware
module.exports = {
  login,
  me: requireAuth(me),
  logout: requireAuth(logout),
  refresh: requireAuth(refresh)
};