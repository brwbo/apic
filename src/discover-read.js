/**
 * discover-read.js - compile a public consumer site into READ tools.
 *
 * The write path proves an action by making a state change the app confirms:
 * a toast, an echo, a new address. A read changes nothing, so there is no
 * confirmation to wait for and that evidence rule does not transfer. What a
 * read produces instead is STRUCTURE - a repeated list or card grid appears
 * where there was none, or the one already there now holds different rows.
 * That is the signal this file probes for, and it is just as falsifiable:
 * a probe that leaves the page's repeated structure untouched read nothing.
 *
 * Discovery is deliberately dumb about the target. It knows "search box",
 * "filter control" and "repeated sibling"; it does not know what a restaurant
 * is. The row schema - which of the strings in a card is a name and which is a
 * price - is the one part no heuristic can settle, so that is where the model
 * goes in, once, over three sample rows.
 *
 * Read-only by construction. Everything reaching the network goes through
 * `visit()` in replay-read.js: one request per second, cookies declined, and a
 * hard stop on any challenge page. No login, no basket, no checkout.
 */
import { writeFileSync } from 'node:fs'
import { affordances } from './explore.js'
import { fields as liveFields } from './forms.js'
import { nextReadAction } from './h.js'
import { distill } from './distill.js'
import { adjudicate, shot, visionAvailable } from './perceive.js'
import { emit } from './emit.js'
import { inferRowSchema, toTool } from './synthesize-read.js'
import { openRead, visit, replayRead, verifyRead, relaxReadSchema, ChallengeError } from './replay-read.js'

const SEARCHY = /search|postcode|post code|zip|location|address|where|find/i
const NOT_A_FILTER = /^(log ?in|sign ?up|download|get started|view all|skip to|cookie|privacy|terms|conditions|accessibility|careers|about|help|contact|next|previous|close|back)/i

/**
 * Every repeated structure on the page, with a selector durable enough to
 * record. Consumer sites ship hashed class names - `HomeFeedGrid-26729bd7` is
 * a different string after every deploy - so match the component prefix and
 * let the hash rot, the same trick forms.js uses on generated element ids.
 * A `data-testid` beats both: it exists because someone else also needed a
 * handle that survives a re-render.
 */
