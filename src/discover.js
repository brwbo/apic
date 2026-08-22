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

/**
 * Inline actions: fields already on the page with no button to open them.
 * Kanban quick-add is the canonical case - type a title, press Enter or hit
 * ADD, and a card appears. Button-first probing never finds these because
 * there is nothing to click first.
 */
export async function discoverInline(page, seedUrl, { onStep } = {}) {
  await page.goto(seedUrl, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(900)

  const present = await fields(page)
  const found = []
  for (const f of present) {
    await page.goto(seedUrl, { waitUntil: 'domcontentloaded' }).catch(() => {})
    await page.waitForTimeout(700)
    const before = await snapshot(page)

    // re-read: generated ids change per load, so the recorded chain must be fresh
    const live = (await fields(page)).find((x) => x.label === f.label || x.placeholder === f.placeholder)
    if (!live) continue
    const [used] = await fill(page, [live])
    if (!used) continue

    const btn = await submitButton(page)
    if (btn) await btn.handle.click({ timeout: 3000 }).catch(() => {})
    else await page.locator(live.selector).press('Enter').catch(() => {})
    await page.waitForTimeout(1400)

    const d = diff(before, await snapshot(page), used.value)
    const label = (live.label || live.placeholder || 'submit').replace(/…$/, '').trim()
    const step = {
      label,
      parameters: [{ ...live, example: used.value }],
      effect: d.kind, changed: d.changed, committed: true, inline: true,
      evidence: { added: d.added.slice(0, 3), removed: d.removed.slice(0, 3), from: d.from, to: d.to, announced: d.announced },
      seedUrl,
    }
    if (d.changed) found.push(step)
    onStep?.(step, d)
  }
  return found
}

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

    // fields already present belong to the page, not to this action
    const preexisting = new Set((await fields(page)).map((f) => f.label + '|' + f.placeholder))

    const opened = await open(page, label)
    if (!opened) continue

    const discovered = (await fields(page)).filter((f) => !preexisting.has(f.label + '|' + f.placeholder))
    const used = discovered.length ? await fill(page, discovered) : []

    let committed = false
    if (used.length) {
      const btn = await submitButton(page)
      if (btn) { await btn.handle.click({ timeout: 3000 }).catch(() => {}); committed = true; await page.waitForTimeout(1200) }
    }

    const after = await snapshot(page)
    const d = diff(before, after, used[0]?.value)
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
