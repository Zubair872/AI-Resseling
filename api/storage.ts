// Purpose: picks the upload storage. database (default, works with zero setup) or s3 (any S3-compatible bucket).
import { config } from './config.js'
import { S3Storage } from './s3.js'

export function getObjectStorage() {
  if (config.STORAGE_PROVIDER !== 's3') return null
  if (!config.S3_ENDPOINT || !config.S3_BUCKET || !config.S3_ACCESS_KEY_ID || !config.S3_SECRET_ACCESS_KEY) return null
  return new S3Storage({ endpoint: config.S3_ENDPOINT, region: config.S3_REGION, bucket: config.S3_BUCKET, accessKeyId: config.S3_ACCESS_KEY_ID, secretAccessKey: config.S3_SECRET_ACCESS_KEY })
}
