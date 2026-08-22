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
  await page.fill('#username', user)
  await page.fill('#password', pass)
  await page.click('button[type="submit"], button:has-text("Login")')
  await page.waitForURL((u) => !u.pathname.includes('/login'), { timeout: 15000 })
  return page.url()
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
