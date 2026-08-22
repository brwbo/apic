/**
 * discover.js - goal-directed exploration.
 *
 * Walks a seed page, ranks affordances so create actions go first, opens each
 * one, fills whatever form appears, submits, and records the state change.
 * The result is a candidate action: label + parameters + observed effect.
 */
import { snapshot, diff, describe } from './perceive.js'
import { fields, fill, submitButton } from './forms.js'
import { rank, isDestructive } from './plan.js'
import { affordances } from './explore.js'

export async function discoverOn(page, seedUrl, { skipDestructive = true, onStep } = {}) {
  const found = []
  await page.goto(seedUrl, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(600)

  const candidates = rank(await affordances(page))
  for (const { label } of candidates) {
    if (skipDestructive && isDestructive(label)) continue

    await page.goto(seedUrl, { waitUntil: 'domcontentloaded' }).catch(() => {})
    await page.waitForTimeout(500)
    const before = await snapshot(page)

    const opened = await open(page, label)
    if (!opened) continue

    const discovered = await fields(page)
    const used = discovered.length ? await fill(page, discovered) : []

    let committed = false
    if (used.length) {
      const btn = await submitButton(page)
      if (btn) { await btn.handle.click({ timeout: 3000 }).catch(() => {}); committed = true; await page.waitForTimeout(1200) }
    }

    const after = await snapshot(page)
    const d = diff(before, after)
    const step = {
      label,
      parameters: used.map(({ name, label: l, placeholder, type, required, value, selector }) => ({ name, label: l, placeholder, type, required, example: value, selector })),
      effect: d.kind,
      changed: d.changed,
      committed,
      evidence: { added: d.added.slice(0, 3), removed: d.removed.slice(0, 3), from: d.from, to: d.to, announced: d.announced },
      seedUrl,
    }
    if (d.changed) found.push(step)
    onStep?.(step, d)
  }
  return found
}

/** Click an affordance and wait for whatever it opens. */
async function open(page, label) {
  const el = page.locator('button:visible, a[href]:visible, [role="button"]:visible').filter({ hasText: label }).first()
  try {
    await el.click({ timeout: 3500 })
    await page.waitForTimeout(800)
    return true
  } catch { return false }
}

export { describe }