export async function lists(page) {
  return page.evaluate(() => {
    const stable = (el) => {
      const tid = el.getAttribute('data-testid')
      if (tid) return `[data-testid="${CSS.escape(tid).replace(/\\/g, '')}"]`
      const tag = el.tagName.toLowerCase()
      const cls = [...el.classList].filter((c) => !/^(ot-|optanon|is-|splide|css-)/.test(c))
      const comp = cls.find((c) => /^[A-Za-z][\w]*-[0-9a-f]{8,}$/.test(c))
      if (comp) return `${tag}[class*="${comp.split('-')[0]}-"]`
      if (cls.length) return `${tag}.${cls.map((c) => CSS.escape(c)).join('.')}`
      return null
    }
    // Leaf text nodes inside a card are the candidate columns. Anything with a
    // text-bearing child is a wrapper, and a wrapper's text is every column
    // concatenated - which is exactly the DOM dump a read tool must not return.
    const leaves = (row) => {
      const out = []
      const structural = (el) => {
        const parts = []
        let node = el
        while (node && node !== row) {
          const index = [...node.parentElement.children].indexOf(node) + 1
          parts.unshift(`${node.tagName.toLowerCase()}:nth-child(${index})`)
          node = node.parentElement
        }
        return parts.join(' > ')
      }
      for (const el of row.querySelectorAll('*')) {
        let sel = stable(el)
        if (!sel) continue
        // A utility class often appears on every textual child in a card. Its
        // bare selector makes "name", "price" and "description" all resolve
        // to the first node. Preserve the stable class AND its local type
        // position, which is durable across sibling values and re-renders.
        const siblings = [...(el.parentElement?.children || [])].filter((x) => x.tagName === el.tagName)
        if (siblings.length > 1) sel += `:nth-of-type(${siblings.indexOf(el) + 1})`
        // CSS-in-JS utility classes describe styling, not which value we need.
        // Keep an observed card-relative path for them so price cannot resolve
        // to the first badge ("Highly rated") on every row.
        if (/class\*="ccl-"/.test(sel)) sel = structural(el)
        const t = (el.textContent || '').trim().replace(/\s+/g, ' ')
        const href = el.tagName === 'A' ? el.getAttribute('href') : null
        if (href) out.push({ selector: sel, attr: 'href', sample: href.slice(0, 120) })
        if (!t || t.length > 120) continue
        if ([...el.children].some((c) => (c.textContent || '').trim())) continue
        out.push({ selector: sel, attr: null, sample: t.slice(0, 120) })
      }
      return out
    }

    const found = []
    for (const el of document.querySelectorAll('ul, ol, div, section')) {
      if (el.closest('footer, nav, aside, [role="dialog"]')) continue
      const container = stable(el)
      if (!container) continue
      const kids = [...el.children].filter((k) => {
        const r = k.getBoundingClientRect()
        return r.width > 60 && r.height > 30 && (k.textContent || '').trim().length > 10
      })
      if (kids.length < 3) continue
      const rows = kids.map((k) => (k.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 160))
      const avg = rows.reduce((s, t) => s + t.length, 0) / rows.length
      if (avg < 12) continue
      const rowSelector = stable(kids[0])
        || (kids.every((k) => k.tagName === kids[0].tagName) ? kids[0].tagName.toLowerCase() : null)
      const recurringLeaves = leaves(kids[0]).filter((l) => kids.slice(1, 3).some((k) => k.querySelector(l.selector)))
      // Component classes recur across unrelated carousels. Scope the recorded
      // container to a field witnessed inside this row, preferring test IDs;
      // otherwise replay's querySelector would take the first category carousel
      // rather than the restaurant carousel discovery actually selected.
      const discriminator = recurringLeaves.find((l) => l.selector.includes('data-testid')) || recurringLeaves[0]
      const scopedContainer = discriminator && rowSelector
        ? `${container}:has(> ${rowSelector} ${discriminator.selector})`
        : container
      found.push({
        container: scopedContainer,
        rowSelector,
        n: kids.length,
        rows: rows.slice(0, 6),
        // A column is a column only if it recurs. One card's "Sponsored" badge
        // is not a field of the collection.
        leaves: recurringLeaves,
        // The page may move on to another probe before schema synthesis. Keep
        // the observed per-row columns, rather than revisiting the seed URL and
        // accidentally asking a search-result selector to describe the home
        // page again.
        fieldRows: kids.slice(0, 3).map((k) => leaves(k)),
        score: kids.length * Math.min(Math.round(avg), 120),
      })
    }
    // Same selector can match several nodes; keep the richest instance of each.
    const best = new Map()
    for (const f of found.sort((a, b) => b.score - a.score)) if (!best.has(f.container)) best.set(f.container, f)
    return [...best.values()].slice(0, 12)
  })
}

/** A page's read affordances: boxes you can type a query into, controls that filter. */
async function probes(page, maxControls = Number(process.env.APIC_READ_CONTROLS || 8)) {
  const seenSearches = new Set()
  const searches = (await liveFields(page)).filter(
    (f) => (f.type === 'search' || f.type === 'text') && SEARCHY.test(`${f.name} ${f.placeholder} ${f.label}`),
  ).filter((f) => (seenSearches.has(f.selector) ? false : seenSearches.add(f.selector)))
  const controls = (await affordances(page))
    .filter((a) => !NOT_A_FILTER.test(a.label) && a.label.length <= 26 && a.label.split(' ').length <= 3)
    .slice(0, maxControls)
  return { searches, controls }
}

/** Did this probe surface a collection? A container that is new, longer, or now holds other rows. */
function changed(before, after) {
  const prior = new Map(before.map((l) => [l.container, l]))
  const moved = after
    .map((l) => {
      const was = prior.get(l.container)
      if (!was) return { ...l, why: 'list appeared' }
      if (l.n > was.n + 2) return { ...l, why: `list grew ${was.n} -> ${l.n}` }
      if (l.rows.join('|') !== was.rows.join('|')) return { ...l, why: 'list rows changed' }
      return null
    })
    .filter(Boolean)
    .filter((l) => l.leaves.length >= 2)
    // Whole-page/feed wrappers can contain hundreds of nodes but are never a
    // row collection a tool can replay. Prefer a bounded, denser result list
    // over a four-item promotion or the document-scale wrapper around it.
    .filter((l) => l.n <= 60)
  return moved.sort((a, b) => (b.n - a.n) || (b.leaves.length - a.leaves.length) || (b.score - a.score))[0] || null
}

/**
 * Probe one seed page and return whatever read recipes it yields.
 * `log` is the only channel out: this is a compile step, not a library call.
 */
