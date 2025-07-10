const { v4: uuidv4 } = require('uuid');
const Joi = require('joi');
const { S3Client, GetObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { DynamoDBDocumentClient, GetCommand, PutCommand, QueryCommand, UpdateCommand, DeleteCommand, ScanCommand } = require('@aws-sdk/lib-dynamodb');
const { createResponse, handleError, validateRequest } = require('../utils/response');
const { requireAuth } = require('../middleware/auth');

const s3Client = new S3Client({ region: process.env.REGION });
const client = new DynamoDBClient({ region: process.env.REGION });
const ddb = DynamoDBDocumentClient.from(client);

const FILES_TABLE = process.env.FILES_TABLE;
const CASES_TABLE = process.env.CASES_TABLE;
const S3_BUCKET = process.env.S3_BUCKET;

// Validation schemas
const presignedUrlSchema = Joi.object({
  fileName: Joi.string().required(),
  fileType: Joi.string().required(),
  caseId: Joi.string().required(),
  captureType: Joi.string().valid('screenshot', 'video').required(),
  fileSize: Joi.number().optional(),
  uploadMethod: Joi.string().valid('PUT', 'POST').default('PUT')
});

const confirmUploadSchema = Joi.object({
  fileId: Joi.string().required(),
  fileKey: Joi.string().required(),
  actualFileSize: Joi.number().required(),
  checksum: Joi.string().optional(),
  uploadMethod: Joi.string().valid('PUT', 'POST').default('PUT')
});

const deleteFileSchema = Joi.object({
  fileKey: Joi.string().required(),
  caseId: Joi.string().optional()
});

/**
 * Generate unique file key for S3
 */
function generateFileKey(caseId, captureType, fileName) {
  const timestamp = new Date().toISOString().slice(0, 10);
  const uniqueId = uuidv4().slice(0, 8);
  const sanitizedFileName = fileName.replace(/[^a-zA-Z0-9.-]/g, '_');
  
  return `${caseId}/${captureType}/${timestamp}/${uniqueId}_${sanitizedFileName}`;
}

/**
 * Check if case exists
 */
async function checkCaseExists(caseId) {
  try {
    const params = {
      TableName: CASES_TABLE,
      Key: { id: caseId }
    };

    const response = await ddb.send(new GetCommand(params));
    return !!response.Item;
  } catch (error) {
    console.error('Error checking case existence:', error);
    return false;
  }
}

/**
 * Get presigned URL for upload
 */
async function getPresignedUrl(event) {
  try {
    console.log('🔗 Getting presigned URL');

    // Validate request
    const validation = validateRequest(event.body, presignedUrlSchema);
    if (!validation.isValid) {
      return createResponse(400, {
        success: false,
        error: 'Invalid request data',
        details: validation.errors
      });
    }

    const { fileName, fileType, caseId, captureType, fileSize, uploadMethod } = validation.data;
    const { userId } = event.user;

    // Check if case exists
    const caseExists = await checkCaseExists(caseId);
    if (!caseExists) {
      return createResponse(404, {
        success: false,
        error: 'Case not found'
      });
    }

    // Validate file type
    const allowedTypes = {
      screenshot: ['image/png', 'image/jpeg', 'image/webp', 'image/gif'],
      video: ['video/webm', 'video/mp4', 'video/quicktime']
    };

    if (!allowedTypes[captureType].includes(fileType)) {
      return createResponse(400, {
        success: false,
        error: `Invalid file type for ${captureType}. Allowed types: ${allowedTypes[captureType].join(', ')}`
      });
    }

    // Validate file size (100MB max)
    const maxFileSize = 100 * 1024 * 1024; // 100MB
    if (fileSize && fileSize > maxFileSize) {
      return createResponse(400, {
        success: false,
        error: `File size exceeds maximum limit of ${maxFileSize / (1024 * 1024)}MB`
      });
    }

    const fileId = uuidv4();
    const fileKey = generateFileKey(caseId, captureType, fileName);
    const expiresIn = 3600; // 1 hour

    // Create presigned URL for PUT
    const putObjectParams = {
      Bucket: S3_BUCKET,
      Key: fileKey,
      ContentType: fileType,
      ServerSideEncryption: 'AES256',
      Metadata: {
        'file-id': fileId,
        'case-id': caseId,
        'capture-type': captureType,
        'uploaded-by': userId,
        'original-name': fileName
      }
    };

    const uploadUrl = await getSignedUrl(
      s3Client,
      new PutObjectCommand(putObjectParams),
      { expiresIn }
    );

    // Store pending upload info
    const now = new Date().toISOString();
    const pendingUpload = {
      id: fileId,
      fileKey,
      fileName,
      originalName: fileName,
      fileType,
      fileSize: fileSize || 0,
      caseId,
      captureType,
      uploadedBy: userId,
      status: 'pending',
      createdAt: now,
      expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString()
    };

    const params = {
      TableName: FILES_TABLE,
      Item: pendingUpload
    };

    await ddb.send(new PutCommand(params));

    // Generate file URL (for GET after upload)
    const fileUrl = `https://${S3_BUCKET}.s3.${process.env.REGION}.amazonaws.com/${fileKey}`;

    console.log('✅ Presigned URL generated:', { fileId, fileKey });

    return createResponse(200, {
      uploadUrl,
      fileUrl,
      fileName,
      key: fileKey,
      expiresIn,
      method: uploadMethod,
      fileId,
      headers: {
        'Content-Type': fileType,
        'x-amz-server-side-encryption': 'AES256'
      },
      metadata: {
        caseId,
        captureType,
        userId
      }
    });

  } catch (error) {
    console.error('❌ Get presigned URL error:', error);
    return handleError(error);
  }
}

/**
 * Confirm upload completion
 */
async function confirmUpload(event) {
  try {
    console.log('✅ Confirming upload');

    // Validate request
    const validation = validateRequest(event.body, confirmUploadSchema);
    if (!validation.isValid) {
      return createResponse(400, {
        success: false,
        error: 'Invalid request data',
        details: validation.errors
      });
    }

    const { fileId, fileKey, actualFileSize, checksum } = validation.data;

    // Get pending upload record
    const getParams = {
      TableName: FILES_TABLE,
      Key: { id: fileId }
    };

    const response = await ddb.send(new GetCommand(getParams));
    
    if (!response.Item) {
      return createResponse(404, {
        success: false,
        error: 'Upload record not found'
      });
    }

    const uploadRecord = response.Item;

    // Check if upload is still valid (not expired)
    if (new Date(uploadRecord.expiresAt) < new Date()) {
      return createResponse(400, {
        success: false,
        error: 'Upload session expired'
      });
    }

    // Verify the file exists in S3
    try {
      await s3Client.send(new GetObjectCommand({
        Bucket: S3_BUCKET,
        Key: fileKey
      }));
    } catch (s3Error) {
      console.error('File not found in S3:', s3Error);
      return createResponse(400, {
        success: false,
        error: 'File not found in S3. Upload may have failed.'
      });
    }

    const now = new Date().toISOString();

    // Update upload record to confirmed
    const updateParams = {
      TableName: FILES_TABLE,
      Key: { id: fileId },
      UpdateExpression: 'SET #status = :status, uploadedAt = :uploadedAt, fileSize = :fileSize',
      ExpressionAttributeNames: {
        '#status': 'status'
      },
      ExpressionAttributeValues: {
        ':status': 'completed',
        ':uploadedAt': now,
        ':fileSize': actualFileSize
      }
    };

    if (checksum) {
      updateParams.UpdateExpression += ', checksum = :checksum';
      updateParams.ExpressionAttributeValues[':checksum'] = checksum;
    }

    await ddb.send(new UpdateCommand(updateParams));

    // Update case metadata
    try {
      await updateCaseFileStats(uploadRecord.caseId);
    } catch (statsError) {
      console.warn('Failed to update case stats:', statsError);
      // Don't fail the confirmation for this
    }

    console.log('✅ Upload confirmed:', fileId);

    return createResponse(200, {
      success: true,
      fileId,
      fileKey,
      message: 'Upload confirmed successfully'
    });

  } catch (error) {
    console.error('❌ Confirm upload error:', error);
    return handleError(error);
  }
}

/**
 * Update case file statistics
 */
async function updateCaseFileStats(caseId) {
  try {
    // Get all files for this case
    const fileParams = {
      TableName: FILES_TABLE,
      IndexName: 'CaseIdIndex',
      KeyConditionExpression: 'caseId = :caseId',
      FilterExpression: '#status = :status',
      ExpressionAttributeNames: {
        '#status': 'status'
      },
      ExpressionAttributeValues: {
        ':caseId': caseId,
        ':status': 'completed'
      }
    };

    const fileResponse = await ddb.send(new QueryCommand(fileParams));
    const files = fileResponse.Items || [];

    const screenshots = files.filter(f => f.captureType === 'screenshot').length;
    const videos = files.filter(f => f.captureType === 'video').length;
    const totalSize = files.reduce((sum, f) => sum + (f.fileSize || 0), 0);
    const lastActivity = files.length > 0 ? 
      files.sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt))[0].uploadedAt :
      new Date().toISOString();

    // Update case metadata
    const caseParams = {
      TableName: CASES_TABLE,
      Key: { id: caseId },
      UpdateExpression: 'SET metadata.totalScreenshots = :screenshots, metadata.totalVideos = :videos, metadata.totalFileSize = :totalSize, metadata.lastActivity = :lastActivity, updatedAt = :updatedAt',
      ExpressionAttributeValues: {
        ':screenshots': screenshots,
        ':videos': videos,
        ':totalSize': totalSize,
        ':lastActivity': lastActivity,
        ':updatedAt': new Date().toISOString()
      }
    };

    await ddb.send(new UpdateCommand(caseParams));
    console.log('✅ Case file stats updated:', caseId);

  } catch (error) {
    console.error('Error updating case file stats:', error);
    throw error;
  }
}

