/**
 * The reload itself needs a browser; the decision it feeds does not. These pin
 * the rule that separates "the app stored our input" from "the app showed it
 * back", including the three-state verdict - false rejects a tool, null must
 * never reject one.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { containsValue, submittedValue, isDistinctive } from '../src/persist.js'

test('a value still rendered after a reload counts as stored', () => {
  assert.equal(containsValue('Inbox\napic probe 11237\nAdd a task', 'apic probe 11237'), true)
  assert.equal(containsValue('APIC PROBE 11237', 'apic probe 11237'), true, 'case must not decide it')
})

test('a value gone after a reload is a display, not a write', () => {
  assert.equal(containsValue('Filters\nCustom\nNow\nStart of today', 'apic probe 11237'), false)
})

test('a needle that is not unique to this run cannot settle anything', () => {
  // The exact case that made doFilters: "apic" is the username, the project
  // prefix and half the page, so finding it after a reload proves nothing.
  // plan.js now probe-marks every value it submits so this branch stays unused.
  assert.equal(isDistinctive('apic'), false)
  assert.equal(isDistinctive('apic probe 11237'), true)
  assert.equal(containsValue('apic apic apic', 'apic'), null)
  assert.equal(containsValue('anything', ''), null)
  assert.equal(containsValue('anything', null), null)
})

test('submittedValue skips parameters too short to be a needle', () => {
  assert.equal(submittedValue({ parameters: [{ example: '1' }, { example: 'apic probe 99' }] }), 'apic probe 99')
  assert.equal(submittedValue({ parameters: [{ example: 'apic' }, { example: 'apic probe 99' }] }), 'apic probe 99')
  assert.equal(submittedValue({ parameters: [{ example: '1' }] }), null)
  assert.equal(submittedValue({}), null)
})

test('synthesize rejects only an explicit false', async () => {
  const { synthesize } = await import('../src/synthesize.js')
  const base = {
    label: 'NEW PROJECT', parameters: [], committed: true, effect: 'creation', seedUrl: '/projects',
    evidence: { added: [], removed: [], from: '/projects', to: '/projects/1', announced: { text: 'created', kind: 'creation' } },
  }
  assert.equal(synthesize([{ ...base, persisted: true }]).length, 1)
  assert.equal(synthesize([{ ...base, persisted: null }]).length, 1, 'inconclusive must not reject')
  assert.equal(synthesize([{ ...base, persisted: undefined }]).length, 1, 'unchecked must not reject')
  assert.equal(synthesize([{ ...base, persisted: false }]).length, 0)
})

test('a batch containing a deletion is refused, not judged', async () => {
  const { unstable } = await import('../src/persist.js')
  const rename = { label: 'update task', effect: 'mutation' }
  assert.equal(unstable([rename]), false)
  assert.equal(unstable([rename, { label: 'delete task', effect: 'deletion' }]), true)
  assert.equal(unstable([rename, { label: 'delete task', destructive: true }]), true)
})

test('an echo is re-checked; a banner is taken at its word', async () => {
  const { isEchoConfirmation } = await import('../src/persist.js')
  const params = [{ example: 'apic probe 11237' }]
  // The value coming back IS the confirmation - that is an echo.
  assert.equal(isEchoConfirmation({ parameters: params, evidence: { announced: { text: 'apic probe 11237' } } }), true)
  // The app asserting in its own words - nothing to re-check, and the value we
  // sent to a move or an assign was a search string that was never stored.
  assert.equal(isEchoConfirmation({ parameters: params, evidence: { announced: { text: 'Success The task was moved' } } }), false)
})
