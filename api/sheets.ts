// Purpose: optional Google Sheets sync using a Google service account (RS256 JWT -> access token -> Sheets values API).
// Setup: create a service account, enable the Sheets API, put its JSON in GOOGLE_SERVICE_ACCOUNT_JSON and share the sheet with the service account email.
import { createSign } from 'node:crypto'

export class SheetsError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message)
    this.name = 'SheetsError'
  }
}

export type ServiceAccount = { client_email: string; private_key: string; token_uri?: string }
const b64url = (data: string | Buffer) => Buffer.from(data).toString('base64url')

export function parseServiceAccount(json: string): ServiceAccount {
  let parsed: Partial<ServiceAccount>
  try {
    parsed = JSON.parse(json)
  } catch {
    throw new SheetsError('GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON')
  }
  if (!parsed.client_email || !parsed.private_key) throw new SheetsError('Service account JSON needs client_email and private_key')
  return { client_email: parsed.client_email, private_key: parsed.private_key, token_uri: parsed.token_uri }
}

export function buildServiceAccountJwt(account: ServiceAccount, nowSeconds = Math.floor(Date.now() / 1000)) {
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const claims = b64url(JSON.stringify({ iss: account.client_email, scope: 'https://www.googleapis.com/auth/spreadsheets', aud: account.token_uri ?? 'https://oauth2.googleapis.com/token', iat: nowSeconds, exp: nowSeconds + 3600 }))
  const signature = createSign('RSA-SHA256').update(`${header}.${claims}`).sign(account.private_key)
  return `${header}.${claims}.${b64url(signature)}`
}

// Spreadsheet cells starting with = + - @ are formulas: prefix them so synced data can never run as a formula.
export const safeCell = (value: unknown) => {
  const text = value === null || value === undefined ? '' : String(value)
  return /^[=+\-@\t\r]/.test(text) ? `'${text}` : text
}

type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>

export class GoogleSheetsClient {
  constructor(private readonly account: ServiceAccount, private readonly fetchImpl: FetchLike = fetch as unknown as FetchLike) {}

  private async token() {
    const body = new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: buildServiceAccountJwt(this.account) })
    const response = await this.fetchImpl(this.account.token_uri ?? 'https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: body.toString() })
    const data = (await response.json().catch(() => null)) as { access_token?: string; error_description?: string } | null
    if (!response.ok || !data?.access_token) throw new SheetsError(data?.error_description ?? `Google sign-in failed (HTTP ${response.status})`, response.status)
    return data.access_token
  }

  // Replaces the tab's contents with header + rows. Returns the row count ONLY after Google confirms.
  async replaceTab(spreadsheetId: string, tab: string, header: string[], rows: unknown[][]) {
    const token = await this.token()
    const range = encodeURIComponent(`${tab}!A1`)
    const base = `https://sheets.googleapis.com/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}/values`
    const auth = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
    const cleared = await this.fetchImpl(`${base}/${encodeURIComponent(tab)}:clear`, { method: 'POST', headers: auth, body: '{}' })
    if (!cleared.ok) throw new SheetsError(`Google Sheets refused to clear the tab (HTTP ${cleared.status}). Is the sheet shared with the service account and does the tab exist?`, cleared.status)
    const values = [header, ...rows.map((r) => r.map(safeCell))]
    const written = await this.fetchImpl(`${base}/${range}?valueInputOption=RAW`, { method: 'PUT', headers: auth, body: JSON.stringify({ values }) })
    const data = (await written.json().catch(() => null)) as { updatedRows?: number; error?: { message?: string } } | null
    if (!written.ok || typeof data?.updatedRows !== 'number') throw new SheetsError(data?.error?.message ?? `Google Sheets rejected the data (HTTP ${written.status})`, written.status)
    return { rows: data.updatedRows - 1 }
  }
}
