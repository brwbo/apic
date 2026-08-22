#!/usr/bin/env node
import { launch, login } from './explore.js'
import { discoverOn, describe } from './discover.js'
import { synthesize } from './synthesize.js'
import { emit } from './emit.js'
import { config } from './config.js'
import { writeFileSync, mkdirSync } from 'node:fs'

const SEEDS = ['/projects', '/labels']
const headless = !process.argv.includes('--headed')
const { browser, page } = await launch({ headless })

try {
  console.log(`\n  apic compile -> ${config.target.url}\n`)
  await login(page)

  const actions = []
  for (const seed of SEEDS) {
    const url = `${config.target.url}${seed}`
    console.log(`  seed ${seed}`)
    const found = await discoverOn(page, url, {
      onStep: (s, d) => console.log(`    ${s.changed ? '\x1b[32m*\x1b[0m' : ' '} ${s.label.padEnd(26).slice(0, 26)} ${s.parameters.length ? `[${s.parameters.length}p] ` : '     '}${describe(d).slice(0, 46)}`),
    })
    actions.push(...found)
  }

  mkdirSync('out', { recursive: true })
  writeFileSync('out/actions.json', JSON.stringify(actions, null, 2))
  const withParams = actions.filter((a) => a.parameters.length).length
  console.log(`\n  ${actions.length} candidate actions (${withParams} with parameters)`)

  const tools = synthesize(actions)
  const { dir, count } = emit(tools, { app: 'vikunja', target: config.target.url })
  console.log(`  ${count} tools synthesised -> ${dir}/`)
  tools.forEach((t) => console.log(`    ${t.name}(${Object.keys(t.inputSchema.properties).join(', ')})`))
  console.log()
} finally { await browser.close() }
