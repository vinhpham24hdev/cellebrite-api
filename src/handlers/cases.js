const { v4: uuidv4 } = require('uuid');
const Joi = require('joi');
const { stringify } = require('csv-stringify/sync');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand, UpdateCommand, DeleteCommand, ScanCommand } = require('@aws-sdk/lib-dynamodb');
const { createResponse, handleError, validateRequest } = require('../utils/response');
const { requireAuth } = require('../middleware/auth');

const client = new DynamoDBClient({ region: process.env.REGION });
const ddb = DynamoDBDocumentClient.from(client);

const CASES_TABLE = process.env.CASES_TABLE;
const FILES_TABLE = process.env.FILES_TABLE;

// Validation schemas
const createCaseSchema = Joi.object({
  title: Joi.string().required().min(1).max(200),
  description: Joi.string().optional().max(1000),
  priority: Joi.string().valid('low', 'medium', 'high', 'critical').default('medium'),
  tags: Joi.array().items(Joi.string()).optional().default([])
});

const updateCaseSchema = Joi.object({
  title: Joi.string().optional().min(1).max(200),
  description: Joi.string().optional().max(1000),
  status: Joi.string().valid('active', 'pending', 'closed', 'archived').optional(),
  priority: Joi.string().valid('low', 'medium', 'high', 'critical').optional(),
  assignedTo: Joi.string().optional(),
  tags: Joi.array().items(Joi.string()).optional()
});

const bulkUpdateSchema = Joi.object({
  caseIds: Joi.array().items(Joi.string()).required().min(1),
  updates: updateCaseSchema.required()
});

/**
 * Generate case ID
 */
function generateCaseId() {
  const timestamp = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const random = Math.floor(Math.random() * 10000).toString().padStart(4, '0');
  return `Case-${timestamp}${random}`;
}

/**
 * Get cases with filtering and pagination
 */
