import { Worker } from 'bullmq'
import { Redis } from 'ioredis'
import { config } from './config.js'
import { query } from './db.js'
import { getContentProvider, type ContentRequest } from './ai.js'

const connection = new Redis(config.REDIS_URL, { maxRetriesPerRequest: null })

const worker = new Worker('orbitly-workflows', async (job) => {
  const { tenantId, userId, resourceId, payload } = job.data
  switch (job.name) {
    case 'content-generation': {
      if (!payload || typeof payload.productName !== 'string' || typeof payload.category !== 'string') throw new Error('Content job payload is invalid')
      const content = await getContentProvider().generate(payload as ContentRequest)
      await query(
        'INSERT INTO content_drafts (tenant_id, product_id, platform, language, content, created_by) VALUES ($1,$2,$3,$4,$5,$6)',
        [tenantId, resourceId ?? null, payload.platform, payload.language, JSON.stringify(content), userId ?? null],
      )
      await query('INSERT INTO usage_events (tenant_id, kind) VALUES ($1, $2)', [tenantId, 'ai_content_generation'])
      return { created: true }
    }
    case 'publishing':
    case 'supplier-order':
    case 'product-import':
    case 'notification':
      throw new Error(`${job.name} worker adapter requires an approved provider implementation`)
    default:
      throw new Error(`Unsupported job: ${job.name}`)
  }
}, { connection, concurrency: 5 })

worker.on('completed', (job) => console.log(JSON.stringify({ event: 'job.completed', jobId: job.id, name: job.name })))
worker.on('failed', (job, error) => console.error(JSON.stringify({ event: 'job.failed', jobId: job?.id, name: job?.name, error: error.message })))

const shutdown = async () => {
  await worker.close()
  await connection.quit()
  process.exit(0)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
