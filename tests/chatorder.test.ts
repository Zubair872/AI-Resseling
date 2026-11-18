import test from 'node:test'
import assert from 'node:assert/strict'
import { composeReply, detectAutoOrder, mergeOrderDetails, type CatalogProduct } from '../api/support.js'

const products: CatalogProduct[] = [
  { id: 'p1', name: 'Smart LED Desk Lamp', category: 'Home', selling_price: '1150.00', stock: 4 },
  { id: 'p2', name: 'Cotton Baby Blanket', category: 'Baby', selling_price: '899.50', stock: 0 },
]

test('details spread over several messages are merged, newest wins', () => {
  const d = mergeOrderDetails(['Name: Ali', 'City: Lahore\nPhone: 03001234567', 'City: Karachi'])
  assert.equal(d.name, 'Ali')
  assert.equal(d.city, 'Karachi')
  assert.equal(d.phone, '03001234567')
})

test('auto order is created only when every detail is present and stock is enough', () => {
  const full = ['Smart LED Desk Lamp order karna hai', 'Name: Ali Raza\nPhone: 0300-1234567\nCity: Lahore\nAddress: House 5, Street 2, Gulberg\nQty: 2']
  const order = detectAutoOrder(full, products)
  assert.ok(order)
  assert.equal(order.product.id, 'p1')
  assert.equal(order.quantity, 2)
  assert.equal(order.paymentMethod, 'cod')
  assert.equal(order.phone, '03001234567')
  assert.equal(detectAutoOrder(['Smart LED Desk Lamp order karna hai', 'Name: Ali Raza\nCity: Lahore'], products), null)
  assert.equal(detectAutoOrder(['Smart LED Desk Lamp order\nName: Ali Raza\nPhone: 03001234567\nCity: Lahore\nAddress: House 5, Gulberg\nQty: 9'], products), null)
  assert.equal(detectAutoOrder(['Cotton Baby Blanket order\nName: Ali Raza\nPhone: 03001234567\nCity: Lahore\nAddress: House 5, Gulberg\nQty: 1'], products), null)
  assert.equal(detectAutoOrder(['Smart LED Desk Lamp price kitni hai', 'Name: Ali Raza\nPhone: 03001234567\nCity: Lahore\nAddress: House 5, Gulberg\nQty: 1'], products), null)
})

test('payment method is read from the chat, default cash on delivery', () => {
  const base = 'Smart LED Desk Lamp order\nName: Ali Raza\nPhone: 03001234567\nCity: Lahore\nAddress: House 5, Gulberg\nQty: 1'
  assert.equal(detectAutoOrder([base + '\nEasypaisa se pay karunga'], products)?.paymentMethod, 'easypaisa')
  assert.equal(detectAutoOrder([base], products)?.paymentMethod, 'cod')
})

test('advance payment / China-sourced products are not auto-ordered', () => {
  const advanceProducts: CatalogProduct[] = [
    { id: 'p3', name: 'China Smart Watch', category: 'Electronics', selling_price: '2500', stock: 10, is_advance_payment: true },
  ]
  const msg = ['China Smart Watch order\nName: Ali Raza\nPhone: 03001234567\nCity: Lahore\nAddress: House 5, Gulberg\nQty: 1']
  assert.equal(detectAutoOrder(msg, advanceProducts), null)
})

test('a message with only details continues the order and asks only for what is still missing', () => {
  const history = ['Smart LED Desk Lamp order karna hai']
  const reply = composeReply('Name: Ali Raza\nPhone: 03001234567', products, { history })
  assert.match(reply.text, /shehar/)
  assert.match(reply.text, /address/)
  assert.doesNotMatch(reply.text, /poora naam/)
  assert.equal(reply.needsHuman, false)
})