export async function discoverRead(page, seed, { log = () => {}, query = process.env.APIC_READ_QUERY || 'EC2A 3AY', maxControls } = {}) {
  const out = []
  await visit(page, seed.url)
  const base = await lists(page)
  const { searches, controls: rawControls } = await probes(page, maxControls)
  const preferred = await nextReadAction(page, { candidates: rawControls.map((control) => control.label) })
  const controls = preferred ? [...rawControls].sort((a, b) => (a.label === preferred ? -1 : b.label === preferred ? 1 : 0)) : rawControls
  log(`${seed.url} - ${base.length} repeated structures, ${searches.length} search fields, ${controls.length} filter controls`)

  const judge = async (hit, label, beforeFrame = null) => {
    if (!hit) return null
    const action = {
      label, effect: 'creation', seedUrl: seed.url, parameters: [],
      evidence: { added: hit.rows, removed: [], from: seed.url, to: page.url(), announced: null },
      frames: { before: beforeFrame, after: visionAvailable() ? await shot(page) : null },
    }
    await distill([action], { log: (message) => log(`  pioneer: ${message}`) })
    if (action.perception?.escalate) await adjudicate([action], { log: (message) => log(`  fal: ${message}`) })
    return action.effect === 'cosmetic' ? null : { hit, perception: action.perception }
  }

  // A public workflow can have several location-like inputs (origin and
  // destination, departure and arrival). Probe that form as one transaction,
  // not as two unrelated one-field searches.
  if (searches.length >= 2) {
    const fields = searches.slice(0, 3)
    const keyFor = (field, index) => {
      const text = `${field.label} ${field.placeholder} ${field.name}`.toLowerCase()
      if (/pick.?up|origin|from|start/.test(text)) return 'origin'
      if (/destination|drop.?off|where to|arrival| to\b/.test(text)) return 'destination'
      return index ? `query${index + 1}` : 'query'
    }
    await visit(page, seed.url, { scroll: false })
    const before = await lists(page)
    const beforeFrame = visionAvailable() ? await shot(page) : null
    const inputs = [], samples = {}
    for (const [index, field] of fields.entries()) {
      const key = keyFor(field, index)
      const value = process.env[`APIC_READ_${key.toUpperCase()}`] || (index ? 'London Bridge' : query)
      await page.fill(field.selector, value, { timeout: 8000 }).catch(() => {})
      await page.waitForTimeout(600)
      const option = page.locator('[role="option"]:visible, [data-testid*="suggestion"]:visible').first()
      const selectSuggestion = Boolean(await option.count().catch(() => 0))
      if (selectSuggestion) await option.click({ timeout: 3000 }).catch(() => {})
      inputs.push({ selector: field.selector, schemaKey: key, selectSuggestion })
      samples[key] = value
    }
    const submit = await page.evaluate(() => [...document.querySelectorAll('button, a[href], [role="button"], input[type="submit"]')]
      .filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 })
      .map((el) => (el.value || el.innerText || '').trim())
      .find((label) => /^(see prices|get .*estimate|calculate|search|go|find)$/i.test(label)) || null)
    if (submit) await page.evaluate((label) => {
      const el = [...document.querySelectorAll('button, a[href], [role="button"], input[type="submit"]')]
        .find((node) => { const r = node.getBoundingClientRect(); return r.width > 0 && r.height > 0 && (node.value || node.innerText || '').trim() === label })
      el?.click()
    }, submit).catch(() => {})
    else await page.keyboard.press('Enter').catch(() => {})
    await page.waitForTimeout(5000)
    const judged = await judge(changed(before, await lists(page)), 'multi-input public form', beforeFrame)
    if (judged) out.push({ candidate: judged.hit, context: { title: await page.title(), url: page.url(), why: judged.hit.why, intent: 'results from a multi-input public form', perception: judged.perception },
      recipe: { via: 'form', origin: new URL(seed.url).origin, seedUrl: seed.url, submit, inputs,
        params: Object.fromEntries(inputs.map((input, index) => [input.schemaKey, fields[index].label || fields[index].placeholder || 'query'])) },
      samples, evidence: { control: fields.map((field) => field.label || field.placeholder).join(' + '), landedAt: page.url() } })
  }

  for (const f of searches.slice(0, 2)) {
    const label = f.label || f.placeholder || f.name
    await visit(page, seed.url, { scroll: false })
    const before = await lists(page)
    const beforeFrame = visionAvailable() ? await shot(page) : null
    await page.fill(f.selector, query, { timeout: 8000 }).catch(() => {})
    await page.waitForTimeout(1500)
    const option = page.locator('[role="option"]:visible, [data-testid*="suggestion"]:visible').first()
    const selectSuggestion = Boolean(await option.count().catch(() => 0))
    if (selectSuggestion) await option.click({ timeout: 3000 }).catch(() => {})
    const submit = await page.evaluate(() => [...document.querySelectorAll('button, a[href], [role="button"]')]
      .filter((el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 })
      .map((e) => (e.value || e.innerText || '').trim()).find((t) => /^(search|go|find)$/i.test(t)) || null)
    await page.evaluate((want) => {
      const el = [...document.querySelectorAll('button, a[href], [role="button"]')].find((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 && (e.value || e.innerText || '').trim() === want })
      el?.click()
    }, submit).catch(() => {})
    if (!submit) await page.keyboard.press('Enter').catch(() => {})
    await page.waitForTimeout(5000)
    await page.evaluate(() => window.scrollTo(0, 1000)).catch(() => {})
    await page.waitForTimeout(1500)
    const hit = changed(before, await lists(page))
    log(`  search "${label}" <- ${query} : ${hit ? `${hit.why}, ${hit.n} rows` : 'no collection surfaced'}`)
    const judged = await judge(hit, label, beforeFrame)
    if (judged) out.push({ candidate: judged.hit, context: { title: await page.title(), url: page.url(), why: judged.hit.why, intent: `search results for ${label}`, perception: judged.perception },
      recipe: { via: 'form', origin: new URL(seed.url).origin, seedUrl: seed.url, submit, inputs: [{ selector: f.selector, schemaKey: 'query', selectSuggestion }], params: { query: label || 'search query' } },
      samples: { query }, evidence: { control: label, landedAt: page.url() } })
  }

  for (const c of controls) {
    await visit(page, seed.url)
    const before = await lists(page)
    const beforeFrame = visionAvailable() ? await shot(page) : null
    const at = page.url()
    // The element's own click, not a synthetic mouse event at coordinates: a
    // consumer page keeps an invisible modal backdrop over everything long
    // after its dialog is gone, and it eats a real click without comment.
    await page.evaluate((want) => {
      const el = [...document.querySelectorAll('a[href], button, [role="button"]')]
        .find((e) => ((e.getAttribute('aria-label') || e.innerText || '').trim() === want))
      el?.click()
    }, c.label).catch(() => {})
    await page.waitForTimeout(4500)
    await page.evaluate(() => window.scrollTo(0, 1000)).catch(() => {})
    await page.waitForTimeout(1500)
    const hit = changed(before, await lists(page))
    const url = page.url()
    log(`  filter "${c.label}" : ${hit ? `${hit.why}, ${hit.n} rows -> ${url.replace(/^https?:\/\/[^/]+/, '')}` : 'no collection surfaced'}`)
    // A filter that never reached the address bar cannot be replayed as a URL,
    // and re-finding the control by label on every call is the fragile thing
    // this compiler exists to stop emitting. Skip it rather than ship it.
    const judged = await judge(hit, c.label, beforeFrame)
    if (!judged || url === at) continue
    out.push({ candidate: judged.hit, context: { title: await page.title(), url, why: judged.hit.why, perception: judged.perception },
      recipe: { via: 'url', origin: new URL(seed.url).origin, urlTemplate: templateFor(url, seed, c.label), params: seed.params || {} },
      samples: seed.samples || {}, evidence: { control: c.label, landedAt: url } })
  }
  return out
}

