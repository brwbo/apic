/**
 * session.js - one login, reused.
 *
 * replay() used to log in once per tool invocation, launching a browser each
 * time. A watch cycle over N tools therefore cost N logins, and Vikunja rate
 * limits unauthenticated routes: the tools went red for a reason that had
 * nothing to do with the UI drifting - the exact signal the heal loop exists
 * to detect, generated spuriously.
 *
 * Log in once, persist cookies + localStorage, reuse. h's free tier is 5 req/min,
 * so the same discipline applies there: authenticate rarely, act often.
 *
 * Measured against the live target on 2026-08-22: POST /api/v1/login and
 * POST /api/v1/user/token/refresh share ONE 10-request / 30-second bucket
 * (a refresh and a login decrement the same X-Ratelimit-Remaining). The SPA
 * fires a refresh on every boot, so every page.goto() spends login budget.
 * That is why this file navigates as little as it can get away with.
 */
import { chromium } from 'playwright'
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs'
import { dirname } from 'node:path'
import { login } from './explore.js'
import { config } from './config.js'

const STATE = process.env.APIC_SESSION || '.apic/session.json'
const MAX_AGE_MS = 30 * 60 * 1000 // fallback when the state carries no expiry
// A route that requires authentication. A 2xx here is proof; nothing else is.
const AUTH_PROBE = '/api/v1/user'

/**
 * Is there a stored session worth trying?
 *
 * File mtime is the wrong clock. The access token in localStorage lives ten
 * minutes, but the refresh cookie beside it lives days, and a boot with an
 * expired access token and a live refresh cookie authenticates fine - so an
 * mtime window either throws away a usable session or keeps a dead one. Ask
 * the stored credentials when they expire instead, and fall back to mtime only
 * when nothing in the file says.
 */
export function isFresh(state = STATE) {
  if (!existsSync(state)) return false
  try {
    const stored = JSON.parse(readFileSync(state, 'utf8'))
    const expiries = (stored.cookies || []).map((c) => c.expires).filter((e) => e > 0)
    if (expiries.length) return Math.max(...expiries) * 1000 > Date.now()
  } catch { /* unreadable state is stale state */ }
  return Date.now() - statSync(state).mtimeMs < MAX_AGE_MS
}

/** Browser + context + page, with any stored session already applied. */
export async function openSession({ headless = true, state = STATE } = {}) {
  const browser = await chromium.launch({ headless })
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    storageState: isFresh(state) ? state : undefined,
  })
  const page = await context.newPage()
  return { browser, context, page, state, authed: false }
}

/**
 * Write the session back to disk.
 *
 * This has to happen on every touch, not just after a login. The refresh
 * cookie ROTATES: the app boots, refreshes, and the cookie captured a moment
 * ago is spent. Saving only after login left the file holding a consumed
 * refresh token, so the next run booted, presented it, was refused, and
 * re-authenticated - the whole reason a stored session never survived a run.
 */
async function save(session) {
  try {
    mkdirSync(dirname(session.state), { recursive: true })
    await session.context.storageState({ path: session.state })
  } catch { /* a session that cannot be cached is still a usable session */ }
}

/**
 * Does the browser hold a working credential right now?
 *
 * Not on /login is NOT proof of being logged in: a stored session whose token
 * has expired still renders the whole app, because the SPA boots from
 * localStorage and never redirects. Only the writes fail, which reads
 * downstream as "the app rejected this action" and quietly loses every write
 * discovery tries.
 *
 * Watching for a 401 instead was the previous fix, and it over-corrected. The
 * SPA's token refresh 401s routinely on a restored session - the cookie it
 * presents has been rotated - while every data route on the same page load
 * returns 200. Treating that as a dead session threw away a working one on
 * every single call. So: ask a route that requires auth, and believe the answer.
 */
async function authenticated(page, target) {
  // Only navigate when we are not already somewhere on the target. Each boot
  // of the SPA spends a unit of the shared login/refresh budget, and cli.js
  // guards before all five of its seeds.
  if (!page.url().startsWith(target.url)) {
    await page.goto(`${target.url}/projects`, { waitUntil: 'domcontentloaded' }).catch(() => {})
    await page.waitForTimeout(900) // let the SPA boot and rotate its token
  }
  if (page.url().includes('/login')) return { ok: false, rejected: true }

  return page
    .evaluate(async ({ base, probe }) => {
      const token = (localStorage.getItem('token') || '').replace(/^"|"$/g, '')
      if (!token) return { ok: false, status: 0 }
      const r = await fetch(base + probe, { headers: { Authorization: `Bearer ${token}` } })
      return { ok: r.ok, status: r.status }
    }, { base: target.url, probe: AUTH_PROBE })
    // A probe that could not run is not a rejection: do not throw away a
    // session, and above all do not clear it, over a transient failure.
    .then((r) => ({ ok: r.ok, rejected: r.status === 0 || r.status === 401 || r.status === 403 }))
    .catch(() => ({ ok: false, rejected: false }))
}

/**
 * A dead credential is worse than none.
 *
 * The SPA redirects /login away whenever localStorage holds a token, expired
 * or not - so login() finds no form, returns early, and the caller is told a
 * session exists when it does not. That is the silent-degradation failure:
 * discovery explores logged out and emits three actions instead of eleven.
 * Clear the corpse so the login form is actually rendered.
 */
async function clearCredentials(session) {
  await session.page.evaluate(() => { try { localStorage.removeItem('token') } catch { /* ignore */ } }).catch(() => {})
  await session.context.clearCookies().catch(() => {})
}

/**
 * Guarantee the session is authenticated, logging in only if the stored one is
 * missing or expired. Returns whether a login was actually spent.
 */
export async function ensure(session, target = config.target) {
  const { page } = session

  const proof = await authenticated(page, target)
  if (proof.ok) {
    session.authed = true
    await save(session) // capture the rotated cookie, not the one we booted with
    return { reused: true }
  }

  if (proof.rejected) await clearCredentials(session)
  await login(page, target)
  await save(session)
  session.authed = true
  return { reused: false }
}

export async function closeSession(session) {
  // The refresh cookie rotated many times since the last ensure(); persist the
  // current one so the NEXT run starts from a credential the server still
  // honours rather than a spent one.
  if (session?.authed && session?.context) await save(session)
  await session?.browser?.close().catch(() => {})
}
