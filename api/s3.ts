// Purpose: S3-compatible object storage (AWS S3, Cloudflare R2, Backblaze B2, MinIO) with AWS Signature V4, no SDK needed.
// Used for product images and payment proofs when STORAGE_PROVIDER=s3. Needs your bucket and keys. Path-style URLs: {endpoint}/{bucket}/{key}.
import { createHash, createHmac } from 'node:crypto'

const sha256Hex = (data: string | Buffer) => createHash('sha256').update(data).digest('hex')
const hmac = (key: string | Buffer, data: string) => createHmac('sha256', key).update(data, 'utf8').digest()
const encode = (value: string) => encodeURIComponent(value).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)
const encodePath = (path: string) => path.split('/').map(encode).join('/')

export type S3Config = { endpoint: string; region: string; bucket: string; accessKeyId: string; secretAccessKey: string; pathStyle?: boolean }

function signingKey(secret: string, date: string, region: string) {
  return hmac(hmac(hmac(hmac(`AWS4${secret}`, date), region), 's3'), 'aws4_request')
}

function target(cfg: S3Config, key: string) {
  const base = new URL(cfg.endpoint)
  if (cfg.pathStyle === false) return { host: `${cfg.bucket}.${base.host}`, path: `/${encodePath(key)}`, origin: `${base.protocol}//${cfg.bucket}.${base.host}` }
  return { host: base.host, path: `/${encode(cfg.bucket)}/${encodePath(key)}`, origin: base.origin }
}

// Time-limited GET link (query-string signing). `now` is injectable so the algorithm can be tested against AWS's published example.
export function presignGetUrl(cfg: S3Config, key: string, expiresSeconds = 900, now = new Date()) {
  const stamp = now.toISOString().replace(/[:-]|\.\d{3}/g, '')
  const date = stamp.slice(0, 8)
  const scope = `${date}/${cfg.region}/s3/aws4_request`
  const t = target(cfg, key)
  const params: Record<string, string> = { 'X-Amz-Algorithm': 'AWS4-HMAC-SHA256', 'X-Amz-Credential': `${cfg.accessKeyId}/${scope}`, 'X-Amz-Date': stamp, 'X-Amz-Expires': String(expiresSeconds), 'X-Amz-SignedHeaders': 'host' }
  const canonicalQuery = Object.keys(params).sort().map((k) => `${encode(k)}=${encode(params[k])}`).join('&')
  const canonicalRequest = ['GET', t.path, canonicalQuery, `host:${t.host}\n`, 'host', 'UNSIGNED-PAYLOAD'].join('\n')
  const toSign = ['AWS4-HMAC-SHA256', stamp, scope, sha256Hex(canonicalRequest)].join('\n')
  const signature = createHmac('sha256', signingKey(cfg.secretAccessKey, date, cfg.region)).update(toSign, 'utf8').digest('hex')
  return `${t.origin}${t.path}?${canonicalQuery}&X-Amz-Signature=${signature}`
}

// Header-signed request used for PUT/DELETE.
export function signRequest(cfg: S3Config, method: 'PUT' | 'DELETE' | 'GET', key: string, body: Buffer, contentType: string | undefined, now = new Date()) {
  const stamp = now.toISOString().replace(/[:-]|\.\d{3}/g, '')
  const date = stamp.slice(0, 8)
  const scope = `${date}/${cfg.region}/s3/aws4_request`
  const t = target(cfg, key)
  const payloadHash = sha256Hex(body)
  const headers: Record<string, string> = { host: t.host, 'x-amz-content-sha256': payloadHash, 'x-amz-date': stamp }
  if (contentType) headers['content-type'] = contentType
  const names = Object.keys(headers).sort()
  const canonicalHeaders = names.map((n) => `${n}:${headers[n].trim()}\n`).join('')
  const signedHeaders = names.join(';')
  const canonicalRequest = [method, t.path, '', canonicalHeaders, signedHeaders, payloadHash].join('\n')
  const toSign = ['AWS4-HMAC-SHA256', stamp, scope, sha256Hex(canonicalRequest)].join('\n')
  const signature = createHmac('sha256', signingKey(cfg.secretAccessKey, date, cfg.region)).update(toSign, 'utf8').digest('hex')
  headers.authorization = `AWS4-HMAC-SHA256 Credential=${cfg.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`
  return { url: `${t.origin}${t.path}`, headers }
}

type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body?: Buffer }) => Promise<{ ok: boolean; status: number }>

export class S3Storage {
  constructor(private readonly cfg: S3Config, private readonly fetchImpl: FetchLike = fetch as unknown as FetchLike) {}

  // Stored ONLY when the storage server answers 2xx.
  async put(key: string, body: Buffer, contentType: string) {
    const signed = signRequest(this.cfg, 'PUT', key, body, contentType)
    const response = await this.fetchImpl(signed.url, { method: 'PUT', headers: signed.headers, body })
    if (!response.ok) throw new Error(`Storage rejected the upload (HTTP ${response.status})`)
    return { key }
  }

  async remove(key: string) {
    const signed = signRequest(this.cfg, 'DELETE', key, Buffer.alloc(0), undefined)
    const response = await this.fetchImpl(signed.url, { method: 'DELETE', headers: signed.headers })
    if (!response.ok && response.status !== 404) throw new Error(`Storage rejected the delete (HTTP ${response.status})`)
  }

  signedUrl(key: string, seconds = 900) {
    return presignGetUrl(this.cfg, key, seconds)
  }
}