async function getCases(event) {
  try {
    console.log('📁 Getting cases');

    const queryParams = event.queryStringParameters || {};
    const {
      status,
      priority,
      search,
      assignedTo,
      tags,
      page = 1,
      limit = 50,
      sortBy = 'createdAt',
      sortOrder = 'desc'
    } = queryParams;

    let items = [];
    let hasMore = false;

    // If we have specific filters that require GSI, use query
    if (status || assignedTo) {
      if (status) {
        const statusArray = status.split(',');
        for (const s of statusArray) {
          const params = {
            TableName: CASES_TABLE,
            IndexName: 'StatusIndex',
            KeyConditionExpression: '#status = :status',
            ExpressionAttributeNames: {
              '#status': 'status'
            },
            ExpressionAttributeValues: {
              ':status': s.trim()
            },
            ScanIndexForward: sortOrder === 'asc'
          };

          const response = await ddb.send(new QueryCommand(params));
          if (response.Items) {
            items.push(...response.Items);
          }
        }
      } else if (assignedTo) {
        const params = {
          TableName: CASES_TABLE,
          IndexName: 'AssignedToIndex',
          KeyConditionExpression: 'assignedTo = :assignedTo',
          ExpressionAttributeValues: {
            ':assignedTo': assignedTo
          },
          ScanIndexForward: sortOrder === 'asc'
        };

        const response = await ddb.send(new QueryCommand(params));
        if (response.Items) {
          items = response.Items;
        }
      }
    } else {
      // Use scan for general queries
      const params = {
        TableName: CASES_TABLE
      };

      const response = await ddb.send(new ScanCommand(params));
      if (response.Items) {
        items = response.Items;
      }
    }

    // Apply additional filters
    if (priority) {
      const priorityArray = priority.split(',').map(p => p.trim());
      items = items.filter(item => priorityArray.includes(item.priority));
    }

    if (tags) {
      const tagArray = tags.split(',').map(t => t.trim());
      items = items.filter(item => 
        item.tags && item.tags.some(tag => tagArray.includes(tag))
      );
    }

    if (search) {
      const searchLower = search.toLowerCase();
      items = items.filter(item => 
        item.title.toLowerCase().includes(searchLower) ||
        (item.description && item.description.toLowerCase().includes(searchLower)) ||
        item.id.toLowerCase().includes(searchLower) ||
        (item.tags && item.tags.some(tag => tag.toLowerCase().includes(searchLower)))
      );
    }

    // Sort items
    items.sort((a, b) => {
      let aValue = a[sortBy];
      let bValue = b[sortBy];

      if (sortBy === 'createdAt' || sortBy === 'updatedAt') {
        aValue = new Date(aValue);
        bValue = new Date(bValue);
      }

      if (sortOrder === 'desc') {
        return bValue > aValue ? 1 : -1;
      } else {
        return aValue > bValue ? 1 : -1;
      }
    });

    // Pagination
    const startIndex = (page - 1) * limit;
    const endIndex = startIndex + parseInt(limit);
    const paginatedItems = items.slice(startIndex, endIndex);
    hasMore = endIndex < items.length;

    // Add file counts to each case
    for (const case_ of paginatedItems) {
      try {
        const fileParams = {
          TableName: FILES_TABLE,
          IndexName: 'CaseIdIndex',
          KeyConditionExpression: 'caseId = :caseId',
          ExpressionAttributeValues: {
            ':caseId': case_.id
          }
        };

        const fileResponse = await ddb.send(new QueryCommand(fileParams));
        
        if (fileResponse.Items) {
          const files = fileResponse.Items;
          const screenshots = files.filter(f => f.captureType === 'screenshot').length;
          const videos = files.filter(f => f.captureType === 'video').length;
          const totalSize = files.reduce((sum, f) => sum + (f.fileSize || 0), 0);
          
          case_.metadata = {
            ...case_.metadata,
            totalScreenshots: screenshots,
            totalVideos: videos,
            totalFileSize: totalSize,
            lastActivity: files.length > 0 ? files[0].uploadedAt : case_.updatedAt || case_.createdAt
          };
        }
      } catch (fileError) {
        console.warn('Error getting file count for case:', case_.id, fileError);
        // Continue without file metadata
      }
    }

    const pagination = {
      page: parseInt(page),
      limit: parseInt(limit),
      total: items.length,
      totalPages: Math.ceil(items.length / limit),
      hasNext: hasMore,
      hasPrev: page > 1
    };

    console.log('✅ Cases retrieved:', {
      total: pagination.total,
      page: pagination.page,
      returned: paginatedItems.length
    });

    return createResponse(200, {
      cases: paginatedItems,
      pagination,
      filters: { status, priority, search, assignedTo, tags }
    });

  } catch (error) {
    console.error('❌ Get cases error:', error);
    return handleError(error);
  }
}

/**
 * Create new case
 */
async function createCase(event) {
  try {
    console.log('➕ Creating new case');

    // Validate request
    const validation = validateRequest(event.body, createCaseSchema);
    if (!validation.isValid) {
      return createResponse(400, {
        success: false,
        error: 'Invalid request data',
        details: validation.errors
      });
    }

    const { title, description, priority, tags } = validation.data;
    const { userId, username } = event.user;

    const caseId = generateCaseId();
    const now = new Date().toISOString();

    const newCase = {
      id: caseId,
      title,
      description,
      status: 'active',
      priority,
      tags,
      createdAt: now,
      updatedAt: now,
      createdBy: userId,
      assignedTo: username,
      metadata: {
        totalScreenshots: 0,
        totalVideos: 0,
        totalFileSize: 0,
        lastActivity: now
      }
    };

    const params = {
      TableName: CASES_TABLE,
      Item: newCase,
      ConditionExpression: 'attribute_not_exists(id)'
    };

    await ddb.send(new PutCommand(params));

    console.log('✅ Case created:', caseId);

    return createResponse(201, {
      success: true,
      case: newCase
    });

  } catch (error) {
    console.error('❌ Create case error:', error);
    if (error.name === 'ConditionalCheckFailedException') {
      return createResponse(409, {
        success: false,
        error: 'Case ID already exists'
      });
    }
    return handleError(error);
  }
}

/**
 * Get single case
 */