/**
 * Delete file
 */
async function deleteFile(event) {
  try {
    console.log('🗑️ Deleting file');

    // Validate request
    const validation = validateRequest(event.body, deleteFileSchema);
    if (!validation.isValid) {
      return createResponse(400, {
        success: false,
        error: 'Invalid request data',
        details: validation.errors
      });
    }

    const { fileKey, caseId } = validation.data;

    // Get file record
    const fileParams = {
      TableName: FILES_TABLE,
      IndexName: 'FileKeyIndex',
      KeyConditionExpression: 'fileKey = :fileKey',
      ExpressionAttributeValues: {
        ':fileKey': fileKey
      }
    };

    const fileResponse = await ddb.send(new QueryCommand(fileParams));
    
    if (!fileResponse.Items || fileResponse.Items.length === 0) {
      return createResponse(404, {
        success: false,
        error: 'File not found'
      });
    }

    const fileRecord = fileResponse.Items[0];

    // Delete from S3
    try {
      await s3Client.send(new DeleteObjectCommand({
        Bucket: S3_BUCKET,
        Key: fileKey
      }));
      console.log('✅ File deleted from S3:', fileKey);
    } catch (s3Error) {
      console.warn('S3 delete error (file may not exist):', s3Error);
      // Continue with database cleanup even if S3 delete fails
    }

    // Delete from database
    const deleteParams = {
      TableName: FILES_TABLE,
      Key: { id: fileRecord.id }
    };

    await ddb.send(new DeleteCommand(deleteParams));

    // Update case statistics
    if (fileRecord.caseId) {
      try {
        await updateCaseFileStats(fileRecord.caseId);
      } catch (statsError) {
        console.warn('Failed to update case stats after deletion:', statsError);
      }
    }

    console.log('✅ File deleted:', fileKey);

    return createResponse(200, {
      success: true,
      message: 'File deleted successfully'
    });

  } catch (error) {
    console.error('❌ Delete file error:', error);
    return handleError(error);
  }
}

