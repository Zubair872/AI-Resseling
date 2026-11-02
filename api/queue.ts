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

type WorkflowJob = { id: string; name: OrbitlyJobName; data: OrbitlyJobData; status: 'queued' }
class InMemoryQueue {
  private readonly jobs = new Map<string, WorkflowJob>()

  async add(name: OrbitlyJobName, data: OrbitlyJobData, options: { jobId: string }) {
    const job = this.jobs.get(options.jobId) ?? { id: options.jobId, name, data, status: 'queued' as const }
    this.jobs.set(options.jobId, job)
    return job
  }

  async close() {}
}

const connection = config.REDIS_URL ? new Redis(config.REDIS_URL, { maxRetriesPerRequest: null, lazyConnect: true }) : undefined
export const orbitlyQueue = connection ? new Queue<OrbitlyJobData, unknown, OrbitlyJobName>('orbitly-workflows', {
  connection,
  defaultJobOptions: {
    attempts: 5,
    backoff: { type: 'exponential', delay: 2000 },
    removeOnComplete: { age: 86400, count: 1000 },
    removeOnFail: { age: 604800, count: 5000 },
  },
}) : new InMemoryQueue()

export async function enqueueWorkflow(name: OrbitlyJobName, data: OrbitlyJobData, idempotencyKey: string) {
  return orbitlyQueue.add(name, data, { jobId: idempotencyKey })
}

export async function closeQueue() {
  await orbitlyQueue.close()
  if (connection) await connection.quit()
}
