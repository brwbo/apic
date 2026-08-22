/**
 * ground.js - discover the app's vocabulary instead of hardcoding it.
 *
 * plan.js decides what a control is by matching its label against RESOURCE and
 * GESTURE_VERB. Those tables are hand-written and they are Vikunja's words:
 * bucket, task, label, project. Point apic at Gitea and the same tables are
 * asked about issues, repositories, pull requests and milestones, which they
 * have never heard of - so every one of those controls falls through to h, and
 * whatever h cannot place is dropped. The compiler is only as general as its
 * noun list, and today that list is a constant in a source file.
 *
 * This reads the app's own documentation and derives the list per app. Tavily
 * finds and fetches the docs; OpenAI turns that prose into a closed set of
 * nouns under a strict schema. Neither is trusted blind: every term is
 * validated, capped, and merged into the built-in table rather than replacing
 * it, so grounding can add vocabulary but can never take Vikunja's away.
 *
 * Degrades in three steps. No TAVILY_API_KEY and there is no evidence, so
 * nothing is learned. No OPENAI_API_KEY and the evidence cannot be structured,
 * so nothing is learned. Either way the built-in table stands and the compile
 * runs exactly as it did before - this stage can improve a compile, never
 * break one.
 *
 * The result is cached per host under .apic/, so a demo does not depend on
 * venue wifi and a repeat compile spends nothing.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import OpenAI from 'openai'
import { config } from './config.js'

const CACHE_DIR = process.env.APIC_VOCAB_DIR || '.apic'
const MODEL = process.env.OPENAI_MODEL || 'gpt-4.1-mini'
const MAX_NOUNS = 12
const MAX_OFF_SLICE = 20

/**
 * A canonical noun is one lowercase word - it becomes part of a tool name, so
 * `createIssue` not `createPullRequestReviewComment`. A SYNONYM may carry one
 * space, because the canonical noun is frequently not what the UI says: Gitea's
 * docs call it a `pullrequest` and its button says "New Pull Request", and
 * without the spaced synonym that control never matches at all.
 */
const TERM = /^[a-z][a-z-]{1,18}$/
const SYNONYM = /^[a-z][a-z -]{1,24}$/

const SCHEMA = {
  type: 'object',
  properties: {
    app: { type: 'string', description: 'The product this documentation is for.' },
    nouns: {
      type: 'array',
      description: 'The domain objects a user creates, edits and deletes in this app. Singular, lowercase, one word.',
      items: {
        type: 'object',
        properties: {
          canonical: { type: 'string', description: 'Singular lowercase noun, e.g. "issue".' },
          synonyms: { type: 'array', items: { type: 'string' }, description: 'Other words the UI uses for the same object, INCLUDING the spaced form if the canonical noun is a compound - for "pullrequest" include "pull request". Lowercase, singular.' },
        },
        required: ['canonical', 'synonyms'],
        additionalProperties: false,
      },
    },
    offSlice: {
      type: 'array',
      description: 'Words naming controls that write state but are NOT core object CRUD - watch, star, fork, subscribe, notification settings and the like.',
      items: { type: 'string' },
    },
  },
  required: ['app', 'nouns', 'offSlice'],
  additionalProperties: false,
}

const SYSTEM = `You read documentation for a web application and name the objects its users create, rename and delete.
Return the small set of CORE domain nouns - the things the product is fundamentally about. For a task manager that is
project, task, label. For a code host it is repository, issue, branch, release. Exclude anything that is a setting, a
view, a filter, a permission, or an account concept. Prefer the word the product's own UI uses. Singular, lowercase,
one word each. If the documentation does not make an object clear, leave it out - a short accurate list beats a long
speculative one.`

export function available() { return Boolean(config.keys.tavily) }

const cachePath = (url) => join(CACHE_DIR, `vocab-${new URL(url).host.replace(/[^a-z0-9.-]/gi, '_')}.json`)