/**
 * Get files for a case
 */
async function getCaseFiles(event) {
  try {
    const caseId = event.pathParameters.caseId;
    console.log('📁 Getting files for case:', caseId);

    const queryParams = event.queryStringParameters || {};
    const {
      captureType,
      page = 1,
      limit = 50,
      sortBy = 'uploadedAt',
      sortOrder = 'desc'
    } = queryParams;

    // Check if case exists
    const caseExists = await checkCaseExists(caseId);
    if (!caseExists) {
      return createResponse(404, {
        success: false,
        error: 'Case not found'
      });
    }

    let filterExpression = '#status = :status';
    let expressionAttributeNames = {
      '#status': 'status'
    };
    let expressionAttributeValues = {
      ':caseId': caseId,
      ':status': 'completed'
    };

    if (captureType) {
      filterExpression += ' AND captureType = :captureType';
      expressionAttributeValues[':captureType'] = captureType;
    }

    const params = {
      TableName: FILES_TABLE,
      IndexName: 'CaseIdIndex',
      KeyConditionExpression: 'caseId = :caseId',
      FilterExpression: filterExpression,
      ExpressionAttributeNames: expressionAttributeNames,
      ExpressionAttributeValues: expressionAttributeValues,
      ScanIndexForward: sortOrder === 'asc'
    };

    const response = await ddb.send(new QueryCommand(params));
    let files = response.Items || [];

    // Sort if needed (DynamoDB only sorts by sort key)
    if (sortBy !== 'uploadedAt') {
      files.sort((a, b) => {
        let aValue = a[sortBy];
        let bValue = b[sortBy];

        if (sortBy === 'fileSize') {
          aValue = parseInt(aValue) || 0;
          bValue = parseInt(bValue) || 0;
        }

        if (sortOrder === 'desc') {
          return bValue > aValue ? 1 : -1;
        } else {
          return aValue > bValue ? 1 : -1;
        }
      });
    }

    // Pagination
    const startIndex = (page - 1) * limit;
    const endIndex = startIndex + parseInt(limit);
    const paginatedFiles = files.slice(startIndex, endIndex);

    // Add download URLs to files
    for (const file of paginatedFiles) {
      try {
        const downloadUrl = await getSignedUrl(
          s3Client,
          new GetObjectCommand({
            Bucket: S3_BUCKET,
            Key: file.fileKey
          }),
          { expiresIn: 3600 } // 1 hour
        );
        file.downloadUrl = downloadUrl;
      } catch (urlError) {
        console.warn('Failed to generate download URL for:', file.fileKey);
        file.downloadUrl = null;
      }
    }

    // Calculate summary
    const summary = {
      totalFiles: files.length,
      screenshots: files.filter(f => f.captureType === 'screenshot').length,
      videos: files.filter(f => f.captureType === 'video').length,
      totalSize: files.reduce((sum, f) => sum + (f.fileSize || 0), 0)
    };

    const pagination = {
      page: parseInt(page),
      limit: parseInt(limit),
      total: files.length,
      totalPages: Math.ceil(files.length / limit),
      hasNext: endIndex < files.length,
      hasPrev: page > 1
    };

    console.log('✅ Case files retrieved:', {
      caseId,
      total: summary.totalFiles,
      returned: paginatedFiles.length
    });

    return createResponse(200, {
      files: paginatedFiles,
      pagination,
      summary
    });

  } catch (error) {
    console.error('❌ Get case files error:', error);
    return handleError(error);
  }
}

