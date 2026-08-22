/**
 * perceive.js - did anything meaningful change?
 *
 * Two backends. The DOM differ is deterministic, free and needs no keys; it
 * answers "did something change". fal's VLM answers "is the change meaningful"
 * and is a refinement layered on top, not a prerequisite.
 */

/** Structural fingerprint of the page: roles + accessible names, order preserved. */
export async function snapshot(page) {
  return page.evaluate(() => {
    const out = []
    for (const el of document.querySelectorAll('button, a, input, textarea, select, [role], h1, h2, h3, li, td')) {
      const r = el.getBoundingClientRect()
      if (!r.width || !r.height) continue
      const label = (el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.innerText || el.value || '').trim().slice(0, 60)
      if (!label) continue
      out.push(`${el.tagName.toLowerCase()}|${el.getAttribute('role') || ''}|${label}`)
    }
    return { items: out, url: location.pathname + location.search, title: document.title }
  })
}

/**
 * Apps announce their own write outcomes. A toast saying "successfully created"
 * is far stronger evidence than counting DOM nodes, and it survives navigation
 * - which counting does not.
 */
const SUCCESS = /\b(success|successfully|created|saved|added|updated|deleted|removed|opened|complete|completed|confirmed|transferred|submitted)\b/i
const OUTCOME_VERB = [
  [/\b(created|added)\b/i, 'creation'],
  [/\b(deleted|removed)\b/i, 'deletion'],
  [/\b(updated|saved|edited|moved)\b/i, 'mutation'],
]

function announced(added) {
  for (const item of added) {
    const [tag, role, label] = item.split('|')
    // Must be an announcement region. Otherwise a button labelled
    // "NEW SAVED FILTER" reads as a save that happened.
    // Modern apps announce in a role="status" region. Apps written before ARIA
    // announce by replacing the page heading - ParaBank's success page is an
    // <h1> reading "Account Opened!". Requiring a role makes every legacy app
    // look silent, and legacy apps are the target market.
    const isBanner = /status|alert/.test(role || '') || /toast|notification/i.test(tag)
    const isHeadline = /^h[1-3]$/.test(tag || '')
    if (!(isBanner || isHeadline) || !SUCCESS.test(label || '')) continue
    const hit = OUTCOME_VERB.find(([re]) => re.test(label))
    return { text: label.replace(/\n/g, ' ').trim().slice(0, 80), kind: hit ? hit[1] : 'mutation', via: 'banner' }
  }
  return null
}

/**
 * Echo: the value we submitted is now on the page.
 *
 * Stronger and more general than a toast - not every app announces a write,
 * but every app that stored your input shows it back. Together the two cover
 * announce-and-stay (labels), announce-and-navigate (projects) and
 * silent-append (kanban quick-add).
 */
export function echoed(added, value) {
  if (!value || String(value).length < 4) return null
  const needle = String(value).toLowerCase()
  // The field we typed into echoes trivially. Only rendered content counts:
  // seeing the value in a list item or link means the app STORED it.
  const hit = added.find((i) => !/^(input|textarea|select)\|/.test(i) && i.toLowerCase().includes(needle))
  // `via: echo` matters downstream: the value being on screen proves a write
  // happened, but not what kind. That is the ambiguity the vision tier resolves.
  return hit ? { text: hit.split('|').pop().slice(0, 80), kind: 'creation', via: 'echo' } : null
}

/** Compare two snapshots. Deterministic; no API key. */
export function diff(before, after, submittedValue) {
  const b = new Set(before.items), a = new Set(after.items)
  const added = [...a].filter((x) => !b.has(x))
  const removed = [...b].filter((x) => !a.has(x))
  const navigated = before.url !== after.url
  const banner = announced(added) || echoed(added, submittedValue)
  return {
    changed: added.length > 0 || removed.length > 0 || navigated,
    navigated,
    added, removed,
    from: before.url, to: after.url,
    announced: banner,
    // The app's own success message wins. Node counting is the fallback, and
    // it cannot see through a navigation.
    kind: banner ? banner.kind
      : navigated ? 'navigation'
      : added.length > removed.length ? 'creation'
      : removed.length > added.length ? 'deletion' : 'mutation',
  }
}

/** Human-readable one-liner for the trajectory log. */
export function describe(d) {
  if (!d.changed) return 'no change'
  if (d.announced) return `${d.kind} - confirmed: "${d.announced.text}"`
  if (d.navigated) return `navigated ${d.from} -> ${d.to}`
  const parts = []
  if (d.added.length) parts.push(`+${d.added.length}`)
  if (d.removed.length) parts.push(`-${d.removed.length}`)
  return `${d.kind} (${parts.join(' ')}) e.g. ${(d.added[0] || d.removed[0] || '').slice(0, 50)}`
}

/**
 * ---------------------------------------------------------------------------
 * The vision tier - fal.
 *
 * The DOM differ says *whether* something changed. Pioneer's encoder says what
 * kind, from the diff text. Neither can settle a change the text does not
 * describe: a card that moved column, a row that reordered, a control that
 * merely lit up. distill.js flags those cases rather than guessing, and this is
 * the tier they escalate to - pixels, once, only for the steps text could not
 * decide.
 *
 * That ordering is the whole economy of it. A VLM on every step would be slow
 * and mostly wasted, because most steps announce themselves: when the app says
 * "The task was deleted successfully", the text IS the evidence and a
 * screenshot adds nothing. Escalation runs on the remainder.
 *
 * Degrades like every other stage: no key, no frames, or a dead endpoint leaves
 * the existing classification untouched. A blind judge must not fail a compile.
 * ---------------------------------------------------------------------------
 */
