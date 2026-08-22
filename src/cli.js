#!/usr/bin/env node
import { discoverOn, discoverInline, discoverTask, describe } from './discover.js'
import { discoverMove } from './kanban.js'
import { gesture } from './plan.js'
import { openSession, ensure, closeSession } from './session.js'
import { synthesize } from './synthesize.js'
import { distill, summarise } from './distill.js'
import { emit } from './emit.js'
import { config } from './config.js'
import { writeFileSync, mkdirSync } from 'node:fs'

const SEEDS = ['/projects', '/labels']
const PROJECT_SEED = /\/projects\/\d+/
const TASK_SEED = /\/tasks\/\d+/
const headless = !process.argv.includes('--headed')

const abs = (u) => (u.startsWith('http') ? u : `${config.target.url}${u}`)
const line = (mark) => (s, d) =>
  console.log(`    ${s.changed ? mark : ' '} ${s.label.padEnd(14)} ${(s.control || '').padEnd(22).slice(0, 22)} ${s.parameters.length ? `[${s.parameters.length}p] ` : '     '}${describe(d).slice(0, 44)}`)

// One login for the whole compile, reused from disk across runs. Vikunja rate
// limits the login route, and a compile that re-authenticates per seed spends
// that budget on nothing.
const session = await openSession({ headless })

async function boardView(page, projectUrl) {
  await page.goto(projectUrl, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(1200)
  const kb = page.locator('a, button').filter({ hasText: /kanban|board/i }).first()
  if (!(await kb.count())) return null
  await kb.click().catch(() => {})
  await page.waitForTimeout(2000)
  return page.url()
}

try {
  console.log(`\n  apic compile -> ${config.target.url}\n`)
  const { reused } = await ensure(session)
  console.log(`  session ${reused ? 'reused' : 'authenticated'}\n`)
  const { page } = session

  // A token can expire mid-compile. Without this, discovery happily explores
  // the login page and emits tools called "create account".
  const guard = async (label) => {
    const { reused } = await ensure(session)
    if (!reused) console.log(`  \x1b[33m!\x1b[0m re-authenticated before ${label}`)
  }

  const actions = []
  for (const seed of SEEDS) {
    await guard(seed)
    console.log(`  seed ${seed}`)
    actions.push(...(await discoverOn(page, abs(seed), { onStep: line('\x1b[32m*\x1b[0m') })))
  }

  // A board is projects -> tasks -> labels. Follow the project apic just made.
  const project = actions.map((a) => a.evidence?.to).find((u) => u && PROJECT_SEED.test(u))
  let task = null
  if (project) {
    await guard('project seed')
    console.log(`  seed ${project} (discovered)`)
    actions.push(...(await discoverOn(page, abs(project), { onStep: line('\x1b[32m*\x1b[0m') })))
    const inline = await discoverInline(page, abs(project), { onStep: line('\x1b[32m+\x1b[0m') })
    actions.push(...inline)
    task = inline.map((a) => a.created).find((u) => u && TASK_SEED.test(u))
  }

  // Board views hide the most legible action of all behind a drag, not a button.
  // kanban.js finds it by relocation - the card did not appear or disappear, it
  // moved - which is a third confirmation signal alongside toast and echo.
  if (project) {
    await guard('board seed')
    const boardUrl = await boardView(page, abs(project))
    if (boardUrl) {
      console.log(`  seed ${boardUrl.replace(config.target.url, '')} (board)`)
      const move = await discoverMove(page, boardUrl)
      if (move) {
        // Canonicalise the label the same way discover.js does, so the emitted
        // tool is `moveTask` and not `moveCardBetweenColumns`.
        const g = gesture('move bucket', { scope: 'task' })
        actions.push({ ...move, label: g.label, control: move.label, evidence: { ...move.evidence, control: move.label } })
        console.log(`    \x1b[32m>\x1b[0m ${g.label.padEnd(14)} ${move.label.padEnd(22).slice(0, 22)} [2p] ${move.evidence.announced.text.slice(0, 44)}`)
      }
    }
  }

  // The task detail page: rename, bucket move, label, done, delete. Destructive
  // gestures run against the task apic created itself, one paragraph above.
  if (task) {
    console.log(`  seed ${task} (discovered)`)
    actions.push(...(await discoverTask(page, abs(task), { onStep: line('\x1b[36m>\x1b[0m') })))
  } else {
    console.log('  \x1b[33m!\x1b[0m no task created - skipping the task detail seed')
  }

  const withParams = actions.filter((a) => a.parameters.length).length
  console.log(`\n  ${actions.length} candidate actions (${withParams} with parameters)`)

  // One batched SLM call for the whole trajectory, after exploring rather than
  // during it. Falls back to the node-count heuristic if the key is absent or
  // the call fails, so this line can never break a compile.
  const perception = await distill(actions, { log: (m) => console.log(`  \x1b[33m!\x1b[0m ${m}`) })
  console.log(`  ${summarise(perception)}`)

  mkdirSync('out', { recursive: true })
  writeFileSync('out/actions.json', JSON.stringify(actions, null, 2))
  writeFileSync('out/perception.json', JSON.stringify(perception, null, 2))

  const tools = synthesize(actions)
  const { dir, count } = emit(tools, { app: 'vikunja', target: config.target.url })
  // generated/ is the shared demo artifact and other sessions compile into it
  // too. Snapshot this run's own output so `npm run score out/tools.json`
  // scores what THIS compile produced rather than whatever landed last.
  writeFileSync('out/tools.json', JSON.stringify({ tools }, null, 2))
  console.log(`  ${count} tools synthesised -> ${dir}/`)
  tools.forEach((t) => console.log(`    ${t.destructive ? '\x1b[31m!\x1b[0m' : ' '} ${t.name}(${Object.keys(t.inputSchema.properties).join(', ')})`))
  console.log()
} finally { await closeSession(session) }
