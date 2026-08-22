#!/usr/bin/env node
/**
 * doctor.js - check every provider key once, with a real call where cheap.
 * Run it after editing .env so nobody debugs credentials twice.
 */
import 'dotenv/config'

const checks = [
  {
    name: 'OpenAI', env: 'OPENAI_API_KEY', stages: 'synthesize, verify',
    live: async (k) => {
      const r = await fetch('https://api.openai.com/v1/models', { headers: { Authorization: `Bearer ${k}` } })
      return r.ok ? true : `HTTP ${r.status}`
    },
  },
  {
    name: 'fal', env: 'FAL_KEY', stages: 'perceive',
    live: async (k) => {
      const r = await fetch('https://rest.alpha.fal.ai/tokens/', { method: 'POST', headers: { Authorization: `Key ${k}`, 'Content-Type': 'application/json' }, body: '{}' })
      return r.status < 500 && r.status !== 401 && r.status !== 403 ? true : `HTTP ${r.status}`
    },
  },
  {
    name: 'Tavily', env: 'TAVILY_API_KEY', stages: 'ground',
    live: async (k) => {
      const r = await fetch('https://api.tavily.com/search', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ api_key: k, query: 'apic health check', max_results: 1 }),
      })
      return r.ok ? true : `HTTP ${r.status}`
    },
  },
  { name: 'h', env: 'H_API_KEY', stages: 'explore', live: null },
  { name: 'Pioneer', env: 'PIONEER_API_KEY', stages: 'distill (stretch)', live: null },
]

const targets = [
  { name: 'Vikunja', url: `${process.env.TARGET_URL || 'http://localhost:3456'}/api/v1/info` },
  { name: 'Gitea', url: 'http://localhost:3001/api/v1/version' },
]

const ok = (s) => `\x1b[32m${s}\x1b[0m`, bad = (s) => `\x1b[31m${s}\x1b[0m`, dim = (s) => `\x1b[2m${s}\x1b[0m`

let blocking = 0
console.log('\n  apic doctor\n')
for (const c of checks) {
  const key = process.env[c.env]
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
