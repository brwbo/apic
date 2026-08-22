#!/usr/bin/env node
/**
 * watch.js - continuous verification.
 *
 * A compiled interface is a claim about an app that keeps changing. Watch runs
 * the generated suite on an interval, and when a tool goes red it calls heal
 * rather than a human. The dashboard is the demo: five tools green, edit a
 * button in the target app, one goes red on its own, heals, green again.
 *
 * The cycle counters are also the eval. Numbers that accumulate over an
 * afternoon of real drift beat a benchmark invented at the end of one.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { replay } from './replay.js'
import { heal } from './heal.js'
import { openSession, ensure, closeSession } from './session.js'

const OUT = process.env.APIC_OUT_DIR || 'generated'
const APP = process.env.APIC_APP || 'vikunja'
const INTERVAL = Number(process.env.APIC_WATCH_INTERVAL_MS || 20000)
// replay gives the page 500ms to settle and Vikunja rate limits: unpaced checks
// invent failures indistinguishable from drift, which is the one thing a drift
// detector must never do.
const PACE_MS = Number(process.env.APIC_WATCH_PACE_MS || 2000)
const DIR = join(OUT, APP)

const g = (s) => `\x1b[32m${s}\x1b[0m`, r = (s) => `\x1b[31m${s}\x1b[0m`
const y = (s) => `\x1b[33m${s}\x1b[0m`, dim = (s) => `\x1b[2m${s}\x1b[0m`

const load = () => JSON.parse(readFileSync(join(DIR, 'tools.json'), 'utf8'))
const save = (doc) => writeFileSync(join(DIR, 'tools.json'), JSON.stringify(doc, null, 2))

const stats = { cycles: 0, checks: 0, breaks: 0, repairs: 0, repairMs: [], started: Date.now() }

function args(tool) {
  const out = {}
  for (const [k, spec] of Object.entries(tool.inputSchema?.properties || {})) {
    if (k === 'confirm' || spec.type === 'boolean') out[k] = true
    else if (spec.type === 'number') out[k] = 7
    else out[k] = `apic watch ${Date.now() % 100000}`
  }
  return out
}

function render(rows) {
  const up = rows.filter((x) => x.ok).length
  const mttr = stats.repairMs.length ? Math.round(stats.repairMs.reduce((a, b) => a + b) / stats.repairMs.length / 1000) : null
  console.clear()
  console.log(`\n  apic watch  ${dim(`${APP} · cycle ${stats.cycles} · every ${INTERVAL / 1000}s`)}\n`)
  for (const x of rows) {
    const badge = x.ok ? g('  UP  ') : x.healed ? y('HEALED') : r(' DOWN ')
    console.log(`  ${badge}  ${x.name.padEnd(16)} ${dim((x.note || x.effect || '').slice(0, 58))}`)
  }
  console.log(`\n  ${up}/${rows.length} up   ${dim(`${stats.checks} checks · ${stats.breaks} breaks · ${stats.repairs} repairs${mttr !== null ? ` · MTTR ${mttr}s` : ''}`)}\n`)
  mkdirSync('out', { recursive: true })
  writeFileSync('out/watch-stats.json', JSON.stringify({ ...stats, uptime: `${up}/${rows.length}` }, null, 2))
}

let session = await openSession({ headless: true })
await ensure(session)

// A crashed page takes the whole context with it, and every subsequent tool
// then reports "browser has been closed" - one dead session masquerading as
// total drift. Recover rather than report a fleet-wide outage.
const DEAD = /browser has been closed|Target page, context or browser has been closed|Target closed/i
async function revive(reason) {
  try { await closeSession(session) } catch { /* already gone */ }
  session = await openSession({ headless: true })
  await ensure(session)
  return `session revived (${reason})`
}
console.log('  watching… ctrl-c to stop\n')

let stop = false
process.on('SIGINT', () => { stop = true })

while (!stop) {
  stats.cycles++
  const doc = load()
  const rows = []

  // Only verified tools are watched. A rejected tool going red is not drift,
  // it never worked, and counting it as a break poisons the MTTR figure.
  const watched = (doc.tools || []).filter((t) => t.verified !== false)
  for (const tool of watched) {
    stats.checks++
    await new Promise((r) => setTimeout(r, PACE_MS))
    let res
    try { res = await replay(tool, args(tool), { session }) } catch (e) { res = { ok: false, error: e.message.split('\n')[0] } }

    // Re-authenticate only on evidence of logout. Doing it per cycle spends a
    // login per cycle, and Vikunja rate limits the route - which manifests as
    // every tool breaking at once, the exact false positive this must not emit.
    if (!res.ok && session.page.url().includes('/login')) {
      await ensure(session).catch(() => {})
      try { res = await replay(tool, args(tool), { session }) } catch { /* keep the failure */ }
    }

    if (!res.ok && DEAD.test(res.error || res.note || '')) {
      const note = await revive('page crashed')
      try { res = await replay(tool, args(tool), { session }) } catch (e) { res = { ok: false, error: e.message.split('\n')[0] } }
      if (res.ok) { rows.push({ name: tool.name, ok: true, note }); continue }
    }

    if (res.ok) { rows.push({ name: tool.name, ok: true, note: res.effect || 'verified' }); continue }

    // red: attempt repair before reporting failure
    stats.breaks++
    const t0 = Date.now()
    let fix = await heal(tool, session)
    if (!fix.repaired && DEAD.test(fix.note || '')) { await revive('heal hit a dead page'); fix = await heal(tool, session) }
    if (fix.repaired) {
      Object.assign(tool, { recipe: fix.recipe, inputSchema: fix.inputSchema || tool.inputSchema, healedAt: new Date(Date.now()).toISOString() })
      save(doc)
      const after = await replay(tool, args(tool), { session }).catch(() => ({ ok: false }))
      if (after.ok) {
        stats.repairs++; stats.repairMs.push(Date.now() - t0)
        rows.push({ name: tool.name, ok: true, healed: true, note: fix.note })
        continue
      }
      rows.push({ name: tool.name, ok: false, note: `healed but still failing: ${fix.note}` })
      continue
    }
    rows.push({ name: tool.name, ok: false, note: fix.note || res.error || res.effect })
  }

  render(rows)
  for (let i = 0; i < INTERVAL / 500 && !stop; i++) await new Promise((r) => setTimeout(r, 500))
}

await closeSession(session)
