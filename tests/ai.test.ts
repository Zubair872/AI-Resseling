import test from 'node:test'
import assert from 'node:assert/strict'
import { TemplateContentProvider, generatedContentSchema } from '../api/ai.ts'

test('template provider builds a post from product data only', async () => {
  const content = await new TemplateContentProvider().generate({
    productName: 'Smart Lamp',
    category: 'Home & Kitchen',
    platform: 'instagram',
    language: 'roman_urdu',
    price: 1200,
  })

  assert.equal(generatedContentSchema.safeParse(content).success, true)
  assert.match(content.disclaimer, /Check it/)
  assert.match(content.caption, /Qeemat: Rs\. 1,200/)
  assert.doesNotMatch(content.caption, /discount|guarantee|%/i)
  assert.match(content.caption, /Smart Lamp/)
  assert.match(content.caption, /Rs\. 1,200/)
})

test('post text has name, price, category and details from the product data', async () => {
  const content = await new TemplateContentProvider().generate({ productName: 'Mini Blender', category: 'Home & Kitchen', platform: 'facebook', language: 'roman_urdu', price: 2450, description: 'Rechargeable, 6 blades, 400ml jar' })
  assert.match(content.caption, /Mini Blender/)
  assert.match(content.caption, /Qeemat: Rs\. 2,450/)
  assert.match(content.caption, /Tafseel: Rechargeable, 6 blades, 400ml jar/)
})