async function getCase(event) {
  try {
    const caseId = event.pathParameters.id;
    console.log('📋 Getting case:', caseId);

    const params = {
      TableName: CASES_TABLE,
      Key: { id: caseId }
    };

    const response = await ddb.send(new GetCommand(params));
    
    if (!response.Item) {
      return createResponse(404, {
        success: false,
        error: 'Case not found'
      });
    }

    const case_ = response.Item;

    // Get file statistics
    try {
      const fileParams = {
        TableName: FILES_TABLE,
        IndexName: 'CaseIdIndex',
        KeyConditionExpression: 'caseId = :caseId',
        ExpressionAttributeValues: {
          ':caseId': caseId
        }
      };

      const fileResponse = await ddb.send(new QueryCommand(fileParams));
      
      if (fileResponse.Items) {
        const files = fileResponse.Items;
        const screenshots = files.filter(f => f.captureType === 'screenshot').length;
        const videos = files.filter(f => f.captureType === 'video').length;
        const totalSize = files.reduce((sum, f) => sum + (f.fileSize || 0), 0);
        
        case_.metadata = {
          ...case_.metadata,
          totalScreenshots: screenshots,
          totalVideos: videos,
          totalFileSize: totalSize,
          lastActivity: files.length > 0 ? files[0].uploadedAt : case_.updatedAt || case_.createdAt
        };
      }
    } catch (fileError) {
      console.warn('Error getting file statistics:', fileError);
    }

    console.log('✅ Case retrieved:', case_.title);

    return createResponse(200, case_);

  } catch (error) {
    console.error('❌ Get case error:', error);
    return handleError(error);
  }
}

/**
 * Update case
 */
async function updateCase(event) {
  try {
    const caseId = event.pathParameters.id;
    console.log('✏️ Updating case:', caseId);

    // Validate request
    const validation = validateRequest(event.body, updateCaseSchema);
    if (!validation.isValid) {
      return createResponse(400, {
        success: false,
        error: 'Invalid request data',
        details: validation.errors
      });
    }

    const updates = validation.data;
    const now = new Date().toISOString();

    // Build update expression
    let updateExpression = 'SET updatedAt = :updatedAt';
    let expressionAttributeValues = {
      ':updatedAt': now
    };

    Object.keys(updates).forEach(key => {
      updateExpression += `, ${key} = :${key}`;
      expressionAttributeValues[`:${key}`] = updates[key];
    });

    const params = {
      TableName: CASES_TABLE,
      Key: { id: caseId },
      UpdateExpression: updateExpression,
      ExpressionAttributeValues: expressionAttributeValues,
      ConditionExpression: 'attribute_exists(id)',
      ReturnValues: 'ALL_NEW'
    };

    const response = await ddb.send(new UpdateCommand(params));

    console.log('✅ Case updated:', caseId);

    return createResponse(200, {
      success: true,
      case: response.Attributes
    });

  } catch (error) {
    console.error('❌ Update case error:', error);
    if (error.name === 'ConditionalCheckFailedException') {
      return createResponse(404, {
        success: false,
        error: 'Case not found'
      });
    }
    return handleError(error);
  }
}

/**
 * Delete case
 */
async function deleteCase(event) {
  try {
    const caseId = event.pathParameters.id;
    console.log('🗑️ Deleting case:', caseId);

    // Check if case has files
    const fileParams = {
      TableName: FILES_TABLE,
      IndexName: 'CaseIdIndex',
      KeyConditionExpression: 'caseId = :caseId',
      ExpressionAttributeValues: {
        ':caseId': caseId
      },
      Limit: 1
    };

    const fileResponse = await ddb.send(new QueryCommand(fileParams));
    
    if (fileResponse.Items && fileResponse.Items.length > 0) {
      return createResponse(400, {
        success: false,
        error: 'Cannot delete case with associated files. Please delete files first.'
      });
    }

    const params = {
      TableName: CASES_TABLE,
      Key: { id: caseId },
      ConditionExpression: 'attribute_exists(id)'
    };

    await ddb.send(new DeleteCommand(params));

    console.log('✅ Case deleted:', caseId);

    return createResponse(200, {
      success: true,
      message: 'Case deleted successfully'
    });

  } catch (error) {
    console.error('❌ Delete case error:', error);
    if (error.name === 'ConditionalCheckFailedException') {
      return createResponse(404, {
        success: false,
        error: 'Case not found'
      });
    }
    return handleError(error);
  }
}

/**
 * Get case statistics
 */
