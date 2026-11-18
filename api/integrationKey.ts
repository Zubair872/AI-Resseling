// Purpose: the key that encrypts integration secrets (same rule as the rest of the API: explicit key, or one derived from JWT_SECRET in development).
import { createHash } from 'node:crypto'
import { config } from './config.js'

export const integrationKey = () => config.INTEGRATION_ENCRYPTION_KEY ?? createHash('sha256').update(`${config.JWT_SECRET}:integrations`).digest('hex')
