/**
 * replay.js - execute a compiled tool against the live app.
 * Deterministic: no model in the loop. This is the whole point.
 */
import { snapshot, diff } from './perceive.js'
import { submitButton } from './forms.js'
import { board, drag, relocated } from './kanban.js'
import { openSession, ensure, closeSession } from './session.js'

/**
 * Pass an existing `session` to reuse one browser and one login across many
 * tools - what watch.js should do. Omit it and this opens and closes its own.
 */
export async function replay(tool, args, { headless = true, session = null } = {}) {
  const own = !session
  const s = session ?? (await openSession({ headless }))
  const { page } = s
  try {
    if (!s.authed) await ensure(s)
    await page.goto(tool.recipe.seedUrl, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(tool.recipe.drag ? 2200 : 500)

    if (tool.recipe.drag) {
      const { columnSelector, cardSelector } = tool.recipe.drag
      const b4 = await board(page, columnSelector)
      const wanted = String(args.card || '')
      let fromIdx = b4.findIndex((c) => c.cards.some((t) => t.includes(wanted)))
      if (fromIdx < 0) fromIdx = b4.findIndex((c) => c.cards.length)
      const toIdx = args.column
        ? b4.findIndex((c) => c.title.toLowerCase().includes(String(args.column).toLowerCase()))
        : b4.findIndex((_, i) => i !== fromIdx)
      if (fromIdx < 0 || toIdx < 0) return { ok: false, error: 'column or card not found' }

      const cardLoc = wanted
        ? page.locator(columnSelector).nth(fromIdx).locator(cardSelector).filter({ hasText: wanted }).first()
        : page.locator(columnSelector).nth(fromIdx).locator(cardSelector).first()
      await drag(page, cardLoc, page.locator(columnSelector).nth(toIdx))
      const moved = relocated(b4, await board(page, columnSelector))
      return moved
        ? { ok: true, effect: 'relocation', moved: `"${moved.card}" ${moved.from} -> ${moved.to}` }
        : { ok: false, effect: 'none', expected: 'relocation' }
    }

    const before = await snapshot(page)

    await page.locator('button:visible, a[href]:visible, [role="button"]:visible')
      .filter({ hasText: tool.recipe.click }).first().click({ timeout: 4000 })
    await page.waitForTimeout(700)

    const unfilled = []
    for (const f of tool.recipe.fields) {
      const v = args[f.schemaKey]
      if (v === undefined) continue
      if (!(await fillField(page, f, String(v)))) unfilled.push(f.schemaKey)
    }

    if (tool.recipe.submit) {
      const btn = await submitButton(page)
      if (btn) { await btn.handle.click({ timeout: 3000 }).catch(() => {}); await page.waitForTimeout(1200) }
    }

    const d = diff(before, await snapshot(page))
    // A tool that submitted without setting its arguments has not done its job,
    // however much the page changed. That is the failure mode that looks like success.
    return {
      ok: d.changed && d.kind === tool.recipe.expect && unfilled.length === 0,
      effect: d.kind, expected: tool.recipe.expect, unfilled,
      added: d.added.slice(0, 3),
    }
  } finally { if (own) await closeSession(s) }
}

/**
 * Ordered locator candidates: what was recorded at compile time, then semantic
 * fallbacks derived from the field itself. Absorbing small UI drift here is far
 * cheaper than escalating to a re-exploration in heal.js.
 */
function locators(f) {
  const out = [f.selector, ...(f.selectors || [])]
  if (f.name) out.push(`[name="${f.name}"]`)
  if (f.placeholder) out.push(`[placeholder="${f.placeholder}"]`)
  return [...new Set(out.filter(Boolean))]
}

/** Fill a compiled field, trying each locator in turn. Returns the one that worked. */
async function fillField(page, f, value) {
  for (const sel of locators(f)) {
    try { await page.fill(sel, value, { timeout: 1500 }); return sel } catch { /* try the next */ }
  }
  if (f.label) {
    try {
      await page.getByLabel(f.label, { exact: false }).first().fill(value, { timeout: 1500 })
      return `label=${f.label}`
    } catch { /* exhausted */ }
  }
  return null
}