async function getCaseStats(event) {
  try {
    console.log('📊 Getting case statistics');

    // Get all cases
    const casesParams = {
      TableName: CASES_TABLE
    };

    const casesResponse = await ddb.send(new ScanCommand(casesParams));
    const cases = casesResponse.Items || [];

    // Get all files
    const filesParams = {
      TableName: FILES_TABLE
    };

    const filesResponse = await ddb.send(new ScanCommand(filesParams));
    const files = filesResponse.Items || [];

    // Calculate statistics
    const stats = {
      total: cases.length,
      active: cases.filter(c => c.status === 'active').length,
      pending: cases.filter(c => c.status === 'pending').length,
      closed: cases.filter(c => c.status === 'closed').length,
      archived: cases.filter(c => c.status === 'archived').length,
      byPriority: {
        low: cases.filter(c => c.priority === 'low').length,
        medium: cases.filter(c => c.priority === 'medium').length,
        high: cases.filter(c => c.priority === 'high').length,
        critical: cases.filter(c => c.priority === 'critical').length
      },
      totalFiles: files.length,
      totalFileSize: files.reduce((sum, f) => sum + (f.fileSize || 0), 0),
      recentActivity: cases
        .sort((a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt))
        .slice(0, 5)
        .map(c => ({
          id: c.id,
          title: c.title,
          status: c.status,
          lastActivity: c.updatedAt || c.createdAt
        }))
    };

    console.log('✅ Case statistics calculated');

    return createResponse(200, stats);

  } catch (error) {
    console.error('❌ Get case stats error:', error);
    return handleError(error);
  }
}

/**
 * Get available tags
 */
async function getAvailableTags(event) {
  try {
    console.log('🏷️ Getting available tags');

    const params = {
      TableName: CASES_TABLE,
      ProjectionExpression: 'tags'
    };

    const response = await ddb.send(new ScanCommand(params));
    const cases = response.Items || [];

    // Extract all unique tags
    const tagsSet = new Set();
    cases.forEach(case_ => {
      if (case_.tags && Array.isArray(case_.tags)) {
        case_.tags.forEach(tag => tagsSet.add(tag));
      }
    });

    const tags = Array.from(tagsSet).sort();

    console.log('✅ Available tags retrieved:', tags.length);

    return createResponse(200, { tags });

  } catch (error) {
    console.error('❌ Get available tags error:', error);
    return handleError(error);
  }
}

/**
 * Bulk update cases
 */
async function bulkUpdateCases(event) {
  try {
    console.log('📦 Bulk updating cases');

    // Validate request
    const validation = validateRequest(event.body, bulkUpdateSchema);
    if (!validation.isValid) {
      return createResponse(400, {
        success: false,
        error: 'Invalid request data',
        details: validation.errors
      });
    }

    const { caseIds, updates } = validation.data;
    const now = new Date().toISOString();

    const results = {
      updated: 0,
      failed: 0,
      errors: []
    };

    // Update each case
    for (const caseId of caseIds) {
      try {
        // Build update expression
        let updateExpression = 'SET updatedAt = :updatedAt';
        let expressionAttributeValues = {
          ':updatedAt': now
        };

        Object.keys(updates).forEach(key => {
          updateExpression += `, ${key} = :${key}`;
          expressionAttributeValues[`:${key}`] = updates[key];
        });

        const params = {
          TableName: CASES_TABLE,
          Key: { id: caseId },
          UpdateExpression: updateExpression,
          ExpressionAttributeValues: expressionAttributeValues,
          ConditionExpression: 'attribute_exists(id)'
        };

        await ddb.send(new UpdateCommand(params));
        results.updated++;

      } catch (error) {
        console.error(`Error updating case ${caseId}:`, error);
        results.failed++;
        results.errors.push({
          caseId,
          error: error.message
        });
      }
    }

    console.log('✅ Bulk update completed:', results);

    return createResponse(200, {
      success: true,
      total: caseIds.length,
      ...results
    });

  } catch (error) {
    console.error('❌ Bulk update cases error:', error);
    return handleError(error);
  }
}

/**
 * Update case metadata
 */
