import test from 'node:test'
import assert from 'node:assert/strict'
import { MockContentProvider, generatedContentSchema } from '../api/ai.ts'

test('mock content provider creates review-required content', async () => {
  const content = await new MockContentProvider().generate({
    productName: 'Demo Lamp',
    category: 'Home & Kitchen',
    platform: 'instagram',
    language: 'roman_urdu',
    price: 1200,
  })

  assert.equal(generatedContentSchema.safeParse(content).success, true)
  assert.match(content.disclaimer, /review/i)
  assert.match(content.caption, /Demo Lamp/)
})
