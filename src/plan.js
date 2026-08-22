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

import * as h from './h.js'

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
  // Probe-marked, like the title branch above. persist.js proves a write by
  // reloading and looking for what we typed, and a bare "apic" is the username,
  // the project prefix and half the page - it matches everywhere and proves
  // nothing. Every value apic submits has to be unique to this run.
  return `apic probe ${Date.now() % 100000}`
}

export function isDestructive(label) { return DESTRUCTIVE.test(label) }
export function isCreate(label) { return CREATE.test(label) }

/**
 * Choose the next label to try: h's Holo model when a key is present, the
 * heuristic ranking otherwise. This is the seam the module header describes -
 * one interface, two planners - and it degrades rather than fails, so losing h
 * at the venue costs action quality, not the compile.
 *
 * Returns { label, why, planner } or null when nothing is left to try.
 */
export async function nextLabel(page, { candidates, tried = [], goal = 'Discover the write actions this app exposes.' }) {
  const remaining = candidates.filter((c) => !tried.includes(c))
  if (!remaining.length) return null

  if (h.available()) {
    const choice = await h.nextAction(page, { goal, candidates, tried })
    if (choice?.error) console.warn(`    h unavailable (${choice.error}) - using the heuristic planner`)
    else if (choice?.done) return null
    else if (choice?.label) return { label: choice.label, why: choice.why, planner: 'h' }
  }

  return { label: rank(remaining.map((label) => ({ label })))[0].label, why: 'highest heuristic score', planner: 'heuristic' }
}

/**
 * ---------------------------------------------------------------------------
 * The board gesture model.
 *
 * apic knows what a Kanban board *is* - projects hold tasks, tasks carry labels,
 * tasks sit in buckets - but nothing about how this app renders one. `gesture()`
 * turns a control's visible text plus the page it was found on into a canonical
 * <verb, resource> pair, and returns null for anything that is not a board write.
 *
 * That null is the precision gate. Before it existed every sidebar link and
 * every project a previous probe had created came back as a candidate, picked up
 * the unknown-verb fallback name, and shipped as `doPoweredByVikunja`. A control
 * that maps to no board gesture is not an action.
 *
 * The canonical phrase becomes the action's label, so the emitted tool is
 * `markTask`, not `markTaskDone`. The raw UI string is kept on the action as
 * `control` and travels into the evidence, so replay still knows what to click
 * and a human reviewing the tool can still see where it came from.
 * ---------------------------------------------------------------------------
 */

/** Board resources, longest-specific first. */
const RESOURCE = [
  [/\bbuckets?\b|\bcolumns?\b/i, 'bucket'],
  [/\btasks?\b|\bcards?\b/i, 'task'],
  [/\blabels?\b|\btags?\b/i, 'label'],
  [/\bprojects?\b|\bboards?\b/i, 'project'],
]

/** Verbs that name a write. Anchored: "add relation" is a verb phrase, "readd" is not. */
const GESTURE_VERB = [
  [/^(new|add|create)\b|^\+$/i, 'create'],
  [/^(rename|edit|update|change)\b/i, 'update'],
  [/^(delete|remove|trash)\b/i, 'delete'],
  [/^(move|drag|drop)\b/i, 'move'],
  [/^(assign)\b/i, 'assign'],
  [/^(mark|toggle|complete)\b/i, 'mark'],
]

/**
 * Off-slice: real controls that write real state, but not board gestures. Named
 * explicitly rather than left to fall through, because "ADD TO FAVORITES" parses
 * as a perfectly good create and would otherwise be emitted as `createTask`.
 */
let OFF_SLICE = /favou?rit|subscrib|duplicat|relation|attachment|reaction|priorit|progress|colou?r|remind|repeat|\bdate\b|filter|\bsort\b|comment|assignee|\buser\b|share|team|\bview\b|import|export|password|token|migrat/i

/**
 * Extend the vocabulary with nouns discovered from the target app's own docs.
 *
 * RESOURCE above is Vikunja's words. Point apic at Gitea and it is asked about
 * issues, repositories and milestones by a table that has never heard of them,
 * so `gesture()` returns null and the control is dropped. ground.js reads the
 * target's documentation and calls this with what it found.
 *
 * ADDITIVE ONLY, deliberately. The built-in table is tuned against a real
 * compile; a bad noun from a model that silently replaced it would cost more
 * than an ungrounded compile ever could. Learned entries are APPENDED, so a
 * built-in always matches first, and a learned off-slice word colliding with a
 * known noun is refused outright - that single mistake would delete a working
 * tool rather than merely fail to find one.
 *
 * Returns what was actually taken, not what was offered.
 */
export function learnVocabulary(vocab) {
  const escape = (w) => String(w).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const known = () => new Set(RESOURCE.map(([, n]) => n))
  const added = []

  for (const { canonical, synonyms = [] } of vocab?.nouns || []) {
    if (known().has(canonical)) continue
    const words = [canonical, ...synonyms].map(escape)
    RESOURCE.push([new RegExp(`\\b(${words.join('|')})s?\\b`, 'i'), canonical])
    added.push(canonical)
  }

  const nouns = known()
  const offered = vocab?.offSlice || []
  const off = offered.filter((w) => !nouns.has(w))
  if (off.length) OFF_SLICE = new RegExp(`${OFF_SLICE.source}|${off.map(escape).join('|')}`, 'i')

  return { added, offSlice: off.length, refused: offered.length - off.length }
}

/** The nouns this compiler currently understands - built-in plus anything learned. */
export function vocabulary() { return RESOURCE.map(([, n]) => n) }

/** Which board resource a piece of text is about, if any. */
export function resourceOf(text) {
  const hit = RESOURCE.find(([re]) => re.test(String(text || '')))
  return hit ? hit[1] : null
}

/** Which resource a seed URL is about, so a bare "DELETE" knows what it deletes. */
export function scopeOf(url = '') {
  if (/\/tasks\/\d+/.test(url)) return 'task'
  if (/\/projects\/\d+/.test(url)) return 'project'
  if (/\/labels\b/.test(url)) return 'label'
  if (/\/projects\b/.test(url)) return 'project'
  return null
}

/**
 * Map a control to a board gesture, or null.
 * Returns { verb, noun, label } where `label` is the canonical phrase.
 */
export function gesture(text, { scope = null } = {}) {
  const s = String(text || '').trim()
  if (!s || OFF_SLICE.test(s)) return null

  const vhit = GESTURE_VERB.find(([re]) => re.test(s))
  if (!vhit) return null
  let verb = vhit[1]

  const rhit = RESOURCE.find(([re]) => re.test(s))
  let noun = rhit ? rhit[1] : scope
  if (!noun) return null

  // A bucket is a column on the board, not a resource this slice creates.
  // The only board gesture involving one is putting a task into it.
  if (noun === 'bucket') {
    if (verb !== 'move') return null
    noun = scope === 'task' ? 'task' : null
    if (!noun) return null
  }

  // "ADD LABELS" on a project page creates a label; on a task page it attaches
  // one to that task. Same words, different write - the page decides.
  if (verb === 'create' && noun === 'label' && scope === 'task') verb = 'assign'

  return { verb, noun, label: `${verb} ${noun}` }
}
