// Purpose: "Test connection" for providers without a dedicated adapter (custom APIs and Markaz): checks that the URL answers and, when a key is given, that it is not rejected.
import { isIP } from 'node:net'

export function isPublicHttpUrl(value: string): boolean {
  let url: URL
  try { url = new URL(value) } catch { return false }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return false
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, '')
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local') || host.endsWith('.internal')) return false
  if (isIP(host) === 4) {
    const [a, b] = host.split('.').map(Number)
    if (a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)) return false
  }
  if (isIP(host) === 6 && (host === '::1' || host.startsWith('fc') || host.startsWith('fd') || host.startsWith('fe80'))) return false
  return true
}

export async function checkApiReachable(url: string | null, secret: string | null): Promise<{ status: 'verified' | 'failed' | 'unverified'; message: string }> {
  if (!url) return { status: 'failed', message: 'Add a Base URL first, then test again.' }
  if (!isPublicHttpUrl(url)) return { status: 'failed', message: 'Only public http(s) addresses can be tested.' }
  try {
    const host = new URL(url).hostname.toLowerCase()
    // Google Gemini: ask for the model list with the key, which only works when the key is valid.
    if (host === 'generativelanguage.googleapis.com') {
      if (!secret) return { status: 'failed', message: 'No key stored.' }
      const gemini = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=1', { redirect: 'manual', signal: AbortSignal.timeout(8000), headers: { 'x-goog-api-key': secret } })
      return gemini.ok ? { status: 'verified', message: 'Gemini accepted this key.' } : { status: 'failed', message: `Gemini rejected this key (HTTP ${gemini.status}).` }
    }
    const response = await fetch(url, { method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(8000), headers: secret ? { Authorization: `Bearer ${secret}`, Accept: 'application/json' } : { Accept: 'application/json' } })
    if (response.status === 401 || response.status === 403) return { status: 'failed', message: `The service answered ${response.status}: the key was rejected or is missing a permission.` }
    if (response.status >= 500) return { status: 'failed', message: `The service answered ${response.status} (server error).` }
    if (response.ok) return { status: 'verified', message: `The service accepted the request (HTTP ${response.status}).` }
    return { status: 'unverified', message: `The address answered HTTP ${response.status}, but this does not prove the key works. Use the real API address of the service as Base URL.` }
  } catch {
    return { status: 'failed', message: 'Could not reach this address.' }
  }
}
