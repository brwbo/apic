import { test } from 'node:test'
import assert from 'node:assert/strict'

test('type-less native inputs are discoverable as text fields', async () => {
  // This regression is exercised through the browser integration; pin the
  // public contract here so readers of the field shape do not treat "input"
  // as a separate, non-searchable field type again.
  const source = await import('node:fs').then(({ readFileSync }) => readFileSync(new URL('../src/forms.js', import.meta.url), 'utf8'))
  assert.match(source, /el\.tagName === 'INPUT' \? 'text'/)
})