/** Ask Tavily for the app's documentation. Returns prose evidence, or null. */
async function evidence(app, url) {
  const res = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      api_key: config.keys.tavily,
      query: `${app} documentation: what objects can users create, edit and delete`,
      max_results: 5,
      include_answer: true,
      search_depth: 'basic',
    }),
    signal: AbortSignal.timeout(25000),
  })
  if (!res.ok) throw new Error(`tavily HTTP ${res.status}`)
  const body = await res.json()
  const parts = [body.answer, ...(body.results || []).map((r) => r.content)].filter(Boolean)
  if (!parts.length) return null
  return {
    text: parts.join('\n\n').slice(0, 12000),
    sources: (body.results || []).map((r) => r.url).slice(0, 5),
  }
}

/** Turn prose into a closed vocabulary under a strict schema. */
async function structure(app, text) {
  const client = new OpenAI({ apiKey: config.keys.openai, timeout: 30000 })
  const res = await client.chat.completions.create({
    model: MODEL,
    response_format: { type: 'json_schema', json_schema: { name: 'vocabulary', strict: true, schema: SCHEMA } },
    messages: [
      { role: 'system', content: SYSTEM },
      { role: 'user', content: `Application: ${app}\n\nDocumentation:\n${text}` },
    ],
  })
  return JSON.parse(res.choices[0].message.content)
}

/**
 * A model asked for nouns will return phrases, plurals and whole sentences.
 * Everything that is not one lowercase word is dropped rather than repaired -
 * a bad noun becomes a regex that matches the wrong controls, and a wrong
 * gesture becomes a tool that does not exist.
 */
export function validate(raw) {
  const seen = new Set()
  const nouns = []
  for (const n of raw?.nouns || []) {
    const canonical = String(n?.canonical || '').trim().toLowerCase()
    if (!TERM.test(canonical) || seen.has(canonical)) continue
    seen.add(canonical)
    const synonyms = [...new Set((n.synonyms || [])
      .map((s) => String(s).trim().toLowerCase().replace(/\s+/g, ' '))
      .filter((s) => SYNONYM.test(s) && s !== canonical))].slice(0, 4)
    nouns.push({ canonical, synonyms })
    if (nouns.length >= MAX_NOUNS) break
  }
  const offSlice = [...new Set((raw?.offSlice || [])
    .map((s) => String(s).trim().toLowerCase())
    .filter((s) => TERM.test(s)))].slice(0, MAX_OFF_SLICE)
  return { app: String(raw?.app || '').slice(0, 60), nouns, offSlice }
}

/**
 * Discover the vocabulary for one target. Never throws: every failure path
 * returns null and the caller keeps its built-in table.
 */
export async function ground({ app, url, refresh = false, log } = {}) {
  const path = cachePath(url)
  if (!refresh && existsSync(path)) {
    try {
      const cached = JSON.parse(readFileSync(path, 'utf8'))
      if (cached?.nouns?.length) return { ...cached, cached: true }
    } catch { /* a corrupt cache is no cache */ }
  }

  if (!available()) { log?.('no TAVILY_API_KEY - vocabulary not grounded, built-in table stands'); return null }
  if (!config.keys.openai) { log?.('no OPENAI_API_KEY - Tavily evidence cannot be structured, built-in table stands'); return null }

  let found
  try {
    found = await evidence(app, url)
    if (!found) { log?.('tavily returned no usable content'); return null }
  } catch (e) { log?.(`tavily: ${e.message}`); return null }

  let vocab
  try {
    vocab = validate(await structure(app, found.text))
  } catch (e) { log?.(`vocabulary extraction failed: ${e.message}`); return null }

  if (!vocab.nouns.length) { log?.('no usable nouns survived validation'); return null }

  const result = { ...vocab, sources: found.sources, groundedAt: new Date().toISOString() }
  try {
    mkdirSync(dirname(path) || '.', { recursive: true })
    writeFileSync(path, JSON.stringify(result, null, 2))
  } catch { /* an ungrounded cache is still a usable vocabulary */ }
  return result
}

/** One line for the compile log. */
export function summarise(v) {
  if (!v) return 'vocabulary: built-in (Vikunja board terms) - not grounded'
  const where = v.cached ? 'cached' : `via Tavily, ${v.sources?.length || 0} sources`
  return `vocabulary: ${v.nouns.length} nouns from ${v.app || 'the docs'} (${where}) - ${v.nouns.map((n) => n.canonical).join(', ')}`
}
