/**
 * persist.js - did the write survive?
 *
 * synthesize.js admits a tool when the app confirmed a write, and perceive.js
 * counts two kinds of confirmation: a success banner, and an echo - the value
 * we submitted coming back as rendered content. The echo is the more general
 * signal and it is what finds the kanban quick-add, but it cannot tell storing
 * from displaying. Vikunja's filter panel renders your query back at you, so
 * typing into it looks exactly like a write and compiles into a tool that
 * writes nothing.
 *
 * Reloading settles it. A created task, project or label is still there; a
 * filter query is not. That is the whole difference between the app storing
 * your input and the app showing it to you, and it needs no key, no model and
 * no app-specific rule - which is why it belongs here rather than in a
 * blocklist that grows one entry per app.
 *
 * Costs one page load per candidate, and only candidates synthesize would
 * actually admit are checked.
 *
 * THIS NAVIGATES THE PAGE IT IS GIVEN. A sibling tab would be tidier, but
 * explore.js opens the browser with `browser.newPage()`, and the implicit
 * context that creates refuses `context.newPage()` - it throws "Please use
 * browser.newContext()", which this module swallowed as an inconclusive
 * verdict on every single candidate. So: call this BETWEEN discovery batches,
 * never inside one. Discovery re-seeds with `page.goto` at the top of every
 * iteration, so a batch boundary is safe and mid-loop is not.
 */
/**
 * innerText is deliberate: it excludes input `value` attributes, so a field
 * that merely still holds what we typed does not count as the app having kept
 * it. Only rendered content does.
 */
export function containsValue(text, value) {
  if (!isDistinctive(value)) return null
  return String(text).toLowerCase().includes(String(value).trim().toLowerCase())
}

/**
 * A needle that could plausibly occur on the page anyway settles nothing. Every
 * value plan.js submits carries a per-run number for exactly this reason, so
 * requiring one costs nothing and closes the false-positive door: "apic" is the
 * username and matches every page in the app, "apic probe 11237" matches only
 * a page the app stored it on.
 */
export function isDistinctive(value) {
  const v = String(value ?? '').trim()
  return v.length >= 6 && /\d/.test(v)
}

/** The value this action submitted - the needle we look for after a reload. */
export function submittedValue(action) {
  return action.parameters?.map((p) => p.example).find(isDistinctive) || null
}

/**
 * An echo is the only confirmation this stage can judge.
 *
 * perceive.js confirms a write two ways. A banner - "Success The task was
 * moved" - is the app asserting in its own words that it did something, and no
 * reload is needed or wanted: the value we submitted to a move or an assign is
 * a search string or a card handle, never stored content, so looking for it
 * afterwards rejects four real writes to catch one fake one. An echo is the
 * weaker claim, and the only one worth re-testing.
 *
 * Detected from the evidence rather than tagged in perceive.js: an echo's
 * announcement text IS the value coming back, so it contains it; a banner's
 * does not.
 */
export function isEchoConfirmation(action) {
  const text = action.evidence?.announced?.text
  const value = submittedValue(action)
  if (!text || !value) return false
  return String(text).toLowerCase().includes(String(value).toLowerCase())
}

/** Only an echo-confirmed candidate that synthesize would admit earns a page load. */
function worthChecking(action) {
  return Boolean(action.committed && action.evidence?.announced && submittedValue(action) && isEchoConfirmation(action))
}

/**
 * A batch that deletes something cannot be re-checked afterwards.
 *
 * `discoverTask` renames a task, moves it, labels it, then deletes it. Every
 * one of those is a real write, and every one of them is unfindable a moment
 * later because the row they acted on no longer exists. Re-checking that batch
 * rejects four working tools to catch nothing. Discovery verifies those in
 * step, at the only moment the evidence exists; this stage stays out.
 */
export function unstable(batch) {
  return batch.some((a) => a.effect === 'deletion' || a.destructive)
}

export async function checkPersistence(page, actions, { baseUrl, onStep } = {}) {
  const stats = { checked: 0, persisted: 0, vanished: 0, unknown: 0 }

  if (unstable(actions)) {
    for (const a of actions) a.persisted = null
    stats.skipped = 'batch contains a deletion - its own state is gone by now'
    return stats
  }

  for (const action of actions) {
    if (!worthChecking(action)) { action.persisted = null; continue }

    const value = submittedValue(action)
    const path = action.evidence.to || action.seedUrl || '/'
    const url = /^https?:/.test(path) ? path : `${baseUrl}${path}`

    let verdict = null
    try {
      const res = await page.goto(url, { waitUntil: 'domcontentloaded' })
      await page.waitForLoadState('networkidle').catch(() => {})
      await page.waitForTimeout(600)
      const text = await page.evaluate(() => document.body.innerText || '')
      verdict = gone(res?.status(), text) ? null : containsValue(text, value)
    } catch {
      // A probe that fails proves nothing either way. Never reject a tool on
      // the strength of a page that would not load.
      verdict = null
    }

    stats.checked++
    action.persisted = verdict
    action.persistence = { url, value, checkedAt: new Date().toISOString() }
    if (verdict === true) stats.persisted++
    else if (verdict === false) stats.vanished++
    else stats.unknown++
    onStep?.(action, verdict)
  }
  return stats
}

/**
 * The record itself is gone, so its absence says nothing about whether the
 * write happened.
 *
 * This is the difference between the two ways a value can fail to come back.
 * A filter query never existed - the page it should be on is right there and
 * does not contain it, and that is a rejection. A renamed task that a later
 * `delete task` removed is a real write whose page has since been destroyed,
 * and rejecting it would delete a working tool to catch a fake one. Anything
 * ambiguous resolves to inconclusive, which never rejects.
 */
const MISSING = /\b(not found|doesn'?t exist|does not exist|no longer exists|404)\b/i

export function gone(status, text) {
  if (typeof status === 'number' && status >= 400) return true
  return MISSING.test(String(text).slice(0, 400))
}

export function summarise(s) {
  if (s.skipped) return `persistence: skipped - ${s.skipped}`
  if (!s.checked) return 'persistence: nothing confirmed to re-check'
  const bits = [`${s.persisted}/${s.checked} survived a reload`]
  if (s.vanished) bits.push(`\x1b[31m${s.vanished} vanished\x1b[0m`)
  if (s.unknown) bits.push(`${s.unknown} inconclusive`)
  return `persistence: ${bits.join(', ')}`
}
