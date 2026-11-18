// Purpose: encrypt integration API keys at rest (AES-256-GCM). Keys are never returned by the API.
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

export function encryptSecret(plain: string, keyHex: string) {
  const key = Buffer.from(keyHex, 'hex')
  if (key.length !== 32) throw new Error('Encryption key must be 32 bytes (64 hex characters)')
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const encrypted = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()])
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), encrypted.toString('base64url')].join(':')
}

export function decryptSecret(payload: string, keyHex: string) {
  const [version, iv, tag, data] = payload.split(':')
  if (version !== 'v1' || !iv || !tag || !data) throw new Error('Unsupported secret format')
  const decipher = createDecipheriv('aes-256-gcm', Buffer.from(keyHex, 'hex'), Buffer.from(iv, 'base64url'))
  decipher.setAuthTag(Buffer.from(tag, 'base64url'))
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString('utf8')
}

export function secretHint(plain: string) {
  return plain.length >= 8 ? plain.slice(-4) : ''
}
