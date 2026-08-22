import { test } from 'node:test'
import assert from 'node:assert/strict'
import { evidenceNeeds, fulfillRequest, supportsEvidence } from '../src/request-router.js'

test('fulfill_request rejects an empty request before touching providers', async () => {
  const result = await fulfillRequest('')
  assert.deepEqual(result, { ok: false, error: 'request must be between 1 and 1000 characters' })
})

test('fulfill_request caps the request at a safe boundary', async () => {
  const result = await fulfillRequest('x'.repeat(1001))
  assert.deepEqual(result, { ok: false, error: 'request must be between 1 and 1000 characters' })
})

test('a cheapest request requires cold-verified monetary evidence', () => {
  const needs = evidenceNeeds('Find the cheapest pizza near me')
  assert.equal(needs.price, true)
  const reviewTool = { recipe: { fields: [{ name: 'reviewText' }] }, verification: { sample: [{ reviewText: 'Lovely food' }] } }
  const menuTool = { recipe: { fields: [{ name: 'price' }] }, verification: { sample: [{ name: 'Margherita', price: '£7.95' }] } }
  assert.equal(supportsEvidence(reviewTool, needs), false)
  assert.equal(supportsEvidence(menuTool, needs), true)
})
