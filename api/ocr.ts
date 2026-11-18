// Purpose: optional OCR for payment screenshots through an OpenAI-compatible vision model. It only EXTRACTS text fields.
// An OCR result is a hint for the human reviewer. It never verifies a payment.
import { parsePaymentText } from './agents.js'

type FetchLike = (url: string, init: { method: string; headers: Record<string, string>; body?: string }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>

export async function ocrImageText(opts: { baseUrl: string; apiKey: string; model: string; contentType: string; dataBase64: string; fetchImpl?: FetchLike }) {
  const fetchImpl = opts.fetchImpl ?? (fetch as unknown as FetchLike)
  const response = await fetchImpl(`${opts.baseUrl.replace(/\/+$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${opts.apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: opts.model, temperature: 0, max_tokens: 400, messages: [{ role: 'user', content: [
      { type: 'text', text: 'Transcribe all visible text of this payment screenshot exactly as written. Output only the transcription. Do not interpret, summarise or judge whether the payment is real.' },
      { type: 'image_url', image_url: { url: `data:${opts.contentType};base64,${opts.dataBase64}` } },
    ] }] }),
  })
  const data = (await response.json().catch(() => null)) as { choices?: { message?: { content?: string } }[] } | null
  const text = data?.choices?.[0]?.message?.content
  if (!response.ok || typeof text !== 'string' || !text.trim()) throw new Error(`OCR provider did not return text (HTTP ${response.status})`)
  return { text: text.trim().slice(0, 4000), extracted: parsePaymentText(text), verified: false as const }
}
