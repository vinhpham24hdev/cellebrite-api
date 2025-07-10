const jwt = require('jsonwebtoken');
const { createResponse } = require('../utils/response');

const JWT_SECRET = process.env.JWT_SECRET;

/**
 * Extract JWT token from Authorization header
 */
function extractToken(authHeader) {
  if (!authHeader) {
    return null;
  }

  const parts = authHeader.split(' ');
  if (parts.length !== 2 || parts[0] !== 'Bearer') {
    return null;
  }

  return parts[1];
}

/**
 * Verify JWT token
 */
function verifyToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (error) {
    console.error('Token verification failed:', error.message);
    return null;
  }
}

/**
 * Authentication middleware
 */
function requireAuth(handler) {
  return async (event, context) => {
    try {
      console.log('🔐 Checking authentication');

      // Extract token from Authorization header
      const authHeader = event.headers?.Authorization || event.headers?.authorization;
      const token = extractToken(authHeader);

      if (!token) {
        console.log('❌ No token provided');
        return createResponse(401, {
          success: false,
          error: 'Authentication token required'
        });
      }

      // Verify token
      const decoded = verifyToken(token);
      if (!decoded) {
        console.log('❌ Invalid token');
        return createResponse(401, {
          success: false,
          error: 'Invalid or expired token'
        });
      }

      // Add user info to event
      event.user = {
        userId: decoded.userId,
        username: decoded.username,
        email: decoded.email,
        role: decoded.role
      };

      console.log('✅ Authentication successful:', decoded.username);

      // Call the actual handler
      return await handler(event, context);

    } catch (error) {
      console.error('❌ Authentication middleware error:', error);
      return createResponse(500, {
        success: false,
        error: 'Authentication failed'
      });
    }
  };
}

/**
 * Optional authentication middleware (doesn't fail if no token)
 */
function optionalAuth(handler) {
  return async (event, context) => {
    try {
      // Extract token from Authorization header
      const authHeader = event.headers?.Authorization || event.headers?.authorization;
      const token = extractToken(authHeader);

      if (token) {
        // Verify token if provided
        const decoded = verifyToken(token);
        if (decoded) {
          event.user = {
            userId: decoded.userId,
            username: decoded.username,
            email: decoded.email,
            role: decoded.role
          };
          console.log('✅ Optional auth successful:', decoded.username);
        } else {
          console.log('⚠️ Invalid token provided (optional auth)');
        }
      }

      // Call the actual handler regardless of auth status
      return await handler(event, context);

    } catch (error) {
      console.error('❌ Optional auth middleware error:', error);
      // Continue without auth in case of error
      return await handler(event, context);
    }
  };
}

/**
 * Role-based authorization middleware
 */
function requireRole(roles) {
  return function(handler) {
    return requireAuth(async (event, context) => {
      const userRole = event.user.role;
      
      if (!roles.includes(userRole)) {
        console.log(`❌ Insufficient permissions. Required: ${roles.join(', ')}, User has: ${userRole}`);
        return createResponse(403, {
          success: false,
          error: 'Insufficient permissions'
        });
      }

      console.log(`✅ Role authorization successful: ${userRole}`);
      return await handler(event, context);
    });
  };
}

/**
 * Admin only middleware
 */
function requireAdmin(handler) {
  return requireRole(['admin'])(handler);
}

/**
 * CORS middleware
 */
function corsMiddleware(handler) {
  return async (event, context) => {
    // Handle preflight requests
    if (event.httpMethod === 'OPTIONS') {
      return {
        statusCode: 200,
        headers: {
          'Access-Control-Allow-Origin': process.env.CORS_ORIGIN || '*',
          'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token',
          'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS,PATCH',
          'Access-Control-Max-Age': '86400'
        },
        body: ''
      };
    }

    // Call the handler
    const response = await handler(event, context);

    // Add CORS headers to response
    if (!response.headers) {
      response.headers = {};
    }

    response.headers['Access-Control-Allow-Origin'] = process.env.CORS_ORIGIN || '*';
    response.headers['Access-Control-Allow-Headers'] = 'Content-Type,Authorization,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token';
    response.headers['Access-Control-Allow-Methods'] = 'GET,POST,PUT,DELETE,OPTIONS,PATCH';

    return response;
  };
}

module.exports = {
  requireAuth,
  optionalAuth,
  requireRole,
  requireAdmin,
  corsMiddleware,
  extractToken,
  verifyToken
};