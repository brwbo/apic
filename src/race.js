#!/usr/bin/env node
/**
 * race.js - the side-by-side.
 *
 * One task, two ways, at the same time, in one frame:
 *
 *   left   a computer-use agent looking at screenshots and deciding what to
 *          click, which is how you automate an app that has no API today
 *   right  the tool apic compiled for that same action, called directly
 *
 * The claim the whole project rests on is that the second one has no model in
 * it. That is invisible - fast and headless look like nothing at all - so this
 * counts what is actually being spent: wall time, model round-trips and tokens.
 * The right lane's model count is zero by construction, not by measurement.
 *
 * Cost is deliberately NOT guessed. Set APIC_RACE_PRICE_IN / _OUT (dollars per
 * million tokens, from the provider's own page) and it renders a figure; leave
 * them unset and it renders a dash. A made-up number on camera is worse than
 * no number.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from 'playwright'
import OpenAI from 'openai'
import { replay } from './replay.js'
import { openSession, ensure, closeSession, isFresh } from './session.js'
import { config } from './config.js'

const OUT = process.env.APIC_OUT_DIR || 'generated'
const APP = process.env.APIC_APP || 'vikunja'
const TOOL = process.env.APIC_RACE_TOOL || 'createTask'
const MAX_STEPS = Number(process.env.APIC_RACE_MAX_STEPS || 14)
const HEADED = process.argv.includes('--headed')

/**
 * Sequential by default, and that is a correctness decision, not a timid one.
 *
 * Run concurrently against the same board and the two lanes contaminate each
 * other: the compiled lane verifies by diffing the DOM before and after its own
 * action, and the pixel lane is adding rows to that same list at the same time.
 * Measured - 4/4 both lanes sequentially, 2/4 concurrently, failing with
 * "expected creation, got deletion" on a call that did exactly what it should.
 * A red lane on camera for a reason that is not real is the worst outcome here.
 *
 * --concurrent restores the side-by-side. Give the lanes separate boards when
 * you use it (APIC_RACE_PIXEL_URL), or you are filming the artifact above.
 */
const SEQUENTIAL = !process.argv.includes('--concurrent')
const PIXEL_URL = process.env.APIC_RACE_PIXEL_URL || null

/**
 * Window geometry for the filmed frame: two browsers side by side, left one
 * being clicked by a model, right one mutating with nothing touching it.
 *
 * Defaults suit a 1512x982 logical display (a 3024x1964 Retina panel). Override
 * per-machine rather than editing this - the recording rig is not the product.
 */
const [WIN_W, WIN_H] = (process.env.APIC_RACE_WINDOW || '756x900').split('x').map(Number)
const WIN_Y = Number(process.env.APIC_RACE_WINDOW_Y || 0)
const WIN_X = Number(process.env.APIC_RACE_WINDOW_X || 0)

const PRICE_IN = Number(process.env.APIC_RACE_PRICE_IN || 0)
const PRICE_OUT = Number(process.env.APIC_RACE_PRICE_OUT || 0)

const g = (s) => `\x1b[32m${s}\x1b[0m`
const r = (s) => `\x1b[31m${s}\x1b[0m`
const y = (s) => `\x1b[33m${s}\x1b[0m`
const b = (s) => `\x1b[1m${s}\x1b[0m`
const dim = (s) => `\x1b[2m${s}\x1b[0m`

// One name, created by both lanes with a suffix, so each lane asserts on a
// string only it produced. Sharing one title makes both lanes pass whenever
// either one succeeds, which is the one failure this harness must not have.
const STAMP = String(Date.now() % 100000)
const base = process.env.APIC_RACE_TASK || 'launch checklist'
const goalsFor = (lane) =>
  Array.from({ length: N }, (_, i) => `${base} ${STAMP}${lane === 'pixel' ? 'a' : 'b'}${N > 1 ? `-${i + 1}` : ''}`)

const lane = (name, label, how) => ({
  name, label, how,
  state: 'waiting', step: '', steps: 0, calls: 0, tokIn: 0, tokOut: 0, made: 0,
  t0: null, ms: null, ok: null, error: null, log: [],
})

// How many times to do the same thing. One call is a demo; twelve is the
// argument - a per-call model does not amortise, and the gap widens linearly
// while the compiled lane's model count stays flat at zero.
const N = Number(process.env.APIC_RACE_N || (process.argv.includes('--volume') ? 8 : 1))

