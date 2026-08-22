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

const session = await openSession({ headless: true })
await ensure(session)
console.log('  watching… ctrl-c to stop\n')

let stop = false
process.on('SIGINT', () => { stop = true })

while (!stop) {
  stats.cycles++
  const doc = load()
  const rows = []

  for (const tool of doc.tools) {
    stats.checks++
    let res
    try { res = await replay(tool, args(tool), { session }) } catch (e) { res = { ok: false, error: e.message.split('\n')[0] } }

    if (res.ok) { rows.push({ name: tool.name, ok: true, note: res.effect || 'verified' }); continue }

    // red: attempt repair before reporting failure
    stats.breaks++
    const t0 = Date.now()
    const fix = await heal(tool, session)
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
