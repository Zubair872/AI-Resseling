import assert from 'node:assert/strict'
import test from 'node:test'
import { autoApprovesContent, freeSlots, slotTimes } from '../api/autopilot.js'

test('slots are spread inside the posting window and sorted', () => {
  const slots = slotTimes(3)
  assert.equal(slots.length, 3)
  const minutes = slots.map((s) => s.hour * 60 + s.minute)
  assert.deepEqual([...minutes].sort((a, b) => a - b), minutes)
  assert.ok(minutes[0] >= 10 * 60 && minutes[2] <= 21 * 60)
  assert.equal(slotTimes(0).length, 0)
  assert.equal(slotTimes(100).length, 24)
})

test('free slots skip the ones already scheduled', () => {
  assert.equal(freeSlots(4, 1).length, 3)
  assert.equal(freeSlots(4, 4).length, 0)
  assert.equal(freeSlots(4, 9).length, 0)
  assert.deepEqual(freeSlots(3, 0), slotTimes(3))
})

test('only hybrid and full modes auto-approve content', () => {
  assert.equal(autoApprovesContent('manual'), false)
  assert.equal(autoApprovesContent('approval'), false)
  assert.equal(autoApprovesContent('hybrid'), true)
  assert.equal(autoApprovesContent('full'), true)
})
