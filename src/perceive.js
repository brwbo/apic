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

/** Compare two snapshots. Deterministic; no API key. */
export function diff(before, after) {
  const b = new Set(before.items), a = new Set(after.items)
  const added = [...a].filter((x) => !b.has(x))
  const removed = [...b].filter((x) => !a.has(x))
  const navigated = before.url !== after.url
  return {
    changed: added.length > 0 || removed.length > 0 || navigated,
    navigated,
    added, removed,
    from: before.url, to: after.url,
    // A crude but useful signal: creation adds rows, deletion removes them.
    kind: navigated ? 'navigation' : added.length > removed.length ? 'creation' : removed.length > added.length ? 'deletion' : 'mutation',
  }
}

/** Human-readable one-liner for the trajectory log. */
export function describe(d) {
  if (!d.changed) return 'no change'
  if (d.navigated) return `navigated ${d.from} -> ${d.to}`
  const parts = []
  if (d.added.length) parts.push(`+${d.added.length}`)
  if (d.removed.length) parts.push(`-${d.removed.length}`)
  return `${d.kind} (${parts.join(' ')}) e.g. ${(d.added[0] || d.removed[0] || '').slice(0, 50)}`
}
