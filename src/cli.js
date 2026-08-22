#!/usr/bin/env node
import { launch, login, probe, describe } from './explore.js'
import { config } from './config.js'
import { writeFileSync, mkdirSync } from 'node:fs'

const headless = !process.argv.includes('--headed')
const { browser, page } = await launch({ headless })
try {
  console.log(`\n  logging in to ${config.target.url}`)
  const home = await login(page)
  console.log(`  in: ${home}\n`)

  const trajectory = await probe(page, {
    baseUrl: home,
    limit: Number(process.env.LIMIT || 12),
    onStep: (s) => console.log(`  ${s.changed ? '*' : ' '} ${s.label.padEnd(32).slice(0, 32)} ${s.error ? 'ERR ' + s.error.slice(0, 40) : describe(s)}`),
  })

  mkdirSync('out', { recursive: true })
  writeFileSync('out/trajectory.json', JSON.stringify(trajectory, null, 2))
  const changed = trajectory.filter((t) => t.changed).length
  console.log(`\n  ${changed}/${trajectory.length} actions changed state -> out/trajectory.json\n`)
} finally { await browser.close() }
