import { z } from 'zod'
import { config } from './config.js'

export type ContentRequest = {
  productName: string
  category: string
  platform: 'facebook' | 'instagram' | 'tiktok' | 'whatsapp'
  language: 'english' | 'urdu' | 'roman_urdu'
  price?: number
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

export class MockContentProvider implements ContentProvider {
  async generate(request: ContentRequest) {
    const languageLabel = request.language === 'urdu' ? 'اردو' : request.language === 'roman_urdu' ? 'Roman Urdu' : 'English'
    return generatedContentSchema.parse({
      caption: `${request.productName} — thoughtfully selected for your ${request.category.toLowerCase()} collection. Available for ${request.platform} in ${languageLabel}. Verify price and availability before publishing.`,
      hashtags: [`#${request.category.replace(/[^a-z0-9]/gi, '')}`, '#OrbitlyFinds', '#ShopSmart'],
      disclaimer: 'Draft generated for review. Product claims, price, stock, and discounts must be verified before publishing.',
    })
  }
}

class OpenAIContentProvider implements ContentProvider {
  async generate(request: ContentRequest) {
    if (!config.AI_API_KEY) throw new AIProviderError('AI provider is not configured with an API key')
    let response: Response
    try {
      response = await fetch(`${config.AI_BASE_URL}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.AI_API_KEY}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: config.AI_MODEL,
          temperature: 0.4,
          response_format: { type: 'json_object' },
          messages: [
            {
              role: 'system',
              content: 'Generate commerce content as JSON with exactly these keys: caption (string), hashtags (array of strings), disclaimer (string). Do not invent stock, shipping, guarantees, medical claims, discounts, or facts not supplied. The disclaimer must state that a human must verify the draft before publishing.',
            },
            {
              role: 'user',
              content: JSON.stringify(request),
            },
          ],
        }),
      })
    } catch (error) {
      throw new AIProviderError('Unable to reach the AI provider', { cause: error })
    }
    const body = await response.json().catch(() => null) as { choices?: { message?: { content?: string } }[] } | null
    if (!response.ok) throw new AIProviderError(`AI provider rejected the request (${response.status})`)
    const content = body?.choices?.[0]?.message?.content
    if (!content) throw new AIProviderError('AI provider returned no content')
    let parsed: unknown
    try {
      parsed = JSON.parse(content)
    } catch {
      throw new AIProviderError('AI provider returned invalid JSON content')
    }
    try {
      return generatedContentSchema.parse(parsed)
    } catch (error) {
      throw new AIProviderError('AI provider returned content in an unexpected format', { cause: error })
    }
  }
}

export function getContentProvider(): ContentProvider {
  return config.AI_PROVIDER === 'openai' ? new OpenAIContentProvider() : new MockContentProvider()
}