import { fal } from '@fal-ai/client'
import { config, hasKey } from './config.js'

const VISION_MODEL = process.env.FAL_VISION_MODEL || 'google/gemini-2.5-flash-lite'
const VISION_TIMEOUT_MS = Number(process.env.FAL_TIMEOUT_MS || 25000)

export function visionAvailable() { return hasKey('fal') }

/**
 * A frame small enough to send by value. JPEG at q55 lands around 30-50KB for a
 * 1440x900 viewport, which fal accepts inline as a data URI - so a judgement
 * costs one request, not an upload plus a request.
 */
export async function shot(page) {
  try {
    const buf = await page.screenshot({ type: 'jpeg', quality: 55 })
    return `data:image/jpeg;base64,${buf.toString('base64')}`
  } catch { return null }
}

/**
 * Which steps the text could not settle.
 *
 * An announcement is the app asserting its own outcome - authoritative, and
 * cheaper than pixels. Anything else reached its `kind` by counting nodes, and
 * counting is the softest inference in the compiler.
 */
export function needsVision(action) {
  if (action?.perception?.escalate) return true
  // A toast is the app naming its own outcome - authoritative, no pixels needed.
  // An echo only proves the value landed somewhere; it always reports "creation"
  // because that is all it can infer, which is exactly the guess worth checking.
  if (['banner', 'reload'].includes(action?.evidence?.announced?.via)) return false
  return true
}

const SYSTEM = 'You judge before/after screenshots of a web app. Reply with strict JSON and nothing else.'

const promptFor = (action) => [
  `An agent performed: "${action.label}".`,
  'Image 1 is BEFORE, image 2 is AFTER.',
  'Did the underlying application state actually change, or is the difference cosmetic (hover, focus, a menu opening) or merely navigational?',
  'Reply JSON: {"kind":"creation|deletion|mutation|navigation|cosmetic","meaningful":true|false,"reason":"under 12 words"}',
].join(' ')

function parseVerdict(raw) {
  if (!raw) return null
  const m = String(raw).match(/\{[\s\S]*\}/)
  if (!m) return null
  try {
    const v = JSON.parse(m[0])
    if (!KINDS.includes(v.kind)) return null
    return { kind: v.kind, meaningful: v.meaningful !== false, reason: String(v.reason || '').slice(0, 80) }
  } catch { return null }
}

/** Vocabulary shared with distill.js, plus the one the DOM differ cannot express. */
export const KINDS = ['creation', 'deletion', 'mutation', 'navigation', 'cosmetic']

/** One judgement. Returns null on any failure - the caller keeps what it had. */
export async function judge(action) {
  const { before, after } = action.frames || {}
  if (!before || !after) return null
  try {
    const res = await Promise.race([
      fal.subscribe('fal-ai/any-llm/vision', {
        input: {
          model: VISION_MODEL,
          system_prompt: SYSTEM,
          prompt: promptFor(action),
          image_urls: [before, after],
          max_tokens: 200,
        },
      }),
      new Promise((_, rej) => setTimeout(() => rej(new Error('fal timeout')), VISION_TIMEOUT_MS)),
    ])
    return parseVerdict(res?.data?.output)
  } catch { return null }
}

/**
 * Escalate the unsettled steps. Mutates `action.perception` in place and returns
 * stats for the compile log.
 */
export async function adjudicate(actions, { log } = {}) {
  const stats = { source: 'none', considered: 0, judged: 0, overruled: 0, corroborated: 0, cosmetic: 0 }
  if (!visionAvailable()) { log?.('no FAL_KEY - vision tier idle, text classification stands'); return stats }

  fal.config({ credentials: config.keys.fal })
  const cases = actions.filter((a) => needsVision(a) && a.frames?.before && a.frames?.after)
  stats.considered = cases.length
  if (!cases.length) { stats.source = 'fal'; return stats }

  const verdicts = await Promise.all(cases.map((a) => judge(a)))
  for (const [i, v] of verdicts.entries()) {
    if (!v) continue
    const a = cases[i]
    stats.judged++
    if (!v.meaningful || v.kind === 'cosmetic') stats.cosmetic++
    // A drag carries its own structural proof: kanban.js watched a card leave one
    // column and arrive in another, and replay.js re-checks exactly that. Its
    // `relocation` is more precise than any of the five kinds here, so the
    // verdict corroborates it rather than flattening it to `mutation`.
    if (a.drag) {
      stats.corroborated++
    } else {
      if (v.kind !== a.effect) stats.overruled++
      a.effect = v.kind
    }
    a.perception = { ...(a.perception || {}), kind: v.kind, meaningful: v.meaningful, reason: v.reason, source: 'fal', escalate: false }
  }
  stats.source = stats.judged ? 'fal' : 'none'
  return stats
}

export function summariseVision(s) {
  if (s.source !== 'fal') return 'vision: idle (text classification stands)'
  const bits = [`${s.judged}/${s.considered} escalated steps judged by fal`]
  if (s.overruled) bits.push(`${s.overruled} reclassified`)
  if (s.corroborated) bits.push(`${s.corroborated} drag corroborated`)
  if (s.cosmetic) bits.push(`${s.cosmetic} found cosmetic`)
  return `vision: ${bits.join(', ')}`
}