/**
 * Get download URL for a file
 */
async function getDownloadUrl(event) {
  try {
    const fileKey = decodeURIComponent(event.pathParameters.fileKey);
    console.log('🔗 Getting download URL for:', fileKey);

    const queryParams = event.queryStringParameters || {};
    const { expiresIn = 3600, download = 'false', filename } = queryParams;

    // Get file record to verify it exists
    const fileParams = {
      TableName: FILES_TABLE,
      IndexName: 'FileKeyIndex',
      KeyConditionExpression: 'fileKey = :fileKey',
      ExpressionAttributeValues: {
        ':fileKey': fileKey
      }
    };

    const fileResponse = await ddb.send(new QueryCommand(fileParams));
    
    if (!fileResponse.Items || fileResponse.Items.length === 0) {
      return createResponse(404, {
        success: false,
        error: 'File not found'
      });
    }

    const fileRecord = fileResponse.Items[0];

    // Create command for signed URL
    const commandParams = {
      Bucket: S3_BUCKET,
      Key: fileKey
    };

    // Add content disposition for download
    if (download === 'true') {
      commandParams.ResponseContentDisposition = `attachment; filename="${filename || fileRecord.fileName}"`;
    }

    const downloadUrl = await getSignedUrl(
      s3Client,
      new GetObjectCommand(commandParams),
      { expiresIn: parseInt(expiresIn) }
    );

    console.log('✅ Download URL generated:', fileKey);

    return createResponse(200, {
      downloadUrl,
      fileName: fileRecord.fileName,
      fileSize: fileRecord.fileSize,
      expiresIn: parseInt(expiresIn)
    });

  } catch (error) {
    console.error('❌ Get download URL error:', error);
    return handleError(error);
  }
}

/**
 * Get upload statistics
 */
