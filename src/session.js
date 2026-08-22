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
import { existsSync, mkdirSync, statSync } from 'node:fs'
import { dirname } from 'node:path'
import { login } from './explore.js'
import { config } from './config.js'

const STATE = process.env.APIC_SESSION || '.apic/session.json'
const MAX_AGE_MS = 30 * 60 * 1000 // re-authenticate every half hour

/** Is there a stored session recent enough to be worth trying? */
export function isFresh(state = STATE) {
  return existsSync(state) && Date.now() - statSync(state).mtimeMs < MAX_AGE_MS
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
 * Guarantee the session is authenticated, logging in only if the stored one is
 * missing or expired. Returns whether a login was actually spent.
 */
export async function ensure(session, target = config.target) {
  const { page, context, state } = session

  // Not on /login is NOT proof of being logged in.
  //
  // A stored session whose refresh token has expired still renders the whole
  // app: the SPA boots from localStorage, never redirects, and only the writes
  // fail - 401 on /user/token/refresh, and every create silently turns into a
  // generic "Error / unexpected" toast. That reads downstream as "the app
  // rejected this action", so discovery quietly loses every write it tries.
  // Watch for the 401 instead of trusting the URL.
  let unauthorized = false
  const watch = (r) => { if (r.url().includes('/api/v1/') && r.status() === 401) unauthorized = true }
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
      return { reused: true }
    }
  } finally { page.off('response', watch) }

  await login(page, target)
  mkdirSync(dirname(state), { recursive: true })
  await context.storageState({ path: state })
  session.authed = true
  return { reused: false }
}

export async function closeSession(session) {
  await session?.browser?.close().catch(() => {})
}
