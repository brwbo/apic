/**
 * discover.js - goal-directed exploration of a Kanban board.
 *
 * Three entry points, one per shape of control the board slice actually uses:
 *
 *   discoverOn      button-first. Click an affordance, fill whatever form it
 *                   opens, submit, record the state change.
 *   discoverInline  fields already on the page with no button to open them.
 *   discoverTask    the task detail page, where rename / done / label / bucket
 *                   / delete all live behind controls that are not forms.
 *
 * Every candidate passes through plan.gesture() first. A control that maps to
 * no board gesture is not recorded, which is what keeps precision at 100%.
 */
import { snapshot, diff, describe } from './perceive.js'
import { fields, fill, submitButton, confirmButton } from './forms.js'
import { rank, isDestructive, gesture, scopeOf, resourceOf } from './plan.js'
import { affordances, links } from './explore.js'

const SETTLE = 1400

/**
 * One recorded action. `label` is the canonical gesture ("delete task") because
 * that is what names the emitted tool; `control` is the raw UI string, kept so
 * replay knows what to click and a reviewer can see where the tool came from.
 */
function record({ g, control, parameters, d, seedUrl, extra = {} }) {
  return {
    label: g.label,
    control,
    parameters,
    effect: d.kind,
    changed: d.changed,
    committed: true,
    evidence: {
      control,
      added: d.added.slice(0, 3),
      removed: d.removed.slice(0, 3),
      from: d.from, to: d.to,
      announced: d.announced,
    },
    seedUrl,
    ...extra,
  }
}

/**
 * Inline actions: fields already on the page with no button to open them.
 * Kanban quick-add is the canonical case - type a title, press Enter or hit
 * ADD, and a card appears. Button-first probing never finds these because
 * there is nothing to click first.
 */
