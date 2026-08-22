/**
 * seeds.js - find the pages worth exploring, instead of naming them.
 *
 * Discovery has to start somewhere, and until now that somewhere was a
 * constant: `['/projects', '/labels']`. Both 404 on Gitea, so a Gitea compile
 * explored two error pages, found nothing, and emitted zero tools - not
 * because anything was hard, but because the entry points were Vikunja's.
 *
 * The app already knows where its own pages are: they are in its navigation.
 * This reads them, ranks them, and proves them by visiting.
 *
 * Ranking is where ground.js pays off. A nav link is a candidate because its
 * path names one of the app's own domain objects - `/issues` scores on Gitea
 * because Tavily read Gitea's docs and learned `issue`, and `/projects` scores
 * on Vikunja for the same reason. Without a grounded vocabulary the ranking
 * falls back to the built-in nouns, which is exactly the Vikunja-only
 * behaviour this replaces. The vocabulary is not decoration here; it is what
 * tells one route from another.
 *
 * Never throws and never returns nothing useful: if discovery finds no proven
 * seed, the caller's configured list stands.
 */
import { affordances } from './explore.js'
import { vocabulary } from './plan.js'

/** Routes that write nothing worth compiling, or that end the session. */
const NOT_A_SEED = /log ?out|sign ?out|logout|signout|\/user\/settings|\/admin|\/notifications|\/help|\/docs?$|\/api\b|\/swagger|\.(png|jpg|svg|css|js|json|xml|ico)$|^mailto:|^tel:/i

/** A seed is a listing page. An instance is something discovery descends into later. */
const INSTANCE = /\/\d+(\/|$)/

const pathOf = (href, baseUrl) => {
  try {
    const u = new URL(href, baseUrl)
    if (u.origin !== new URL(baseUrl).origin) return null
    return u.pathname.replace(/\/+$/, '') || '/'
  } catch { return null }
}

/** Every same-origin link on the page, navigation included. */
async function candidates(page, baseUrl) {
  const hrefs = await page.evaluate(() =>
    [...document.querySelectorAll('a[href]')]
      .filter((el) => { const r = el.getBoundingClientRect(); return r.width && r.height })
      .map((el) => ({ href: el.getAttribute('href'), text: (el.innerText || '').trim().slice(0, 40) })),
  ).catch(() => [])

  const seen = new Set()
  const out = []
  for (const { href, text } of hrefs) {
    if (!href || NOT_A_SEED.test(href)) continue
    const path = pathOf(href, baseUrl)
    if (!path || path === '/' || INSTANCE.test(path) || seen.has(path)) continue
    seen.add(path)
    out.push({ path, text })
  }
  return out
}

/**
 * Score a route by whether it names one of the app's own objects.
 *
 * Depth is a tiebreak, not a signal in itself: `/issues` and `/repo/create`
 * both name objects, and the shallower one lists more of them.
 */
export function score(path, terms) {
  const segments = path.toLowerCase().split('/').filter(Boolean)
  if (!segments.length) return 0

  let best = 0
  for (const term of terms) {
    const t = String(term).toLowerCase().replace(/\s+/g, '')
    if (t.length < 3) continue
    for (const seg of segments) {
      // Exact, or the plural the route almost always uses: /issues for issue.
      if (seg === t || seg === `${t}s` || seg === `${t}es`) { best = Math.max(best, 100); continue }
      // Routes abbreviate what the docs spell out. Gitea's own nav links
      // /repo/create while its documentation says "repository", and without
      // this the single most valuable seed on the app scores zero.
      if (t.startsWith(seg) && seg.length >= 3) { best = Math.max(best, 70); continue }
      if (seg.includes(t)) best = Math.max(best, 40)
    }
  }
  if (!best) return 0
  return best - segments.length * 5
}

export function rank(found, terms) {
  return found
    .map((c) => ({ ...c, score: score(c.path, terms) }))
    .filter((c) => c.score > 0)
    .sort((a, b) => b.score - a.score)
}

/**
 * Discover, then PROVE. A route that scores well and 404s is worse than no
 * route at all - it is the current failure mode, two error pages explored in
 * silence - so each candidate is visited and kept only if the app served it
 * and it actually exposes controls.
 */
export async function discoverSeeds(page, { baseUrl, terms, limit = 4, probe = 8, log } = {}) {
  const nouns = terms?.length ? terms : vocabulary()
  try {
    await page.goto(baseUrl, { waitUntil: 'domcontentloaded' })
    await page.waitForTimeout(800)
  } catch (e) { log?.(`could not load ${baseUrl}: ${e.message}`); return [] }

  const ranked = rank(await candidates(page, baseUrl), nouns)
  if (!ranked.length) { log?.(`no nav link names any known object (${nouns.join(', ')})`); return [] }

  const proven = []
  for (const c of ranked.slice(0, probe)) {
    if (proven.length >= limit) break
    let ok = false, count = 0
    try {
      const res = await page.goto(`${baseUrl}${c.path}`, { waitUntil: 'domcontentloaded' })
      await page.waitForTimeout(700)
      const status = res?.status() ?? 0
      count = (await affordances(page).catch(() => [])).length
      ok = status < 400 && count > 0
      if (!ok) log?.(`rejected ${c.path} - HTTP ${status}, ${count} controls`)
    } catch { log?.(`rejected ${c.path} - would not load`) }
    if (ok) proven.push({ ...c, controls: count })
  }
  return proven
}

export function summarise(seeds, configured) {
  if (!seeds.length) return `seeds: none discovered - falling back to ${configured.join(', ')}`
  return `seeds: ${seeds.map((s) => `${s.path} (${s.controls})`).join(', ')}`
}
