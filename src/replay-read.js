/**
 * replay-read.js - execute a compiled READ tool against the live site.
 *
 * The write path proves an action by making a state change the app confirms.
 * A read has no such confirmation to wait for: the proof is that the recipe
 * still resolves a repeated row structure and that the recorded per-field
 * selectors still carry text. So this is the deterministic half - no model in
 * the loop - and everything it needs was decided at compile time.
 *
 * Read-only by construction: it navigates, it fills search boxes, it clicks
 * filters. There is no code path here that logs in, adds to a basket or
 * touches checkout, and the crawl budget is enforced in one place (`visit`).
 */
import { chromium } from 'playwright'

// A normal desktop Chrome UA. Not evasion - the default Playwright UA advertises
// HeadlessChrome, and consumer sites serve it a degraded page that has none of
// the structure a recipe was compiled against.
export const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

// One request per second, globally, across every caller in this process.
const MIN_GAP_MS = Number(process.env.APIC_READ_GAP_MS || 1000)
let lastRequest = 0

async function throttle() {
  const wait = MIN_GAP_MS - (Date.now() - lastRequest)
  if (wait > 0) await new Promise((r) => setTimeout(r, wait))
  lastRequest = Date.now()
}

/** A challenge page is a stop sign, not an obstacle. Never work around one. */
const CHALLENGE = /captcha|are you a (human|robot)|unusual traffic|verify you are|access denied|checking your browser|attention required/i

export class ChallengeError extends Error {
  constructor(url, detail) {
    super(`challenge page at ${url} - stopping. ${detail}`)
    this.name = 'ChallengeError'
    this.url = url
  }
}

export async function openRead({ headless = true } = {}) {
  const browser = await chromium.launch({ headless })
  const context = await browser.newContext({
    userAgent: UA,
    viewport: { width: 1440, height: 900 },
    locale: 'en-GB',
  })
  return { browser, context, page: await context.newPage() }
}

/**
 * Navigate, decline non-essential cookies, let lazy content in, and refuse to
 * continue if the site put up a challenge.
 */
export async function visit(page, url, { scroll = true } = {}) {
  await throttle()
  const res = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 })
  const status = res?.status() ?? 0
  await page.waitForTimeout(2500)
  await consent(page)
  if (scroll) {
    for (const y of [1200, 2600]) {
      await page.evaluate((k) => window.scrollTo(0, k), y).catch(() => {})
      await page.waitForTimeout(900)
    }
    await page.evaluate(() => window.scrollTo(0, 0)).catch(() => {})
    await page.waitForTimeout(400)
  }
  const title = await page.title().catch(() => '')
  const body = await page.evaluate(() => document.body.innerText.slice(0, 400)).catch(() => '')
  if (status === 403 || status === 429 || CHALLENGE.test(title) || CHALLENGE.test(body)) {
    throw new ChallengeError(url, `status ${status}, title "${title}"`)
  }
  return status
}

/** Decline everything optional. The banner also overlays the page until it goes. */
async function consent(page) {
  for (const label of ['Reject all', 'Reject All', 'Decline optional', 'Only necessary']) {
    const b = page.locator(`button:has-text("${label}")`).first()
    if (await b.count().catch(() => 0)) {
      await b.click({ timeout: 4000 }).catch(() => {})
      await page.waitForTimeout(1200)
      return
    }
  }
}

/**
 * Read the rows a recipe points at.
 *
 * Runs entirely in the page so a row is only ever matched against its own
 * subtree: two restaurants both have a `partner-name`, and a document-wide
 * query for one would return the first row's value for every row.
 */
