import assert from 'node:assert/strict'
import test from 'node:test'
import { createOneTimeToken, hashOneTimeToken, tokenTtlMinutes } from '../api/tokens.js'
import { csvCell, toCsv } from '../api/csvExport.js'

test('one-time tokens are unique, long and hashed deterministically', () => {
  const a = createOneTimeToken()
  const b = createOneTimeToken()
  assert.notEqual(a, b)
  assert.ok(a.length >= 40)
  assert.equal(hashOneTimeToken(a), hashOneTimeToken(a))
  assert.notEqual(hashOneTimeToken(a), a)
  assert.equal(hashOneTimeToken(a).length, 64)
  assert.ok(tokenTtlMinutes.password_reset <= 60)
})
test('csv escapes quotes, commas and newlines', () => {
  assert.equal(csvCell('a,b'), '"a,b"')
  assert.equal(csvCell('say "hi"'), '"say ""hi"""')
  assert.equal(csvCell('x\ny'), '"x\ny"')
  assert.equal(csvCell(null), '')
})
test('csv blocks spreadsheet formula injection', () => {
  assert.equal(csvCell('=HYPERLINK("x")'), `"'=HYPERLINK(""x"")"`)
  assert.equal(csvCell('+1'), "'+1")
  assert.equal(csvCell('@cmd'), "'@cmd")
})
test('toCsv builds header and rows', () => {
  assert.equal(toCsv(['a', 'b'], [[1, 'x,y']]), 'a,b\n1,"x,y"\n')
})
