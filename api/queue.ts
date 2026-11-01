import { Queue } from 'bullmq'
import { Redis } from 'ioredis'
import { config } from './config.js'

export type OrbitlyJobName = 'product-import' | 'content-generation' | 'publishing' | 'supplier-order' | 'notification'

export type OrbitlyJobData = {
  tenantId: string
  userId?: string
  resourceId?: string
  payload?: Record<string, unknown>
}

const connection = new Redis(config.REDIS_URL, { maxRetriesPerRequest: null, lazyConnect: true })
export const orbitlyQueue = new Queue<OrbitlyJobData, unknown, OrbitlyJobName>('orbitly-workflows', {
  connection,
  defaultJobOptions: {
    attempts: 5,
    backoff: { type: 'exponential', delay: 2000 },
    removeOnComplete: { age: 86400, count: 1000 },
    removeOnFail: { age: 604800, count: 5000 },
  },
})

export async function enqueueWorkflow(name: OrbitlyJobName, data: OrbitlyJobData, idempotencyKey: string) {
  return orbitlyQueue.add(name, data, { jobId: idempotencyKey })
}

export async function closeQueue() {
  await orbitlyQueue.close()
  await connection.quit()
}
