import { z } from 'zod'
import { config } from './config.js'
import { formatPrice, priceFacts, replyUsesOnlyKnownNumbers } from './support.js'

export type ContentRequest = {
  productName: string
  category: string
  platform: 'facebook' | 'instagram' | 'tiktok' | 'whatsapp' | 'bluesky' | 'mastodon' | 'discord'
  language: 'english' | 'urdu' | 'roman_urdu'
  price?: number
  description?: string
  brandVoice?: string
}

export const generatedContentSchema = z.object({
  caption: z.string().min(1).max(5000),
  hashtags: z.array(z.string().min(1).max(80)).max(30),
  disclaimer: z.string().min(1),
})

export interface ContentProvider {
  generate(request: ContentRequest): Promise<z.infer<typeof generatedContentSchema>>
}

export class AIProviderError extends Error {
  readonly statusCode = 502

  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options)
    this.name = 'AIProviderError'
  }
}

// Local renderer: builds the post from the product record only.
// It invents nothing: no discounts, no claims, no delivery promises.
export class TemplateContentProvider implements ContentProvider {
  async generate(request: ContentRequest) {
    const price = request.price !== undefined ? formatPrice(request.price) : null
    const description = (request.description ?? '').replace(/\s+/g, ' ').trim().slice(0, 400)
    const labels = {
      english: { price: 'Price', details: 'Details', category: 'Category', cta: 'To order, send us a message.' },
      roman_urdu: { price: 'Qeemat', details: 'Tafseel', category: 'Category', cta: 'Order karne ke liye humein message karein.' },
      urdu: { price: 'قیمت', details: 'تفصیل', category: 'قسم', cta: 'آرڈر کے لیے ہمیں پیغام بھیجیں۔' },
    }[request.language]
    const caption = [request.productName, price ? `${labels.price}: ${price}` : null, request.category && request.category !== 'Other' ? `${labels.category}: ${request.category}` : null, description ? `${labels.details}: ${description}` : null, labels.cta].filter(Boolean).join('\n')
    const words = request.productName.split(/[^A-Za-z0-9]+/).filter((word) => word.length >= 4).slice(0, 2)
    const hashtags = [...new Set([request.category.replace(/[^A-Za-z0-9]/g, ''), ...words].filter(Boolean).map((word) => `#${word}`))]
    return generatedContentSchema.parse({
      caption,
      hashtags,
      disclaimer: 'Built from your product data only (name, price, description). Check it before posting.',
    })
  }
}

class OpenAIContentProvider implements ContentProvider {
  // The model may only use the price from the database. A draft with any other number is rejected and retried once.
  async generate(request: ContentRequest) {
    let lastError: unknown
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const content = await this.generateOnce(request)
      // Allowed numbers: the price, plus any number that is part of the product's own name or description (e.g. "9 Massage Head").
      const own = `${request.productName} ${request.description ?? ''}`.match(/\d[\d,]*(?:\.\d+)?/g) ?? []
      if (replyUsesOnlyKnownNumbers(`${content.caption} ${content.hashtags.join(' ')}`, [...priceFacts(request.price), ...own])) return content
      lastError = new AIProviderError('The AI wrote a number that is not in your product data, so the draft was rejected')
    }
    throw lastError
  }

  private async generateOnce(request: ContentRequest) {
    if (!config.AI_API_KEY) throw new AIProviderError('AI provider is not configured with an API key')
    const baseUrl = config.AI_BASE_URL.replace(/\/+$/, '')
    const messages = [
      {
        role: 'system',
        content: 'Generate commerce content as JSON with exactly these keys: caption (string), hashtags (array of strings), disclaimer (string). Do not invent stock, shipping, guarantees, medical claims, discounts, prices, or facts not supplied. Use only the product name, category, description and price given. If a price is given, write it exactly as Rs. followed by the number. The disclaimer must state that a human must verify the draft before publishing.',
      },
      {
        role: 'user',
        content: JSON.stringify(request),
      },
    ]

    let response: Response
    try {
      // First try with json_object format (works with OpenAI and supported Gemini configurations)
      response = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.AI_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: config.AI_MODEL,
          temperature: 0.4,
          response_format: { type: 'json_object' },
          messages,
        }),
      })

      // If rejected with 400 (e.g. Gemini OpenAI endpoint rejecting response_format json_object), retry without it
      if (response.status === 400) {
        response = await fetch(`${baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${config.AI_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: config.AI_MODEL,
            temperature: 0.4,
            messages,
          }),
        })
      }
    } catch (error) {
      throw new AIProviderError('Unable to reach the AI provider', { cause: error })
    }

    const body = (await response.json().catch(() => null)) as { choices?: { message?: { content?: string } }[] } | null
    if (!response.ok) throw new AIProviderError(`AI provider rejected the request (${response.status})`)
    const content = body?.choices?.[0]?.message?.content
    if (!content) throw new AIProviderError('AI provider returned no content')

    let parsed: unknown
    try {
      parsed = JSON.parse(content)
    } catch {
      // Safe fallback: strip markdown code blocks (e.g. ```json ... ```) or extract JSON object substring
      const stripped = content.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()
      try {
        parsed = JSON.parse(stripped)
      } catch {
        const match = content.match(/\{[\s\S]*\}/)
        if (match) {
          try {
            parsed = JSON.parse(match[0])
          } catch {
            throw new AIProviderError('AI provider returned invalid JSON content')
          }
        } else {
          throw new AIProviderError('AI provider returned invalid JSON content')
        }
      }
    }

    try {
      return generatedContentSchema.parse(parsed)
    } catch (error) {
      throw new AIProviderError('AI provider returned content in an unexpected format', { cause: error })
    }
  }
}

// If the AI provider fails or writes a number that is not in the product data, the post is built from the product data only, so a post is never blocked by the AI.
class FallbackContentProvider implements ContentProvider {
  constructor(private readonly primary: ContentProvider, private readonly fallback: ContentProvider) {}
  async generate(request: ContentRequest) {
    try {
      return await this.primary.generate(request)
    } catch (error) {
      if (!(error instanceof AIProviderError)) throw error
      const content = await this.fallback.generate(request)
      return { ...content, disclaimer: `AI wording was not used (${error.message}). Built from your product data only. Check it before posting.` }
    }
  }
}

export function getContentProvider(): ContentProvider {
  return config.AI_PROVIDER === 'openai' ? new FallbackContentProvider(new OpenAIContentProvider(), new TemplateContentProvider()) : new TemplateContentProvider()
}
