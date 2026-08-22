/**
 * explore.js - drive the app and record what each action does.
 *
 * Two drivers. `playwright` needs no API key and is both the offline fallback
 * (ladder rung 3) and the way this is testable before credentials arrive.
 * `h` is the computer-use driver and picks actions intelligently.
 */
import { chromium } from 'playwright'
import { snapshot, diff, describe } from './perceive.js'
import { config } from './config.js'

// Chrome, not affordances. The rich-text toolbar is the expensive one: the
// description editor contributes ~25 buttons (Bold, Italic, Heading 1...) that
// are formatting controls inside a field, not actions the app exposes.
// apic's own probe artifacts become links on later runs. Exploring your own
// litter produces tools named after test data, so filter it out by construction.
export const PROBE_MARK = 'apic probe'
const SKIP = /log ?out|sign ?out|delete account|settings|admin|language|theme|apic probe|keyboard shortcuts|powered by/i
const CHROME = /^(skip to|vikunja home|hide the menu|show the menu|powered by|keyboard shortcuts|scroll to|open calendar|check out how)/i
const TOOLBAR = /^(bold|italic|underline|strikethrough|code|quote|bullet list|ordered list|task list|image|link|text|horizontal rule|undo|redo|table|\d heading \d|add your reaction)$/i

export async function launch({ headless = true } = {}) {
  const browser = await chromium.launch({ headless })
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  return { browser, page }
}

/** Vikunja login. Kept separate: auth is app-specific and not part of discovery. */
/**
 * Login is app-specific, so it is DISCOVERED rather than configured.
 *
 * Every login form has the same shape: a password input, a text input above it,
 * and a button that submits them. Finding it structurally means a new target
 * needs a URL and credentials, not a code change - which is the difference
 * between a compiler and a Vikunja script.
 */
const LOGIN_PATHS = ['/login', '/user/login', '/signin', '/auth/login', '/users/sign_in']
const AUTH_PATH = /login|signin|sign_in|auth/i
const SUBMIT_TEXT = /sign ?in|log ?in|continue|submit/i

async function findLoginForm(page) {
  const pw = page.locator('input[type="password"]:visible').first()
  if (!(await pw.count())) return null
  const user = page.locator('input[type="text"]:visible, input[type="email"]:visible, input:not([type]):visible').first()
  if (!(await user.count())) return null
  let submit = page.locator('button[type="submit"]:visible, input[type="submit"]:visible').first()
  if (!(await submit.count())) submit = page.locator('button:visible').filter({ hasText: SUBMIT_TEXT }).first()
  return { user, pw, submit }
}

export async function login(page, target = config.target) {
  const { url, user, pass } = target
  const paths = target.loginPath ? [target.loginPath, ...LOGIN_PATHS] : LOGIN_PATHS

  let form = null, landedOn = null
  for (const path of paths) {
    await page.goto(`${url}${path}`, { waitUntil: 'domcontentloaded' }).catch(() => {})
    // The submit click is swallowed if it lands before the framework attaches
    // its handler: the button exists in the DOM well before the app hydrates,
    // so Playwright clicks a dead element and no request is ever made.
    await page.waitForLoadState('networkidle').catch(() => {})

    // A valid stored session redirects the login route away. Filling a form
    // that is not there burns the full Playwright timeout and reads as a
    // broken target - the false failure the session cache exists to prevent.
    if (!AUTH_PATH.test(new URL(page.url()).pathname)) return page.url()

    form = await findLoginForm(page)
    if (form) { landedOn = path; break }
  }
  if (!form) throw new Error(`no login form found at ${url} (tried ${paths.join(', ')})`)

  let status = 0
  page.on('response', (r) => { if (/login|signin|session/i.test(r.url())) status = r.status() })

  for (let attempt = 1; attempt <= 3; attempt++) {
    await form.user.fill(user)
    await form.pw.fill(pass)
    await form.submit.click({ timeout: 4000 }).catch(() => {})

    // Client-side routing means there is no navigation lifecycle to wait on.
    const landed = await page
      .waitForFunction(() => !/login|signin/i.test(location.pathname), null, { timeout: 6000, polling: 150 })
      .then(() => true).catch(() => false)
    if (landed) return page.url()

    // Retrying into a rate limiter only deepens the hole - fail loudly instead.
    if (status === 429) throw new Error(`${url} rate-limited the login (HTTP 429). Reuse a stored session or raise the target's rate limit.`)
    await page.waitForTimeout(700)
  }
  throw new Error(`login failed at ${url}${landedOn} after 3 attempts (last status ${status})`)
}

