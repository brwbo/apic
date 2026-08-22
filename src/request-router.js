/**
 * request-router.js - turn one user request into a verified public workflow.
 *
 * This is deliberately above the compiler: callers provide prose, never a
 * target URL or selector. The router finds a candidate public site, compiles
 * its read surface, then lets a model choose from only the tools that survived
 * cold replay. It cannot bypass a login/challenge; those are returned as an
 * honest inability, not papered over with an invented answer.
 */
import OpenAI from 'openai'
import { config } from './config.js'
import { ground } from './ground.js'
import { compileRead, replayRead } from './discover-read.js'

const MODEL = process.env.OPENAI_MODEL || 'gpt-4.1-mini'
const client = () => new OpenAI({ apiKey: config.keys.openai, timeout: 45000 })
const json = (text) => { try { return JSON.parse(String(text).replace(/```json|```/g, '').trim()) } catch { return null } }

async function findSites(request) {
  if (!config.keys.tavily) return []
  try {
    const response = await fetch('https://api.tavily.com/search', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        api_key: config.keys.tavily,
        query: `${request}\nFind an official online ordering, catalogue, availability or price-estimator website. Exclude articles, reviews, directories and social-video pages.`,
        max_results: 8, search_depth: 'advanced',
      }),
      signal: AbortSignal.timeout(25000),
    })
    if (!response.ok) return []
    const body = await response.json()
    return (body.results || []).map((r) => ({ url: r.url, title: r.title || '' }))
      .filter((r) => /^https?:\/\//.test(r.url))
      .sort((a, b) => candidateScore(b) - candidateScore(a)).slice(0, 8)
  } catch { return [] }
}

// This ranks result *types*, not websites: a primary service with an order or
// price flow is more likely to yield a replayable tool than an editorial guide.
function candidateScore({ url, title }) {
  const text = `${url} ${title}`.toLowerCase()
  let score = /order|delivery|menu|prices?|estimate|book|near.?me|store|catalog|availability/.test(text) ? 3 : 0
  if (/\/near-me\/|\/store\/|\/order\b|\/menu\b|\/price/.test(url)) score += 2
  if (/review|guide|article|news|magazine|blog|directory|list of|youtube|instagram|tiktok|facebook|reddit/.test(text)) score -= 6
  return score
}

async function chooseSite(request, sites) {
  if (!config.keys.openai || !sites.length) return null
  try {
    const response = await client().chat.completions.create({
      model: MODEL, temperature: 0,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: 'Choose one public website that can answer the request through an interactive search, catalog, estimator or availability flow. Prefer a primary service or merchant over editorial, review, news, directory and comparison pages. Return JSON only: {"url":"one exact candidate URL","query":"the location, search phrase, or other value to enter"}. Never invent a URL.' },
        { role: 'user', content: JSON.stringify({ request, candidates: sites }) },
      ],
    })
    const choice = json(response.choices?.[0]?.message?.content)
    const url = sites.find((site) => site.url === choice?.url)?.url
    return url ? { url, query: String(choice.query || request).slice(0, 200) } : null
  } catch { return null }
}

const toolSummary = (tools) => tools.map((tool) => ({ name: tool.name, description: tool.description, inputSchema: tool.inputSchema }))

async function nextStep(request, tools, observations) {
  try {
    const response = await client().chat.completions.create({
      model: MODEL, temperature: 0, response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: 'You are an agent using read-only web tools. Return JSON only. Either {"tool":"exact tool name","arguments":{...}} to call a tool, or {"answer":"concise answer based only on observations"}. Use a tool when more evidence is needed. Never invent prices, availability, or URLs.' },
        { role: 'user', content: JSON.stringify({ request, tools: toolSummary(tools), observations }) },
      ],
    })
    return json(response.choices?.[0]?.message?.content)
  } catch { return null }
}

/** Run an autonomous public-read request. It returns an answer plus evidence. */
export async function fulfillRequest(request, { outDir = 'generated', log = () => {} } = {}) {
  request = String(request || '').trim()
  if (!request || request.length > 1000) return { ok: false, error: 'request must be between 1 and 1000 characters' }
  if (!config.keys.openai || !config.keys.tavily) {
    return { ok: false, error: 'fulfill_request needs OPENAI_API_KEY and TAVILY_API_KEY to select a public site' }
  }
  const sites = await findSites(request)
  const choice = await chooseSite(request, sites) || (sites[0] ? { url: sites[0].url, query: request.slice(0, 200) } : null)
  if (!choice) return { ok: false, error: 'could not identify a suitable public site from search results' }
  // Search results are only candidates, not proof that a page can be read.
  // Try a small, origin-distinct fallback set when a site blocks public access
  // or its flow simply does not yield rows. That is how this remains generic
  // without treating any named site as a special case.
  const candidates = [choice.url, ...sites.map((site) => site.url)]
    .filter((url, index, all) => {
      try { return all.findIndex((other) => new URL(other).origin === new URL(url).origin) === index } catch { return false }
    })
    .slice(0, Number(process.env.APIC_REQUEST_SITES || 2))
  let app, target, compiled
  const attempts = []
  for (const seedUrl of candidates) {
    target = new URL(seedUrl).origin
    app = new URL(target).hostname.replace(/^www\./, '').split('.')[0]
    log(`selected ${seedUrl}`)
    const vocabulary = await ground({ app, url: seedUrl, log })
    try {
      const candidate = await compileRead({
        app, target, outDir, headless: true, query: choice.query, vocabulary,
        seeds: [{ url: seedUrl, samples: {} }], direct: [],
        maxControls: Number(process.env.APIC_REQUEST_CONTROLS || 3), log,
      })
      if (candidate.verified?.length) { compiled = candidate; break }
      attempts.push(`${target}: no cold-verified tool`)
    } catch (error) {
      attempts.push(`${target}: ${String(error.message || error).slice(0, 120)}`)
    }
  }
  if (!compiled) return { ok: false, target: candidates[0], error: `no candidate yielded a cold-verified public tool (${attempts.join('; ')})` }
  const tools = compiled.verified || []
  if (!tools.length) return { ok: false, target, error: 'the public flow did not yield a cold-verified tool' }

  const observations = []
  for (let turn = 0; turn < 3; turn++) {
    const step = await nextStep(request, tools, observations)
    if (step?.answer) return { ok: true, app, target, answer: step.answer, evidence: observations, tools: tools.map((t) => t.name), compiled }
    const tool = tools.find((candidate) => candidate.name === step?.tool)
    if (!tool || !step?.arguments || typeof step.arguments !== 'object') break
    const result = await replayRead(tool, step.arguments)
    observations.push({ tool: tool.name, arguments: step.arguments, result: result.ok ? { count: result.count, rows: result.rows.slice(0, 20), url: result.url } : { error: result.error } })
    if (!result.ok) break
  }
  if (!observations.length) return { ok: false, target, error: 'the planner could not execute a verified tool', tools: tools.map((t) => t.name) }
  const answer = await nextStep(request, tools, observations)
  return { ok: true, app, target, answer: answer?.answer || 'I found results but could not safely summarise them.', evidence: observations, tools: tools.map((t) => t.name), compiled }
}
