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
import { snapshot, diff, describe, shot, visionAvailable } from './perceive.js'
import { fields, fill, submitButton, confirmButton } from './forms.js'
import { rank, isDestructive, gesture, gestureFrom, offSlice, scopeOf, resourceOf, VOCABULARY } from './plan.js'
import * as h from './h.js'
import { affordances, links } from './explore.js'

const SETTLE = 1400

// Frames are only worth their cost if something can read them. With no FAL_KEY
// the vision tier is idle, so skip the screenshots entirely rather than carry
// ~40KB per step through the whole compile for nothing.
const VISION = visionAvailable()
const frame = (page) => (VISION ? shot(page) : Promise.resolve(null))

/**
 * One recorded action. `label` is the canonical gesture ("delete task") because
 * that is what names the emitted tool; `control` is the raw UI string, kept so
 * replay knows what to click and a reviewer can see where the tool came from.
 */
function record({ g, control, handles, parameters, d, seedUrl, planner = 'heuristic', extra = {} }) {
  // Every way the control could be found at compile time. replay tries them in
  // order, so a control that renders differently later still resolves.
  const controls = [...new Set([control, ...(handles || [])].filter(Boolean))]
  return {
    label: g.label,
    control,
    planner,
    parameters,
    effect: d.kind,
    changed: d.changed,
    committed: true,
    evidence: {
      control,
      controls,
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
  // A field with no label of its own is still part of an action - the action is
  // named by the control that commits it. ParaBank's open-account form is two
  // unlabelled selects and a button reading "Open New Account".
  const commit = await submitButton(page)
  // An app names its own actions in its page heading. ParaBank's fields carry
  // no labels and its commit control reads only "Transfer", but the h1 says
  // "Transfer Funds" and "Apply for a Loan". Third fallback, cheapest last.
  const heading = await page.evaluate(() => (document.querySelector('h1')?.innerText || '').trim().slice(0, 60)).catch(() => '')
  const found = []
  for (const f of present) {
    const g = gesture(f.label || f.placeholder || '', { scope })
      || (commit ? gesture(commit.label, { scope }) : null)
      || (heading ? gesture(heading, { scope }) : null)
    if (!g) continue

    await page.goto(seedUrl, { waitUntil: 'domcontentloaded' }).catch(() => {})
    await page.waitForTimeout(700)
    const before = await snapshot(page)
    const beforeFrame = await frame(page)

    // re-read: generated ids change per load, so the recorded chain must be fresh
    const live = (await fields(page)).find((x) => x.label === f.label || x.placeholder === f.placeholder)
    if (!live) continue
    const [used] = await fill(page, [live])
    if (!used) continue

    // Some controls that look like submits are decorative. Vikunja's
    // "Create a task." is a heading-styled button that fires no request at all,
    // while the real control is "ADD" - or just Enter in the field. A button
    // that changes nothing has not been tried, so fall through to Enter before
    // concluding the action does not exist.
    const btn = await submitButton(page)
    if (btn) await btn.handle.click({ timeout: 3000 }).catch(() => {})
    else await page.locator(live.selector).press('Enter').catch(() => {})
    await page.waitForTimeout(SETTLE)

    let afterSnap = await snapshot(page)
    let d = diff(before, afterSnap, used.value)

    if (!d.changed && btn) {
      await page.fill(live.selector, used.value).catch(() => {})
      await page.locator(live.selector).press('Enter').catch(() => {})
      await page.waitForTimeout(SETTLE)
      afterSnap = await snapshot(page)
      d = diff(before, afterSnap, used.value)
    }
    const control = (live.label || live.placeholder || 'submit').replace(/…$/, '').trim()
    // The inline path had no stability check at all, and it is the path most
    // likely to run against an empty collection - which is exactly the state a
    // freshly cleaned demo target is in.
    const fieldStable = await fieldResolves(page, seedUrl, live.selectors?.length ? live.selectors : [live.selector])
    const step = record({
      g, control, d, seedUrl,
      parameters: [{ ...live, example: used.value }],
      extra: {
        inline: true,
        created: await createdLink(page, used.value),
        frames: { before: beforeFrame, after: await frame(page) },
      },
    })
    step.evidence.controlStable = fieldStable
    if (d.changed && fieldStable !== false) found.push(step)
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

/**
 * Drop the rows before asking about the buttons.
 *
 * `/labels` offers 47 clickable things and 45 of them are labels a previous
 * probe run created - content, not controls. Sending those spends a call
 * describing a list to a model and invites one probe per row, which is how a
 * classifier turns into a crawler.
 *
 * A control appears once; a collection repeats. Grouping by shape - words
 * stripped of their digits and ids - separates the two without knowing anything
 * about this app, and a group with siblings is content.
 */
function withoutContent(labels, onLog) {
  const shape = (l) => l.toLowerCase().replace(/[0-9]+/g, '#').replace(/\b[a-z0-9]{6,}\b/g, '*').trim()
  const groups = new Map()
  for (const l of labels) groups.set(shape(l), [...(groups.get(shape(l)) || []), l])

  const kept = labels.filter((l) => groups.get(shape(l)).length === 1)
  const dropped = labels.length - kept.length
  if (dropped) onLog?.(`${dropped} repeated row${dropped === 1 ? '' : 's'} look like content, not controls - not sent to h`)
  return kept
}

/**
 * Escalate the leftovers to h.
 *
 * Only the controls `gesture()` refused are sent, and only once per seed - the
 * regex vocabulary is right about most of a page and there is nothing to gain
 * by asking about what it already resolved. Off-slice controls are withheld
 * rather than offered: "ADD TO FAVORITES" is a real write that this slice
 * deliberately excludes, and that is a scoping decision, not a gap in the
 * vocabulary for a model to fill.
 *
 * Returns label -> gesture for whatever survives validation. Empty whenever h
 * is unkeyed, unreachable, or unsure, which is the keyless behaviour unchanged.
 */
async function classify(page, candidates, { scope, skipDestructive, onLog }) {
  const out = new Map()
  if (!h.available()) return out

  const unresolved = candidates
    .filter(({ label }) => !(skipDestructive && isDestructive(label)))
    .filter(({ label }) => !gesture(label, { scope }) && !offSlice(label))
    .map(({ label }) => label)
  if (!unresolved.length) return out

  const leftovers = withoutContent(unresolved, onLog)
  if (!leftovers.length) return out

  const res = await h.classifyGestures(page, { labels: leftovers, scope, ...VOCABULARY })
  if (res?.error) { onLog?.(`h unavailable (${res.error}) - vocabulary only`); return out }
  onLog?.(`h read ${leftovers.length} unresolved control${leftovers.length === 1 ? '' : 's'}, named ${res.length}`)

  for (const { label, verb, noun, why } of res) {
    const g = gestureFrom(verb, noun, { scope })
    // Refused: outside the closed vocabulary, or a pair the canonical rules
    // reject. Logged rather than swallowed - a classifier whose answers are
    // being discarded should be visible, not silently idle.
    if (!g) { onLog?.(`h proposed ${verb}/${noun} for "${label}" - outside the vocabulary, refused`); continue }
    out.set(label, g)
    onLog?.(`h: "${label}" -> ${g.label} (${why})`)
  }
  return out
}

export async function discoverOn(page, seedUrl, { skipDestructive = true, onStep, onLog } = {}) {
  const scope = scopeOf(seedUrl)
  const found = []
  await page.goto(seedUrl, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(600)

  const candidates = rank(await affordances(page))
  const classified = await classify(page, candidates, { scope, skipDestructive, onLog })

  for (const { label, handles } of candidates) {
    if (skipDestructive && isDestructive(label)) continue
    const g = gesture(label, { scope }) || classified.get(label) || null
    if (!g) continue

    await page.goto(seedUrl, { waitUntil: 'domcontentloaded' }).catch(() => {})
    await page.waitForTimeout(500)
    const before = await snapshot(page)
    const beforeFrame = await frame(page)

    const opened = await open(page, label, handles)
    if (!opened) continue

    const discovered = await fields(page)
    const used = discovered.length ? await fill(page, discovered) : []

    let committed = false
    if (used.length) {
      const btn = await submitButton(page)
      if (btn) { await btn.handle.click({ timeout: 3000 }).catch(() => {}); committed = true; await page.waitForTimeout(1200) }
    }

    const afterSnap = await snapshot(page)
    const afterFrame = await frame(page)
    const d = diff(before, afterSnap, used[0]?.value)
    const controlStable = await stillResolves(page, seedUrl, [label, ...(handles || [])])

    // A dead control is only fatal when the fields it was meant to reveal are
    // unreachable without it - which is exactly the rule replay.js already
    // applies at execution time, and the two disagreeing would be worse than
    // either being wrong alone. createProject's fields sit behind a modal, so
    // losing its opener loses the tool; a quick-add box is on the page whatever
    // the collection contains, so losing a stale call-to-action costs nothing
    // and executing the tool still proves it works.
    let fieldsReachable = null
    if (controlStable === false && used.length) {
      const sels = used.flatMap((u) => (u.selectors?.length ? u.selectors : [u.selector])).filter(Boolean)
      fieldsReachable = sels.length ? await fieldResolves(page, seedUrl, sels) : null
    }

    const step = record({
      g, control: label, handles, d, seedUrl, planner: classified.has(label) ? 'h' : 'heuristic',
      parameters: used.map(({ name, label: l, placeholder, type, required, value, selector, selectors }) =>
        ({ name, label: l, placeholder, type, required, example: value, selector, selectors })),
      extra: { frames: { before: beforeFrame, after: afterFrame } },
    })
    step.evidence.controlStable = controlStable
    step.evidence.fieldsReachable = fieldsReachable
    step.committed = committed
    // Dropped only when the control is gone AND nothing can reach the fields
    // without it. Replaying a tool is better evidence than a capture-time guess
    // about whether a button stayed put, so when the fields are still reachable
    // the action is kept and verification gets to rule on it.
    const unusable = controlStable === false && fieldsReachable !== true
    if (d.changed && !unusable) found.push(step)
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
export async function discoverTask(page, taskUrl, { onStep, onLog } = {}) {
  const found = []
  const scope = 'task'
  const push = (step, d) => { if (step && d.changed) found.push(step); if (step) onStep?.(step, d) }

  const reload = async () => {
    await page.goto(taskUrl, { waitUntil: 'domcontentloaded' }).catch(() => {})
    await page.waitForTimeout(SETTLE)
    return { snap: await snapshot(page), frame: await frame(page) }
  }

  // --- rename: the title is an editable field, not a form ---------------------
  {
    const { snap: before, frame: beforeFrame } = await reload()
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
        const { snap: after, frame: afterFrame } = await reload()
        const persisted = (await page.locator(used.selector).innerText().catch(() => '')).trim()
        const d = diff(before, after, used.value)
        if (persisted === used.value) {
          d.changed = true
          d.kind = 'mutation'
          // `via: reload` is authoritative like a toast: the server handed the
          // value back on a cold load. A rename is a mutation by definition, so
          // there is nothing here for the vision tier to settle.
          d.announced = { text: `reloaded and the title is still "${used.value}"`, kind: 'mutation', via: 'reload' }
        }
        const g = gesture('rename task', { scope })
        push(record({
          g, control: title.label || 'Title', d, seedUrl: taskUrl,
          parameters: [{ ...used, example: used.value }],
          extra: { frames: { before: beforeFrame, after: afterFrame } },
        }), d)
      }
    }
  }

  // --- move between buckets: a choice control, not a form ---------------------
  {
    const { snap: before, frame: beforeFrame } = await reload()
    const moved = await chooseOther(page, /bucket|column/i)
    if (moved) {
      const d = diff(before, await snapshot(page), moved.picked)
      const g = gesture('move bucket', { scope })
      push(record({
        g, control: moved.control, handles: moved.handles, d, seedUrl: taskUrl,
        parameters: [{ name: 'bucket', label: 'Bucket', placeholder: '', type: 'string', required: true, example: moved.picked, selector: moved.selector }],
        extra: { frames: { before: beforeFrame, after: await frame(page) } },
      }), d)
    }
  }

  // --- the rest: one click, sometimes a field, sometimes a confirmation -------
  const gestures = []
  await reload()
  const controls = await affordances(page)
  // The task page is where the vocabulary is weakest: its controls are icons,
  // bare adjectives ("Done") and dropdowns rather than verb phrases, so this is
  // where h has something to add that a regex cannot.
  const classified = await classify(page, controls, { scope, skipDestructive: false, onLog })
  for (const { label, handles } of controls) {
    const g = gesture(label, { scope }) || classified.get(label) || null
    // Only the verbs this loop owns. Rename and bucket-move have dedicated
    // branches above, and letting them through here probes them a second time -
    // which mutates the task out from under the gestures still queued behind
    // it, and cost mark/assign/delete an entire run when it was tried.
    if (!g || !['mark', 'assign', 'delete'].includes(g.verb)) continue
    gestures.push({ label, handles, g, planner: classified.has(label) ? 'h' : 'heuristic' })
  }
  // destructive last: it takes the page with it
  gestures.sort((a, b) => Number(isDestructive(a.g.label)) - Number(isDestructive(b.g.label)))

  for (const { label, handles, g, planner } of gestures) {
    const { snap: before, frame: beforeFrame } = await reload()
    if (!(await open(page, label, handles))) continue

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
      g, control: label, handles, d, seedUrl: taskUrl, planner,
      parameters: used ? [{ ...used, example: used.value }] : [],
      extra: {
        destructive: isDestructive(g.label) || undefined,
        frames: { before: beforeFrame, after: await frame(page) },
      },
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
  if (!(await open(page, opener.label, opener.handles))) return null

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
  return { control: opener.label, handles: opener.handles, picked, selector: null }
}

const CLICKABLE = 'main button:visible, main a[href]:visible, main [role="button"]:visible'

/**
 * Does this control still exist once the action has changed the app's state?
 *
 * A control that only renders in one state is not a capability of the app, it
 * is a property of that moment - an empty-collection call to action is the
 * classic case: it is on screen only until the first row exists, so a tool
 * minted from it can never be replayed against a populated app. Recorded as
 * evidence rather than acted on, because the same signal fires for controls
 * that are legitimately conditional.
 */
/**
 * Reload the seed and say whether the page can be trusted to answer at all.
 * Returns false when it cannot - the caller must then report null, never false.
 */
async function reloadTrustworthy(page, seedUrl) {
  let loaded = true
  await page.goto(seedUrl, { waitUntil: 'domcontentloaded' }).catch(() => { loaded = false })
  await page.waitForTimeout(600)
  if (!loaded) return false
  if (page.url().includes('/login')) return false // session dropped mid-compile
  return true
}

/**
 * The inline sibling of stillResolves().
 *
 * An inline recipe never clicks anything - it fills a field that is already on
 * the page - so the thing that must survive is the FIELD, not a control. Asking
 * stillResolves() about it would be asking the wrong question with the wrong
 * locators: it hunts buttons and links, and would report every healthy quick-add
 * box as unstable, dropping createTask and costing recall to "fix" a bug that
 * was not there.
 *
 * Same tri-state discipline: only an explicit false rejects.
 */
async function fieldResolves(page, seedUrl, selectors) {
  if (!(await reloadTrustworthy(page, seedUrl))) return null
  let errored = false
  for (const sel of (selectors || []).filter(Boolean)) {
    try { if (await page.locator(`${sel}:visible`).count()) return true } catch { errored = true }
  }
  return errored ? null : false
}

async function stillResolves(page, seedUrl, tries) {
  // Tri-state, for the reason persist.js already states: a probe that fails
  // proves nothing either way, so never reject a tool on the strength of a page
  // that would not load. Collapsing "could not tell" into "does not resolve"
  // rejects, and a rejection here is not local - dropping create-project leaves
  // no project to descend into, so the entire task branch goes with it. One
  // expired session cost a compile 7 of its 9 tools.
  if (!(await reloadTrustworthy(page, seedUrl))) return null

  let errored = false
  const count = async (sel) => {
    try { return await page.locator(sel).count() } catch { errored = true; return 0 }
  }
  for (const t of tries.filter(Boolean)) {
    const attr = t.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
    if (await page.locator(`${CLICKABLE}`).filter({ hasText: t }).count().catch(() => { errored = true; return 0 })) return true
    if (await count(`main [aria-label="${attr}"]:visible`)) return true
  }
  return errored ? null : false
}


/**
 * Click an affordance and wait for whatever it opens.
 *
 * Two ways to find it, because there are two ways affordances() named it. The
 * bucket selector renders as a button whose visible text is "To-Do" but whose
 * aria-label is "Kanban bucket: To-Do" - matching on text alone silently missed
 * the single most visible action on a Kanban board.
 */
async function open(page, label, handles = []) {
  const tries = [...new Set([label, ...handles].filter(Boolean))]
  const candidates = tries.flatMap((t) => {
    const attr = t.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
    return [
      page.locator(`${CLICKABLE}`).filter({ hasText: t }).first(),
      page.locator(`main [aria-label="${attr}"]:visible`).first(),
    ]
  })
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
