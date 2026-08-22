import test from 'node:test'
import assert from 'node:assert/strict'
import { dateRange } from '../src/replay-read.js'
import { relatedToQuery } from '../src/discover-read.js'

test('dateRange accepts an ordered ISO stay range', () => {
  const range = dateRange('2026-09-10', '2026-09-12')
  assert.equal(range.start.toISOString().slice(0, 10), '2026-09-10')
  assert.equal(range.end.toISOString().slice(0, 10), '2026-09-12')
})

test('dateRange refuses ambiguous, reversed and same-day ranges', () => {
  assert.equal(dateRange('10/09/2026', '12/09/2026'), null)
  assert.equal(dateRange('2026-09-12', '2026-09-10'), null)
  assert.equal(dateRange('2026-09-10', '2026-09-10'), null)
})

test('a changed collection must echo an ordinary text query', () => {
  assert.equal(relatedToQuery({ rows: ['Room in Greater London'] }, 'London'), true)
  assert.equal(relatedToQuery({ rows: ['Room in Paris', 'Flat in Edinburgh'] }, 'London'), false)
  assert.equal(relatedToQuery({ rows: ['Pizza Union'] }, 'EC2A 3AY'), true)
})
