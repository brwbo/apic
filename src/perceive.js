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
const SUCCESS = /\b(success|successfully|created|saved|added|updated|deleted|removed)\b/i
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
    const isBanner = /status|alert/.test(role || '') || /toast|notification/i.test(tag)
    if (!isBanner || !SUCCESS.test(label || '')) continue
    const hit = OUTCOME_VERB.find(([re]) => re.test(label))
    return { text: label.replace(/\n/g, ' ').trim().slice(0, 80), kind: hit ? hit[1] : 'mutation' }
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
  return hit ? { text: hit.split('|').pop().slice(0, 80), kind: 'creation' } : null
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
