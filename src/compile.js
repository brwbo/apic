/**
 * compile.js - the pipeline, as a function.
 *
 * explore -> distill -> synthesize -> emit. Extracted from cli.js so that the
 * MCP server can run a compile in-process and register the resulting tools on
 * itself, without shelling out. cli.js is now a printer around this.
 */
import { launch, login } from './explore.js'
import { discoverOn, discoverInline, describe } from './discover.js'
import { synthesize } from './synthesize.js'
import { distill, summarise } from './distill.js'
import { emit } from './emit.js'
import { config } from './config.js'
import { writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join, resolve } from 'node:path'

/** Repo root, so a compile writes to the same place wherever it was invoked from. */
export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const SEEDS = ['/projects', '/labels']
const PROJECT_SEED = /\/projects\/\d+/
const LOOPBACK = /^(localhost|127\.0\.0\.1|\[::1\])$/

/**
 * Directory name for a compiled app. A hostname is the natural identity, but
 * loopback hostnames say nothing about what is running behind them, so the
 * local demo target is named explicitly.
 */
export function appName(url) {
  const host = new URL(url).hostname
  if (LOOPBACK.test(host)) return process.env.APIC_APP || 'vikunja'
  return host.replace(/^www\./, '').split('.')[0].toLowerCase().replace(/[^a-z0-9-]+/g, '-')
}

/** Seed paths to explore: the standard set, plus any path the goal names outright. */
function seedsFor(goal) {
  const named = String(goal || '').match(/\/[a-z0-9\-_/]+/gi) || []
  return [...new Set([...SEEDS, ...named])]
}

/**
 * Compile an app into tools.
 *
 * `onLog` receives already-formatted lines. The MCP server routes them to
 * stderr - stdout is the JSON-RPC channel and a stray console.log corrupts it.
 */
export async function compile({
  url = config.target.url,
  goal = '',
  app = null,
  headless = true,
  outDir = join(ROOT, 'generated'),
  onLog = () => {},
} = {}) {
  const name = app || appName(url)
  const target = { ...config.target, url }
  const step = (s, mark = '*') =>
    `    ${s.changed ? `\x1b[32m${mark}\x1b[0m` : ' '} ` +
    `${s.label.padEnd(26).slice(0, 26)} ${s.parameters?.length ? `[${s.parameters.length}p] ` : '     '}`

  const { browser, page } = await launch({ headless })
  try {
    onLog(`\n  apic compile -> ${url}${goal ? `\n  goal: ${goal}` : ''}\n`)
    await login(page, target)

    const actions = []
    for (const seed of seedsFor(goal)) {
      onLog(`  seed ${seed}`)
      const found = await discoverOn(page, `${url}${seed}`, {
        onStep: (s, d) => onLog(step(s) + describe(d).slice(0, 46)),
      })
      actions.push(...found)
    }

    // Tasks live inside a project, so follow one in and explore there.
    const inside = actions.map((a) => a.evidence?.to).find((u) => u && PROJECT_SEED.test(u))
    if (inside) {
      onLog(`  seed ${inside} (discovered)`)
      const found = await discoverOn(page, `${url}${inside}`, {
        onStep: (s, d) => onLog(step(s) + describe(d).slice(0, 46)),
      })
      actions.push(...found)
      const inline = await discoverInline(page, `${url}${inside}`, {
        onStep: (s, d) => onLog(step({ ...s, label: `${s.label} (inline)` }, '+') + describe(d).slice(0, 46)),
      })
      actions.push(...inline)
    }

    const withParams = actions.filter((a) => a.parameters.length).length
    onLog(`\n  ${actions.length} candidate actions (${withParams} with parameters)`)

    // One batched SLM call for the whole trajectory, after exploring rather than
    // during it. Falls back to the node-count heuristic if the key is absent or
    // the call fails, so this line can never break a compile.
    const perception = await distill(actions, { log: (m) => onLog(`  \x1b[33m!\x1b[0m ${m}`) })
    onLog(`  ${summarise(perception)}`)

    mkdirSync(join(ROOT, 'out'), { recursive: true })
    writeFileSync(join(ROOT, 'out/actions.json'), JSON.stringify(actions, null, 2))
    writeFileSync(join(ROOT, 'out/perception.json'), JSON.stringify(perception, null, 2))

    const tools = synthesize(actions)
    const { dir, count } = emit(tools, { app: name, outDir, target: url })
    onLog(`  ${count} tools synthesised -> ${dir}/`)
    tools.forEach((t) =>
      onLog(`    ${t.destructive ? '\x1b[31m!\x1b[0m' : ' '} ${t.name}(${Object.keys(t.inputSchema.properties).join(', ')})`))
    onLog('')

    return { app: name, dir, count, tools, actions, perception, url, goal }
  } finally { await browser.close() }
}
