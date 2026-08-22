#!/usr/bin/env node
/**
 * score.js - the recall scorer. Needs NO API keys.
 *
 * Ground truth comes from the target app's own OpenAPI spec, which apic never
 * reads during compilation. Compiling from the UI and scoring against the real
 * API turns "did it do well?" into a number.
 */
import { readFileSync, existsSync } from 'node:fs'
import { config } from './config.js'

const WRITE_METHODS = new Set(['post', 'put', 'delete', 'patch'])

// The board slice. The full Vikunja surface (105 write ops) is mostly admin,
// OpenID callbacks and CSV migration - noise for a Kanban demo.
const SLICE = [/^\/projects(\/|$)/, /^\/tasks(\/|$)/, /^\/labels(\/|$)/]
// Board actions only: what a human can plainly do on a Kanban board.
// Dropped: teams, project-level user perms, shares, views admin, attachments,
// relations, duplicate, bulk ops, read receipts - none are board gestures.
const EXCLUDE = [
  /webhook/i, /subscription/i, /background/i, /avatar/i, /migration/i, /export/i,
  /\/teams/i, /\/shares/i, /\/attachments/i, /\/relations/i, /duplicate/i,
  /\/bulk/i, /\/read$/i, /^\/projects\/\{[^}]+\}\/users/i,
]
// Views paths are admin noise EXCEPT the bucket-task move, which is the
// single most visually obvious action on a board.
const KEEP_ANYWAY = [/\/buckets\/\{[^}]+\}\/tasks$/]

export async function groundTruth(baseUrl = config.target.url) {
  const res = await fetch(`${baseUrl}/api/v1/docs.json`)
  if (!res.ok) throw new Error(`spec fetch failed: ${res.status} from ${baseUrl}`)
  const spec = await res.json()

  const ops = []
  for (const [path, methods] of Object.entries(spec.paths || {})) {
    if (!SLICE.some((re) => re.test(path))) continue
    const kept = KEEP_ANYWAY.some((re) => re.test(path))
    if (!kept && EXCLUDE.some((re) => re.test(path))) continue
    if (!kept && /\/views/i.test(path)) continue
    for (const [method, op] of Object.entries(methods)) {
      if (!WRITE_METHODS.has(method.toLowerCase())) continue
      ops.push({
        id: `${method.toUpperCase()} ${path}`,
        summary: (op.summary || '').trim(),
        path,
        method: method.toUpperCase(),
      })
    }
  }
  return ops
}

/** Match an emitted tool to a ground-truth op by the nouns and verbs in its name. */
function matches(tool, op) {
  const hay = `${op.summary} ${op.path} ${op.method}`.toLowerCase()
  const words = (tool.name || '').replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().split(/[^a-z]+/).filter((w) => w.length > 2)
  if (!words.length) return false
  const verbHit = words.some((w) => hay.includes(w) || (w === 'create' && op.method === 'PUT'))
  const nounHit = words.some((w) => op.path.includes(w) || op.path.includes(w.replace(/s$/, '')))
  return verbHit && nounHit
}

export function score(tools, truth) {
  const found = truth.filter((op) => tools.some((t) => matches(t, op)))
  const real = tools.filter((t) => truth.some((op) => matches(t, op)))
  return {
    recall: { hit: found.length, total: truth.length },
    precision: { hit: real.length, total: tools.length },
    missed: truth.filter((op) => !found.includes(op)).map((o) => o.id),
  }
}

function loadTools(path = 'generated/vikunja/tools.json') {
  if (!existsSync(path)) return []
  try { return JSON.parse(readFileSync(path, 'utf8')).tools || [] } catch { return [] }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const truth = await groundTruth()
  const tools = loadTools(process.argv[2])
  const s = score(tools, truth)
  console.log(`\n  ground truth: ${truth.length} write ops in the board slice`)
  truth.forEach((o) => console.log(`    ${o.method.padEnd(6)} ${o.path.padEnd(34)} ${o.summary}`))
  console.log(`\n  RECALL    ${s.recall.hit}/${s.recall.total}   (actions apic found)`)
  console.log(`  PRECISION ${s.precision.hit}/${s.precision.total}   (emitted tools that are real)`)
  if (!tools.length) console.log(`\n  no tools yet - compile first\n`)
}
