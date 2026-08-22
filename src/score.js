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

// Every target keeps its spec somewhere else and slices differently. Defaults
// are Vikunja's, so `npm run score` is unchanged; Gitea passes its own.
const res = (v, d) => (v || d).split(',').map((x) => x.trim()).filter(Boolean).map((x) => new RegExp(x))
const SPEC_PATH = process.env.APIC_SPEC_PATH || '/api/v1/docs.json'

// The board slice. The full Vikunja surface (105 write ops) is mostly admin,
// OpenID callbacks and CSV migration - noise for a Kanban demo.
const SLICE = res(process.env.APIC_SLICE, '^\\/projects(\\/|$),^\\/tasks(\\/|$),^\\/labels(\\/|$)')
// Board actions only: what a human can plainly do on a Kanban board.
// Dropped: teams, project-level user perms, shares, views admin, attachments,
// relations, duplicate, bulk ops, read receipts - none are board gestures.
const EXCLUDE = [
  /webhook/i, /subscription/i, /background/i, /avatar/i, /migration/i, /export/i,
  /\/teams/i, /\/shares/i, /\/attachments/i, /\/relations/i, /duplicate/i,
  /\/bulk/i, /\/read$/i, /^\/projects\/\{[^}]+\}\/users/i,
  ...res(process.env.APIC_EXCLUDE, ''),
]
// Views paths are admin noise EXCEPT the bucket-task move, which is the
// single most visually obvious action on a board.
const KEEP_ANYWAY = [/\/buckets\/\{[^}]+\}\/tasks$/]

export async function groundTruth(baseUrl = config.target.url) {
  const r = await fetch(`${baseUrl}${SPEC_PATH}`)
  if (!r.ok) throw new Error(`spec fetch failed: ${r.status} from ${baseUrl}${SPEC_PATH}`)
  const spec = await r.json()

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

/**
 * Match an emitted tool to one ground-truth op. Deliberately strict: a tool
 * claims exactly one op, and an inflated recall number is worse than none.
 */
const VERB_METHOD = { create: ['PUT', 'POST'], add: ['PUT', 'POST'], update: ['POST', 'PUT'], edit: ['POST', 'PUT'], delete: ['DELETE'], remove: ['DELETE'], move: ['POST'], assign: ['PUT'], mark: ['POST'] }

function parse(tool) {
  const words = (tool.name || '').replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().split(/[^a-z]+/).filter(Boolean)
  return { verb: words[0], noun: words.slice(1).join('') }
}

/**
 * A path segment and a tool noun name the same resource.
 *
 * The UI says "Repository" and Gitea's API says /user/repos, so plural-stripping
 * alone scores a correct tool as a miss. The alias table holds the cases where
 * an API abbreviates the word its own UI spells out - short, and each entry is
 * a fact about one target rather than a guess.
 */
const ALIAS = { repository: 'repo', repositories: 'repo', repos: 'repo', issues: 'issue' }
const stem = (w) => {
  const s = String(w || '').toLowerCase()
  if (ALIAS[s]) return ALIAS[s]
  const singular = s.replace(/ies$/, 'y').replace(/s$/, '')
  return ALIAS[singular] || singular
}

function matches(tool, op) {
  const { verb, noun } = parse(tool)
  if (!verb || !noun) return false
  const methods = VERB_METHOD[verb]
  if (!methods || !methods.includes(op.method)) return false
  // the noun must be the LAST resource segment of the path, not merely present
  const segs = op.path.split('/').filter((s) => s && !s.startsWith('{'))
  const last = segs[segs.length - 1] || ''
  return stem(last) === stem(noun)
}

export function score(tools, truth) {
  // one tool claims at most one op, so recall cannot exceed the tool count
  const claimed = new Set()
  for (const t of tools) {
    const op = truth.find((o) => !claimed.has(o.id) && matches(t, o))
    if (op) claimed.add(op.id)
  }
  const found = truth.filter((op) => claimed.has(op.id))
  const real = tools.filter((t) => truth.some((op) => matches(t, op)))
  return {
    recall: { hit: found.length, total: truth.length },
    precision: { hit: real.length, total: tools.length },
    missed: truth.filter((op) => !found.includes(op)).map((o) => o.id),
  }
}

function loadTools(path = `generated/${process.env.APIC_APP || 'vikunja'}/tools.json`) {
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
