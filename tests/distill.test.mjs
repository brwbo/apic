/**
 * The Pioneer response `result` is documented as `object | array` with "format
 * depends on task", so the exact shape cannot be read off the spec. These tests
 * pin the shapes pickLabel() accepts and, more importantly, pin the guarantee
 * that matters on the day: a missing key, a dead endpoint or an unrecognised
 * payload degrades to the heuristic and never fails a compile.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

// Deliberately not a `pio_sk_` prefix: this repo is public and a realistic-looking
// literal trips secret scanners. hasKey() only tests truthiness.
process.env.PIONEER_API_KEY = 'not-a-real-key'
process.env.PIONEER_THRESHOLD = '0.6'
const { pickLabel, pickEntities, distill, perceptionText, summarise } = await import('../src/distill.js')
const { config } = await import('../src/config.js')
const { heuristicTool } = await import('../src/synthesize.js')

const action = (over = {}) => ({
  label: 'NEW PROJECT',
  parameters: [],
  effect: 'mutation',
  changed: true,
  committed: true,
  seedUrl: 'http://localhost:3456/projects',
  evidence: { added: ['div|status|Success The project was created'], removed: [], from: '/projects', to: '/projects/5', announced: { text: 'Success The project was created', kind: 'creation' } },
  ...over,
})

const stubFetch = (body, { ok = true, status = 200 } = {}) => {
  globalThis.fetch = async () => ({ ok, status, json: async () => body, text: async () => JSON.stringify(body) })
}

// Nothing in this file may reach the network. A test that silently calls the
// real API passes for the wrong reason and burns credits doing it.
globalThis.fetch = async (url) => { throw new Error(`unstubbed fetch to ${url}`) }

test('pickLabel reads the shapes an encoder API plausibly returns', () => {
  const shapes = [
    { state_change: 'creation' },
    { state_change: [{ label: 'creation', score: 0.91 }, { label: 'mutation', score: 0.04 }] },
    { classifications: { state_change: [{ label: 'creation', confidence: 0.91 }] } },
    { classifications: [{ task: 'state_change', label: 'creation', score: 0.91 }] },
    { result: { classifications: { state_change: { label: 'creation', score: 0.91 } } } },
    { state_change: { creation: 0.91, mutation: 0.04 } },
  ]
  for (const s of shapes) assert.equal(pickLabel(s, 'state_change')?.label, 'creation', JSON.stringify(s))
})

test('pickLabel returns the highest-scoring label, not the first', () => {
  const got = pickLabel({ state_change: [{ label: 'mutation', score: 0.2 }, { label: 'deletion', score: 0.8 }] }, 'state_change')
  assert.deepEqual(got, { label: 'deletion', confidence: 0.8 })
})

test('pickLabel returns null for a shape it does not understand', () => {
  assert.equal(pickLabel({ something_else: 1 }, 'state_change'), null)
  assert.equal(pickLabel(null, 'state_change'), null)
})

test('pickEntities normalises span objects and bare strings', () => {
  assert.deepEqual(pickEntities({ entities: [{ text: 'project', label: 'object_type', score: 0.8 }] }), [{ text: 'project', label: 'object_type', confidence: 0.8 }])
  assert.deepEqual(pickEntities({ entities: ['task'] }), [{ text: 'task', label: null }])
  assert.deepEqual(pickEntities({}), [])
})

test('perceptionText carries the announcement, which is the whole signal', () => {
  const t = perceptionText(action())
  assert.match(t, /the app announced: "Success The project was created"/)
  assert.match(t, /navigated \/projects -> \/projects\/5/)
})

test('no key: falls back to the heuristic without calling out', async () => {
  const saved = config.keys.pioneer
  config.keys.pioneer = undefined
  const acts = [action()]
  const stats = await distill(acts)
  config.keys.pioneer = saved

  assert.equal(stats.source, 'heuristic')
  assert.equal(stats.reason, 'no PIONEER_API_KEY')
  assert.equal(acts[0].effect, 'mutation')
  assert.equal(acts[0].perception.source, 'heuristic')
  assert.match(summarise(stats), /SLM classifier idle/)
})

test('a confident classification overrules the node count', async () => {
  stubFetch({ result: [{ classifications: { state_change: [{ label: 'creation', score: 0.93 }], destructive: [{ label: 'safe', score: 0.99 }] }, entities: [{ text: 'project', label: 'object_type', score: 0.8 }] }], inference_id: 'inf_1', latency_ms: 41, model_used: 'fastino/gliner2-base-v1' })
  const acts = [action()]
  const stats = await distill(acts)

  assert.equal(stats.source, 'pioneer')
  assert.equal(stats.confident, 1)
  assert.equal(stats.disagreed, 1)
  assert.equal(acts[0].effect, 'creation')
  assert.equal(acts[0].perception.heuristicKind, 'mutation')
  assert.equal(acts[0].perception.inferenceId, 'inf_1')
  assert.deepEqual(acts[0].perception.entities, [{ text: 'project', label: 'object_type', confidence: 0.8 }])
})

test('below threshold the heuristic stands and the step is flagged to escalate', async () => {
  stubFetch({ result: [{ state_change: [{ label: 'creation', score: 0.41 }] }] })
  const acts = [action()]
  const stats = await distill(acts)

  assert.equal(stats.escalate, 1)
  assert.equal(stats.confident, 0)
  assert.equal(acts[0].effect, 'mutation', 'a low-confidence guess must not overwrite the deterministic answer')
  assert.equal(acts[0].perception.escalate, true)
  assert.equal(acts[0].perception.source, 'heuristic')
})

test('a destructive classification makes the emitted tool demand a confirm', async () => {
  stubFetch({ result: [{ state_change: [{ label: 'deletion', score: 0.88 }], destructive: [{ label: 'destructive', score: 0.95 }] }] })
  const acts = [action({ label: 'DELETE', effect: 'deletion' })]
  await distill(acts)
  const tool = heuristicTool(acts[0])

  assert.equal(acts[0].destructive, true)
  assert.equal(tool.destructive, true)
  assert.ok(tool.inputSchema.required.includes('confirm'))
  assert.equal(tool.provenance.discoveredBy, 'pioneer/gliner2')
})

test('an HTTP failure degrades instead of throwing', async () => {
  stubFetch({ detail: 'nope' }, { ok: false, status: 402 })
  const acts = [action()]
  const stats = await distill(acts)

  assert.equal(stats.source, 'heuristic')
  assert.match(stats.reason, /402/)
  assert.match(stats.reason, /credits/)
  assert.equal(acts[0].effect, 'mutation')
})

test('a network error degrades instead of throwing', async () => {
  globalThis.fetch = async () => { throw new Error('ECONNREFUSED') }
  const acts = [action()]
  const stats = await distill(acts)
  assert.equal(stats.source, 'heuristic')
  assert.match(stats.reason, /ECONNREFUSED/)
})

test('an unrecognised payload is recorded rather than silently trusted', async () => {
  stubFetch({ result: [{ mystery: true }] })
  const acts = [action()]
  const stats = await distill(acts)

  assert.equal(stats.unparsed, 1)
  assert.equal(acts[0].effect, 'mutation')
  const { existsSync } = await import('node:fs')
  assert.ok(existsSync('out/pioneer-raw.json'), 'raw shape must be written so one live run settles it')
})
