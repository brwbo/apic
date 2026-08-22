import test from 'node:test'
import assert from 'node:assert/strict'
import { replay } from '../src/replay.js'

test('destructive replay stops before opening a browser without confirm: true', async () => {
  const result = await replay({
    destructive: true,
    recipe: { expect: 'deletion' },
  }, {})

  assert.deepEqual(result, {
    ok: false,
    error: 'This destructive action requires confirm: true.',
    expected: 'deletion',
  })
})
