import assert from 'node:assert/strict'
import test from 'node:test'
import { toExcelXml } from '../api/csvExport.js'

test('excel export escapes xml and keeps every cell a string', () => {
  const xml = toExcelXml('Orders/1', ['a', 'b'], [['<x>&"', '=1+1']])
  assert.ok(xml.includes('&lt;x&gt;&amp;&quot;'))
  assert.ok(xml.includes('ss:Type="String">=1+1<'))
  assert.ok(xml.includes('ss:Name="Orders 1"'))
  assert.ok(!xml.includes('\u0001'))
})
