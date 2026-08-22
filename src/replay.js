/**
 * replay.js - execute a compiled tool against the live app.
 * Deterministic: no model in the loop. This is the whole point.
 */
import { snapshot, diff } from './perceive.js'
import { submitButton, confirmButton, fields as liveFields } from './forms.js'
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
    await seedTo(page, tool.recipe)
    await page.waitForTimeout(tool.recipe.drag ? 2200 : 500)

    if (tool.recipe.drag) {
      const { columnSelector, cardSelector } = tool.recipe.drag
      const b4 = await board(page, columnSelector)
      const wanted = String(args.card || '')
      // Whether the named card is actually on the board decides both which
      // column to drag from AND whether to filter by that name below. Falling
      // back on one but not the other locates a card that does not exist, and
      // boundingBox() then hangs for 30s and throws instead of failing fast.
      const found = Boolean(wanted) && b4.some((c) => c.cards.some((t) => t.includes(wanted)))
      let fromIdx = found
        ? b4.findIndex((c) => c.cards.some((t) => t.includes(wanted)))
        : b4.findIndex((c) => c.cards.length)
      // A column name that does not exist is a bad argument, not drift: fall
      // back to any other column so the mechanism is still exercised.
      let toIdx = args.column
        ? b4.findIndex((c) => c.title.toLowerCase().includes(String(args.column).toLowerCase()))
        : -1
      if (toIdx < 0) toIdx = b4.findIndex((_, i) => i !== fromIdx)
      if (fromIdx < 0 || toIdx < 0) return { ok: false, error: 'column or card not found' }

      const cardLoc = found
        ? page.locator(columnSelector).nth(fromIdx).locator(cardSelector).filter({ hasText: wanted }).first()
        : page.locator(columnSelector).nth(fromIdx).locator(cardSelector).first()
      await drag(page, cardLoc, page.locator(columnSelector).nth(toIdx))
      const moved = relocated(b4, await board(page, columnSelector))
      return moved
        ? { ok: true, effect: 'relocation', expected: 'relocation', moved: `"${moved.card}" ${moved.from} -> ${moved.to}` }
        : { ok: false, effect: 'none', expected: 'relocation' }
    }

    const before = await snapshot(page)

    await opener(page, tool)
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

    // A destructive gesture asks twice. discoverTask() answered the modal at
    // compile time, so a replay that leaves it open has not performed the action
    // it was compiled from - it has only opened a dialog.
    const confirm = await confirmButton(page)
    if (confirm) { await confirm.handle.click({ timeout: 3000 }).catch(() => {}); await page.waitForTimeout(1400) }

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
 * Navigate to the resource this tool acts on.
 *
 * The recorded seed URL is a row the explorer created, and by the next replay
 * anything may have removed it - deleteTask, for one, removes exactly the row
 * the other task tools were compiled against. A tool that only works on the row
 * it was born on is a recording.
 *
 * recipe.seed.from is the page that listed the resource when it was created, so
 * ask that page for one that exists now: keep the recorded row if it is still
 * listed, otherwise take the first link of the same shape. Tools seeded on a
 * collection carry no resolver and just go where they were told.
 */
async function seedTo(page, recipe) {
  const goto = (u) => page.goto(u, { waitUntil: 'domcontentloaded' })
  if (!recipe.seed?.from) return goto(recipe.seedUrl)

  const { origin, pathname } = new URL(recipe.seedUrl)
  const shape = new RegExp(recipe.seed.pattern)
  await goto(new URL(recipe.seed.from, origin).href)
  await page.waitForTimeout(900)

  let rows = await rowsMatching(page, shape, origin)
  // Nothing of this kind is left. That is the normal state, not an edge case:
  // deleteTask removes exactly the row its siblings were compiled against. The
  // compiler learned how to create this resource, so use that and act on what
  // it makes - a precondition, satisfied with the app's own UI.
  if (!rows.length && recipe.seed.create) {
    await makeOne(page, recipe.seed.create)
    rows = await rowsMatching(page, shape, origin)
  }

  // The recorded row first: a tool asked to act on a specific thing should keep
  // acting on it for as long as that thing exists.
  return goto(new URL(rows.includes(pathname) ? pathname : (rows[0] ?? pathname), origin).href)
}

/** Every link on the page that points at a row of the shape we want. */
async function rowsMatching(page, shape, origin) {
  const hrefs = await page.locator('a[href]').evaluateAll((as) => as.map((a) => a.getAttribute('href')))
  return [...new Set(hrefs.map((h) => path(h, origin)).filter((h) => h && shape.test(h)))]
}

/** Replay the compiled create recipe with a throwaway value, to have something to act on. */
async function makeOne(page, spec) {
  if (spec.click) { await opener(page, { recipe: { click: spec.click } }); await page.waitForTimeout(500) }
  const value = `apic seed ${Math.random().toString(36).slice(2, 8)}`
  for (const f of spec.fields || []) {
    const sel = await fillField(page, f, value)
    if (!sel) continue
    await page.locator(sel).press('Enter').catch(() => {})
    break
  }
  const btn = await submitButton(page)
  if (btn) await btn.handle.click({ timeout: 2500 }).catch(() => {})
  await page.waitForTimeout(1600)
}

const path = (href, origin) => { try { return new URL(href, origin).pathname } catch { return null } }

/**
 * Click whatever opens this action, if anything does.
 *
 * `recipe.click` is the canonical gesture ("create task") because that is what
 * named the tool - no button carries that text. The control actually clicked at
 * compile time is kept in the evidence, so try that first, then the canonical
 * phrase, then give up quietly: inline actions like Kanban quick-add have no
 * opener at all, and throwing on a missing one fails a tool that is working.
 */
async function opener(page, tool) {
  const control = tool.provenance?.evidence?.control
  const attr = (v) => v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
  const tries = []
  for (const text of [control, tool.recipe.click].filter(Boolean)) {
    tries.push(page.locator('button:visible, a[href]:visible, [role="button"]:visible').filter({ hasText: text }).first())
    tries.push(page.locator(`[aria-label="${attr(text)}"]:visible`).first())
  }
  for (const el of tries) {
    try { await el.click({ timeout: 2500 }); return true } catch { /* next handle */ }
  }
  return false
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