export async function extractRows(page, recipe, limit = 40) {
  await page.waitForSelector(recipe.container, { timeout: 15000 }).catch(() => {})
  await page.waitForTimeout(800)
  return page.evaluate(({ container, rowSelector, fields, limit }) => {
    const out = []
    // A page can render one list per category (menu sections, product rails).
    // The compiled selector identifies the repeated list component, so gather
    // every matching instance instead of silently returning the first section.
    for (const root of document.querySelectorAll(container)) {
      const rows = rowSelector ? [...root.querySelectorAll(rowSelector)] : [...root.children]
      for (const row of rows) {
        if (out.length >= limit) return out
        const rec = {}
        let any = false
        for (const f of fields) {
          const el = f.selector ? row.querySelector(f.selector) : null
          let v = ''
          if (f.derive === 'currency') v = row.textContent.match(/(?:£|\$|€)\s?\d+(?:[.,]\d{1,2})?/)?.[0] || ''
          else if (el) v = (f.attr ? el.getAttribute(f.attr) : el.textContent) || ''
          v = v.trim().replace(/\s+/g, ' ')
          if (f.attr === 'href' && v && v.startsWith('/')) v = new URL(v, location.origin).toString()
          rec[f.name] = v
          if (v) any = true
        }
        if (any) out.push(rec)
      }
    }
    return out
  }, { container: recipe.container, rowSelector: recipe.rowSelector || null, fields: recipe.fields, limit })
}

/** Substitute {placeholders} in a url template, encoding each value. */
export function fillTemplate(template, args) {
  return template.replace(/\{(\w+)\}/g, (_, k) => {
    const v = args[k]
    if (v === undefined || v === '') return ''
    // Linked collection tools intentionally take an absolute same-origin URL;
    // it is validated immediately after substitution. Encoding it here would
    // turn https://… into a path on the compiled site.
    if (template === `{${k}}`) return String(v)
    return encodeURIComponent(String(v)).replace(/%2F/gi, '/')
  }).replace(/\?&/, '?').replace(/[?&]$/, '')
}

/**
 * A public read tool may accept a URL returned by another tool, but must never
 * become a general-purpose browser for an agent prompt. Recipes record the
 * target origin at compile time; calls may only revisit that public site.
 */
export function sameOrigin(url, origin) {
  try { return new URL(url).origin === new URL(origin).origin } catch { return false }
}

function requiredArgs(tool, args) {
  return (tool.inputSchema?.required || []).filter((key) => args[key] === undefined || args[key] === '')
}

/**
 * Run a compiled read tool. Two shapes of recipe:
 *
 *   via 'url'  - the probe changed the address bar, so the query is a URL and
 *                replay is one navigation.
 *   via 'form' - the probe typed into a search box, so replay retypes it. The
 *                site may still land on a URL; we return wherever we ended up.
 */
export async function replayRead(tool, args = {}, { session = null, headless = true } = {}) {
  const own = !session
  const s = session ?? (await openRead({ headless }))
  const { page } = s
  const { recipe } = tool
  try {
    const missing = requiredArgs(tool, args)
    if (missing.length) return { ok: false, kind: 'read', error: `missing required argument(s): ${missing.join(', ')}` }
    if (recipe.via === 'url') {
      const url = fillTemplate(recipe.urlTemplate, args)
      if (!sameOrigin(url, recipe.origin)) return { ok: false, kind: 'read', error: 'URL must stay on the compiled public site' }
    }
    if (recipe.via === 'form') {
      if (!sameOrigin(recipe.seedUrl, recipe.origin)) return { ok: false, kind: 'read', error: 'invalid compiled seed origin' }
      await visit(page, recipe.seedUrl, { scroll: false })
      for (const f of recipe.inputs) {
        const v = args[f.schemaKey]
        if (v === undefined) continue
        await page.fill(f.selector, String(v), { timeout: 8000 })
        if (f.selectSuggestion) {
          await page.waitForTimeout(600)
          const option = page.locator('[role="option"]:visible, [data-testid*="suggestion"]:visible').first()
          if (await option.count().catch(() => 0)) await option.click({ timeout: 3000 }).catch(() => {})
        }
      }
      await page.waitForTimeout(1500)
      await submitSearch(page, recipe.submit)
      await page.waitForTimeout(4500)
      // Match discovery's bounded lazy-load pass. A result grid can be present
      // in the post-search DOM but not hydrate until it enters the viewport;
      // stopping at 900px made a recipe that discovery just observed fail cold.
      for (const y of [1200, 2600]) {
        await page.evaluate((k) => window.scrollTo(0, k), y).catch(() => {})
        await page.waitForTimeout(900)
      }
      await page.evaluate(() => window.scrollTo(0, 0)).catch(() => {})
      await page.waitForTimeout(600)
    } else {
      await visit(page, fillTemplate(recipe.urlTemplate, args))
    }

    const rows = await extractRows(page, recipe)
    return {
      ok: rows.length > 0,
      kind: 'read',
      url: page.url(),
      count: rows.length,
      rows,
      ...(rows.length ? {} : { error: `no rows matched ${recipe.container} on ${page.url()}` }),
    }
  } catch (e) {
    if (e instanceof ChallengeError) return { ok: false, kind: 'read', challenge: true, error: e.message }
    return { ok: false, kind: 'read', error: String(e.message).slice(0, 200) }
  } finally {
    if (own) await s.browser.close().catch(() => {})
  }
}