/**
 * Every visible, enabled affordance in the page's MAIN CONTENT.
 *
 * Scoping to `main` is the single highest-value filter in the whole compiler.
 * Vikunja's document has ~190 clickable elements; ~150 of them are the sidebar,
 * which is the same on every page and contains one entry per project - so every
 * project a previous probe run created came back as a fresh "affordance" and was
 * emitted as a `do*` tool. Actions live in the content area; the chrome does not.
 *
 * Runs as one page.evaluate rather than a round-trip per element: the old
 * version cost ~190 innerText calls per seed, which dominated the compile.
 */
export async function affordances(page) {
  const raw = await page.evaluate(() => {
    const root = document.querySelector('main') || document.body
    const out = []
    for (const el of root.querySelectorAll('button, a[href], [role="button"]')) {
      const r = el.getBoundingClientRect()
      if (!r.width || !r.height) continue
      // Sidebar/breadcrumb chrome can nest inside main - exclude by ancestry.
      if (el.closest('aside, .menu-container, [role="toolbar"], .editor-toolbar')) continue
      if (el.disabled || el.getAttribute('aria-disabled') === 'true') continue
      // Record every handle, not the winner of a || chain.
      //
      // One page mixes three conventions: a project card is aria-labelled with
      // an empty innerText, "NEW PROJECT" is innerText with no aria-label, and
      // the bucket picker reads "To-Do" but is labelled "Kanban bucket: To-Do".
      // Collapsing to one string throws away the other handle, and if the one
      // that won is state-dependent - an empty-collection call to action, say -
      // the recorded control stops resolving the moment the state changes and
      // the emitted tool can never be replayed.
      const clean = (v) => (v || '').trim().replace(/\s+/g, ' ').slice(0, 60)
      const aria = clean(el.getAttribute('aria-label'))
      const text = clean(el.innerText)
      const title = clean(el.getAttribute('title'))
      const label = aria || text
      if (!label) continue
      const handles = [...new Set([aria, text, title].filter(Boolean))]
      out.push({ label, handles, href: el.getAttribute('href') || null })
    }
    return out
  })

  const seen = new Set()
  return raw
    .filter((a) => !SKIP.test(a.label) && !CHROME.test(a.label) && !TOOLBAR.test(a.label))
    // A link to a specific project or task is content, not an action: clicking
    // it navigates to a row somebody created. Those are seeds (see links()),
    // never candidate write actions.
    .filter((a) => !(a.href && RESOURCE_HREF.test(a.href)))
    .filter((a) => (seen.has(a.label) ? false : seen.add(a.label)))
}

// /projects/7, /projects/7/53, /tasks/176 - an instance of a resource.
const RESOURCE_HREF = /^\/(projects|tasks)\/\d+/

/**
 * Links to resource instances, in DOM order. These are how discovery descends:
 * a board is projects -> tasks, and the task detail page is where rename, done,
 * delete, label and bucket-move all live.
 */
export async function links(page, pattern) {
  const hrefs = await page.evaluate(() => {
    const root = document.querySelector('main') || document.body
    return [...root.querySelectorAll('a[href]')].filter((el) => {
      const r = el.getBoundingClientRect()
      return r.width && r.height
    }).map((el) => el.getAttribute('href'))
  })
  const re = pattern || RESOURCE_HREF
  return [...new Set(hrefs.filter((h) => h && re.test(h)))]
}

/**
 * Breadth-first probe: try each affordance, record what changed, return to base.
 * With the `h` driver this becomes goal-directed instead of exhaustive.
 */
export async function probe(page, { baseUrl, limit = 12, onStep } = {}) {
  const trajectory = []
  const home = baseUrl || page.url()

  const candidates = await affordances(page)
  for (const { label } of candidates.slice(0, limit)) {
    await page.goto(home, { waitUntil: 'domcontentloaded' }).catch(() => {})
    await page.waitForTimeout(400)

    const before = await snapshot(page)
    const el = page.locator(`button:visible, a[href]:visible, [role="button"]:visible`).filter({ hasText: label }).first()
    let error = null
    try {
      await el.click({ timeout: 4000 })
      await page.waitForTimeout(900)
    } catch (e) { error = e.message.split('\n')[0] }

    const after = await snapshot(page)
    const d = diff(before, after)
    const step = { label, error, ...d, observedAt: after.url }
    trajectory.push(step)
    onStep?.(step)
  }
  return trajectory
}

export { describe }
