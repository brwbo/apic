#!/usr/bin/env node
/**
 * doctor.js - check every provider key once, with a real call where cheap.
 * Run it after editing .env so nobody debugs credentials twice.
 */
import 'dotenv/config'
import * as h from './h.js'

// Providers say why they refused, in the response body. Guessing instead of
// quoting them once cost three checks: a Pioneer 403 was reported as a key
// format problem when the key was fine and the account had no payment method.
// So: read the body, print what it says, and only fall back to the bare status
// when there is nothing to read.
const MESSAGE_KEYS = ['message', 'error', 'detail', 'msg', 'description', 'title', 'reason']

// Providers nest the human-readable string differently: OpenAI uses
// {error:{message}}, Pioneer {detail:{message}}, fal and Tavily either a plain
// {detail:"..."} or a FastAPI array of {msg}. Walk the usual keys, shallowly.
const findMessage = (v, depth = 0) => {
  if (typeof v === 'string') return v.trim() || null
  if (!v || typeof v !== 'object' || depth > 4) return null
  if (Array.isArray(v)) {
    for (const item of v) { const m = findMessage(item, depth + 1); if (m) return m }
    return null
  }
  for (const k of MESSAGE_KEYS) {
    if (k in v) { const m = findMessage(v[k], depth + 1); if (m) return m }
  }
  return null
}

// This repo is public and doctor output gets pasted into issues. Never let a
// server's echo of the credential through.
const redact = (s, key) =>
  (key ? s.split(key).join('***') : s).replace(/\b(sk-|pio_sk_|key-)[A-Za-z0-9_-]{8,}/g, '$1***')

const clip = (s) => { const t = s.replace(/\s+/g, ' ').trim(); return t.length > 300 ? `${t.slice(0, 297)}...` : t }

/**
 * Turn a failed Response into a line the reader can act on, using the server's
 * own words. Never throws: an empty, truncated or non-JSON body just yields the
 * status code (plus `fallback`, when the caller has something factual to add).
 */
const apiError = async (r, key, fallback = '') => {
  let raw = ''
  try { raw = await r.text() } catch { raw = '' }
  let parsed = null
  try { parsed = JSON.parse(raw) } catch { parsed = null }

  // HTML error pages carry no useful message, only markup - do not quote them.
  const plain = raw.trim().startsWith('<') ? '' : raw.trim()
  const message = findMessage(parsed) || plain
  const detail = parsed && typeof parsed === 'object' ? (parsed.detail ?? parsed.error ?? parsed) : null
  const field = (k) => (detail && typeof detail === 'object' && !Array.isArray(detail) && typeof detail[k] === 'string' ? detail[k] : '')
  const code = field('code') || field('type')
  const link = field('resolution_url') || field('help_url') || field('docs_url')

  let out = `HTTP ${r.status}`
  if (message) out += ` - ${redact(clip(message), key)}`
  else if (fallback) out += ` - ${fallback}`
  else if (r.status === 401 || r.status === 403) out += ' - credential rejected, no reason given'
  if (code) out += ` [${code}]`
  if (link && !out.includes(link)) out += ` -> ${link}`
  return out
}

// Only call a key malformed when the API itself complained about its shape.
const blamesKeyFormat = (s) => /(malformed|must start|must begin|invalid format|bad format|key format|not a valid (api )?key)/i.test(s)

