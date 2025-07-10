const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const { S3Client, HeadBucketCommand } = require('@aws-sdk/client-s3');
const { healthCheckResponse } = require('../utils/response');

const dynamoClient = new DynamoDBClient({ region: process.env.REGION });
const s3Client = new S3Client({ region: process.env.REGION });

const USERS_TABLE = process.env.USERS_TABLE;
const CASES_TABLE = process.env.CASES_TABLE;
const FILES_TABLE = process.env.FILES_TABLE;
const S3_BUCKET = process.env.S3_BUCKET;

/**
 * Basic health check
 */
async function handler(event) {
  try {
    console.log('🏥 Health check requested');

    const checks = {
      api: { status: 'ok', message: 'API is running' },
      timestamp: { status: 'ok', value: new Date().toISOString() }
    };

    // Check DynamoDB tables
    try {
      const tableChecks = await Promise.allSettled([
        checkTable(USERS_TABLE),
        checkTable(CASES_TABLE),
        checkTable(FILES_TABLE)
      ]);

      checks.dynamodb = {
        status: tableChecks.every(result => result.status === 'fulfilled' && result.value.status === 'ok') ? 'ok' : 'error',
        tables: {
          users: tableChecks[0].status === 'fulfilled' ? tableChecks[0].value : { status: 'error', message: tableChecks[0].reason?.message },
          cases: tableChecks[1].status === 'fulfilled' ? tableChecks[1].value : { status: 'error', message: tableChecks[1].reason?.message },
          files: tableChecks[2].status === 'fulfilled' ? tableChecks[2].value : { status: 'error', message: tableChecks[2].reason?.message }
        }
      };
    } catch (dynamoError) {
      checks.dynamodb = {
        status: 'error',
        message: 'DynamoDB connection failed',
        error: dynamoError.message
      };
    }

    // Check S3 bucket
    try {
      await s3Client.send(new HeadBucketCommand({ Bucket: S3_BUCKET }));
      checks.s3 = {
        status: 'ok',
        bucket: S3_BUCKET,
        message: 'S3 bucket accessible'
      };
    } catch (s3Error) {
      checks.s3 = {
        status: 'error',
        bucket: S3_BUCKET,
        message: 'S3 bucket not accessible',
        error: s3Error.message
      };
    }

    // Check environment variables
    const requiredEnvVars = ['USERS_TABLE', 'CASES_TABLE', 'FILES_TABLE', 'S3_BUCKET', 'JWT_SECRET'];
    const missingEnvVars = requiredEnvVars.filter(envVar => !process.env[envVar]);
    
    checks.environment = {
      status: missingEnvVars.length === 0 ? 'ok' : 'error',
      region: process.env.REGION,
      stage: process.env.STAGE,
      missing: missingEnvVars
    };

    console.log('✅ Health check completed');
    return healthCheckResponse(checks);

  } catch (error) {
    console.error('❌ Health check failed:', error);
    return healthCheckResponse({
      api: { status: 'error', message: error.message }
    });
  }
}

/**
 * Check if DynamoDB table exists and is accessible
 */
async function checkTable(tableName) {
  try {
    const command = {
      TableName: tableName
    };

    // Use DescribeTable to check table status
    const { DescribeTableCommand } = require('@aws-sdk/client-dynamodb');
    const response = await dynamoClient.send(new DescribeTableCommand(command));
    
    return {
      status: response.Table.TableStatus === 'ACTIVE' ? 'ok' : 'error',
      name: tableName,
      status_detail: response.Table.TableStatus,
      itemCount: response.Table.ItemCount || 0
    };
  } catch (error) {
    return {
      status: 'error',
      name: tableName,
      message: error.message
    };
  }
}

module.exports = {
  handler
};