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
export async function login(page, { url, user, pass } = config.target) {
  await page.goto(`${url}/login`, { waitUntil: 'domcontentloaded' })
  // The submit click is swallowed if it lands before Vue attaches its handler:
  // the button exists in the DOM well before the app hydrates, so Playwright
  // clicks a dead element and no request is ever made. Measured at a ~30-50%
  // cold-start failure rate, which is why this waits, then retries.
  await page.waitForLoadState('networkidle').catch(() => {})

  let status = 0
  const watch = (r) => { if (r.url().includes('/api/v1/login')) status = r.status() }
  page.on('response', watch)

  try {
    for (let attempt = 1; attempt <= 3; attempt++) {
      await page.fill('#username', user)
      await page.fill('#password', pass)
      await page.click('button[type="submit"], button:has-text("Login")')

      // Client-side routing means no navigation lifecycle event to wait on.
      const landed = await page
        .waitForFunction(() => !location.pathname.includes('/login'), null, { timeout: 5000, polling: 150 })
        .then(() => true)
        .catch(() => false)
      if (landed) return page.url()

      // Retrying into a rate limiter only deepens the hole - fail loudly instead.
      if (status === 429) {
        throw new Error(
          'Vikunja rate-limited the login (HTTP 429). Every replay() logs in fresh, ' +
          'so a watch cycle over N tools costs N logins. Reuse a stored session or ' +
          'raise the target\'s rate limit.',
        )
      }
      await page.waitForTimeout(attempt * 1000) // back off before trying again
    }
    throw new Error(`login failed after 3 attempts as ${user} at ${url}${status ? ` (last login status ${status})` : ''}`)
  } finally { page.off('response', watch) }
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
      const label = (el.getAttribute('aria-label') || el.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 60)
      if (!label) continue
      out.push({ label, href: el.getAttribute('href') || null })
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
