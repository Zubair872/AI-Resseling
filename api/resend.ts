// Purpose: Resend HTTP email client (no config import, so it is unit-testable).
export type Mail = { to: string; subject: string; text: string }
export interface Mailer {
  send(mail: Mail): Promise<{ delivered: boolean }>
}

type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>

export class ResendMailer implements Mailer {
  constructor(private readonly apiKey: string, private readonly from: string, private readonly fetchImpl: FetchLike = fetch as unknown as FetchLike) {}

  async send(mail: Mail) {
    try {
      const response = await this.fetchImpl('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from: this.from, to: [mail.to], subject: mail.subject, text: mail.text }),
      })
      const data = (await response.json().catch(() => null)) as { id?: string; message?: string } | null
      if (!response.ok || !data?.id) {
        console.warn(JSON.stringify({ event: 'mail.failed', status: response.status, reason: data?.message ?? 'no id returned', subject: mail.subject }))
        return { delivered: false }
      }
      return { delivered: true }
    } catch (error) {
      console.warn(JSON.stringify({ event: 'mail.failed', reason: error instanceof Error ? error.message : String(error), subject: mail.subject }))
      return { delivered: false }
    }
  }
}