/**
 * Commit a search. A consumer search box is not a <form> with a Save button -
 * forms.js's SUBMIT verbs never match "Search" - and the button is often a div
 * that a lingering modal backdrop will swallow a real click on. Dispatch the
 * element's own click, then fall back to Enter, which every search box honours.
 */
async function submitSearch(page, label) {
  if (label) {
    const clicked = await page.evaluate((want) => {
      const el = [...document.querySelectorAll('button, a[href], [role="button"], input[type="submit"]')]
        .find((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && ((e.value || e.innerText || '').trim().toLowerCase() === want.toLowerCase()) })
      if (!el) return false
      el.click()
      return true
    }, label).catch(() => false)
    if (clicked) return
  }
  await page.keyboard.press('Enter').catch(() => {})
}

/**
 * Cold verification: a browser this tool has never seen, then the tool's own
 * required fields checked for emptiness. A recipe that returns forty rows with
 * a blank name is a broken recipe that happens to find divs.
 */
export async function verifyRead(tool, args) {
  const required = tool.inputSchema?.required || []
  const call = args || Object.fromEntries(required.map((k) => [k, tool.samples?.[k] ?? '']))
  const res = await replayRead(tool, call)
  if (!res.ok) return { verified: false, reason: res.error || 'no rows', at: new Date().toISOString(), rows: 0 }
  const need = (tool.rowSchema?.required || []).length
    ? tool.rowSchema.required
    : Object.keys(tool.rowSchema?.properties || {})
  const bad = res.rows.filter((r) => need.some((k) => !String(r[k] || '').trim()))
  return {
    verified: bad.length < res.rows.length,
    reason: bad.length
      ? `${res.rows.length - bad.length}/${res.rows.length} rows carry every required field (${need.join(', ')})`
      : `${res.rows.length} rows, all of ${need.join(', ')} non-empty`,
    at: new Date().toISOString(),
    rows: res.rows.length,
    sample: res.rows.slice(0, 3),
    calledWith: call,
  }
}

/**
 * A row field can be meaningful but optional (a price missing on a meal deal,
 * a description absent on a catalogue card). If cold replay proves the list
 * but rejects it solely because such a field was marked required, keep the
 * dependable columns and make the sparse ones optional. A tool with names is
 * useful; a tool discarded for one blank badge is not.
 */
export function relaxReadSchema(tool, result) {
  const rows = result?.rows || []
  if (!rows.length) return false
  const props = tool.rowSchema?.properties || {}
  const coverage = Object.fromEntries(Object.keys(props).map((key) => [key, rows.filter((r) => String(r[key] || '').trim()).length]))
  const surviving = Object.keys(props).filter((key) => coverage[key] > 0)
  if (!surviving.length) return false
  const required = surviving.includes('name') ? ['name'] : [surviving.sort((a, b) => coverage[b] - coverage[a])[0]]
  tool.rowSchema = {
    ...tool.rowSchema,
    properties: Object.fromEntries(surviving.map((key) => [key, props[key]])),
    required,
  }
  tool.recipe.fields = tool.recipe.fields.filter((field) => surviving.includes(field.name))
  return true
}
