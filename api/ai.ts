import { z } from 'zod'

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

export function getContentProvider(): ContentProvider {
  return new MockContentProvider()
}