export async function discoverInline(page, seedUrl, { onStep } = {}) {
  const scope = scopeOf(seedUrl)
  await page.goto(seedUrl, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(900)

  const present = await fields(page)
  const found = []
  for (const f of present) {
    const g = gesture(f.label || f.placeholder || '', { scope })
    if (!g) continue

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
    await page.waitForTimeout(SETTLE)

    const d = diff(before, await snapshot(page), used.value)
    const control = (live.label || live.placeholder || 'submit').replace(/…$/, '').trim()
    const step = record({
      g, control, d, seedUrl,
      parameters: [{ ...live, example: used.value }],
      extra: { inline: true, created: await createdLink(page, used.value) },
    })
    if (d.changed) found.push(step)
    onStep?.(step, d)
  }
  return found
}

/** Href of the row this action just created, so discovery can descend into it. */
async function createdLink(page, value) {
  return page.evaluate((v) => {
    const root = document.querySelector('main') || document.body
    const hit = [...root.querySelectorAll('a[href]')].find((e) => (e.innerText || '').trim().includes(v))
    return hit ? hit.getAttribute('href') : null
  }, value).catch(() => null)
}

export async function discoverOn(page, seedUrl, { skipDestructive = true, onStep } = {}) {
  const scope = scopeOf(seedUrl)
  const found = []
  await page.goto(seedUrl, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(600)

  const candidates = rank(await affordances(page))
  for (const { label } of candidates) {
    if (skipDestructive && isDestructive(label)) continue
    const g = gesture(label, { scope })
    if (!g) continue

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

    const d = diff(before, await snapshot(page), used[0]?.value)
    const step = record({
      g, control: label, d, seedUrl,
      parameters: used.map(({ name, label: l, placeholder, type, required, value, selector, selectors }) =>
        ({ name, label: l, placeholder, type, required, example: value, selector, selectors })),
    })
    step.committed = committed
    if (d.changed) found.push(step)
    onStep?.(step, d)
  }
  return found
}

/**
 * The task detail page - where the rest of the board slice lives.
 *
 * Rename, mark done, assign a label, move between buckets and delete are all
 * one click deep on a page that button-first probing never reaches, because you
 * only get there by following a task somebody created. None of them is a form:
 * one is a contenteditable heading, one is a dropdown, one needs a confirmation
 * modal. Each is probed on its own reload so the diff is attributable.
 *
 * Destructive gestures run last, on the task apic created itself.
 */
export async function discoverTask(page, taskUrl, { onStep } = {}) {
  const found = []
  const scope = 'task'
  const push = (step, d) => { if (step && d.changed) found.push(step); if (step) onStep?.(step, d) }

  const reload = async () => {
    await page.goto(taskUrl, { waitUntil: 'domcontentloaded' }).catch(() => {})
    await page.waitForTimeout(SETTLE)
    return snapshot(page)
  }

  // --- rename: the title is an editable field, not a form ---------------------
  {
    const before = await reload()
    const title = (await fields(page)).find((f) => /^(title|name)$/i.test((f.label || f.placeholder || '').trim()))
    if (title) {
      const [used] = await fill(page, [title])
      if (used) {
        await page.locator(used.selector).press('Tab').catch(() => {}) // blur commits
        await page.waitForTimeout(SETTLE)

        // Verified by reload, not by diffing the page.
        //
        // The title element is `<h1 contenteditable aria-label="Title">`, and the
        // snapshot names every element by aria-label first - so it records
        // "h1||Title" both before and after and the differ sees a rename as no
        // change at all. Reloading asks the server instead: a title that comes
        // back after a fresh page load was persisted, which is stronger evidence
        // than any DOM comparison.
        const after = await reload()
        const persisted = (await page.locator(used.selector).innerText().catch(() => '')).trim()
        const d = diff(before, after, used.value)
        if (persisted === used.value) {
          d.changed = true
          d.kind = 'mutation'
          d.announced = { text: `reloaded and the title is still "${used.value}"`, kind: 'mutation' }
        }
        const g = gesture('rename task', { scope })
        push(record({ g, control: title.label || 'Title', d, seedUrl: taskUrl, parameters: [{ ...used, example: used.value }] }), d)
      }
    }
  }

  // --- move between buckets: a choice control, not a form ---------------------
  {
    const before = await reload()
    const moved = await chooseOther(page, /bucket|column/i)
    if (moved) {
      const d = diff(before, await snapshot(page), moved.picked)
      const g = gesture('move bucket', { scope })
      push(record({
        g, control: moved.control, d, seedUrl: taskUrl,
        parameters: [{ name: 'bucket', label: 'Bucket', placeholder: '', type: 'string', required: true, example: moved.picked, selector: moved.selector }],
      }), d)
    }
  }

  // --- the rest: one click, sometimes a field, sometimes a confirmation -------
  const gestures = []
  await reload()
  for (const { label } of await affordances(page)) {
    const g = gesture(label, { scope })
    if (!g || !['mark', 'assign', 'delete'].includes(g.verb)) continue
    gestures.push({ label, g })
  }
  // destructive last: it takes the page with it
  gestures.sort((a, b) => Number(isDestructive(a.g.label)) - Number(isDestructive(b.g.label)))

  for (const { label, g } of gestures) {
    const before = await reload()
    if (!(await open(page, label))) continue

    // a field may have appeared (ADD LABELS); commit it with Enter
    const opened = await fields(page)
    // The field this gesture wants is the one that talks about the same resource.
    // "Type to add a label…" is not a verb phrase, so gesture() rightly returns
    // null for it - the resource word is what identifies it.
    const target = opened.find((f) => resourceOf(f.label || f.placeholder || '') === g.noun)
    let used = null
    if (target) {
      ;[used] = await fill(page, [target])
      if (used) { await page.locator(used.selector).press('Enter').catch(() => {}); await page.waitForTimeout(SETTLE) }
    }

    // a confirmation may have appeared (DELETE)
    const confirm = await confirmButton(page)
    if (confirm) { await confirm.handle.click({ timeout: 3000 }).catch(() => {}) }
    await page.waitForTimeout(SETTLE)

    const d = diff(before, await snapshot(page), used?.value)
    push(record({
      g, control: label, d, seedUrl: taskUrl,
      parameters: used ? [{ ...used, example: used.value }] : [],
      extra: { destructive: isDestructive(g.label) || undefined },
    }), d)
  }

  return found
}

/**
 * Open a choice control and pick an option other than the current one.
 * Generic over dropdowns: click the opener, read what appeared, take the first
 * option that is not already selected. Returns what was picked.
 */
async function chooseOther(page, match) {
  const opener = (await affordances(page)).find((a) => match.test(a.label))
  if (!opener) return null
  if (!(await open(page, opener.label))) return null

  const options = await page.evaluate(() => {
    const sel = '[role="menuitem"], .dropdown-item, .dropdown-content a, .dropdown-content button'
    return [...document.querySelectorAll(sel)]
      .filter((e) => { const r = e.getBoundingClientRect(); return r.width && r.height })
      .map((e) => (e.innerText || '').trim()).filter(Boolean)
  }).catch(() => [])

  // the opener reads "Kanban bucket: To-Do" - whatever follows the colon is current
  const current = (opener.label.split(':').pop() || '').trim().toLowerCase()
  const picked = options.find((o) => o.toLowerCase() !== current && o.length > 1)
  if (!picked) return null

  const el = page.locator('[role="menuitem"], .dropdown-item, .dropdown-content a, .dropdown-content button').filter({ hasText: picked }).first()
  try { await el.click({ timeout: 3000 }) } catch { return null }
  await page.waitForTimeout(SETTLE)
  return { control: opener.label, picked, selector: null }
}

const CLICKABLE = 'main button:visible, main a[href]:visible, main [role="button"]:visible'

/**
 * Click an affordance and wait for whatever it opens.
 *
 * Two ways to find it, because there are two ways affordances() named it. The
 * bucket selector renders as a button whose visible text is "To-Do" but whose
 * aria-label is "Kanban bucket: To-Do" - matching on text alone silently missed
 * the single most visible action on a Kanban board.
 */
async function open(page, label) {
  const attr = label.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
  const candidates = [
    page.locator(`${CLICKABLE}`).filter({ hasText: label }).first(),
    page.locator(`main [aria-label="${attr}"]:visible`).first(),
  ]
  for (const el of candidates) {
    try {
      await el.click({ timeout: 2500 })
      await page.waitForTimeout(800)
      return true
    } catch { /* try the other handle */ }
  }
  return false
}

export { describe, links }
