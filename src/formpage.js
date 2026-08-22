/**
 * formpage.js - a page that IS a form.
 *
 * apic knows two shapes of write. `discoverOn` clicks a control, waits for a
 * dialog, fills it and submits. `discoverInline` fills a field that is already
 * on the page and submits it on its own - kanban quick-add, one field, one
 * card. Neither describes a dedicated create page.
 *
 * Gitea's /repo/create is the case that exposed it. Three fields, one of them
 * required, and a single "Create Repository" button. `discoverOn` clicks that
 * button first, which submits an empty form. `discoverInline` fills exactly one
 * field per attempt, so `repo_name` is blank and the app rejects it. Both
 * report "no change" and the most valuable action on the app is invisible -
 * which is why Gitea compiled to zero tools even once its vocabulary and its
 * seeds had been discovered correctly.
 *
 * The rule this adds: when a page's own submit button names a gesture, fill
 * every field it has and press it once.
 */
import { snapshot, diff } from './perceive.js'
import { fields, fill, submitButton } from './forms.js'
import { gesture, scopeOf } from './plan.js'

export async function discoverForm(page, seedUrl, { onStep, log } = {}) {
  await page.goto(seedUrl, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(900)

  const present = await fields(page)
  if (!present.length) return []

  const btn = await submitButton(page)
  if (!btn) { log?.(`${seedUrl}: fields but no submit button`); return [] }

  // The submit button has to name a real gesture. Without this a "Search" or a
  // "Save settings" button becomes a compiled tool, and the whole precision
  // argument goes with it.
  const g = gesture(btn.label, { scope: scopeOf(seedUrl) })
  if (!g) { log?.(`${seedUrl}: "${btn.label}" is not a gesture`); return [] }

  // Required fields only.
  //
  // An optional field is optional, and filling one is how a valid submission
  // becomes an invalid one: apic writes "apic probe 93030" into Gitea's
  // Default Branch, git branch names cannot contain spaces, and the form is
  // rejected for a field nobody had to touch. The minimal valid submission is
  // the one most likely to succeed and the one that yields the cleanest tool
  // schema. Apps that never set `required` fall back to filling everything.
  const wanted = present.filter((f) => f.required)
  const before = await snapshot(page)
  const used = await fill(page, wanted.length ? wanted : present)
  if (!used.length) { log?.(`${seedUrl}: no field could be filled`); return [] }

  // Re-resolve: filling can re-render the form and invalidate the handle.
  const live = (await submitButton(page)) || btn
  await live.handle.click({ timeout: 4000 }).catch(() => {})
  await page.waitForTimeout(1600)

  // The needle is whatever went into the required field - that is the value the
  // app had to store for the write to have happened at all.
  const needle = (used.find((u) => u.required) || used[0]).value
  const d = diff(before, await snapshot(page), needle)

  const step = {
    label: g.label,
    control: btn.label,
    planner: 'heuristic',
    parameters: used.map(({ name, label, placeholder, type, required, value, selector }) =>
      ({ name, label, placeholder, type, required, example: value, selector })),
    effect: d.kind,
    changed: d.changed,
    committed: true,
    formPage: true,
    evidence: {
      control: btn.label,
      controls: [btn.label],
      added: d.added.slice(0, 3),
      removed: d.removed.slice(0, 3),
      from: d.from, to: d.to,
      announced: d.announced,
    },
    seedUrl,
  }
  onStep?.(step, d)
  if (!d.changed) log?.(`${seedUrl}: submitted "${btn.label}" and nothing changed`)
  return d.changed ? [step] : []
}
