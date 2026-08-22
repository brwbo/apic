/**
 * replay.js - execute a compiled tool against the live app.
 * Deterministic: no model in the loop. This is the whole point.
 */
import { snapshot, diff } from './perceive.js'
import { submitButton, confirmButton, fields as liveFields } from './forms.js'
import { board, drag, relocated } from './kanban.js'
import { affordances } from './explore.js'
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

    const at = page.url()
    const before = await snapshot(page)

    // An inline control is the page, not a form on it: the heading you rename is
    // the thing you clicked. There is nothing to open, and "Title" also matches a
    // nav link - so opening one navigated off the task and renamed whatever
    // heading the next page happened to have.
    if (!tool.recipe.inline) {
      // Now that a recipe says when it has no opener, finding nothing to click is
      // drift rather than a no-op, and it should say so here. It used to surface
      // a page later as arguments that never reached a field - the modal never
      // opened, so there was nothing to type into - which reads like a bad schema
      // instead of the stale locator it actually is.
      const opened = await opener(page, tool)
      // A missing opener is only drift if what it was meant to reveal is missing
      // too. Some controls are their own field - a quick-add box sitting on the
      // page - and recipe.inline does not catch every one of them, because the
      // control and the field can be named differently ("Create a task." opening
      // "Add a task…"). Asking whether this call's fields are reachable settles
      // it without guessing: all of them present means no opener was needed;
      // any of them missing means the one recorded here no longer resolves.
      if (!opened && !(await allFillable(page, tool.recipe.fields.filter((f) => args[f.schemaKey] !== undefined)))) {
        return {
          ok: false, effect: 'none', expected: tool.recipe.expect, unfilled: [], added: [], removed: [],
          error: `no control on ${page.url()} matched what this tool opens with: ` +
            [...new Set([...(tool.provenance?.evidence?.controls || [tool.provenance?.evidence?.control]),
              tool.recipe.click].filter(Boolean))].map((t) => `"${t}"`).join(' or '),
        }
      }
      await page.waitForTimeout(700)
    }

    const unfilled = [], filled = []
    for (const f of tool.recipe.fields) {
      const v = args[f.schemaKey]
      if (v === undefined) continue
      const sel = await fillField(page, f, String(v))
      if (sel) filled.push({ selector: sel, value: String(v) })
      else unfilled.push(f.schemaKey)
    }

    // How a control commits depends on what it is, and "inline" covers two very
    // different things. A quick-add textarea takes its ADD button or Enter,
    // exactly as discoverInline() drove it. A contenteditable heading has no
    // button of its own - though the page it sits on has plenty belonging to
    // something else - and saves when focus leaves it, which is what
    // discoverTask() did. Driving either the other way types the value in and
    // then never commits it, which reads downstream as "nothing was created".
    const blurs = filled.length ? (await controlKind(page, filled[0].selector)) === 'contenteditable' : false

    let submitted = false
    if (tool.recipe.submit && !blurs) {
      const btn = await submitButton(page)
      if (btn) { await btn.handle.click({ timeout: 3000 }).catch(() => {}); await page.waitForTimeout(1200); submitted = true }
    }
    if (!submitted && filled.length) {
      await page.locator(filled[0].selector).first().press(blurs ? 'Tab' : 'Enter').catch(() => {})
      await page.waitForTimeout(1200)
    }

    // A destructive gesture asks twice. discoverTask() answered the modal at
    // compile time, so a replay that leaves it open has not performed the action
    // it was compiled from - it has only opened a dialog.
    const confirm = await confirmButton(page)
    if (confirm) { await confirm.handle.click({ timeout: 3000 }).catch(() => {}); await page.waitForTimeout(1400) }

    const d = diff(before, await snapshot(page))

    // A rename is invisible to the differ. snapshot() names every element by its
    // aria-label first, so <h1 contenteditable aria-label="Title"> reads
    // h1||Title before and after however its text changed. discoverTask() hit
    // the same blind spot at compile time and settled it the same way: reload,
    // and ask the server whether the value came back.
    if (!d.changed && filled.length) {
      const kept = await survivedReload(page, at, filled)
      if (kept) { d.changed = true; d.kind = 'mutation'; d.added = [kept, ...d.added] }
    }

    // A tool that submitted without setting its arguments has not done its job,
    // however much the page changed. That is the failure mode that looks like success.
    return {
      ok: d.changed && d.kind === tool.recipe.expect && unfilled.length === 0,
      effect: d.kind, expected: tool.recipe.expect, unfilled,
      added: d.added.slice(0, 3),
      // What left the page is evidence too, and for some tools it is the only
      // evidence there is: a deletion has nothing to echo and no value to show,
      // so the rows that disappeared are the whole proof it happened.
      removed: d.removed.slice(0, 3),
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
/** Did we stay where we were sent? */
function landedOn(page, href) {
  const norm = (u) => new URL(u, page.url()).pathname.replace(/\/$/, '')
  return norm(page.url()) === norm(href)
}

/**
 * Whether a seed page actually exists, which the URL alone cannot tell you.
 * Measured on Vikunja: a dead TASK bounces to "/", but a dead PROJECT keeps its
 * URL - it even invents a default view id for one that never existed - and
 * simply renders no content. The shell and its 77 sidebar links are still there
 * either way, so the signal is whether the page offers anything to act on.
 */
async function alive(page, href) {
  if (!landedOn(page, href)) return false
  return (await affordances(page)).length > 0
}

/**
 * A pinned collection page - seedUrl "/projects/62/249", or a seed.from that
 * names one - is a primary key baked into the recipe. The next compile creates
 * project 63 and the recorded one is cleaned up, so every tool seeded on it
 * breaks at once. seed.from fixed that for rows; this fixes it for the page
 * that LISTS the rows, which was still pinned.
 *
 * Resolution is UI-only. Asking Vikunja's REST API for a live project id would
 * be one line and would defeat the claim the whole project rests on.
 */
async function resolveCollection(page, href, origin) {
  const seg = new URL(href, origin).pathname.split('/').filter(Boolean)[0]
  if (!seg) return null
  await page.goto(new URL(`/${seg}`, origin).href, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(800)
  // Opening a collection row lands on its default view, which is the depth-3
  // page a board recipe wants - so the row link is enough either way.
  for (const row of await rowsMatching(page, new RegExp(`^/${seg}/\\d+$`), origin)) {
    await page.goto(new URL(row, origin).href, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(900)
    if (await alive(page, page.url())) return page.url()
  }
  return null
}

async function seedTo(page, recipe) {
  const goto = (u) => page.goto(u, { waitUntil: 'domcontentloaded' })
  const { origin, pathname } = new URL(recipe.seedUrl)

  if (!recipe.seed?.from) {
    await goto(recipe.seedUrl)
    await page.waitForTimeout(500)
    if (await alive(page, recipe.seedUrl)) return
    const live = await resolveCollection(page, recipe.seedUrl, origin)
    return live ? goto(live) : undefined
  }

  const shape = new RegExp(recipe.seed.pattern)
  let from = new URL(recipe.seed.from, origin).href
  await goto(from)
  await page.waitForTimeout(900)
  // The listing page itself can be gone - it is a pinned id too.
  if (!(await alive(page, from))) {
    const live = await resolveCollection(page, from, origin)
    if (live) { from = live; await goto(from); await page.waitForTimeout(900) }
  }

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
 * phrase. Returns whether anything was clicked; the caller decides what that
 * means, because a recipe marked inline has no opener to find and one without
 * that mark has lost the control it was compiled against.
 */
async function opener(page, tool) {
  const ev = tool.provenance?.evidence || {}
  // `controls` is every handle the control had at compile time - aria-label,
  // innerText, title. Older artifacts only carry the single `control`, so fall
  // back to it rather than requiring a recompile.
  const recorded = ev.controls?.length ? ev.controls : [ev.control]
  const attr = (v) => v.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
  const tries = []
  for (const text of [...new Set([...recorded, tool.recipe.click].filter(Boolean))]) {
    tries.push(page.locator('button:visible, a[href]:visible, [role="button"]:visible').filter({ hasText: text }).first())
    tries.push(page.locator(`[aria-label="${attr(text)}"]:visible`).first())
  }
  for (const el of tries) {
    try { await el.click({ timeout: 2500 }); return true } catch { /* next handle */ }
  }
  return false
}

/** A real form field, or an element made editable in place? They commit differently. */
async function controlKind(page, selector) {
  return page.locator(selector).first().evaluate((el) =>
    el.isContentEditable && !/^(input|textarea|select)$/i.test(el.tagName) ? 'contenteditable' : 'field',
  ).catch(() => 'field')
}

/** Can every one of these fields be typed into right now, without opening anything? */
async function allFillable(page, fields) {
  if (!fields.length) return false
  for (const f of fields) {
    let reachable = false
    for (const sel of locators(f)) {
      if (await page.locator(sel).first().isEditable({ timeout: 1000 }).catch(() => false)) { reachable = true; break }
    }
    if (!reachable) return false
  }
  return true
}

/**
 * Reload and ask whether the value is still there.
 *
 * Returns it in the same tag|role|text shape perceive.js records, so whatever
 * judges this replay sees the heading carrying its new text - the thing that
 * actually happened - rather than a claim that it did.
 */
async function survivedReload(page, url, filled) {
  await page.goto(url, { waitUntil: 'domcontentloaded' }).catch(() => {})
  await page.waitForTimeout(1400)
  for (const { selector, value } of filled) {
    const node = await page.locator(selector).first().evaluate((el) => ({
      tag: el.tagName.toLowerCase(),
      role: el.getAttribute('role') || '',
      text: (el.innerText || el.value || '').trim(),
    })).catch(() => null)
    if (node?.text.includes(value.trim())) return `${node.tag}|${node.role}|${node.text.slice(0, 60)}`
  }
  return null
}

/**
 * Ordered locator candidates: what was recorded at compile time, then semantic
 * fallbacks derived from the field itself. Absorbing small UI drift here is far
 * cheaper than escalating to a re-exploration in heal.js.
 */
/**
 * Vikunja's quick-add renders `id="task-add-textarea-rywuedqiv"` - a stable
 * prefix and a tail regenerated on every render. The recorded id therefore
 * misses on the very next page load while the prefix still lands. Deriving the
 * prefix at call time means recipes already on disk survive without a recompile.
 */
function idPrefix(sel) {
  const m = /^#(.+[-_])[A-Za-z0-9]{4,}$/.exec(sel || '')
  return m ? `[id^="${m[1].replace(/"/g, '\\"')}"]` : null
}

function locators(f) {
  const recorded = [f.selector, ...(f.selectors || [])].filter(Boolean)
  const out = [...recorded]
  for (const sel of recorded) {
    const p = idPrefix(sel)
    if (p) out.push(p)
  }
  if (f.name) out.push(`[name="${f.name}"]`)
  if (f.placeholder) out.push(`[placeholder="${f.placeholder}"]`)
  if (f.label) out.push(`[aria-label="${f.label}"]`)
  return [...new Set(out.filter(Boolean))]
}

/** Fill a compiled field, trying each locator in turn. Returns the one that worked. */
async function fillField(page, f, value) {
  for (const sel of locators(f)) {
    try {
      await page.locator(sel).first().fill(value, { timeout: 1500 })
      return sel
    } catch { /* try the next */ }
  }
  if (f.label) {
    try {
      await page.getByLabel(f.label, { exact: false }).first().fill(value, { timeout: 1500 })
      return `label=${f.label}`
    } catch { /* exhausted */ }
  }
  return null
}