const slug = (s) => s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

/** Generalise the URL the probe landed on: the varying parts become parameters. */
function templateFor(url, seed, label) {
  const u = new URL(url)
  let path = u.pathname.replace(/\/$/, '')
  if (seed.areaPath && path.toLowerCase().endsWith(seed.areaPath.toLowerCase())) {
    path = path.slice(0, path.length - seed.areaPath.length) + '{area}'
  }
  const qs = [...u.searchParams.entries()]
    .filter(([, v]) => slug(v) === slug(label))
    .map(([k]) => `${k}={category}`)
  return `${u.origin}${path}${qs.length ? `?${qs.join('&')}` : ''}`
}

/** A tool for a page that IS the collection - no probe needed, the URL is the argument. */
export async function directRead(page, { url, param, description }, { log = () => {} } = {}) {
  await visit(page, url)
  const found = (await lists(page)).filter((l) => l.leaves.length >= 2)[0]
  log(`${url} - ${found ? `${found.n} rows, ${found.leaves.length} candidate columns` : 'no repeated structure'}`)
  if (!found) return null
  return { candidate: { ...found, why: 'page is the collection' }, context: { title: await page.title(), url, why: 'direct', intent: description },
    recipe: { via: 'url', origin: new URL(url).origin, urlTemplate: `{${param}}`, params: { [param]: description } },
    samples: { [param]: url }, evidence: { control: null, landedAt: url } }
}

