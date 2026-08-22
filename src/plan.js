/**
 * plan.js - choose the next action.
 *
 * Two planners behind one interface:
 *   heuristic  - keyless, rule-based. Runs today, and is ladder rung 3.
 *   model      - OpenAI vision/text over the page snapshot. Swaps in unchanged.
 *
 * The heuristic planner encodes what a human knows about web apps: create
 * actions live behind "new/add/+", forms want plausible values, and destructive
 * verbs are explored last.
 */

const CREATE = /^(new|add|create|\+)\b|^\+$/i
const DESTRUCTIVE = /delete|remove|archive|trash/i
const SUBMIT = /^(create|save|add|submit|done|confirm)\b/i

/** Rank affordances by how likely they are to reveal a write action. */
export function rank(affordances) {
  return [...affordances].sort((a, b) => score(b.label) - score(a.label))
}

function score(label) {
  if (CREATE.test(label)) return 100
  if (SUBMIT.test(label)) return 80
  if (DESTRUCTIVE.test(label)) return 10 // real, but explore last
  if (/edit|rename|move|assign|label/i.test(label)) return 60
  return 30
}

/** Plausible value for a form field, from its label/placeholder/type. */
export function fieldValue(field) {
  const hint = `${field.label} ${field.placeholder} ${field.name}`.toLowerCase()
  if (/title|name|task|project|label/.test(hint)) return `apic probe ${Date.now() % 100000}`
  if (/desc|note|comment|body/.test(hint)) return 'created by apic during exploration'
  if (/email/.test(hint)) return 'apic@local.test'
  if (/date|due/.test(hint)) return new Date(Date.now() + 864e5).toISOString().slice(0, 10)
  if (/number|count|priority|position/.test(hint)) return '1'
  return 'apic'
}

export function isDestructive(label) { return DESTRUCTIVE.test(label) }
export function isCreate(label) { return CREATE.test(label) }