const checks = [
  {
    name: 'OpenAI', env: 'OPENAI_API_KEY', stages: 'synthesize, verify',
    live: async (k) => {
      const r = await fetch('https://api.openai.com/v1/models', { headers: { Authorization: `Bearer ${k}` } })
      return r.ok ? true : await apiError(r, k)
    },
  },
  {
    name: 'fal', env: 'FAL_KEY', stages: 'perceive',
    live: async (k) => {
      const r = await fetch('https://rest.alpha.fal.ai/tokens/', { method: 'POST', headers: { Authorization: `Key ${k}`, 'Content-Type': 'application/json' }, body: '{}' })
      // A 4xx that is not an auth refusal means the key got through and the
      // probe body was merely rejected, which is all this check needs to know.
      if (r.status < 500 && r.status !== 401 && r.status !== 403) return true
      return await apiError(r, k)
    },
  },
  {
    name: 'Tavily', env: 'TAVILY_API_KEY', stages: 'ground',
    live: async (k) => {
      const r = await fetch('https://api.tavily.com/search', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ api_key: k, query: 'apic health check', max_results: 1 }),
      })
      return r.ok ? true : await apiError(r, k)
    },
  },
  {
    name: 'h', env: 'HAI_API_KEY', stages: 'explore (Holo planner)',
    live: async (k) => {
      // Two different surfaces, and apic depends on the second one. The hosted
      // Agent Platform runs the browser on h's infrastructure, so it cannot
      // reach a target on localhost; the planner uses Holo inference instead.
      const r = await fetch('https://agp.eu.hcompany.ai/api/v2/sessions', { headers: { Authorization: `Bearer ${k}` } })
      const platform = r.status === 401 || r.status === 403 ? `key rejected (HTTP ${r.status})` : `reachable (HTTP ${r.status})`

      const inf = await h.check()
      if (!inf.ok) return `inference FAILED at ${inf.baseUrl} (${inf.reason}) - set HAI_MODEL_URL; platform ${platform}`
      return true
    },
  },
  {
    name: 'Pioneer', env: 'PIONEER_API_KEY', stages: 'distill',
    live: async (k) => {
      // /base-models is public, so it proves reachability but not the key.
      // A one-token /inference against the base encoder is what actually
      // exercises auth, and it costs a fraction of a credit.
      const r = await fetch('https://api.pioneer.ai/inference', {
        method: 'POST',
        headers: { 'X-API-Key': k, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model_id: 'fastino/gliner2-base-v1', text: 'apic health check', schema: { classifications: [{ task: 'ok', labels: ['yes', 'no'], multi_label: false }] } }),
        signal: AbortSignal.timeout(20000),
      })
      // 401/403 is not automatically a bad key: billing holds land here too,
      // and the body says which. 402 likewise names the shortfall itself.
      if (r.status === 401 || r.status === 403 || r.status === 402) {
        const msg = await apiError(r, k, r.status === 402 ? 'out of credits - top up at pioneer.ai' : '')
        return blamesKeyFormat(msg) ? `${msg} (Pioneer keys start pio_sk_)` : msg
      }
      // Any other 4xx means auth passed and only the probe payload was refused.
      return r.status < 500 ? true : await apiError(r, k)
    },
  },
]

const targets = [
  { name: 'Vikunja', url: `${process.env.TARGET_URL || 'http://localhost:3456'}/api/v1/info` },
  { name: 'Gitea', url: 'http://localhost:3001/api/v1/version' },
]

const ok = (s) => `\x1b[32m${s}\x1b[0m`, bad = (s) => `\x1b[31m${s}\x1b[0m`, dim = (s) => `\x1b[2m${s}\x1b[0m`

let blocking = 0
console.log('\n  apic doctor\n')
for (const c of checks) {
  const key = (process.env[c.env] || '').trim()
  if (!key) { console.log(`  ${bad('MISSING')}  ${c.name.padEnd(9)} ${dim(c.env)}  ${dim('blocks: ' + c.stages)}`); blocking++; continue }
  if (!c.live) { console.log(`  ${dim('SET    ')}  ${c.name.padEnd(9)} ${dim('present, not live-checked')}`); continue }
  try {
    const r = await c.live(key)
    if (r === true) console.log(`  ${ok('OK     ')}  ${c.name.padEnd(9)} ${dim('live call succeeded')}`)
    else { console.log(`  ${bad('BAD    ')}  ${c.name.padEnd(9)} ${bad(String(r))}`); blocking++ }
  } catch (e) { console.log(`  ${bad('ERROR  ')}  ${c.name.padEnd(9)} ${bad(e.message)}`); blocking++ }
}
console.log()
for (const t of targets) {
  try {
    const r = await fetch(t.url, { signal: AbortSignal.timeout(3000) })
    console.log(`  ${r.ok ? ok('UP     ') : bad('DOWN   ')}  ${t.name.padEnd(9)} ${dim(t.url)}`)
  } catch { console.log(`  ${bad('DOWN   ')}  ${t.name.padEnd(9)} ${dim('docker start vikunja gitea')}`) }
}
console.log(blocking ? `\n  ${bad(blocking + ' blocking')} - fill them in .env, then rerun\n` : `\n  ${ok('all clear')}\n`)