async function getUploadStats(event) {
  try {
    console.log('📊 Getting upload statistics');

    const queryParams = event.queryStringParameters || {};
    const { caseId, days = 30, detailed = 'false' } = queryParams;

    let params = {
      TableName: FILES_TABLE,
      FilterExpression: '#status = :status',
      ExpressionAttributeNames: {
        '#status': 'status'
      },
      ExpressionAttributeValues: {
        ':status': 'completed'
      }
    };

    // Filter by case if specified
    if (caseId) {
      params.IndexName = 'CaseIdIndex';
      params.KeyConditionExpression = 'caseId = :caseId';
      params.ExpressionAttributeValues[':caseId'] = caseId;
      delete params.FilterExpression;
    }

    const response = await ddb.send(caseId ? new QueryCommand(params) : new ScanCommand(params));
    let files = response.Items || [];

    // Filter by date range
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - parseInt(days));
    files = files.filter(f => new Date(f.uploadedAt) >= cutoffDate);

    // Calculate statistics
    const stats = {
      totalFiles: files.length,
      totalSize: files.reduce((sum, f) => sum + (f.fileSize || 0), 0),
      byType: {
        screenshot: files.filter(f => f.captureType === 'screenshot').length,
        video: files.filter(f => f.captureType === 'video').length
      },
      byCase: {},
      successRate: 100, // All files in completed status
      averageUploadTime: 0, // Would need upload duration tracking
      recentUploads: files
        .sort((a, b) => new Date(b.uploadedAt) - new Date(a.uploadedAt))
        .slice(0, 10)
        .map(f => ({
          id: f.id,
          fileName: f.fileName,
          captureType: f.captureType,
          fileSize: f.fileSize,
          caseId: f.caseId,
          uploadedAt: f.uploadedAt
        }))
    };

    // Calculate by case
    files.forEach(file => {
      if (!stats.byCase[file.caseId]) {
        stats.byCase[file.caseId] = 0;
      }
      stats.byCase[file.caseId]++;
    });

    // Add detailed breakdown if requested
    if (detailed === 'true') {
      stats.dailyBreakdown = {};
      files.forEach(file => {
        const date = file.uploadedAt.split('T')[0];
        if (!stats.dailyBreakdown[date]) {
          stats.dailyBreakdown[date] = {
            files: 0,
            size: 0,
            screenshots: 0,
            videos: 0
          };
        }
        stats.dailyBreakdown[date].files++;
        stats.dailyBreakdown[date].size += file.fileSize || 0;
        stats.dailyBreakdown[date][file.captureType === 'screenshot' ? 'screenshots' : 'videos']++;
      });
    }

    console.log('✅ Upload statistics calculated');

    return createResponse(200, stats);

  } catch (error) {
    console.error('❌ Get upload stats error:', error);
    return handleError(error);
  }
}

/**
 * Cleanup expired uploads
 */
async function cleanupExpiredUploads() {
  try {
    console.log('🧹 Cleaning up expired uploads');

    const now = new Date().toISOString();
    const params = {
      TableName: FILES_TABLE,
      FilterExpression: '#status = :status AND expiresAt < :now',
      ExpressionAttributeNames: {
        '#status': 'status'
      },
      ExpressionAttributeValues: {
        ':status': 'pending',
        ':now': now
      }
    };

    const response = await ddb.send(new ScanCommand(params));
    const expiredUploads = response.Items || [];

    let cleaned = 0;
    for (const upload of expiredUploads) {
      try {
        // Delete from S3 if it exists
        try {
          await s3Client.send(new DeleteObjectCommand({
            Bucket: S3_BUCKET,
            Key: upload.fileKey
          }));
        } catch (s3Error) {
          // File might not exist in S3, that's okay
        }

        // Delete from database
        await ddb.send(new DeleteCommand({
          TableName: FILES_TABLE,
          Key: { id: upload.id }
        }));

        cleaned++;
      } catch (error) {
        console.error('Error cleaning up expired upload:', upload.id, error);
      }
    }

    console.log(`✅ Cleaned up ${cleaned} expired uploads`);
    return cleaned;

  } catch (error) {
    console.error('❌ Cleanup expired uploads error:', error);
    throw error;
  }
}

// Export handlers with auth middleware
module.exports = {
  getPresignedUrl: requireAuth(getPresignedUrl),
  confirmUpload: requireAuth(confirmUpload),
  deleteFile: requireAuth(deleteFile),
  getCaseFiles: requireAuth(getCaseFiles),
  getDownloadUrl: requireAuth(getDownloadUrl),
  getUploadStats: requireAuth(getUploadStats),
  cleanupExpiredUploads // Internal function for scheduled cleanup
};