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

    for (const f of tool.recipe.fields) {
      if (!f.selector) continue
      const v = args[f.schemaKey]
      if (v !== undefined) await page.fill(f.selector, String(v), { timeout: 2000 }).catch(() => {})
    }

    if (tool.recipe.submit) {
      const btn = await submitButton(page)
      if (btn) { await btn.handle.click({ timeout: 3000 }).catch(() => {}); await page.waitForTimeout(1200) }
    }

    const d = diff(before, await snapshot(page))
    return { ok: d.changed && d.kind === tool.recipe.expect, effect: d.kind, expected: tool.recipe.expect, added: d.added.slice(0, 3) }
  } finally { await browser.close() }
}
