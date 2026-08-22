/**
 * The network half of grounding needs Tavily and OpenAI; the half that decides
 * what to TRUST does not. These pin the validation, because everything this
 * stage learns goes straight into a regex that decides whether a control
 * becomes a tool - and a bad noun there is worse than no noun at all.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { validate } from '../src/ground.js'

const nouns = (v) => v.nouns.map((n) => n.canonical)

test('keeps single lowercase words and drops everything else', () => {
  const v = validate({ app: 'Gitea', nouns: [
    { canonical: 'issue', synonyms: [] },
    { canonical: 'Repository', synonyms: [] },          // capitalised -> lowercased, kept
    { canonical: 'pull request', synonyms: [] },        // space in a canonical -> names a tool, refuse
    { canonical: 'the thing you file', synonyms: [] },  // a sentence
    { canonical: '', synonyms: [] },
  ] })
  assert.deepEqual(nouns(v), ['issue', 'repository'])
})

test('a synonym may carry one space, because the UI says "Pull Request"', () => {
  const v = validate({ nouns: [{ canonical: 'pullrequest', synonyms: ['pull request', 'PR', 'a request to pull a branch into another branch'] }] })
  assert.deepEqual(v.nouns[0].synonyms, ['pull request', 'pr'])
})

test('deduplicates identical terms', () => {
  const v = validate({ nouns: [
    { canonical: 'issue', synonyms: [] },
    { canonical: 'Issue', synonyms: [] },
    { canonical: 'issue', synonyms: ['ticket'] },
  ] })
  assert.deepEqual(nouns(v), ['issue'])
})

test('caps the list, so one bad answer cannot flood the table', () => {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz'.split('')
  const many = alphabet.map((c) => ({ canonical: `noun${c}`, synonyms: [] }))
  assert.equal(new Set(many.map((n) => n.canonical)).size, 26, 'the fixture really is 26 distinct nouns')
  assert.equal(validate({ nouns: many }).nouns.length, 12)
  assert.equal(validate({ offSlice: alphabet.concat(alphabet.map((c) => c + c)) }).offSlice.length, 20)
})

test('garbage in, empty out - never a throw', () => {
  for (const bad of [null, undefined, {}, { nouns: null }, { nouns: 'issue' }, { nouns: [null, 3, 'x'] }]) {
    const v = validate(bad)
    assert.deepEqual(v.nouns, [])
    assert.deepEqual(v.offSlice, [])
  }
})

test('learned nouns extend the table without displacing the built-ins', async () => {
  const plan = await import(`../src/plan.js?case=extend`)
  assert.equal(plan.gesture('New Issue'), null, 'unknown noun before grounding')

  const r = plan.learnVocabulary({
    nouns: [{ canonical: 'issue', synonyms: ['ticket'] }, { canonical: 'task', synonyms: [] }],
    offSlice: ['star', 'fork'],
  })
  assert.deepEqual(r.added, ['issue'], 'task is already built in and must not be added twice')
  assert.deepEqual(plan.gesture('New Issue'), { verb: 'create', noun: 'issue', label: 'create issue' })
  assert.deepEqual(plan.gesture('Create a ticket'), { verb: 'create', noun: 'issue', label: 'create issue' }, 'synonym maps to the canonical')
  assert.equal(plan.gesture('Star this repo'), null, 'learned off-slice term suppresses the control')
  assert.deepEqual(plan.gesture('NEW PROJECT'), { verb: 'create', noun: 'project', label: 'create project' }, 'Vikunja must be untouched')
})

test('an off-slice term that collides with a noun is refused', async () => {
  const plan = await import(`../src/plan.js?case=collide`)
  // Gitea's docs really do list "label" as a non-core control. Honouring that
  // would delete createLabel, a tool that works.
  const r = plan.learnVocabulary({ nouns: [{ canonical: 'issue', synonyms: [] }], offSlice: ['label', 'fork'] })
  assert.equal(r.refused, 1)
  assert.deepEqual(plan.gesture('NEW LABEL'), { verb: 'create', noun: 'label', label: 'create label' })
})
