// Purpose: in-app notifications. A failure here must never break the main action.
import { query } from './db.js'

export async function createNotification(tenantId: string, kind: string, title: string, body?: string) {
  try {
    await query('INSERT INTO notifications (tenant_id, kind, title, body) VALUES ($1,$2,$3,$4)', [tenantId, kind, title, body ?? null])
  } catch (error) {
    console.error(JSON.stringify({ event: 'notification.failed', kind, error: error instanceof Error ? error.message : String(error) }))
  }
}
