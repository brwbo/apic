#!/usr/bin/env node
import { discoverOn, discoverInline, discoverTask, describe, links } from './discover.js'
import { discoverMove } from './kanban.js'
import { gesture } from './plan.js'
import { openSession, ensure, closeSession } from './session.js'
import { synthesize } from './synthesize.js'
import { distill, summarise } from './distill.js'
import { adjudicate, summariseVision, shot, visionAvailable } from './perceive.js'
import { checkPersistence, summarise as summarisePersistence } from './persist.js'
import { emit } from './emit.js'
import { config } from './config.js'
import { groundTruth, score } from './score.js'
import { writeFileSync, mkdirSync } from 'node:fs'

// Seeds are per-target: nothing about the compiler knows Vikunja's routes.
const SEEDS = (process.env.APIC_SEEDS || '/projects,/labels').split(',').map((x) => x.trim()).filter(Boolean)
const PROJECT_SEED = /\/projects\/\d+/
const TASK_SEED = /\/tasks\/\d+/
const headless = !process.argv.includes('--headed')

const abs = (u) => (u.startsWith('http') ? u : `${config.target.url}${u}`)
const line = (mark) => (s, d) =>
  console.log(`    ${s.evidence?.controlStable === false ? '\x1b[31m~\x1b[0m' : s.changed ? mark : ' '} ${s.label.padEnd(14)} ${(s.control || '').padEnd(22).slice(0, 22)} ${s.parameters.length ? `[${s.parameters.length}p] ` : '     '}${describe(d).slice(0, 44)}`)

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
  const persistence = { checked: 0, persisted: 0, vanished: 0, unknown: 0 }

  /**
   * Settle each batch the moment discovery hands it over.
   *
   * An echo-confirmed write is re-tested by reloading and looking for what we
   * submitted: a created task is still there, a filter query the app merely
   * echoed back is not. Left to the end of the compile instead, `delete task`
   * from the task seed has already removed the row an earlier `create task` is
   * being judged on, and a working tool is rejected for a reason that has
   * nothing to do with whether it works. checkPersistence navigates the page,
   * so this belongs between batches - every seed re-navigates anyway.
   */
  const settle = async (found) => {
    const s = await checkPersistence(page, found, {
      baseUrl: config.target.url,
      onStep: (a, ok) => {
        if (ok === false) console.log(`      \x1b[31mx\x1b[0m ${a.label} - the value was displayed, not stored`)
      },
    })
    for (const k of Object.keys(persistence)) persistence[k] += s[k] || 0
    actions.push(...found)
    return found
  }
  for (const seed of SEEDS) {
    await guard(seed)
    console.log(`  seed ${seed}`)
    await settle(await discoverOn(page, abs(seed), { onStep: line('\x1b[32m*\x1b[0m') }))
    // Not every app hides its forms behind a button. Gitea's create-repo form
    // sits on its own page, and button-first probing never reaches it.
    await settle(await discoverInline(page, abs(seed), { onStep: line('\x1b[32m+\x1b[0m') }))
  }

  // A board is projects -> tasks -> labels. Follow the project apic just made.
  let project = actions.map((a) => a.evidence?.to).find((u) => u && PROJECT_SEED.test(u))

  // Every deeper seed hangs off this one URL, so a create-project that does not
  // land takes createTask, moveTask, updateTask, markTask, assignLabel and
  // deleteTask with it - a compile that quietly returns 2 tools instead of 9 and
  // still exits 0. Tasks live in ANY project, not only one apic just made, so
  // fall back to a project that already exists rather than losing the branch.
  if (!project) {
    await page.goto(`${config.target.url}/projects`, { waitUntil: 'domcontentloaded' }).catch(() => {})
    await page.waitForTimeout(1200)
    project = (await links(page)).find((h) => PROJECT_SEED.test(h)) || null
    console.log(project
      ? `  \x1b[33m!\x1b[0m create project yielded no seed - descending into existing ${project}`
      : '  \x1b[33m!\x1b[0m create project yielded no seed and no project exists - task branch unreachable')
  }
  let task = null
  if (project) {
    await guard('project seed')
    console.log(`  seed ${project} (discovered)`)
    await settle(await discoverOn(page, abs(project), { onStep: line('\x1b[32m*\x1b[0m') }))
    const inline = await discoverInline(page, abs(project), { onStep: line('\x1b[32m+\x1b[0m') })
    await settle(inline)
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
      // The case distill.js had in mind: the card did not appear or disappear,
      // it MOVED, and no amount of diff text says so. kanban.js proves it
      // structurally and replay.js re-checks it the same way, so fal is not
      // needed to classify the drag - it is a second, independent witness that
      // the pixels agree, which is the one claim the DOM evidence cannot make.
      const beforeFrame = visionAvailable() ? await shot(page) : null
      const move = await discoverMove(page, boardUrl)
      if (move) {
        move.frames = { before: beforeFrame, after: visionAvailable() ? await shot(page) : null }
        // Canonicalise the label the same way discover.js does, so the emitted
        // tool is `moveTask` and not `moveCardBetweenColumns`.
        const g = gesture('move bucket', { scope: 'task' })
        actions.push({ ...move, label: g.label, control: move.label, evidence: { ...move.evidence, control: move.label, controls: [move.label] } })
        console.log(`    \x1b[32m>\x1b[0m ${g.label.padEnd(14)} ${move.label.padEnd(22).slice(0, 22)} [2p] ${move.evidence.announced.text.slice(0, 44)}`)
      }
    }
  }

  // The task detail page: rename, bucket move, label, done, delete. Destructive
  // gestures run against the task apic created itself, one paragraph above.
  if (task) {
    console.log(`  seed ${task} (discovered)`)
    await settle(await discoverTask(page, abs(task), {
      onStep: line('\x1b[36m>\x1b[0m'),
      onLog: (m) => console.log(`  \x1b[33m!\x1b[0m ${m}`),
    }))
  } else {
    console.log(`  \x1b[33m!\x1b[0m no task created in ${project || 'any project'} - skipping the task detail seed (costs 5 tools)`)
  }

  const withParams = actions.filter((a) => a.parameters.length).length
  console.log(`\n  ${actions.length} candidate actions (${withParams} with parameters)`)
  console.log(`  ${summarisePersistence(persistence)}`)

  // One batched SLM call for the whole trajectory, after exploring rather than
  // during it. Falls back to the node-count heuristic if the key is absent or
  // the call fails, so this line can never break a compile.
  const perception = await distill(actions, { log: (m) => console.log(`  \x1b[33m!\x1b[0m ${m}`) })
  console.log(`  ${summarise(perception)}`)

  // fal adjudicates only what the text could not settle - a card that moved
  // column, a value that merely echoed. Toast-confirmed steps never get here.
  const vision = await adjudicate(actions, { log: (m) => console.log(`  \x1b[33m!\x1b[0m ${m}`) })
  console.log(`  ${summariseVision(vision)}`)

  // Frames are ~40KB of base64 each and have done their job by now.
  for (const a of actions) delete a.frames

  mkdirSync('out', { recursive: true })
  writeFileSync('out/actions.json', JSON.stringify(actions, null, 2))
  writeFileSync('out/perception.json', JSON.stringify(perception, null, 2))

  const tools = synthesize(actions)
  const { dir, count } = emit(tools, {
    app: process.env.APIC_APP || 'vikunja',
    outDir: process.env.APIC_OUT_DIR || 'generated',
    target: config.target.url,
  })
  // generated/ is the shared demo artifact and other sessions compile into it
  // too. Snapshot this run's own output so `npm run score out/tools.json`
  // scores what THIS compile produced rather than whatever landed last.
  writeFileSync('out/tools.json', JSON.stringify({ tools }, null, 2))
  console.log(`  ${count} tools synthesised -> ${dir}/`)
  tools.forEach((t) => console.log(`    ${t.destructive ? '\x1b[31m!\x1b[0m' : ' '} ${t.name}(${Object.keys(t.inputSchema.properties).join(', ')})`))

  // Score THIS run, in this process, against the tools it just built.
  //
  // out/ and generated/ are shared with every other session compiling into the
  // same checkout, so `npm run score` reads whichever compile finished last -
  // it read a 5-tool artifact seven seconds after this one wrote 9. A number
  // you cannot attribute to a run is worse than no number, so the run reports
  // its own and never touches the disk to do it.
  try {
    const s = score(tools, await groundTruth())
    console.log(`\n  RECALL    ${s.recall.hit}/${s.recall.total}   (actions apic found)`)
    console.log(`  PRECISION ${s.precision.hit}/${s.precision.total}   (emitted tools that are real)`)
  } catch (e) {
    console.log(`  \x1b[33m!\x1b[0m could not score this run: ${String(e.message).slice(0, 80)}`)
  }
  console.log()
} finally { await closeSession(session) }
