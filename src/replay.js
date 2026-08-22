/**
 * replay.js - execute a compiled tool against the live app.
 * Deterministic: no model in the loop. This is the whole point.
 */
import { launch, login } from './explore.js'
import { snapshot, diff } from './perceive.js'
import { submitButton } from './forms.js'

export async function replay(tool, args, { headless = true } = {}) {
  const { browser, page } = await launch({ headless })
  try {
    await login(page)
    await page.goto(tool.recipe.seedUrl, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(500)
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
  } finally { await browser.close() }
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