/** Compile a site's read surface end to end: probe, infer, emit, verify. */
export async function compileRead({ app, seeds, direct = [], outDir = 'generated', target, headless = true, vocabulary = null, query, maxControls, log = console.log }) {
  const s = await openRead({ headless })
  const found = []
  try {
    for (const seed of seeds) found.push(...(await discoverRead(s.page, seed, { log, ...(query ? { query } : {}), ...(maxControls ? { maxControls } : {}) })))
    for (const d of direct) { const one = await directRead(s.page, d, { log }); if (one) found.push(one) }

    const tools = []
    for (const f of found) {
      const inferred = await inferRowSchema(f.candidate, s.page, { ...f.context, vocabulary })
      if (!inferred.fields.length) { log(`  ! ${f.context.url} - no field survived selector validation`); continue }
      const tool = toTool(inferred, f.candidate, f.recipe, f.samples, f.evidence)
      if (tools.some((t) => t.name === tool.name)) { log(`  ! duplicate tool ${tool.name} - keeping the first`); continue }
      log(`  = ${tool.name}(${Object.keys(tool.inputSchema.properties).join(', ')}) -> {${inferred.fields.map((x) => x.name).join(', ')}}`)
      tools.push(tool)
    }
    await s.browser.close().catch(() => {})

    // Verify cold: a browser that has never seen this site, one tool at a time.
    for (const t of tools) {
      t.verification = await verifyRead(t)
      if (!t.verification.verified) {
        const raw = await replayRead(t, t.samples)
        if (raw.ok && relaxReadSchema(t, raw)) t.verification = await verifyRead(t)
      }
      log(`  ${t.verification.verified ? '\x1b[32mVERIFIED\x1b[0m' : '\x1b[31mFAILED  \x1b[0m'} ${t.name} - ${t.verification.reason}`)
    }
    // A result card commonly links to the useful second collection: a shop's
    // menu, a product's variants, an event's tickets. Follow one verified
    // same-origin row and compile that page too. This turns search -> detail
    // into an API flow without baking any target-specific route into apic.
    const firstLinkedPage = tools
      .filter((t) => t.verification?.verified)
      .flatMap((t) => t.verification.sample || [])
      .map((row) => row.url)
      .find((url) => {
        try { return new URL(url).origin === new URL(target).origin } catch { return false }
      })
    if (firstLinkedPage && Number(process.env.APIC_READ_FOLLOW_LINKS || 1) > 0) {
      const linked = await openRead({ headless })
      try {
        const f = await directRead(linked.page, {
          url: firstLinkedPage,
          param: 'url',
          description: 'public item-page URL returned by a compiled listing tool',
        }, { log })
        if (f) {
          const inferred = await inferRowSchema(f.candidate, linked.page, { ...f.context, vocabulary })
          const tool = toTool(inferred, f.candidate, f.recipe, f.samples, f.evidence)
          if (inferred.fields.length && !tools.some((t) => t.name === tool.name)) {
            tools.push(tool)
            tool.verification = await verifyRead(tool)
            if (!tool.verification.verified) {
              const raw = await replayRead(tool, tool.samples)
              if (raw.ok && relaxReadSchema(tool, raw)) tool.verification = await verifyRead(tool)
            }
            log(`  ${tool.verification.verified ? '\x1b[32mVERIFIED\x1b[0m' : '\x1b[31mFAILED  \x1b[0m'} ${tool.name} - ${tool.verification.reason}`)
          }
        }
      } finally { await linked.browser.close().catch(() => {}) }
    }
    const verified = tools.filter((t) => t.verification?.verified)
    const { dir } = emit(tools, { app, outDir, target })
    writeFileSync(`${outDir}/${app}/rows.sample.json`,
      JSON.stringify(Object.fromEntries(verified.map((t) => [t.name, t.verification.sample])), null, 2))
    return { dir, tools, verified }
  } catch (e) {
    if (e instanceof ChallengeError) { log(`\x1b[31mSTOPPED\x1b[0m ${e.message}`); return { stopped: 'challenge', tools: [], verified: [] } }
    throw e
  } finally { await s.browser.close().catch(() => {}) }
}

export { replayRead, verifyRead }
