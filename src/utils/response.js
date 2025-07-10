/**
 * Create standardized HTTP response
 */
function createResponse(statusCode, body, headers = {}) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': process.env.CORS_ORIGIN || '*',
      'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-Amz-Date,Authorization,X-Api-Key,X-Amz-Security-Token',
      'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS,PATCH',
      ...headers
    },
    body: JSON.stringify(body)
  };
}

/**
 * Create success response
 */
function successResponse(data, statusCode = 200) {
  return createResponse(statusCode, {
    success: true,
    data
  });
}

/**
 * Create error response
 */
function errorResponse(message, statusCode = 400, details = null) {
  const body = {
    success: false,
    error: message
  };

  if (details) {
    body.details = details;
  }

  return createResponse(statusCode, body);
}

/**
 * Handle common errors
 */
function handleError(error) {
  console.error('Error:', error);

  // DynamoDB errors
  if (error.name === 'ConditionalCheckFailedException') {
    return errorResponse('Resource not found or condition failed', 404);
  }

  if (error.name === 'ValidationException') {
    return errorResponse('Invalid request parameters', 400);
  }

  if (error.name === 'ResourceNotFoundException') {
    return errorResponse('Resource not found', 404);
  }

  if (error.name === 'ProvisionedThroughputExceededException') {
    return errorResponse('Service temporarily unavailable', 503);
  }

  // S3 errors
  if (error.name === 'NoSuchBucket') {
    return errorResponse('Storage bucket not found', 500);
  }

  if (error.name === 'NoSuchKey') {
    return errorResponse('File not found', 404);
  }

  if (error.name === 'AccessDenied') {
    return errorResponse('Access denied', 403);
  }

  // JWT errors
  if (error.name === 'JsonWebTokenError') {
    return errorResponse('Invalid token', 401);
  }

  if (error.name === 'TokenExpiredError') {
    return errorResponse('Token expired', 401);
  }

  // Validation errors
  if (error.name === 'ValidationError') {
    return errorResponse('Validation failed', 400, error.details);
  }

  // Network/timeout errors
  if (error.code === 'ECONNREFUSED' || error.code === 'ETIMEDOUT') {
    return errorResponse('Service temporarily unavailable', 503);
  }

  // Generic server error
  return errorResponse('Internal server error', 500);
}

/**
 * Validate request body against Joi schema
 */
function validateRequest(body, schema) {
  try {
    let data;
    
    if (typeof body === 'string') {
      data = JSON.parse(body);
    } else {
      data = body || {};
    }

    const { error, value } = schema.validate(data, {
      abortEarly: false,
      stripUnknown: true
    });

    if (error) {
      const errors = error.details.map(detail => ({
        field: detail.path.join('.'),
        message: detail.message
      }));

      return {
        isValid: false,
        errors
      };
    }

    return {
      isValid: true,
      data: value
    };

  } catch (parseError) {
    return {
      isValid: false,
      errors: [{ field: 'body', message: 'Invalid JSON format' }]
    };
  }
}

/**
 * Parse query parameters with type conversion
 */
function parseQueryParams(queryStringParameters = {}) {
  const params = {};

  Object.entries(queryStringParameters).forEach(([key, value]) => {
    // Convert string booleans
    if (value === 'true') {
      params[key] = true;
    } else if (value === 'false') {
      params[key] = false;
    }
    // Convert numbers
    else if (/^\d+$/.test(value)) {
      params[key] = parseInt(value, 10);
    }
    // Convert decimals
    else if (/^\d+\.\d+$/.test(value)) {
      params[key] = parseFloat(value);
    }
    // Keep as string
    else {
      params[key] = value;
    }
  });

  return params;
}

/**
 * Sanitize input to prevent injection attacks
 */
function sanitizeInput(input) {
  if (typeof input !== 'string') {
    return input;
  }

  return input
    .replace(/[<>]/g, '') // Remove HTML tags
    .replace(/javascript:/gi, '') // Remove javascript protocol
    .replace(/on\w+\s*=/gi, '') // Remove event handlers
    .trim();
}

/**
 * Generate pagination metadata
 */
function createPaginationMeta(page, limit, total) {
  const totalPages = Math.ceil(total / limit);
  
  return {
    page: parseInt(page),
    limit: parseInt(limit),
    total,
    totalPages,
    hasNext: page < totalPages,
    hasPrev: page > 1,
    nextPage: page < totalPages ? page + 1 : null,
    prevPage: page > 1 ? page - 1 : null
  };
}

/**
 * Format file size for human readability
 */
function formatFileSize(bytes) {
  if (bytes === 0) return '0 B';
  
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return Math.round((bytes / Math.pow(k, i)) * 100) / 100 + ' ' + sizes[i];
}

/**
 * Generate unique ID with prefix
 */
function generateId(prefix = '') {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substr(2, 5);
  return prefix ? `${prefix}_${timestamp}_${random}` : `${timestamp}_${random}`;
}

/**
 * Convert DynamoDB items to plain objects
 */
function unmarshallItems(items) {
  if (!Array.isArray(items)) {
    return items;
  }

  return items.map(item => {
    const unmarshalled = {};
    Object.keys(item).forEach(key => {
      unmarshalled[key] = item[key];
    });
    return unmarshalled;
  });
}

/**
 * Create audit log entry
 */
function createAuditLog(action, resource, userId, details = {}) {
  return {
    timestamp: new Date().toISOString(),
    action,
    resource,
    userId,
    details,
    ip: details.sourceIp || 'unknown',
    userAgent: details.userAgent || 'unknown'
  };
}

/**
 * Rate limiting helper
 */
function checkRateLimit(identifier, limit = 100, windowMinutes = 60) {
  // This would need to be implemented with DynamoDB or Redis
  // For now, just return true (no rate limiting)
  return { allowed: true, remaining: limit };
}

/**
 * Health check response
 */
function healthCheckResponse(checks = {}) {
  const timestamp = new Date().toISOString();
  const status = Object.values(checks).every(check => check.status === 'ok') ? 'ok' : 'error';

  return createResponse(status === 'ok' ? 200 : 503, {
    status,
    timestamp,
    version: process.env.npm_package_version || '1.0.0',
    environment: process.env.STAGE || 'development',
    checks
  });
}

module.exports = {
  createResponse,
  successResponse,
  errorResponse,
  handleError,
  validateRequest,
  parseQueryParams,
  sanitizeInput,
  createPaginationMeta,
  formatFileSize,
  generateId,
  unmarshallItems,
  createAuditLog,
  checkRateLimit,
  healthCheckResponse
};