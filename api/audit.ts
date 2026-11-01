import { query } from './db.js'

export async function writeAuditLog(input: {
  tenantId: string
  userId: string
  action: string
  entityType: string
  entityId?: string
  metadata?: Record<string, unknown>
}) {
  await query(
    'INSERT INTO audit_logs (tenant_id, user_id, action, entity_type, entity_id, metadata) VALUES ($1,$2,$3,$4,$5,$6)',
    [input.tenantId, input.userId, input.action, input.entityType, input.entityId ?? null, JSON.stringify(input.metadata ?? {})],
  )
}
