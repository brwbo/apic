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
 */
import { chromium } from 'playwright'
import { existsSync, mkdirSync, statSync, readFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { login } from './explore.js'
import { config } from './config.js'

const STATE = process.env.APIC_SESSION || '.apic/session.json'
const MAX_AGE_MS = 30 * 60 * 1000 // re-authenticate every half hour

/**
 * Is there a stored session recent enough to be worth trying?
 *
 * Ask the cookies, not the filesystem. The access token lives ~10 minutes and
 * the refresh cookie ~3 days, so a single mtime window is wrong in both
 * directions: it discards a session that is still good and trusts one that is
 * long dead. mtime stays as the fallback for a state file with no dated cookies.
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

/** Persist cookies + localStorage exactly as they stand right now. */
async function save(session) {
  try {
    mkdirSync(dirname(session.state), { recursive: true })
    await session.context.storageState({ path: session.state })
  } catch { /* a session that cannot be cached is still a usable session */ }
}

/**
 * Wipe a credential the app has already rejected, before trying to log in.
 *
 * A dead token still makes the SPA route `/login` away, so `login()` finds no
 * form, returns early, and the whole compile then runs unauthenticated. That
 * surfaces downstream as discovery finding nothing - it looks like a discovery
 * regression, not like an auth failure, which is what makes it expensive.
 */
async function clearCredentials(session) {
  await session.page.evaluate(() => { try { localStorage.clear() } catch { /* ignore */ } }).catch(() => {})
  await session.context.clearCookies().catch(() => {})
}

/**
 * Optional window placement, for filming a headed compile beside the agent that
 * launched it. Off unless APIC_WINDOW is set, so every existing caller keeps
 * the 1440x900 headless context it had.
 *
 * The viewport is sized to the window rather than left null: with viewport:null
 * a headed page.screenshot can hang the full 30s in "waiting for fonts to load",
 * and perceive.js screenshots on every step of a compile.
 */
const WINDOW = process.env.APIC_WINDOW || null
const [WIN_W, WIN_H] = (WINDOW || '1440x900').split('x').map(Number)
const [WIN_X, WIN_Y] = (process.env.APIC_WINDOW_POS || '0,0').split(',').map(Number)
const CHROME_H = Number(process.env.APIC_WINDOW_CHROME || 88) // toolbar + tab strip

/** Browser + context + page, with any stored session already applied. */
export async function openSession({ headless = true, state = STATE } = {}) {
  const placed = Boolean(WINDOW) && !headless
  const browser = await chromium.launch({
    headless,
    args: placed ? [`--window-position=${WIN_X},${WIN_Y}`, `--window-size=${WIN_W},${WIN_H}`] : [],
  })
  const context = await browser.newContext({
    viewport: placed ? { width: WIN_W, height: Math.max(400, WIN_H - CHROME_H) } : { width: 1440, height: 900 },
    storageState: isFresh(state) ? state : undefined,
  })
  const page = await context.newPage()
  return { browser, context, page, state, authed: false }
}

/**
 * Guarantee the session is authenticated, logging in only if the stored one is
 * missing or expired. Returns whether a login was actually spent.
 */
export async function ensure(session, target = config.target) {
  const { page } = session

  // Not on /login is NOT proof of being logged in.
  //
  // A stored session whose refresh token has expired still renders the whole
  // app: the SPA boots from localStorage, never redirects, and only the writes
  // fail - 401 on /user/token/refresh, and every create silently turns into a
  // generic "Error / unexpected" toast. That reads downstream as "the app
  // rejected this action", so discovery quietly loses every write it tries.
  // Watch for the 401 instead of trusting the URL.
  //
  // But not every 401 means the session is dead. The SPA fires
  // POST /user/token/refresh on every boot, and a *restored* session 401s it as
  // a matter of course - the refresh cookie it presents has already been
  // rotated - while /user, /projects and /labels on that very same load all
  // return 200. Counting that one threw a working session away on every call,
  // which is what made `guard()` re-authenticate before all five seeds.
  let unauthorized = false
  const watch = (r) => {
    if (!r.url().includes('/api/v1/') || r.status() !== 401) return
    if (/\/token\/refresh\b/.test(r.url())) return
    unauthorized = true
  }
  page.on('response', watch)
  try {
    await page.goto(`${target.url}${target.probePath || '/'}`, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(900)

    // Nor is a 401 the only tell. Gitea serves a landing page at / to logged-out
    // users - no redirect, no 401, just a Sign In link. Ask structurally.
    const signedOut = await page.evaluate(() => {
      if (document.querySelector('input[type="password"]')) return true
      return [...document.querySelectorAll('a, button')]
        .some((el) => /^\s*(sign ?in|log ?in)\s*$/i.test((el.innerText || '').trim()))
    }).catch(() => false)

    if (!page.url().includes('/login') && !unauthorized && !signedOut) {
      session.authed = true
      // The boot rotated the refresh cookie. Store what we hold NOW - writing
      // state only after a login leaves a spent credential on disk, which is
      // why a session never survived to the next run.
      await save(session)
      return { reused: true }
    }
  } finally { page.off('response', watch) }

  await clearCredentials(session)
  await login(page, target)
  await save(session)
  session.authed = true
  return { reused: false }
}

export async function closeSession(session) {
  if (session?.authed) await save(session)
  await session?.browser?.close().catch(() => {})
}
