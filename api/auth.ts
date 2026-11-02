import bcrypt from 'bcryptjs'
import { createHash, randomBytes } from 'node:crypto'
import jwt from 'jsonwebtoken'
import { config } from './config.js'

export type AuthUser = { id: string; tenantId: string; email: string; role: string }

export function signToken(user: AuthUser) {
  return jwt.sign(user, config.JWT_SECRET, { expiresIn: config.JWT_EXPIRES_IN as jwt.SignOptions['expiresIn'] })
}

export function verifyToken(token: string): AuthUser {
  const payload = jwt.verify(token, config.JWT_SECRET)
  if (!payload || typeof payload === 'string' || !payload.id || !payload.tenantId) throw new Error('Invalid authentication token')
  return payload as AuthUser
}

export function createRefreshToken() {
  return randomBytes(48).toString('base64url')
}

export function hashRefreshToken(token: string) {
  return createHash('sha256').update(token).digest('hex')
}

export async function hashPassword(password: string) {
  return bcrypt.hash(password, 12)
}

export async function comparePassword(password: string, hash: string) {
  return bcrypt.compare(password, hash)
}
