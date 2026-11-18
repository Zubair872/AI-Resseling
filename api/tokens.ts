// Purpose: one-time tokens for email verification and password reset (only the hash is stored).
import { createHash, randomBytes } from 'node:crypto'

export type AuthTokenKind = 'email_verification' | 'password_reset'
export const tokenTtlMinutes: Record<AuthTokenKind, number> = { email_verification: 60 * 24, password_reset: 60 }

export function createOneTimeToken() {
  return randomBytes(32).toString('base64url')
}

export function hashOneTimeToken(token: string) {
  return createHash('sha256').update(token).digest('hex')
}