async function updateCaseMetadata(event) {
  try {
    const caseId = event.pathParameters.id;
    console.log('📊 Updating case metadata:', caseId);

    const { metadata } = JSON.parse(event.body || '{}');
    const now = new Date().toISOString();

    const params = {
      TableName: CASES_TABLE,
      Key: { id: caseId },
      UpdateExpression: 'SET metadata = :metadata, updatedAt = :updatedAt',
      ExpressionAttributeValues: {
        ':metadata': metadata,
        ':updatedAt': now
      },
      ConditionExpression: 'attribute_exists(id)',
      ReturnValues: 'ALL_NEW'
    };

    const response = await ddb.send(new UpdateCommand(params));

    console.log('✅ Case metadata updated:', caseId);

    return createResponse(200, {
      success: true,
      case: response.Attributes
    });

  } catch (error) {
    console.error('❌ Update case metadata error:', error);
    if (error.name === 'ConditionalCheckFailedException') {
      return createResponse(404, {
        success: false,
        error: 'Case not found'
      });
    }
    return handleError(error);
  }
}

/**
 * Export cases to CSV
 */
async function exportCases(event) {
  try {
    console.log('📤 Exporting cases to CSV');

    const queryParams = event.queryStringParameters || {};
    
    // Get cases (reuse the getCases logic but without pagination)
    const params = {
      TableName: CASES_TABLE
    };

    const response = await ddb.send(new ScanCommand(params));
    let cases = response.Items || [];

    // Apply filters if provided
    const { status, priority, search, assignedTo, tags } = queryParams;

    if (status) {
      const statusArray = status.split(',').map(s => s.trim());
      cases = cases.filter(c => statusArray.includes(c.status));
    }

    if (priority) {
      const priorityArray = priority.split(',').map(p => p.trim());
      cases = cases.filter(c => priorityArray.includes(c.priority));
    }

    if (assignedTo) {
      cases = cases.filter(c => c.assignedTo === assignedTo);
    }

    if (tags) {
      const tagArray = tags.split(',').map(t => t.trim());
      cases = cases.filter(c => 
        c.tags && c.tags.some(tag => tagArray.includes(tag))
      );
    }

    if (search) {
      const searchLower = search.toLowerCase();
      cases = cases.filter(c => 
        c.title.toLowerCase().includes(searchLower) ||
        (c.description && c.description.toLowerCase().includes(searchLower)) ||
        c.id.toLowerCase().includes(searchLower)
      );
    }

    // Prepare data for CSV
    const csvData = cases.map(case_ => ({
      ID: case_.id,
      Title: case_.title,
      Description: case_.description || '',
      Status: case_.status,
      Priority: case_.priority,
      'Assigned To': case_.assignedTo || '',
      Tags: (case_.tags || []).join(', '),
      'Created At': case_.createdAt,
      'Updated At': case_.updatedAt || '',
      'Total Screenshots': case_.metadata?.totalScreenshots || 0,
      'Total Videos': case_.metadata?.totalVideos || 0,
      'Total File Size (bytes)': case_.metadata?.totalFileSize || 0
    }));

    // Generate CSV
    const csv = stringify(csvData, {
      header: true,
      columns: [
        'ID', 'Title', 'Description', 'Status', 'Priority', 
        'Assigned To', 'Tags', 'Created At', 'Updated At',
        'Total Screenshots', 'Total Videos', 'Total File Size (bytes)'
      ]
    });

    console.log('✅ Cases exported to CSV:', cases.length);

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'text/csv',
        'Content-Disposition': `attachment; filename="cases-export-${new Date().toISOString().split('T')[0]}.csv"`,
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type,Authorization',
        'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS'
      },
      body: csv
    };

  } catch (error) {
    console.error('❌ Export cases error:', error);
    return handleError(error);
  }
}

// Export handlers with auth middleware
module.exports = {
  getCases: requireAuth(getCases),
  createCase: requireAuth(createCase),
  getCase: requireAuth(getCase),
  updateCase: requireAuth(updateCase),
  deleteCase: requireAuth(deleteCase),
  getCaseStats: requireAuth(getCaseStats),
  getAvailableTags: requireAuth(getAvailableTags),
  bulkUpdateCases: requireAuth(bulkUpdateCases),
  updateCaseMetadata: requireAuth(updateCaseMetadata),
  exportCases: requireAuth(exportCases)
};