const lanes = [
  lane('pixel', 'COMPUTER-USE', 'screenshot -> model -> click'),
  lane('compiled', 'apic COMPILED', 'call the tool'),
]
const L = lanes[0]
const R = lanes[1]

const elapsed = (x) => (x.ms ?? (x.t0 ? Date.now() - x.t0 : 0))
const secs = (ms) => `${(ms / 1000).toFixed(1)}s`
const cost = (x) =>
  PRICE_IN || PRICE_OUT
    ? `$${((x.tokIn / 1e6) * PRICE_IN + (x.tokOut / 1e6) * PRICE_OUT).toFixed(4)}`
    : '—'

function note(x, msg) {
  x.step = msg
  x.log.push(`${secs(elapsed(x))}  ${msg}`)
  if (x.log.length > 8) x.log.shift()
}

// ---------------------------------------------------------------- rendering

const COL = 44
const pad = (s, n = COL) => {
  const bare = s.replace(/\x1b\[[0-9;]*m/g, '')
  return s + ' '.repeat(Math.max(0, n - bare.length))
}

function render(done = false) {
  const rows = []
  rows.push('')
  rows.push(`  ${b('apic race')}  ${dim(`${APP} · ${TOOL} · ${N > 1 ? `${N}x, ` : ''}same action, two ways`)}`)
  if (!SEQUENTIAL && !PIXEL_URL) rows.push(`  ${y('!')} ${dim('concurrent on one board - lanes will contaminate each other; set APIC_RACE_PIXEL_URL')}`)
  rows.push('')
  rows.push(`  ${pad(b(L.label))}  ${b(R.label)}`)
  rows.push(`  ${pad(dim(L.how))}  ${dim(R.how)}`)
  rows.push(`  ${pad(dim('─'.repeat(COL - 2)))}  ${dim('─'.repeat(COL - 2))}`)

  const badge = (x) =>
    x.state === 'done' ? (x.ok ? g('  DONE  ') : r(' FAILED ')) : x.state === 'running' ? y(' RUNNING') : dim(' WAITING')

  const line = (l, rr) => rows.push(`  ${pad(l)}  ${rr}`)

  line(badge(L), badge(R))
  line('', '')
  line(`${b(secs(elapsed(L)).padStart(7))}  ${dim('elapsed')}`, `${b(secs(elapsed(R)).padStart(7))}  ${dim('elapsed')}`)
  line(`${String(L.calls).padStart(7)}  ${dim('model round-trips')}`, `${g(String(R.calls).padStart(7))}  ${dim('model round-trips')}`)
  line(`${String(L.tokIn + L.tokOut).padStart(7)}  ${dim('tokens')}`, `${g(String(R.tokIn + R.tokOut).padStart(7))}  ${dim('tokens')}`)
  line(`${cost(L).padStart(7)}  ${dim('cost')}`, `${cost(R).padStart(7)}  ${dim('cost')}`)
  line(`${String(L.steps).padStart(7)}  ${dim('browser steps')}`, `${String(R.steps).padStart(7)}  ${dim('browser steps')}`)
  line(`${String(`${L.made}/${N}`).padStart(7)}  ${dim('tasks created')}`, `${String(`${R.made}/${N}`).padStart(7)}  ${dim('tasks created')}`)
  line('', '')

  const height = Math.max(L.log.length, R.log.length, 6)
  for (let i = 0; i < height; i++) line(dim((L.log[i] || '').slice(0, COL - 2)), dim((R.log[i] || '').slice(0, COL - 2)))

  if (done) {
    rows.push('')
    const speedup = L.ms && R.ms ? (L.ms / R.ms).toFixed(1) : null
    if (speedup) rows.push(`  ${b(`${speedup}x faster`)}, ${b(`${L.calls} model calls -> 0`)}${dim(', same result')}`)
    if (L.error) rows.push(`  ${dim(`computer-use: ${L.error}`)}`)
    if (R.error) rows.push(`  ${dim(`compiled: ${R.error}`)}`)
  }
  rows.push('')

  console.clear()
  console.log(rows.join('\n'))
}

// ------------------------------------------------------------- the two lanes

/**
 * What a model can actually see and act on. Labels only - no selectors, no
 * DOM - because the point of this lane is that it is working from the surface
 * the way a person does.
 *
 * Scoped to the main content and deduplicated. An unfiltered sweep returns 40
 * rows of sidebar chrome - "Mark this project as favorite" once per project -
 * and the one control that actually creates a task never makes the list. That
 * is a harness bug, not a fair handicap: it would make the baseline fail for a
 * reason the baseline is not responsible for.
 */
async function affordances(page) {
  return page.evaluate(() => {
    const vis = (el) => {
      const r = el.getBoundingClientRect()
      return r.width > 0 && r.height > 0 && r.top < innerHeight && r.bottom > 0
    }
    const name = (el) =>
      (el.getAttribute('aria-label') || el.innerText || el.value || el.placeholder || '').trim().replace(/\s+/g, ' ').slice(0, 60)

    const main = document.querySelector('main, [role="main"], .app-content, .content') || document.body
    const seen = new Set()
    const out = []
    for (const el of main.querySelectorAll('button, a[href], [role="button"], input:not([type=hidden]), textarea')) {
      if (!vis(el) || !name(el)) continue
      if (el.closest('nav, aside, .navigation, .menu-container')) continue
      const label = name(el)
      if (seen.has(label)) continue
      seen.add(label)
      out.push({ kind: /^(INPUT|TEXTAREA)$/.test(el.tagName) ? 'input' : 'click', label })
    }
    return out.slice(0, 25)
  })
}

function planner() {
  const hKey = process.env.HAI_API_KEY
  if (hKey) {
    return {
      who: `h ${process.env.HAI_MODEL_NAME || 'holo3-1-35b-a3b'}`,
      model: process.env.HAI_MODEL_NAME || 'holo3-1-35b-a3b',
      client: new OpenAI({ apiKey: hKey, baseURL: process.env.HAI_MODEL_URL || 'https://api.hcompany.ai/v1', timeout: 40000 }),
    }
  }
  if (config.keys.openai) {
    return {
      who: process.env.APIC_RACE_MODEL || 'gpt-4o-mini',
      model: process.env.APIC_RACE_MODEL || 'gpt-4o-mini',
      client: new OpenAI({ apiKey: config.keys.openai, timeout: 40000 }),
    }
  }
  return null
}

const SYSTEM = `You operate a web app by looking at a screenshot. You are given the visible controls.
Reply with JSON only, one action:
{"action":"click","target":"<exact label>"} - press a control
{"action":"type","target":"<exact label>","value":"<text>"} - type into an input
{"action":"press","key":"Enter"} - press a key
Pick targets only from the provided list. Do not explain.`

/**
 * Holo is a reasoning model: it emits `reasoning` before `content`, and a tight
 * max_tokens is spent entirely on the preamble - the API returns 120 completion
 * tokens and a null message. Budget for the thinking, then the answer.
 *
 * This is not overhead to be engineered away, it is the measurement. Deciding
 * which button to press costs a few hundred tokens of reasoning EVERY step, on
 * EVERY run, forever. That is the number this whole harness exists to show.
 */
const MAX_TOKENS = Number(process.env.APIC_RACE_MAX_TOKENS || 700)

/**
 * The honest baseline: no compiled knowledge, one model round-trip per step.
 * This is what automating an app with no API costs today, every single run.
 */
async function pixelLane(session, goals) {
  const p = planner()
  if (!p) throw new Error('no model key - set HAI_API_KEY or OPENAI_API_KEY')
  const { page } = session
  L.state = 'running'
  L.t0 = Date.now()
  note(L, `planner: ${p.who}`)
  for (const goal of goals) {
    await pixelOne(page, p, goal)
    if (!(await visible(page, goal))) break
    L.made++
  }
  L.ok = L.made === goals.length
  L.ms = Date.now() - L.t0
  L.state = 'done'
  if (!L.ok) L.error = `made ${L.made}/${goals.length} after ${L.calls} model calls`
}

async function pixelOne(page, p, goal) {

  // Start at the front door, NOT at recipe.seedUrl.
  //
  // Seeding this lane with the page apic discovered hands it the answer and
  // makes the comparison worthless - it arrives with the task input already on
  // screen and "finds" it in two steps. Finding the right page is precisely the
  // work the compiled lane no longer has to do, so the baseline has to do it.
  await page.goto(PIXEL_URL || config.target.url, { waitUntil: 'domcontentloaded' })
  await page.waitForTimeout(800)

  for (let i = 0; i < MAX_STEPS; i++) {
    if (await visible(page, goal)) { note(L, 'goal visible - stopping'); break }

    const controls = await affordances(page)

    // A headed window with viewport:null can hang for the full 30s default in
    // page.screenshot's "waiting for fonts to load" step. Cap it, and if the
    // frame never arrives fall back to a text-only prompt rather than losing
    // the step - a computer-use agent that cannot see is degraded, not dead,
    // and pretending the step never happened would understate this lane's cost.
    const shot = await page
      .screenshot({ type: 'jpeg', quality: 55, timeout: 8000, animations: 'disabled' })
      .then((buf) => buf.toString('base64'))
      .catch(() => null)
    if (!shot) note(L, 'screenshot timed out - text only')

    const res = await p.client.chat.completions.create({
      model: p.model,
      max_tokens: MAX_TOKENS,
      temperature: 0,
      messages: [
        { role: 'system', content: SYSTEM },
        {
          role: 'user',
          content: [
            { type: 'text', text: `Goal: create a task called "${goal}".\nURL: ${page.url()}\nControls:\n${controls.map((c) => `- [${c.kind}] ${c.label}`).join('\n')}` },
            ...(shot ? [{ type: 'image_url', image_url: { url: `data:image/jpeg;base64,${shot}` } }] : []),
          ],
        },
      ],
    })
    L.calls++
    L.tokIn += res.usage?.prompt_tokens || 0
    L.tokOut += res.usage?.completion_tokens || 0

    // An unusable answer still cost a round-trip and still took wall time. It
    // is counted, not retried silently - "sometimes the model returns nothing"
    // is part of what this approach costs and hiding it would flatter it.
    const act = parse(res.choices?.[0]?.message?.content)
    if (!act?.action) {
      L.duds = (L.duds || 0) + 1
      note(L, `unusable reply (${L.duds})`)
      if (L.duds >= 3) { note(L, 'giving up'); break }
      continue
    }
    L.duds = 0

    L.steps++
    note(L, `${act.action} ${(act.target || act.key || '').slice(0, 28)}`)
    await perform(page, act, goal).catch((e) => note(L, `x ${String(e.message).slice(0, 30)}`))
    await page.waitForTimeout(700)
  }
}

async function perform(page, act, goal) {
  const find = (label) =>
    page.locator('button:visible, a[href]:visible, [role="button"]:visible, input:visible, textarea:visible')
      .filter({ hasText: label })
      .first()

  if (act.action === 'press') return page.keyboard.press(act.key || 'Enter')
  if (act.action === 'type') {
    const value = act.value && act.value.length > 2 ? act.value : goal
    const byPlaceholder = page.getByPlaceholder(act.target, { exact: false }).first()
    if (await byPlaceholder.count()) return byPlaceholder.fill(value)
    const byLabel = page.getByLabel(act.target, { exact: false }).first()
    if (await byLabel.count()) return byLabel.fill(value)
    return page.locator('input:visible, textarea:visible').first().fill(value)
  }
  const byRole = page.getByRole('button', { name: act.target, exact: false }).first()
  if (await byRole.count()) return byRole.click({ timeout: 4000 })
  return find(act.target).click({ timeout: 4000 })
}

const visible = (page, text) =>
  page.locator(`text=${JSON.stringify(text)}`).first().count().then((n) => n > 0).catch(() => false)

function parse(text) {
  if (!text) return null
  const body = String(text).replace(/```(?:json)?/g, '').trim()
  try { return JSON.parse(body) } catch { /* fall through */ }
  const m = body.match(/\{[\s\S]*?\}/)
  if (!m) return null
  try { return JSON.parse(m[0]) } catch { return null }
}

/** The compiled lane. No planner, no screenshot, no model. That is the point. */
async function compiledLane(session, goals) {
  R.state = 'running'
  R.t0 = Date.now()
  note(R, 'no model - calling the tool')

  const tool = tools().find((t) => t.name === TOOL)
  if (!tool) throw new Error(`${TOOL} not in ${OUT}/${APP}/tools.json`)

  const key = Object.keys(tool.inputSchema?.properties || {})[0]
  note(R, `${tool.name}(${key || ''})`)

  for (const goal of goals) {
    const out = await replay(tool, key ? { [key]: goal } : {}, { session })
    R.steps++
    if (!out?.ok) {
      R.error = out?.error || `expected ${out?.expected}, got ${out?.effect}`
      note(R, `rejected: ${out?.effect || out?.error || '?'}`)
      break
    }
    R.made++
    note(R, `${out.effect} confirmed (${R.made})`)
  }
  R.ok = R.made === goals.length
  R.ms = Date.now() - R.t0
  R.state = 'done'
}

const tools = () => JSON.parse(readFileSync(join(OUT, APP, 'tools.json'), 'utf8')).tools
const seedUrl = () => {
  const t = tools().find((x) => x.name === TOOL)
  return t?.recipe?.seedUrl || config.target.url
}

// -------------------------------------------------------------------- driver

/**
 * A positioned browser window, in the shape `ensure()` and `replay()` expect.
 *
 * Deliberately NOT a change to session.js. openSession has no window-placement
 * argument, and adding one would put a recording concern into the file every
 * other stage depends on - and into a file a second session may be editing.
 * The storageState logic is mirrored, not reimplemented: same file, same
 * freshness rule, so neither lane spends a login.
 */
async function openWindow({ headless, x, y }) {
  const state = process.env.APIC_SESSION || '.apic/session.json'
  const browser = await chromium.launch({
    headless,
    args: headless ? [] : [`--window-position=${x},${y}`, `--window-size=${WIN_W},${WIN_H}`],
  })
  const context = await browser.newContext({
    // A headed window should fill itself; a fixed viewport leaves grey bars
    // down the side of the shot.
    viewport: headless ? { width: 1440, height: 900 } : null,
    storageState: isFresh(state) ? state : undefined,
  })
  const page = await context.newPage()
  return { browser, context, page, state, authed: false }
}

/**
 * Authenticate ONCE before either lane opens a browser. Vikunja rate limits
 * the login route, so two lanes racing to log in is a self-inflicted failure
 * that looks exactly like the app being slow - which would flatter the wrong
 * lane. Both lanes then boot from the saved state and neither spends a login.
 */
async function warm() {
  const s = await openSession({ headless: true })
  await ensure(s)
  await closeSession(s)
}

const ticker = setInterval(() => render(), 120)

let a, c
try {
  render()
  await warm()

  // Both lanes visible when filming. The right-hand window is the shot: the
  // board fills with nobody driving it, no cursor, no page being read.
  a = await openWindow({ headless: !HEADED, x: WIN_X, y: WIN_Y })
  c = await openWindow({ headless: !HEADED, x: WIN_X + WIN_W, y: WIN_Y })

  // Compose the frame before anything starts moving. Both windows show their
  // starting page, the counters read zero, and the viewer gets a beat to see
  // that the right-hand board is empty. Done outside the lanes so it lands
  // before t0 and costs neither side a millisecond of the measurement.
  if (HEADED) {
    await Promise.all([
      a.page.goto(PIXEL_URL || config.target.url, { waitUntil: 'domcontentloaded' }).catch(() => {}),
      c.page.goto(seedUrl(), { waitUntil: 'domcontentloaded' }).catch(() => {}),
    ])
    await new Promise((res) => setTimeout(res, Number(process.env.APIC_RACE_HOLD_MS || 2500)))
  }

  const left = () => pixelLane(a, goalsFor('pixel')).catch((e) => {
    L.state = 'done'; L.ok = false; L.ms = Date.now() - (L.t0 || Date.now()); L.error = e.message
  })
  const right = () => compiledLane(c, goalsFor('compiled')).catch((e) => {
    R.state = 'done'; R.ok = false; R.ms = Date.now() - (R.t0 || Date.now()); R.error = e.message
  })

  if (SEQUENTIAL) { await right(); await left() } else await Promise.all([left(), right()])
} finally {
  clearInterval(ticker)
  await closeSession(a)
  await closeSession(c)
  render(true)

  mkdirSync('out', { recursive: true })
  const result = {
    app: APP,
    tool: TOOL,
    n: N,
    at: new Date().toISOString(),
    pixel: { ms: L.ms, ok: L.ok, made: L.made, modelCalls: L.calls, tokensIn: L.tokIn, tokensOut: L.tokOut, browserSteps: L.steps, error: L.error },
    compiled: { ms: R.ms, ok: R.ok, made: R.made, modelCalls: 0, tokensIn: 0, tokensOut: 0, browserSteps: R.steps, error: R.error },
    speedup: L.ms && R.ms ? Number((L.ms / R.ms).toFixed(1)) : null,
  }
  writeFileSync('out/race.json', JSON.stringify(result, null, 2))
  console.log(dim('  out/race.json written\n'))
}
