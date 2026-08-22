import { test } from 'node:test'
import assert from 'node:assert/strict'
import { fulfillRequest } from '../src/request-router.js'

test('fulfill_request rejects an empty request before touching providers', async () => {
  const result = await fulfillRequest('')
  assert.deepEqual(result, { ok: false, error: 'request must be between 1 and 1000 characters' })
})

test('fulfill_request caps the request at a safe boundary', async () => {
  const result = await fulfillRequest('x'.repeat(1001))
  assert.deepEqual(result, { ok: false, error: 'request must be between 1 and 1000 characters' })
})
