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

const SKIP = /log ?out|sign ?out|delete account|settings|admin|language|theme/i

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

/** Every visible, enabled affordance on the current page. */
export async function affordances(page) {
  const els = await page.$$('button:visible, a[href]:visible, [role="button"]:visible')
  const out = []
  for (const el of els) {
    const label = ((await el.getAttribute('aria-label')) || (await el.innerText()) || '').trim().replace(/\s+/g, ' ').slice(0, 60)
    if (!label || SKIP.test(label)) continue
    if (await el.isDisabled().catch(() => false)) continue
    out.push({ label, handle: el })
  }
  // de-dupe by label; the first instance is representative
  const seen = new Set()
  return out.filter((a) => (seen.has(a.label) ? false : seen.add(a.label)))
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
